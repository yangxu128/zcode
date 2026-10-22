# 无限画布侧边面板（Canvas Pane）规格

## 行为

侧边面板新增「无限画布」标签类型：可平移缩放的无限画布，用节点卡片组织想法与素材，
用连线表达关系。入口位于侧边面板的「打开标签页」启动项（与辅助对话/审查/终端/浏览器
并列）。实现参考外部项目 shortdrama-studio 的自研画布（视口变换 + 指针事件 + SVG 连线），
按 ZCode 面板体系重新适配，不引入第三方画布库。

- 节点类型（MVP）：`text`（文本卡）、`note`（彩色便签）、`image`（图片卡）。
- 连线：`flow`（流程，实线）与 `depends`（依赖，虚线）；从节点左右侧「+」新建时自动连线。
- 交互：空白处拖拽平移（中键 / Shift+左键 / 手型模式）、左键框选、节点拖动（8px 网格
  吸附，可关）、Ctrl/⌘+滚轮以指针为中心缩放、双击边删除、Del 删除选区、⌘D 复制、
  ⌘A 全选、⌘0 适应画布（作用域仅限画布面板获得焦点时，不劫持全局快捷键）。
- 覆盖层：左侧工具栏（新增节点、手型/选择切换）、右下缩放控制（含适应画布、吸附开关）、
  右上小地图（点击跳转）、多选对齐/分布工具条、右键菜单、空态提示。
- 持久化：按 workspace + board 维度存 localStorage（防抖 600ms；配额溢出时剥离图片
  data URL 重试，行为对齐参考实现）。刷新后恢复文档；视口/选区不持久化。
- 图片节点：本地上传经 canvas 降采样（最长边 1280、JPEG 0.85）转 data URL 存储；
  `URL.createObjectURL` 不落盘，不得作为持久化来源。

## 与 Agent 联动

### T1 · 画布 → 对话（已实现）

- 入口：画布右下控制区最左侧的「发送到对话」按钮；有选中节点时只发送选区，
  否则发送整块画布。
- 序列化：`serializeCanvasToMarkdown` 把节点（标题/正文/说明）与连线关系
  （流程/依赖）转为 Markdown；图片 data URL 不内联，仅标注存在。
- 传递：画布面板派发 `zcode:add-canvas-to-chat` CustomEvent（detail 携带
  workspacePath/Identity 与构造好的 Markdown File），`useComposerAttachments`
  中聚焦的 composer 监听该事件，按 workspace 归属过滤后经 `addAttachmentFiles`
  以附件注入对话——与 whiteboard 的 PNG 附件同模式。
- Agent 侧无需改动：内容作为普通文件附件进入对话，走既有上传链路。

### T2 · Agent → 画布（工作区文件迁移）

画布文档真值迁移到工作区文件 `<workspacePath>/.zcode/canvas/<boardId>.json`
（CanvasDocument JSON）：agent 用既有文件读写工具即可查看和修改画布，
文档随工作区进 git 获得版本历史，多窗口/多端自然一致。

**前置：受控文件写 RPC**（本次实现）：

- `IFileService.writeWorkspaceTextFile({ path, content })` →
  `{ path, bytesWritten }`。与 `readTextFile` 同信任域（宿主进程内直接 fs，
  绝对路径；agent 写工具本就可写任意工作区路径，此 RPC 不构成新的提权面）。
- 约束：内容上限 4MB（画布文档远小于此）；父目录自动创建；
  经 `atomicWriteText` 原子落盘（临时文件 + 重命名 + 重试）。

**画布侧迁移**（本次实现）：

- 持久化所有者改为工作区文件；store 的持久化后端可注入
  （`setPersistBackend`），默认仍是 localStorage（服务不可用/测试降级），
  CanvasPane 挂载后切换为文件后端——同一时刻只有一个写入路径。
- 水合顺序：读文件 → 缺失时读 localStorage 旧键做一次性导入（写文件，
  旧键保留不删作为备份）→ 都缺失则空画布。
- 外部变更跟随：`fileWatcherService.watch` 画布文件，`onDynamicChange`
  触发重读并整体替换 store 文档；自身写入的回声用 `updatedAt` 比对跳过
  （外部写入若恰好同毫秒会被吞，可忽略）。
- agent 写入格式约定：合法 CanvasDocument JSON（boardId/nodes/edges 字段，
  节点 kind 白名单 text|note|image）；非法 JSON 或形状不符时画布保持当前
  内容并在 debug 日志记录，不崩面板。

