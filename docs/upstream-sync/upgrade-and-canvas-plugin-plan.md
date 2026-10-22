# ZCode 升级到 3.16.2 并把无限画布做成插件：方案（未执行）

> 状态：方案稿，2026-10-22。依据是本次实测的逐文件对照
> （[our-changes-vs-upstream-3.16.2.md](./our-changes-vs-upstream-3.16.2.md)）和上游 `UI_PLUGIN.md`（v3.16.2）。

## 0. 目标与硬约束

目标（按优先级）：

1. 升级到官方开源版 **3.16.2**，现有功能行为不变。
2. 无限画布最终以 **UI Plugin（MCP Apps）** 形式分发，他人可安装。
3. **保留并强化 Agent 自主生成**：Agent 能自己调用画布、排图片/视频生成意图并继续干活，
   不需要用户点按钮，也不依赖画布面板处于打开状态。
4. 升级与插件化都不破坏"凭据不出宿主"的边界，也不把画布数据搬进插件服务。

硬约束（来自仓库规范与现实）：

- **不能丢规格**：`docs/ui/canvas-pane.md`、`docs/agents/image-video-generation.md` 是行为真值，先于代码存在，升级时先带规格再带实现。
- **凭据不出宿主**：生成模型（Agnes）的 key 只在 host/agent 进程里；插件页面与插件 MCP server 都没有凭据。画布的"生成"必须经过宿主。
- **外部真值不变**：画布文档是工作区文件，插件页面不是数据所有者，只是编辑器；刷新/换端以文件为准。
- **意图与执行分离**：Agent/页面只写"要生成什么"，执行与状态只由 **agent 进程内的 generation worker** 写；这是插件时代保住自主生成的前提。
- **可回滚**：现有 123 个文件、+10,013 行的本地改动不能只存在于一个会丢的分支里，升级前必须先在本地提交并打 tag。

## 1. 推荐路线（先升级，后插件化）

```
阶段0 冻结基线 ──► 阶段1 干净检出 3.16.2 + 三批移植 ──► 阶段2 等价验证（门禁）
                                                         │
                                                         ▼
                        阶段3 画布内核解耦 + agent 侧 generation worker（意图队列）
                                                         │
                                                         ▼
                                  阶段4 UI Plugin（MCP server + 页面 + skill）
                                                         │
                                                         ▼
                                   阶段5 发布（官方内置插件 + 市场安装）
```

阶段 3 是这次的改动重点：**先把"Agent 写意图 → agent 侧 worker 执行 → 结果写回文档"跑通，再谈插件**。
这样插件页面只是画布的编辑器，生成本身与页面生命周期无关。

不建议"把上游 merge 进当前仓库"：上游三提交里有 13,541 个文件变动，在本仓库直接 merge 会让 review 与二分失效。正确做法是**从上游干净检出，把我们当补丁打上去**。

## 2. 阶段 0：冻结基线（半天）

1. 把当前未提交的画布/生成改动按功能拆成若干提交（或至少一个 `wip: canvas generation` 提交），确认 `git status` 干净。
2. 打 tag：`pre-upgrade-3.14.3`。同时把 `docs/upstream-sync/` 这份对照纳入提交，作为迁移依据。
3. 记录基线结果（本次已实测）：
   - `pnpm typecheck` 通过；CLI turbo typecheck 27/27；
   - bootstrap 42/42、UI canvas 26/26、core generation 6/6；
   - lint 0 error / 72 warning；`fmt:check` 32 个既有失败（`styles.css` 的 `color-mix` 等），升级后要重取基线，别把旧失败当新问题；
   - 真实链路：画布创建→出片→落盘已验证过 1 次（704×704），排队/限流路径用真实网关验证过（20 分钟 5 次创建全 429）。
4. 保存一份"功能清单"（见第 4 节 parity matrix），后续每阶段对表验收。

## 3. 阶段 1：升级到 3.16.2（2–4 天）

### 3.1 取上游

