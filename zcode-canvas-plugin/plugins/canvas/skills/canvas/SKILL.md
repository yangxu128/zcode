# 无限画布（canvas）

用画布组织图片、视频与提示词。画布文档是工作区文件 `.zcode/canvas/*.json`，你通过 MCP 工具读写它。

## 行为约定

1. **先建节点再排生成**：用 `canvas_apply` 创建节点（至少给 `id`、`kind`、`x`、`y`、`w`、`h`），再用 `canvas_request_generation` 给节点排意图。
2. **排完就走**：`canvas_request_generation` 只写意图，立即返回 `requestId`。不要在同一轮里等待出片，
   继续做别的；宿主进程里的 worker 会执行并把结果写回文档。
3. **只在需要时查结果**：用户明确要求或需要基于结果继续时，再用 `canvas_read` 读生成态
   （`generation.status` / `url` / `savedPath` / `error`）。不要高频轮询。
4. **重做要换意图**：同一节点再次生成前先 `canvas_cancel_generation`，或直接请求新的意图
   （新的 `requestId`），不要重复写同一个请求。
5. **失败原样转述**：`generation.error` 包含服务商原文与 request id，不要改写或臆测原因。
6. **不要写媒体二进制**：结果只以 `url` / `savedPath` 引用存在，禁止把 data URL 或 base64 写进文档。

## 常用参数

- 图片：`size`（1K/2K/4K 或服务商档位）、`ratio`（1:1、16:9、9:16 等）。
- 视频：`seconds`（4–12 的整数字符串）、`ratio`、可选 `firstFrame`（工作区相对路径或 data URI）。
- `model` 可选：`providerId/modelId` 或裸 `modelId`；缺省按注册表候选自动选。