### T3 · 导演台桥（MVP 已实现）与流水线（远期）

已实现的第一片：画布右下「让 Agent 扩展」（星形按钮）——有选中节点时提示词
聚焦这些节点，否则面向整块画布；一键同时完成 T1 附件注入与
requestComposerTextInsert 提示词预填（指向工作区画布文件，要求 agent 写回，
节点 kind 限 text/note/image）。提示词可在发送前编辑。配套改动：SessionPane
的工作区级文本预填消费放宽为「聚焦即可」（原 root-only 使任务会话永远收不到）。

远期：画布内的导演台节点（配置模型/风格/批量）、流水线编排、面板内流式呈现。

### T4 · 节点内生成（P1：图片）

即梦式体验的第一片：图片节点不只能上传，还能就地生成。

- 入口与参数：空图片节点在「选择图片」旁提供「生成」；参数为该模态的
  `prompt` / `size`（1K/2K/3K/4K）/ `ratio`，随节点持久化，重开面板仍可见。
- 执行位置：点生成经**工作区级 RPC** 打到 agent 侧 `GenerationPort.generateImage`
  （docs/agents/image-video-generation.md）。凭据只在宿主端口实现内部，UI 请求与节点
  数据里都不出现 apiKey。目标模型由服务端按注册表候选顺序解析，UI 不指定 provider/model。
- 结果只存引用：远端结果继续用节点的 `url`；Base64 结果由宿主落盘到
  `<workspace>/.zcode/generated/*`，节点存工作区相对路径。**禁止把生成图降采样成 data URL
  写进画布文档**——外部重读按 256KB 分块拉整份文档，MB 级内联会让每次 agent 写入后的
  刷新都退化成大文件搬运。上传本地小图仍沿用既有 data URL 路径，两者不混用。
- 任务态：节点可选 `generation: { status: "idle" | "running" | "failed", error?, prompt,
size?, ratio? }`。`running` 期间卡片显示骨架并禁用重复提交；`failed` 显示 API 原文
  （含 request id）并可重试。P1 不做生成中取消，也不做跨刷新恢复（分钟级的视频任务恢复归 P2）。
- 写入者不变：结果通过 canvasStore 的 action 落到节点，仍走同一条 `persistBackend`
  单写路径。生成期间 agent 也改了画布文件时，以文件监听的外部真值整体替换为准，
  P1 不做字段级合并（不引入第二份文档真值）。

验收场景：

1. 工作区配了生图模型：空图片节点填 prompt → 生成 → 卡片出图，画布 JSON 里该节点只有
   `url` 或 `savedPath` 引用，没有 base64。
2. 没配生图模型：点击后给出可操作提示（去模型设置添加生图模型），节点回到 idle 且保留 prompt。
3. 凭据错或网络失败：`failed` + 原因原文，重试可用。
4. 生成期间 agent 改写画布文件：外部真值替换生效，面板不崩、不产生半写入状态。

兼容：P1 不新增节点 kind，只给 image 节点加可选字段，旧客户端的 kind 白名单与
strict 剥离行为不变；差别是只认 `url` 的旧版本看不到「工作区文件」型结果，
按空图占位显示，不报错。

### T5 · 视频节点与连线即输入

- 视频节点（kind `video`）：空节点内填 prompt + 时长（4–12 秒）+ 画幅，点「生成视频」
  只**创建任务**并立刻返回 `providerId/modelId/videoId`，写进节点的
  `generation.task`。查询走独立 RPC `workspace/videoTask`。
- 轮询归属：由 `useCanvasVideoTasks`（画布面板级）统一驱动，默认 3 秒一轮在途任务；
  卡片不各自起定时器。因为任务身份在文档里，刷新、重开面板或换设备后仍继续查同一个任务。
  单次查询失败按「仍在运行」处理，不改节点状态；创建超过 **30 分钟**仍未完成才标为失败
  （免费档排队 + 出片实测十几二十分钟，判死太早会把还在正常排队的任务误报成超时，
  口径与宿主端口 `VIDEO_POLL_TIMEOUT_MS` 一致），
  避免僵尸 running 永久占住按钮。定时器只依赖「任务签名」而不是文档对象，否则轮询写回
  会重启 effect 并立刻再查一轮，把远端打成高频轮询。