- 优先 `https://github.com/zai-org/ZCode` 的 tarball 或 `git clone`（本机实测 `git clone` 被重置、API/jsDelivr 可用；必要时用 `codeload` tarball 下载）。
- 固定提交：`3c5b2276`（v3.16.2）。新建分支 `upgrade/3.16.2`，不要动 `pre-upgrade-3.14.3`。

### 3.2 三批提交，逐批可回滚

| 批次 | 内容 | 数量 | 验证 |
| --- | --- | --- | --- |
| P1 | D 类：上游完全没动的文件（含两份规格、画布 UI、生成端口、测试） | 70 | 复制后 `pnpm typecheck` |
| P2 | A 类中三方合并**无冲突**的文件 | 34 | 逐文件用 `git merge-file` 结果落盘，跑单测 |
| P3 | A 类中**有冲突**的 16 个 | 16 | 人工解，按下面 4 个热点优先 |

关键做法：P2 不要手抄。我们已经用 `git merge-file` 对 50 个文件做过三方合并（base=`e06bb2b`、ours=本地、theirs=`3c5b2276`），无冲突的直接采用合并结果，冲突的才人工看。这能把 50 个文件的工作量压到 16 个。

### 3.3 16 个冲突里只有 4 个需要设计判断

1. **`packages/ui/src/App.tsx`**：上游新增 `<PluginUiWorkspaceProvider onOpenSidePane>` 包住 `WorkspaceShellLayout`；把我们的画布 props 挂到内层 Layout，保留插件页 provider。
2. **`packages/ui/src/hooks/useAppPanels.ts`**：上游新增 `handleOpenNewSidePaneTab` / `openPluginUiSidePane`，我们新增 `handleOpenCanvasTab` + `buildCanvasBoardId`。两个 handler 并存；重点验"tab 去重、reveal 顺序、恢复后激活"。
3. **`packages/ui/src/lib/modelSelectionGroups.ts`**：同一函数，我们加"生图/生视频模型不进聊天选择器"，上游加供应商 `labelBadge`。以我们的排除判定为准（否则选中生成模型会产生必然失败的对话），保留上游 badge。
4. **`optionSpecs` 容错**：上游在 `compact-active`、`turn-model`、`target-completion-verification` 直接读 `optionSpecs.maxOutputTokens.max`；生成模型没有对话档位。先确认上游是否在注册层补齐；没有就保留我们的 `modelMaxOutputTokens/modelReasoningValues` 容错，并在上游新读点复用。

其余 12 个冲突是 import 块、联合类型、方法表的插入顺序，机械取并集即可。

### 3.4 不要带的东西

- `packages/server/.zcode/`（画布 JSON、生成的 mp4/png）是本地运行产物，不提交、不移植。
- 皮肤/壁纸是我们导入提交里的本地特性（12 个文件：4 新增 + 8 修改），上游没有。要保留就单独一批带；不保留就先标记为放弃，避免混在画布迁移里。

## 4. 阶段 2：功能等价验证（1–2 天，硬门禁）

### 4.1 parity matrix（每项都要有可重复的验证）

| 能力 | 验证方式 | 通过标准 |
| --- | --- | --- |
| 画布 tab 打开/恢复/去重 | 手动 + 单测（`workspaceSidePane`/`useAppPanels` 相关） | 同一 workspace 复用同一 boardId，刷新后恢复 |
| 节点/连线编辑 | UI canvas 单测 + 手动 | 拖拽、缩放、连线改参考输入都正常 |
| 画布文档外部真值 | `canvasGenerationDocument` / `canvasDocument` 单测 | agent 写入后整体替换，sanitize 不丢字段 |
| 图片生成 | bootstrap 单测 + 真实网关一次 | 尺寸/画幅正确，结果落 `.zcode/generated/` |
| 视频创建/查询/恢复 | `generationVideoPolling` 单测 + 协议级 | `created|queued`、`video_id`、三处 url 兜底、无地址判失败 |
| 限流排队 | `generationTransientRetry`/`canvasVideoQueue` 单测 | 1/4/10/15 分钟阶梯、2 小时判失败、RPC 不睡冷却 |
| 媒体卡片/浮层 | 手动 + 截图对比 | 卡片不裁切把手、视频首帧+播放、灯箱/工具栏正常 |
| 输出模态/模型选择 | `modelSelectionGroupsGeneration` 单测 | 生成模型不进聊天选择器，连接测试按模态路由 |
| 协议 strict 校验 | 启动 dev 栈走一次 RPC | 新字段不被 `.strict()` 拒绝 |
| 构建产物 | 重建 CLI bundle + `@zcode/server` dist | 运行时加载的是新产物（不是旧 dist） |

