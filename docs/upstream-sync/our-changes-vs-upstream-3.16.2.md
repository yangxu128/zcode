# 我们 vs 上游 3.16.2：逐文件对照

> 生成时间：2026-10-22  
> 本地基线：`e06bb2b`（"import ZCode v3.14.3 source with local skin/wallpaper features"，2026-09-30）  
> 上游：`zai-org/ZCode@3c5b2276`（main，v3.16.2，2026-10-20）  
> 对照对象：本地自 `e06bb2b` 以来的全部改动 = 13 个提交 + 未提交工作区

## 一、结论

- 我们共改了 **123 个文件**（展开未跟踪目录后），净增约 **+10,013 / -133 行**（不含本地生成产物）。
- 其中 **50 个文件上游也改了**，**70 个上游没动**，**0 个路径与上游新增文件撞名**，**0 个被上游删除**。
- 50 个里三方合并（base=我们的导入版本、ours=本地、theirs=上游 main）真正**文本冲突的只有 16 个**，且**绝大多数是 import 块/注册表里的同类插入**，不是设计冲突。
- **没有功能撞车**：上游没有画布面板、没有生成端口、协议里也没有 `workspace/generateImage`、`workspace/startVideo`、`workspace/videoTask`。我们这层是纯增量。
- 需要人工决策的只有 4 处：`App.tsx`（上游把应用包进了 PluginUiWorkspaceProvider）、`useAppPanels.ts`（上游新增插件页 tab，与我们画布 tab 同区域）、`modelSelectionGroups.ts`（同一函数两侧都改了）、`optionSpecs` 容错（上游改成直接读 `optionSpecs.maxOutputTokens.max`）。

### 改动分布

| 归属 | 文件数 |
| --- | --- |
| Agent 运行时接线 | 20 |
| 输出模态/模型 | 19 |
| 画布 UI / 生成面板 | 18 |
| 生成端口/协议/工具 | 14 |
| 测试 | 12 |
| 宿主装配 | 7 |
| 画布 Tab 接线 | 7 |
| 画布文档/状态 | 5 |
| 服务/RPC | 4 |
| 应用外壳接线 | 3 |
| 会话面板接线 | 3 |
| 画布文案 | 2 |
| 协议 schema | 1 |
| 画布样式 | 1 |
| 画布规格 | 1 |
| 输出模态规格 | 1 |
| 画布 UI | 1 |
| 生成规格 | 1 |

## 二、口径与边界

- **"我们的改动"** = `git diff e06bb2b`（含未提交）+ 未跟踪文件。导入提交里的皮肤/壁纸改动算在基线内，不在本表。
  若要保留它们，移植时还需单独带 12 个文件：新增 `.zcodeignore`、`docs/ui/theme-skin.md`、`packages/ui/src/lib/skinPreference.ts`、`packages/ui/src/lib/wallpaper.ts`；修改 `.gitignore`、`App.tsx`、`WorkspaceSidebarFooter.tsx`、`i18n/locales/{zh-CN,en-US}.ts`、`store/index.ts`、`styles.css`、`test-actions.ts`。
- **"冲突"** 用 `git merge-file --diff3` 实测（行尾统一为 LF），口径是文本级；它能回答"能不能自动合"，不能回答"合完语义对不对"。语义风险见第五节。
- **"上游改动规模"** 是 base→上游 main 的 diff hunk 数（`-U0`），用来看同一文件上游动了多少处，不是行数。
- 上游文件经 jsDelivr（按 main 提交 SHA 固定）拉取；3 个文件 jsDelivr 返回 403，改用 GitHub contents API 取回。

## 三、A 类：上游也改了的 50 个文件

