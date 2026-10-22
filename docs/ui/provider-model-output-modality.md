# 供应商模型的输出模态（生图 / 生视频）规格

## 背景与问题

模型设置添加供应商模型时无法添加生图（如 cogview）与生视频（如 cogvideo）模型。
根因在数据模型：`completeModelOutputFormatDataSchema` 只有 `{ supportsText }`，
且 `completeModelOptionSpecsDataSchema` 强制每个模型都有 reasoningLevel 与
maxOutputTokens——生图/生视频模型（无推理档位、上下文语义不同）被校验整体挡住。

## 行为

模型编辑器新增「输出模态」行（文本 / 生图 / 生视频 多选，至少一项）：

- 文本：现状语义（聊天模型）。勾选时沿用既有校验（contextWindow /
  maxOutputTokens / reasoningLevel 必填）。
- 仅生图 / 生视频（不勾文本）：上下文窗口仍需填写（执行入口与配置完整性
  依赖它）；maxOutputTokens 与 reasoning 档位变为可选，编辑器不再物化对应
  optionSpecs；`supportsToolCall` 落为 false。
- 模型卡片徽标显示输出模态（生图 / 生视频）。

## 数据模型（向后兼容）

- `completeModelOutputFormatDataSchema` 增加
  `supportsImage / supportsVideo: z.boolean().optional()`：旧数据（仅
  supportsText）继续通过完整校验；新字段未设置按 false 语义。
- `completeModelOptionSpecsDataSchema` 的 `reasoningLevel / maxOutputTokens`
  改为 optional：生图/生视频模型可省略。既有合法模型不受影响；新允许的
  「无档位」形状由消费方按下条处理。
- `resolver` 的 outputFormat 透传新字段；optionSpecs 缺省时原样省略。

## 运行时容忍（无推理档位的模型）

- `registry.ts`：`ProviderModel` 视图类型与 `validateModelSelectionOptions`
  容忍 `optionSpecs.reasoningLevel` 缺失——无档位模型的选项校验只保留
  身份（不档位化）。
- `model-selection-config.ts`：初始推荐/档位补全跳过无档位模型；
  normalize 在缺档位时保留身份并等待档位。
- **Registry 发布容忍**：`createRegistryModelConfig` 在模型声明生图/生视频输出且
  `optionSpecs` 缺省或为 null 时，先物化空 optionSpecs 再做完整性校验。缺陷成因：
  `completeModelConfigDataSchema` 要求 `optionSpecs` 键存在，而 resolver 对缺省值是
  「原样省略」，于是只有生成模型的供应商会因全部 Model 不 executable 被整体摘出执行
  Registry（`resolver.ts` 中 `validModels.length === 0 → continue`），连接测试最终报
  「Provider Registry 中不存在 Provider: <id>」而不是 Model 级错误。文本输出模型仍必须
  物化 optionSpecs——缺档位要在发布前暴露，不能放进聊天链路。
- **聊天选择器排除**：composer 可选模型列表过滤掉
  `outputFormat.supportsText === false` 的模型——它们不是聊天模型，
  进入聊天选择只会产生必然失败的请求。（执行入口既有 Selection 完整性
  校验继续兜底。）过滤后没有可选模型的供应商分组整体不渲染（`buildRegistryModelSelectGroups`）：
  只配了生图/生视频模型的供应商若仍出现在菜单里，点开是空子菜单，看起来像「模型列表加载不出来」。

## 状态所有者

- Schema 真值：`packages/shared/src/model-config.ts`。
- 领域校验：`packages/provider/src/config/*`（既有 ConfigOverlay 体系，
  不新增所有者）。
- 编辑器草稿：`ProviderModelMetadata.ts` 既有 Draft/Commit 管线扩展，
  不另起表单状态。

## 失败语义

- 输出模态一个都没选：提交无效，错误定位到输出模态行。
- 旧版本客户端读到含 supportsImage/supportsVideo 的配置：未知字段在
  strict schema 下被剥离（旧行为），不影响旧客户端运行。
- 非文本输出模型被强行用于聊天（绕过选择器）：执行入口的 Selection
  校验与供应商 API 报错兜底，不产生部分写入。
- 生成模型没有 optionSpecs：Registry 物化空 specs 后照常发布（见上），Model 侧
  拒绝任何生成选项；连接测试改走生成端点探测（docs/agents/image-video-generation.md），
  不再请求 chat/completions。

## 非目标

- 运行时实际的生图/生视频调用（image/video generation API 适配、画布或
  文件场景的生成工具）——本轮只打通「配置存在且正确」；调用层与按模态选端点
  的连接测试见 docs/agents/image-video-generation.md。
- 内置模型规则（builtin rules）中预置生图模型条目。