### 4.2 顺序

1. `pnpm typecheck` + CLI turbo typecheck。
2. 三套单测（bootstrap / ui canvas / core generation）。
3. `pnpm architecture:check --changed`、`pnpm lint`、`pnpm fmt:check`（重取基线）。
4. 重建 bundle 与 server dist，起 dev 栈，手动走一遍画布与生成（生成受 Agnes 免费额度限制，至少验到"创建被拒→排队中→自动重投"）。
5. 冻结为 `upgrade/3.16.2-verified`，作为插件化的起点。

## 5. 阶段 3：画布内核解耦 + 生成执行归位（4–6 天）

目标：让画布有**一个**数据与业务内核，并把「生成」从 UI 的生命周期里独立出来——这是保住
"Agent 自主生成"的关键。当前 `useCanvasVideoTasks` 挂在画布面板上，面板一关就不轮询；
在插件形态下页面更不能持有凭据。所以生成执行必须从 UI 移到 agent 进程。

建议新增 `packages/canvas-core`（只依赖 `shared`，不依赖 `ui`/`services`）：

- `document/`：节点/连线/生成态的 schema、sanitize、迁移、boardId 规则（从 `canvasDocument.ts` 迁出）。
- `media/`：媒体引用解析（savedPath 优先、外链过期、尺寸上报策略）。
- `generation/intent.ts`：**生成意图**（requestId/prompt/尺寸/画幅/参考输入/kind，可选 model）与执行态字段的
  领域定义、字段归属、版本合并、幂等与去重规则。不实现 HTTP。
- `ports.ts`：`CanvasFileStore`（读写工作区文件）、`CanvasMediaStore`（预览/落盘）、
  `CanvasGenerationPort`（agent 侧执行器，插件侧为空）、`AgentBridge`（选区/指令交给对话）。

同时新增**画布生成 worker（落在 agent 进程里）**。这里有个容易写错的细节：`GenerationPort`
是在 `bootstrap/create-app.ts` 里构造、注入 agent runtime 的，凭据与限流队列都在 agent 进程；
host 只负责拉起/重启 agent，自身没有凭据。所以 worker 必须放在
`apps/zcode-cli/packages/bootstrap/src/app/canvas-generation/`（或 core 的运行时服务），
直接持有同一个 `GenerationPort` 实例——而不是放在桌面 main 或 `packages/server` 里再走一遍 RPC。

worker 的职责：

- 监听工作区画布文档（agent 侧的 fs 适配器 / watch），拾取 `request` 待执行的节点；
- 认领（lease）后调用现有 `GenerationPort`：图片同步生成，视频 `startVideo`+轮询；
- 把执行态写回文档（`claimId/status/task/url/savedPath/error/model`）；
- 沿用我们已经调好的排队策略：按模态分开的串行队列、429 冷却、1→4→10→15 分钟重投、
  2 小时上限、`created|queued` 判别；
- 与 Agent 的工具调用共享同一个端口实例，所以 `runSerialized` 会天然把
  "Agent 直接调 VideoGenerate" 与 "worker 执行意图" 排进同一条限流队列；
- **不依赖画布面板是否打开**：agent 进程在跑就执行，重启后继续认领未完成的请求。

> 如果后续把 worker 挪到 host 侧（例如为了多 workspace 统一调度），它就只能通过
> `workspace/generateImage|startVideo|videoTask` 这三个 RPC 走 agent——那会多一层
> 客户端超时与鉴权，不建议在 MVP 做。

权责划分（这是整个方案的核心约定）：