- **排队重投（T5 增补）**：`startVideo` 返回 `queued`（服务商这次没收：限流/繁忙/连不上）时，
  节点保持 `status: "running"` 但**没有 task**，并记下 `retryAt` 与 `queuedReason`；卡片显示
  「排队中，约 N 分钟后自动重试」而不是失败。重投由面板级 `useCanvasVideoTasks` 统一驱动（它同时管
  「查在途任务」和「重投未建成的」两类）。节奏按**已排队多久**推导（`nextQueueWaitMs`：2 分钟内
  1 分钟一轮 → 10 分钟内 4 分钟 → 30 分钟内 10 分钟 → 之后 15 分钟），总时限 2 小时后才判失败；
  不写「上一轮等了多久」的内存计数，因为刷新会丢，翻倍退避会退回 1 分钟从头猛投，而实测限流
  不是分钟窗口（空 24 分钟仍 429）。重投会复用节点上已存的 prompt/时长/画幅**和连线首帧**，
  否则等窗口过去后会退化成纯文本生成。`retryAt`/`queuedReason` 属于任务态，写进画布文档，
  所以刷新或换端后队列继续。`retryAt` 的语义是**「最早可以再投的时刻」而不是「被拒后的下次时间」**：
  面板在发出创建 RPC 之前就先写上 `retryAt = now + 请求超时`，否则节点在「running 且没有 task」
  这段时间里看起来就像排队中，驱动会替同一次点击再投一遍——等于自己造出一次重复创建。
- 请求频次（更新 T5，依据 docs/agents/image-video-generation.md「请求频次与并发」）：
  分钟级额度卡的是**创建**请求，查询不在这份额度里（创建连续 429 的同一时段，任务查询照常推进，
  14:59 创建的任务 15:07 就 completed 并把片下载到工作区；同栈的 AIxiaoshuo 也是 2 秒轮询 +
  创建滴灌 ≥61 秒跑得通），所以查询保持 3 秒默认节奏，不必自我阉割到分钟一级。
  仍然按「省」定这几条：**创建后 10 秒内不查**（任务要几十秒才完成）、一轮没回来就不发下一轮
  （`setInterval` 不看响应快慢，慢网络下会自己把并发抬上去）；查询结果带 `retryAfterMs`
  （429/5xx 等被拒信号）时整轮停住并按该时长冷却，本轮剩余任务不再查。冷却与首查延迟
  只存在 hook 的局部变量与节点已有的 `startedAt` 上，**不额外往画布文档写调度事实**。
- 连线即输入：指向媒体节点的入边把上游**图片节点**的 `url`/`savedPath` 作为参考素材传下去
  ——图片节点收到 `image` 数组（图生图/多图合成），视频节点取第一张作为 `first_frame`。
  工作区相对路径由宿主在发出前读文件换成 data URI（网关要求公网可达），UI 不搬像素。
- agent 写入格式（更新 T2 约定）：kind 白名单为 `text|note|image|video`；媒体节点的
  `url`/`savedPath` 只能是引用，`generation` 为可选任务态；旧客户端遇到不认识的 `video`
  节点会按 kind 白名单丢弃，不会崩面板。

### T6 · 结果落地、重新生成与素材进对话

- 结果落地：生成端返回的是**会过期的外链**（Agnes 响应带 `expires_at`），而画布是长期
  文档，只存外链等于给文档埋坏链。因此节点拿到 url 后再调 `workspace/saveGeneratedMedia`
  把字节落到 `<workspace>/.zcode/generated/<sha1(url)前16位>.<ext>`，节点同时保留
  `url` 与 `savedPath`，渲染优先 `savedPath`。落地失败**不判生成失败**：保留 url 并
  记 debug 日志，用户仍能看到结果。
- 幂等与边界：文件名只由 URL 哈希派生（不取 URL 路径片段，避免穿越与非法字符）；已存在
  同名文件直接复用，重试不重复下载；仅接受 http(s)，单文件上限图片 16MB、视频 64MB，
  超限或超时按失败处理。
- 重新生成：已有结果的媒体节点保留紧凑的生成入口，复用节点上已存的 prompt/档位参数再跑
  一次并覆盖结果（即梦式的「再来一张」），不需要新建节点。
- 素材进对话（增强 T1）：「发送到对话」/「让 Agent 扩展」除 Markdown 导出外，把选区内
  媒体节点的**工作区文件引用**作为真实图片附件一并注入；只有外链的节点仍按 Markdown 占位
  说明，不伪造附件。