| 文件 | 归属 | 我们的状态 | 我们行数 | 上游规模 | 三方合并 |
| --- | --- | --- | --- | --- | --- |
| `apps/zcode-cli/packages/bootstrap/src/app/session-facade.ts` | 宿主装配 | 提交+未提交 | +37/-1 | 32 处 | **冲突 2** |
| `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx` | 画布 Tab 接线 | 已提交 | +22/-0 | 85 处 | **冲突 2** |
| `packages/ui/src/hooks/useAppPanels.ts` | 画布 Tab 接线 | 已提交 | +25/-0 | 62 处 | **冲突 2** |
| `apps/zcode-cli/packages/core/src/runtime/agent-runtime.ts` | Agent 运行时接线 | 未提交 | +30/-0 | 23 处 | **冲突 1** |
| `apps/zcode-cli/packages/core/src/runtime/methods/compact-active.ts` | Agent 运行时接线 | 已提交 | +4/-3 | 22 处 | **冲突 1** |
| `apps/zcode-cli/packages/core/src/runtime/methods/target-completion-verification.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 10 处 | **冲突 1** |
| `apps/zcode-cli/packages/core/src/runtime/methods/turn-model.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 11 处 | **冲突 1** |
| `apps/zcode-cli/packages/core/src/runtime/types.ts` | Agent 运行时接线 | 未提交 | +2/-0 | 20 处 | **冲突 1** |
| `apps/zcode-cli/packages/core/src/tool/executor/call-runner.ts` | Agent 运行时接线 | 未提交 | +3/-0 | 50 处 | **冲突 1** |
| `apps/zcode-cli/packages/core/src/tool/executor/types.ts` | Agent 运行时接线 | 未提交 | +4/-0 | 18 处 | **冲突 1** |
| `apps/zcode-cli/packages/core/src/tool/types.ts` | Agent 运行时接线 | 未提交 | +5/-1 | 28 处 | **冲突 1** |
| `packages/ui/src/app-shell/SidePaneTabTrigger.tsx` | 画布 Tab 接线 | 已提交 | +9/-0 | 12 处 | **冲突 1** |
| `packages/ui/src/App.tsx` | 应用外壳接线 | 已提交 | +2/-0 | 51 处 | **冲突 1** |
| `packages/ui/src/lib/modelSelectionGroups.ts` | 输出模态/模型 | 提交+未提交 | +33/-12 | 2 处 | **冲突 1** |
| `packages/ui/src/lib/workspaceSidePane.ts` | 画布 Tab 接线 | 已提交 | +32/-0 | 47 处 | **冲突 1** |
| `packages/ui/src/styles.css` | 画布样式 | 提交+未提交 | +356/-0 | 89 处 | **冲突 1** |
| `apps/zcode-cli/packages/adapters/src/model/model-execution.ts` | 输出模态/模型 | 已提交 | +16/-4 | 24 处 | 自动合并 |
| `apps/zcode-cli/packages/adapters/src/model/model.ts` | 输出模态/模型 | 已提交 | +44/-12 | 5 处 | 自动合并 |
| `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts` | 宿主装配 | 未提交 | +9/-0 | 41 处 | 自动合并 |
| `apps/zcode-cli/packages/bootstrap/src/app/types.ts` | 宿主装配 | 未提交 | +47/-0 | 35 处 | 自动合并 |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts` | 宿主装配 | 未提交 | +12/-0 | 25 处 | 自动合并 |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/workspace-model-runtime.ts` | 宿主装配 | 未提交 | +93/-8 | 2 处 | 自动合并 |
| `apps/zcode-cli/packages/contracts/src/index.ts` | 生成端口/协议/工具 | 未提交 | +2/-0 | 2 处 | 自动合并 |
| `apps/zcode-cli/packages/contracts/src/interfaces/index.ts` | 生成端口/协议/工具 | 未提交 | +1/-0 | 1 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/runtime/helpers/runtime-tools.ts` | Agent 运行时接线 | 未提交 | +3/-0 | 3 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/runtime/internal.ts` | Agent 运行时接线 | 未提交 | +2/-0 | 9 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/runtime/methods/compact.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 5 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/runtime/methods/index.ts` | Agent 运行时接线 | 未提交 | +12/-0 | 6 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/runtime/methods/turn-model-step.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 18 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/runtime/methods/workspace-generate-text.ts` | 生成端口/协议/工具 | 提交+未提交 | +12/-4 | 4 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/tool/executor/impl.ts` | Agent 运行时接线 | 未提交 | +3/-0 | 6 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/tool/handlers/index.ts` | Agent 运行时接线 | 未提交 | +14/-0 | 13 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/tool/handlers/read-session-context.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 12 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/tool/handlers/webfetch-processing.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 1 处 | 自动合并 |
| `apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 3 处 | 自动合并 |
| `packages/services/src/file/fileService.ts` | 服务/RPC | 已提交 | +18/-1 | 2 处 | 自动合并 |
| `packages/services/src/zcode-agent/zcodeAgent.ts` | 服务/RPC | 未提交 | +53/-0 | 25 处 | 自动合并 |
| `packages/services/src/zcode-agent/zcodeAgentService.ts` | 服务/RPC | 未提交 | +87/-0 | 122 处 | 自动合并 |
| `packages/shared/src/zcode-protocol/index.ts` | 协议 schema | 未提交 | +128/-0 | 73 处 | 自动合并 |
| `packages/ui/src/app-shell/animatedSidePanePanelModel.ts` | 画布 Tab 接线 | 已提交 | +3/-0 | 13 处 | 自动合并 |
| `packages/ui/src/app-shell/sidePaneTabPresentation.ts` | 画布 Tab 接线 | 已提交 | +4/-0 | 13 处 | 自动合并 |
| `packages/ui/src/app-shell/types.ts` | 应用外壳接线 | 已提交 | +1/-0 | 27 处 | 自动合并 |
| `packages/ui/src/app-shell/WorkspaceShellLayout.tsx` | 应用外壳接线 | 已提交 | +2/-0 | 136 处 | 自动合并 |
| `packages/ui/src/i18n/locales/en-US.ts` | 画布文案 | 提交+未提交 | +74/-0 | 167 处 | 自动合并 |
| `packages/ui/src/i18n/locales/zh-CN.ts` | 画布文案 | 提交+未提交 | +73/-0 | 165 处 | 自动合并 |
| `packages/ui/src/lib/composerRecent.ts` | 会话面板接线 | 已提交 | +15/-6 | 12 处 | 自动合并 |
| `packages/ui/src/settings/model-provider-section/ProviderCardSections.tsx` | 输出模态/模型 | 已提交 | +1/-0 | 5 处 | 自动合并 |
| `packages/ui/src/settings/model-provider-section/ProviderModelMetadataDialog.tsx` | 输出模态/模型 | 已提交 | +15/-1 | 1 处 | 自动合并 |
| `packages/ui/src/v4/composer/useComposerAttachments.ts` | 会话面板接线 | 已提交 | +17/-0 | 19 处 | 自动合并 |
| `packages/ui/src/v4/SessionPane.tsx` | 会话面板接线 | 已提交 | +4/-1 | 280 处 | 自动合并 |

### 冲突热点（需要人看的 16 个）

| 文件 | 冲突 | 实际情况 | 建议 |
| --- | --- | --- | --- |
| `packages/ui/src/App.tsx` | 1 | 上游新增 `<PluginUiWorkspaceProvider onOpenSidePane={...}>` 包住 `WorkspaceShellLayout`，我们给 Layout 传了画布相关 props | 保留上游包一层，把我们的 props 原样挂在 Layout 上 |
| `packages/ui/src/hooks/useAppPanels.ts` | 2 | 上游加了 `handleOpenNewSidePaneTab`/`openPluginUiSidePane`；我们在同一文件加了 `handleOpenCanvasTab` + `buildCanvasBoardId` | 两个 handler 并存；注意 tab 去重与 reveal 顺序 |
| `packages/ui/src/lib/modelSelectionGroups.ts` | 1 | 同一函数：我们加"生图/生视频模型不进聊天选择器"，上游加供应商接入方式 labelBadge | 合并两边逻辑，保持我们的排除判定在合并之后 |
| `packages/ui/src/lib/workspaceSidePane.ts` | 1 | 上游 tab 联合类型新增 `BrowserPermissionsSidePaneTab` 等，我们加 `CanvasSidePaneTab` | 联合类型取并集即可 |
| `packages/ui/src/app-shell/SidePaneTabTrigger.tsx` 与 `AnimatedSidePanePanel.tsx` | 1 / 2 | 同一图标 import 块（我们 `FrameIcon` vs 上游 `FolderOpenIcon/PuzzleIcon`）+ 新增 tab 菜单项 | 取并集，菜单顺序保持"画布在插件页之前" |
| `apps/zcode-cli/packages/bootstrap/src/app/session-facade.ts` | 2 | 我们新增 4 个生成方法到 facade 方法表；上游新增 `sampleModel` | 两个列表取并集；确认 facade 类型已包含上游新方法 |
| `apps/zcode-cli/packages/core/src/tool/executor/call-runner.ts` | 1 | 上游新增 `entry.resolveInput`（在 hook/权限之前归一化入参），我们给超时解析多传了 `model` | 保留上游 resolveInput 顺序，我们的 model 参数并入现有调用 |
| `apps/zcode-cli/packages/core/src/runtime/methods/{compact-active,target-completion-verification,turn-model}.ts` | 1 each | 我们引入 `modelMaxOutputTokens/modelReasoningValues` 容错（非文本模型可能没有 optionSpecs）；上游在同处直接读 `optionSpecs.maxOutputTokens.max` | **语义要点**：确认上游是否也修了缺 optionSpecs 的路径，否则保留我们的容错 |
| 其余（`agent-runtime`、`runtime/types`、`executor/types`、`tool/types`、`bootstrap/types`、`contracts/interfaces/index`） | 1 each / 0 | 都是"注入 GenerationPort/model 依赖"与上游新增 import 撞在同一行 | 取并集，按 import 排序即可 |

## 四、D 类：上游没动的 70 个文件（可直接带过去）

| 文件 | 归属 | 我们的状态 | 我们行数 | 上游 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `apps/zcode-cli/packages/bootstrap/src/app/generated-media.ts` | 宿主装配 | 未提交 | +142/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/src/app/generation-connectivity.ts` | 生成端口/协议/工具 | 未提交 | +46/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/src/app/generation-http.ts` | 生成端口/协议/工具 | 未提交 | +296/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/src/app/generation-limits.ts` | 生成端口/协议/工具 | 未提交 | +83/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/src/app/generation-port.ts` | 生成端口/协议/工具 | 未提交 | +498/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/src/app/model-catalog-port.ts` | 宿主装配 | 已提交 | +4/-3 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/src/app/provider-registry-selection.ts` | 输出模态/模型 | 已提交 | +7/-7 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/test/generatedMediaFileName.test.ts` | 测试 | 未提交 | +26/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/test/generationConnectivityProbe.test.ts` | 测试 | 未提交 | +96/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/test/generationTransientRetry.test.ts` | 测试 | 未提交 | +132/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/test/generationVideoPolling.test.ts` | 测试 | 未提交 | +441/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/bootstrap/test/sessionFacadeConnectivityDispatch.test.ts` | 测试 | 未提交 | +127/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/contracts/src/interfaces/generation.port.ts` | 生成端口/协议/工具 | 未提交 | +122/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/contracts/src/tools/generation.ts` | 生成端口/协议/工具 | 未提交 | +48/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/context/dynamic-sections.ts` | Agent 运行时接线 | 未提交 | +18/-2 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/model/auxiliary-model-options.ts` | 输出模态/模型 | 已提交 | +3/-2 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/model/option-specs.ts` | 输出模态/模型 | 已提交 | +14/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/runtime/methods/microcompact.ts` | Agent 运行时接线 | 已提交 | +2/-1 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/runtime/methods/workspace-generate-image.ts` | 生成端口/协议/工具 | 未提交 | +91/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/runtime/methods/workspace-generate-video.ts` | 生成端口/协议/工具 | 未提交 | +112/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/tool/handlers/generation-targets.ts` | 生成端口/协议/工具 | 未提交 | +72/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/tool/handlers/image-generate.ts` | 生成端口/协议/工具 | 未提交 | +129/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/src/tool/handlers/video-generate.ts` | 生成端口/协议/工具 | 未提交 | +132/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/test/generationTargets.test.ts` | 测试 | 未提交 | +98/-0 | 未动 | 直接带过去 |
| `apps/zcode-cli/packages/core/test/sessionGuidanceGeneration.test.ts` | 测试 | 未提交 | +24/-0 | 未动 | 直接带过去 |
| `docs/agents/image-video-generation.md` | 生成规格 | 未提交 | +146/-0 | 未动 | 直接带过去 |
| `docs/ui/canvas-pane.md` | 画布规格 | 提交+未提交 | +270/-0 | 未动 | 直接带过去 |
| `docs/ui/provider-model-output-modality.md` | 输出模态规格 | 提交+未提交 | +75/-0 | 未动 | 直接带过去 |
| `packages/provider/src/config/manual-model-config.ts` | 输出模态/模型 | 已提交 | +31/-9 | 未动 | 直接带过去 |
| `packages/provider/src/config/model-config.ts` | 输出模态/模型 | 已提交 | +10/-1 | 未动 | 直接带过去 |
| `packages/provider/src/model-selection-config.ts` | 输出模态/模型 | 已提交 | +8/-4 | 未动 | 直接带过去 |
| `packages/provider/src/registry.ts` | 输出模态/模型 | 已提交 | +16/-10 | 未动 | 直接带过去 |
| `packages/provider/src/resolver.ts` | 输出模态/模型 | 提交+未提交 | +43/-5 | 未动 | 直接带过去 |
| `packages/provider/test/generationModelRegistryPublication.test.ts` | 测试 | 未提交 | +95/-0 | 未动 | 直接带过去 |
| `packages/services/src/file/file.ts` | 服务/RPC | 已提交 | +9/-0 | 未动 | 直接带过去 |
| `packages/shared/src/model-config.ts` | 输出模态/模型 | 已提交 | +18/-3 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasEdges.tsx` | 画布 UI / 生成面板 | 已提交 | +99/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasImageGeneratePanel.tsx` | 画布 UI / 生成面板 | 未提交 | +168/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasMediaBody.tsx` | 画布 UI / 生成面板 | 未提交 | +279/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasMediaDialog.tsx` | 画布 UI / 生成面板 | 未提交 | +78/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasMediaLightbox.tsx` | 画布 UI / 生成面板 | 未提交 | +74/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/canvasMediaMaterialize.ts` | 画布 UI / 生成面板 | 未提交 | +29/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasMediaQuickBar.tsx` | 画布 UI / 生成面板 | 未提交 | +95/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/canvasMediaStage.ts` | 画布 UI / 生成面板 | 未提交 | +157/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasMinimap.tsx` | 画布 UI / 生成面板 | 提交+未提交 | +119/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasNodeCard.tsx` | 画布 UI / 生成面板 | 提交+未提交 | +208/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasOverlays.tsx` | 画布 UI / 生成面板 | 已提交 | +313/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasSelectionToolbar.tsx` | 画布 UI / 生成面板 | 已提交 | +76/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasVideoGeneratePanel.tsx` | 画布 UI / 生成面板 | 未提交 | +190/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/canvasVideoQueue.ts` | 画布 UI / 生成面板 | 未提交 | +68/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/CanvasWorkspaceImage.tsx` | 画布 UI / 生成面板 | 未提交 | +82/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/useCanvasVideoTasks.ts` | 画布 UI / 生成面板 | 未提交 | +281/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/useMediaAspect.ts` | 画布 UI / 生成面板 | 未提交 | +41/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/canvas/useRatioFrame.ts` | 画布 UI / 生成面板 | 未提交 | +41/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/CanvasPane.tsx` | 画布 UI | 提交+未提交 | +1043/-0 | 未动 | 直接带过去 |
| `packages/ui/src/app-shell/SidePaneTabOverview.tsx` | 画布 Tab 接线 | 已提交 | +2/-0 | 未动 | 直接带过去 |
| `packages/ui/src/components/ModelOutputCapabilityBadge.tsx` | 输出模态/模型 | 已提交 | +28/-0 | 未动 | 直接带过去 |
| `packages/ui/src/lib/canvasBrowserStorage.ts` | 画布文档/状态 | 未提交 | +96/-0 | 未动 | 直接带过去 |
| `packages/ui/src/lib/canvasDocument.ts` | 画布文档/状态 | 提交+未提交 | +437/-0 | 未动 | 直接带过去 |
| `packages/ui/src/lib/canvasGeneration.ts` | 画布文档/状态 | 未提交 | +107/-0 | 未动 | 直接带过去 |
| `packages/ui/src/settings/model-provider-section/ProviderFormControls.tsx` | 输出模态/模型 | 已提交 | +5/-0 | 未动 | 直接带过去 |
| `packages/ui/src/settings/model-provider-section/ProviderModelDraftState.ts` | 输出模态/模型 | 已提交 | +21/-1 | 未动 | 直接带过去 |
| `packages/ui/src/settings/model-provider-section/ProviderModelMetadata.ts` | 输出模态/模型 | 已提交 | +87/-23 | 未动 | 直接带过去 |
| `packages/ui/src/settings/model-provider-section/ProviderModelModalityOptions.tsx` | 输出模态/模型 | 已提交 | +69/-1 | 未动 | 直接带过去 |
| `packages/ui/src/store/canvasStore.ts` | 画布文档/状态 | 提交+未提交 | +398/-0 | 未动 | 直接带过去 |
| `packages/ui/test/canvasGenerationDocument.test.ts` | 画布文档/状态 | 未提交 | +71/-0 | 未动 | 直接带过去 |
| `packages/ui/test/canvasMediaStage.test.ts` | 测试 | 未提交 | +146/-0 | 未动 | 直接带过去 |
| `packages/ui/test/canvasVideoQueue.test.ts` | 测试 | 未提交 | +115/-0 | 未动 | 直接带过去 |
| `packages/ui/test/canvasVideoTasks.test.ts` | 测试 | 未提交 | +112/-0 | 未动 | 直接带过去 |
| `packages/ui/test/modelSelectionGroupsGeneration.test.ts` | 测试 | 未提交 | +51/-0 | 未动 | 直接带过去 |

## 五、语义风险（文本合并不报，但移植后必须验）

1. **依赖注入面**：`GenerationPort` 挂在 `AgentToolDeps`、`AgentRuntimeInternal`、bootstrap facade 上。上游 3.15/3.16 新增了 `ToolSearch`、`deferred-tool-call`、`sampleModel`、off-peak runtime，工具执行器与运行时类型都变过。移植后先跑 `pnpm typecheck`（CLI 27 个包）再谈行为。
2. **optionSpecs 容错**：上游在 `compact-active`、`turn-model`、`target-completion-verification` 里直接读 `optionSpecs`，而我们的生成模型（生图/生视频）没有对话档位。需要确认上游是否在别处补齐，否则保留 `option-specs.ts` 的容错并在这些新读点复用。
3. **侧栏插件化**：上游引入 `plugin-ui` 后，侧栏 tab 的打开/持久化/可见性多了一层 `PluginUiWorkspaceProvider`。我们的画布 tab 走的是 `workspaceSidePane` 的联合类型与 `useAppPanels` 的 handler，需要确认画布 tab 仍能正常 reveal、恢复与去重。
4. **协议 schema**：上游协议仍是 v1，我们加的方法/结果 schema 不与上游冲突；但上游新增了 `sampleModel`、`mcp/ui*` 等 18 个方法，`index.ts` 自动合并后要重跑协议级校验（`.strict()` 对象多字段就会拒）。
5. **工具注册表**：`core/src/tool/handlers/index.ts` 是自动合并的，但上游新增了 `ToolSearch`/deferred 工具可见性机制（`turn-tool-visibility.ts`）。确认 `ImageGenerate`/`VideoGenerate` 在延迟加载与可见性计算里仍会被注册。
6. **i18n**：两侧各自新增 key，文本合并无冲突；但 key 命名若撞车会静默覆盖，合完跑一次 key 重复检查。
7. **样式**：`styles.css` 上游改了 89 处，我们只在文件尾部追加画布块，文本合并自动完成；视觉仍需实测（主题、暗色、窄屏）。

## 六、E 类：本地数据（不要带进移植）

| 路径 | 大小 | 处理 |
| --- | --- | --- |
| `packages/server/.zcode/canvas/default-1tp8aj5.json` | 3 KB | 属本地运行产物（画布文档与已生成的 mp4/png），不要提交、不要移植 |
| `packages/server/.zcode/generated/04ab40faef083468.mp4` | 570 KB | 属本地运行产物（画布文档与已生成的 mp4/png），不要提交、不要移植 |
| `packages/server/.zcode/generated/eeab216c6d7ab703.png` | 1009 KB | 属本地运行产物（画布文档与已生成的 mp4/png），不要提交、不要移植 |

## 七、建议的移植步骤

1. 从上游 `3c5b2276` 拉一份干净检出新分支（不要在这个仓库上直接 merge，13k 文件差异会让 review 失效）。
2. 先带 **D 类 70 个文件**（直接复制，含 `docs/ui/canvas-pane.md`、`docs/agents/image-video-generation.md` 两份规格）。
3. 再逐个解 **A 类 50 个文件**，从第四节列出的 4 个热点开始；每解完一组跑一次 `pnpm typecheck`。
4. 重跑生成链路的验证：bootstrap 单测 → UI canvas 单测 → 重建 CLI bundle 与 `@zcode/server` dist → 真实一次创建（注意 Agnes 免费档额度）。
5. 皮肤/壁纸若要保留，按第二节列的 12 个文件单独带（它们与上游无冲突，但会叠在 `App.tsx`/`i18n`/`styles.css` 上）。

## 八、本次对照未覆盖的

- 上游 `docs/` 新增 2,404 个文件、`.agents/skills` 141 处变更、E2E 体系（Vitest/容器化）——与我们的功能无关，但会影响 `pnpm test`、`lint`、`fmt` 的基线，移植后要重新取基线。
- 上游 `packages/desktop` 新增 118 个源文件（source server、远程 workspace 契约、插件沙箱、桌面遥控 IPC），如果后续要用"手机远控/插件页面"，这些是新的依赖面。