| 谁 | 只写 | 说明 |
| --- | --- | --- |
| Agent（经插件 MCP tool）/ 插件页面 / 宿主 UI | `request.*`：`requestId / prompt / size / ratio / seconds / refs / requestedAt` | 表达"要生成什么"，不写执行结果 |
| agent 进程 generation worker | `execution.*`：`claimId / status / task / url / savedPath / error / model / startedAt` | 唯一执行者与唯一执行态写者 |
| 两者都读 | 整份文档 | 渲染与决策都基于同一份真值 |

写冲突处理：每次写入带 `rev`，读-改-写只合并自己拥有的字段，`rev` 不匹配就重读重试（≤3 次）；
文件用临时文件 + 原子 rename。`requestId` 是幂等键，同一 requestId 只执行一次；已 `completed`
的节点只有换新 requestId 才会再次生成。若实测仍冲突，退化方案是 worker 独占一个
`.zcode/canvas/<board>.execution.json` 账本，页面按 requestId 合并展示（文档仍只存意图与结果引用）。

现有 `packages/ui/src/app-shell/canvas/*` 退化为"宿主渲染层"；`useCanvasVideoTasks` 改为消费 worker
写回的文档（或订阅文件变更），不再自己发创建/查询请求。

验收：`canvas-core` 的测试不依赖 React/DOM；把画布面板关掉后，Agent 写入的生成意图仍能被执行并落盘。

## 6. 阶段 4：UI Plugin 化（5–8 天）

### 6.1 插件边界

| 能力 | 归属 | 说明 |
| --- | --- | --- |
| 画布文档读写 | 插件 MCP server | 服务进程以 workspace 为 cwd，直接读写 `.zcode/canvas/`；不经过 host 状态 |
| 画布编辑页 | 插件 UI 页面（MCP App） | `_meta.ui.resourceUri` 提供 HTML 资源；`ui.surfaces` 声明会话侧栏面板 |
| 选区/上下文回传 | 页面 `updateModelContext()` / `sendMessage()` | 替代现在我们直接写 store 的"选区进对话" |
| Agent 驱动画布 | 插件 MCP tools + 插件内 skill | 用 skill 取代 core 里的 P4 系统提示段；工具面即 MCP tools |
| 图片/视频生成 | **agent 进程 generation worker（阶段 3 新增）** | 插件只写意图；凭据、排队、限流都在宿主；见 6.2 |
| 媒体预览 | 插件 MCP resource / 自带静态服务 | 不能再用 `fileService.readMediaPreview`；MB 级媒体必须走资源 URL，禁止 data URL 塞进页面 |

### 6.2 自主生成怎么保住：意图队列 + agent 侧 worker（本方案的核心改进）

先说清现状的三个问题：

1. Agent 现在走宿主 `VideoGenerate` 是**阻塞**调用（最长 33 分钟），一个 turn 只能等一条片子，
   想一次生成四张图/四条视频就得串行干等；
2. 画布轮询挂在**面板**上（`useCanvasVideoTasks`），面板一关或换到别的会话就停；
3. 插件页面既没有凭据，也不能调用宿主服务。

所以在阶段 3 把执行移进 agent 进程之后，插件时代的自主生成走这条链路：

```
Agent / 页面 / 用户
   │  canvas_request_generation（只写意图，立即返回 requestId）
   ▼
画布文档  request.status = "requested"
   │  agent 侧 worker 监听工作区文件（agent 在跑就执行，与面板无关）
   ▼
agent 进程 generation worker ── GenerationPort ──► Agnes
   │  图片：同步生成；视频：startVideo + 轮询（现有队列/冷却/重投全复用）
   ▼
画布文档  execution.status / task / url / savedPath
   │  MCP resource 订阅（uiSubscribeResource）+ 文件变更
   ▼
插件页面实时展示；Agent 下一轮用 canvas_read 拿到结果
```

关键点：

- **Agent 不阻塞**：一个 turn 里可以排 N 条意图然后继续做别的；10–20 分钟的视频排队由 worker 承担。
  需要结果时再 `canvas_read`；不希望轮询的 Agent 可以不查。
- **执行与 UI 解耦**：关掉画布面板、切会话、刷新页面都不影响执行；agent 重启后 worker 继续认领未完成请求
  （`requestId` 幂等，已完成的不会重跑）。