### T7 · 媒体呈现与选中浮层（即梦式）

**媒体呈现**（`CanvasMediaBody` + 纯函数 `canvasMediaStage.ts`）：

- 卡片正文按状态机只画一件事：`empty`（生成入口/上传占位）、`running`（骨架 + 文案）、
  `failed`（原因原文，可重试）、`ready`（媒体本身）。有结果时**卡片内不再塞生成面板**，
  面板改由选中浮层承载（见下），避免一行 caption + 两个 select + 按钮把媒体挤成缩略图。
- 图片：`object-contain` 填满正文并裁剪圆角；`savedPath` 优先走 `CanvasWorkspaceImage`
  （外链会过期，本地文件才是长期真值），没有本地文件时才用 `url`。
- 视频：默认**不常驻原生控制条**——只显示首帧 + 中央播放键 + 时长/画幅角标，点一下才进入
  播放态并出现 `controls`。控制条常驻会把 16:9 的卡片压成一条黑带（用户实测反馈）。
- 只有 `savedPath` 没有 `url` 的视频：显示「外链已过期」+ 本地路径 + 重新生成入口。
  不把几十 MB 的视频读成 data URL 塞进卡片（`readMediaPreview` 支持 video，但那是
  全量字节进内存，代价与收益不匹配），要播放请走预览灯箱按需加载。
- 卡片按媒体**固有比例贴合**（`fitNodeToAspect`）：保持面积不变重算节点宽高并钳边界，
  9:16 的视频不再被塞进横向卡片留两条灰边。触发点除了 `load`/`loadedmetadata`，
  **挂载时也要读一次固有尺寸**——命中缓存的媒体在 React 挂上监听前 readyState 就已经是 4，
  事件不会再触发（实测视频节点因此停在默认比例）。比例已对上时返回 null，所以加载回调
  重复触发不会反复写文档。角标只显示时长：画幅是请求值，上游实际出片可能不同（实测
  请求 9:16 拿到 704×704），把请求值当事实标在画面上会误导。
- **选画幅就改框**（`useRatioFrame`，即梦行为）：面板换档位时立刻按目标比例重算节点宽高；
  没有结果的卡片在挂载时也按当前档位预占位，新建的竖屏节点一上来就是竖框。已有结果时
  挂载不改框，出片比例优先。档位初值在没有 `generation.ratio` 时按当前框反推
  （`nearestRatioOption`，对数距离），否则刷新后会把用户已经选好的竖框又掰回默认横框。
- 说明文案按 kind 分开：图片「图片说明…」、视频「视频说明…」。

**选中浮层**（`CanvasMediaQuickBar` + `CanvasMediaDialog` + `CanvasMediaLightbox`）：

- 选中**单个**媒体节点时，在其屏幕矩形上方浮出工具栏、下方浮出生成对话框；位置由
  `toScreen(node.x, node.y)` 与 `node.w/h * zoom` 算出，与多选对齐工具条同一套坐标口径。
  多选（≥2）仍是原来的对齐/分布工具条，两者互斥。
- 工具栏只放**真的能执行**的动作：预览、重新生成（有结果时）/生成、复制链接（有外链时）、
  发送到对话、让 Agent 扩展、删除。不做假按钮（即梦那些「智能改图/超清/抠图」我们没有对应
  能力，宁缺毋滥）。
- 生成对话框复用既有的 `CanvasImageGeneratePanel` / `CanvasVideoGeneratePanel`（非 compact），
  外面只套浮层外壳：不复制第二份生成逻辑，也不改它们的 RPC 与状态写入路径。
- 预览灯箱：`Dialog` 门户 + 深色底 + `object-contain`，视频带 `controls`；Esc/点遮罩关闭。
- 浮层与灯箱的开关是**纯 UI 局部状态**（选中来自 store），不写进画布文档；节点上已有的
  `generation` 字段不因浮层新增任何键。

## 状态所有者

单一所有者：`packages/ui/src/store/canvasStore.ts`（zustand，仿 whiteboardStore 模式）。

```text
菜单点击 ──> handleOpenCanvasTab（useAppPanels）
             ├─ revealSidePaneForCurrentOwner()
             └─ commitOpenedSidePaneState(current => openCanvasSidePane(current, {boardId, title}))
                  └─ workspaceSidePane.ts: createCanvasSidePaneTab → activateSidePaneTab
画布挂载 ──> canvasStore.hydrate(storageKey) ──> localStorage 读 ──> docs[key]
编辑操作 ──> store action（mutate doc）──> 防抖持久化
视口/选区/连线中 ──> 同一 store 的会话态（按 storageKey 分桶，不持久化）
```

