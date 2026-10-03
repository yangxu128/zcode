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

### T2 · Agent → 画布（待立项，前置为工作区文件写 RPC）

设计方向：画布文档迁移到工作区文件（如 `.zcode/canvas/<boardId>.json`），
agent 用既有文件工具直接读写，UI 经 `fileWatcherService` 跟随重渲染，
文档进 git 获得版本历史。**前置条件**：渲染层当前没有任何通用的工作区文件
写通道（`fileService` 只读、`IZCodeAgentService` 无文件写 RPC），需要先在
`packages/shared` 协议 + host/server 两侧新增受控的写 RPC（spec 先行）。
迁移时需一次性导入 localStorage 旧数据。

### T3 · 导演台 + 流水线（原型的完全体，远期）

画布内配置生成任务并发起 agent 运行，流式结果写回节点；依赖 T2 与
agent 运行接管（权限、流式、取消）在面板内的呈现。

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

## 失败语义

- localStorage 不可用：画布退化为会话内可编辑，刷新后丢失（记 debug 日志）。
- 图片降采样失败（如极端格式）：创建无图占位的空图片节点，不中断流程。
- 存储配额溢出：剥离 data URL 图片后重试一次，仍失败则跳过本次持久化。

## 非目标

- 不做多画布管理、画布分享/导出。
- 不迁移或复用 whiteboard 的数据；两者是独立面板类型。
- 不引入 react-flow 等第三方画布依赖（参考实现证明自研可行且可控）。
- Agent 驱动节点生成（原型的导演台/流水线）为 T3 远期项；当前联动边界见
  「与 Agent 联动」一节（T1 已实现，T2 待工作区文件写 RPC）。