- **凭据只在宿主侧（agent 进程）**：插件与页面零密钥，限流/排队只在 worker 一处实现，不会出现 UI 与 agent 各打一套请求。
- **用户按钮与 Agent 同路**：页面上的"生成"也是写意图，不单独走 `sendMessage()` 执行，行为完全一致。

插件工具面（Agent 可见）：

| 工具 | 作用 |
| --- | --- |
| `canvas_read` | 读节点/连线/合并后的生成态（意图 + 执行结果） |
| `canvas_apply` | 批量增删改节点与连线，`opId` 幂等 |
| `canvas_request_generation` | 写一条生成意图（kind/prompt/size/ratio/seconds/参考输入；`model` 可选，缺省由 worker 按注册表候选自动选），返回 requestId，立即返回 |
| `canvas_cancel_generation` | 取消排队中的意图（不影响已提交到服务商的任务） |
| `canvas_export` | 导出选区/整板为对话附件或文件 |

插件 skill 里要写死行为约定，替代现在 core 里的 P4 提示段：

- 需要出图/出片时**先 request 再继续**，不要在一个工具调用里干等；
- 同一节点重做要换新 `requestId`，不要重复写同一意图；
- 只有用户明确要求时才 `canvas_read` 查进度，避免把查询打成高频请求；
- 失败原因原样转述（含服务商 request id 与处置提示），不要自己编。

可选增强：上游有 background task / 子代理 join 的机制。如果希望"生成完成后 Agent 自动被唤醒继续处理"
（例如把四条视频结果组织成一条回复），可以接 background task，而不是让 Agent 一直阻塞等待。
这一项不阻塞 MVP。

备选方案与取舍：

- **走对话 `sendMessage()` 执行**（原方案）：只在"用户点按钮让 Agent 帮忙想提示词"时保留，
  不再承担执行职责；
- **宿主开放插件生成 API**：未来若有，worker 可以藏在 API 后面，插件协议不变，属于平滑升级；
- **插件自带 key**：违反"凭据不出宿主"，排除。

### 6.3 页面与宿主的技术约束（来自上游 UI_PLUGIN.md）

- 页面用官方 `@modelcontextprotocol/ext-apps`，当前锁 **2.0.0**；MCP server SDK 锁 **1.29.0**。不要自己造页面 SDK。
- 交互页面**只支持 ZCode Desktop 的本地工作区**；Web/手机/远程工作区会退化成普通 MCP 工具记录。这是产品上的硬限制，必须写进 README 与商店描述。
- 插件开发与构建在独立的 `zcode-plugins` 仓库；主仓库只做宿主联调（上游有 `dev:official-mcp` 脚本）。
- 向 `zcode-plugins` 提 PR 时要在模板里声明"是 UI Plugin"并填插件名。

### 6.4 画布插件的最小功能集（MVP）

1. 会话侧栏打开画布，节点/连线编辑，自动保存。
2. Agent 通过 MCP tools 读改画布（加节点、连线、批量写）。
3. 选区 → `updateModelContext()`，用户追问时带上下文。
4. **Agent 自主生成**：`canvas_request_generation` 排意图后立即返回，agent 侧 worker 执行；
   Agent 之后可继续别的工具，或用 `canvas_read` 查结果。一次 turn 支持排多条图片/视频。
5. 用户点"生成"与 Agent 同一条路径（写意图），页面展示排队/出片/失败态，不需要保持页面打开。
6. 媒体卡片、视频首帧+播放、灯箱、工具栏（复用我们从 T7 打磨过的交互规则，但用插件自己的 HTML/CSS 实现）。
7. 失败原样展示网关原因与处置提示；限流排队由 worker 统一承担。

## 7. 阶段 5：发布与分发（2–3 天）

两条腿走：

- **官方内置**：把插件加入上游的 official plugin 定义与 seed 锁（`official-plugin-definitions.ts` / `official-plugin-seed-lock.ts`），安装 ZCode 即带画布，体验等同今天的内嵌 tab。
- **市场安装**：在 `zcode-plugins` 仓库发布，声明 `ui.surfaces`，提供版本、截图、桌面限定说明；走普通插件注册/安装/更新流程。