- board 策略：启动项按 workspace 打开固定画布
  （boardId = `default-<hash(workspaceKey)>`，tab id = `canvas:<boardId>`，
  activateSidePaneTab 按 id 去重实现复用），不做多画布管理（非目标）。
  「+ 新增标签」菜单提供同一入口。
- DOM 应用层：`app-shell/CanvasPane.tsx` 及 `app-shell/canvas/` 子组件；
  组件仅经 store 读写，不直接操作 localStorage。
- 存储键：`zcode-canvas-<hash>`，hash 为 workspaceKey + boardId 的 djb2
  （workspaceKey 含路径分隔符，不能直接作 localStorage 键名）。

## 接入点（面板注册体系）

1. `lib/workspaceSidePane.ts`：`CanvasSidePaneTab` + tab 联合类型 +
   `createCanvasSidePaneTab` / `openCanvasSidePane`。
2. `app-shell/types.ts`：`handleOpenCanvasTab` 声明。
3. `hooks/useAppPanels.ts`：`handleOpenCanvasTab` 实现（同 `handleOpenWhiteboard` 模式）。
4. `app-shell/animatedSidePanePanelModel.ts`：`OpenTabLauncherItemId` 增加 `"canvas"`，
   `resolveOpenTabLauncherItemIds` 在 browser 之后追加。
5. `app-shell/AnimatedSidePanePanel.tsx`：启动项、`TabsContent` 渲染分支（仿
   WhiteboardPane）、Tab 标题、overview 标签。
6. `app-shell/WorkspaceShellLayout.tsx` / `App.tsx`：handler 透传。
7. i18n：`canvas.*`（zh-CN / en-US）。

## 不变量

1. 画布面板不持有第二份文档真值：localStorage 是持久层，store 是内存层，
   组件只经 store 读写。
2. 所有依赖视口尺寸的动作（zoomBy/fitView/toWorld）使用画布容器实测 rect，
   不使用 window.innerWidth——面板是侧栏不是全窗。
3. 键盘快捷键只绑在画布根元素（面板获得焦点才生效），不注册 window 级监听，
   不与终端/输入框/全局命令面板冲突。
4. 持久化写入失败不阻断编辑（try/catch + 剥离重试 + debug 日志）。
5. localStorage 读出的文档经形状校验（节点数组、kind 白名单），坏数据回落空画布。
6. 生成结果不以 data URL 入库：节点媒体只能是远程 `url` 或工作区文件引用两种
   （T4）；上传小图的 data URL 是既有路径，不因此扩大。
7. 生成能力不引入第二份凭据通路：apiKey 只存在于宿主 `GenerationPort` 实现内，
   协议参数、节点数据与日志都不含密钥。
8. 会写文档的 effect / ref 必须只在**输入变化**时触发：内联 ref 回调每次渲染都会被重新
   调用，拿它去报媒体尺寸并回写节点宽高，就是「渲染→写→渲染」的死循环（实测
   `Maximum update depth exceeded` 直接把画布崩掉）。尺寸上报统一走 `useMediaAspect`，
   比例贴合只跟随下拉档位的变化（`useRatioFrame` 的依赖里不含节点宽高）。

## 失败语义

- localStorage 不可用：画布退化为会话内可编辑，刷新后丢失（记 debug 日志）。
- 图片降采样失败（如极端格式）：创建无图占位的空图片节点，不中断流程。
- 存储配额溢出：剥离 data URL 图片后重试一次，仍失败则跳过本次持久化。
- 生成失败的原因文案由宿主端口给出（docs/agents/image-video-generation.md「失败语义」）：
  UI 原样显示「网关原文 + 处置提示」（队列已满 / 限流等窗口恢复 / 5xx 已退避重试仍失败），
  不在前端再判一次可重试性，也不自动重发——按钮保持可用就是重试入口。

## 非目标

- 不做多画布管理、画布分享/导出。
- 不迁移或复用 whiteboard 的数据；两者是独立面板类型。
- 不引入 react-flow 等第三方画布依赖（参考实现证明自研可行且可控）。
- Agent 驱动节点生成：P1 已落地图片（T4）。视频节点与跨刷新的异步任务恢复、
  导演台/流水线编排仍是远期项。