版本策略：插件独立 semver；页面 SDK 与 MCP SDK 版本跟上游锁文件走，升级宿主前先在插件仓库跑兼容矩阵。

## 8. 风险、回滚与"不要做的事"

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 上游 3.15/3.16 的运行时重构（ToolSearch/deferred tools/off-peak）改变工具可见性 | 生成工具可能不被注册/不可见 | parity matrix 加一条"工具列表含 ImageGenerate/VideoGenerate"；在 `turn-tool-visibility` 里验证 |
| `optionSpecs` 语义变化 | 生成模型调用崩溃 | 保留容错并补测试（缺 optionSpecs 的模型能完成一次生成请求构造） |
| 双写者冲突（插件 server 与 agent 侧 worker 同时改画布 JSON） | 意图或结果被覆盖 | 字段归属 + `rev` 读改写重试 + 原子 rename；实测仍冲突则退化为宿主独占 execution 账本 |
| worker 生命周期（应用关闭、agent 进程被回收） | 意图停在 requested | 应用内运行即可；重启后按 lease 过期继续认领；`requestId` 幂等防重跑 |
| Agent 不知道生成何时完成 | 用户要等下一轮才知道 | MVP 让 Agent 主动 `canvas_read`；可选接 background task 在完成时唤醒 |
| 插件页面仅桌面本地 | Web/手机失去画布 | 先双轨：宿主内嵌画布保留，插件作为分发形态；等上游支持再统一 |
| 13.5k 文件差异导致误合并 | 回归难定位 | P1/P2/P3 三批提交 + tag + 每批 typecheck |
| 皮肤/壁纸被漏掉 | 视觉回归 | 单独一批 12 个文件，或在阶段 0 明确放弃 |

回滚：任何阶段失败，`pre-upgrade-3.14.3` tag + 现有分支完整可回；插件化失败不影响宿主版画布。

不要做：

- 不要在当前仓库直接 merge 上游。
- 不要为插件复制一份画布数据模型（必须先有 `canvas-core`）。
- 不要把 API key 或生成 HTTP 逻辑放进插件。
- 不要在插件页面里用 data URL 承载图片/视频。

## 9. 需要你拍板的 4 件事

1. **升级范围**：只升到 3.16.2 的**代码骨架**（不带上游新插件生态），还是连带启用 UI Plugin/Office 等新能力？（决定要不要接 `plugin-ui` 的宿主改造）
2. **皮肤/壁纸**：保留（多 12 个文件的移植与视觉验收）还是放弃？
3. **自主生成的授权边界**：Agent 能不能不经确认直接排生成意图？建议分三档，默认第二档：
   - 直接排（体验最好，但可能一次 turn 花掉多条视频额度）；
   - **仅当用户在本轮明确要求生成/给出提示词时排**（推荐，兼顾自主与额度安全）；
   - 每条都弹确认（最安全，但打断"自主"体验）。
4. **双轨还是切换**：插件发布后，宿主内嵌画布是保留（自己用）还是移除（只留插件）？

## 10. 里程碑与验收

| 里程碑 | 产出 | 验收 |
| --- | --- | --- |
| M1 冻结 | tag + 干净工作区 + 基线记录 | 可一键回到 3.14.3 |
| M2 升级完成 | `upgrade/3.16.2` 三批提交 | typecheck + 三套单测 + 架构检查通过 |
| M3 等价确认 | parity matrix 全绿 | 画布/生成/限流/媒体全部复现 |
| M4 内核解耦 + worker | `packages/canvas-core` + agent 侧 generation worker | 单测不依赖 React；**关闭画布面板后意图仍被执行并落盘** |
| M5 插件 MVP | 可安装的 `zcode-canvas` 插件 | 桌面本地工作区可打开、编辑、对话联动；**Agent 一个 turn 排多条生成意图后继续干活，结果自动写回** |
| M6 分发 | 官方内置 + 市场条目 | 新装 ZCode 自带画布；他人可安装/升级 |
