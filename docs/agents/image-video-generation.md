# 生图 / 生视频运行时工具（Generation Layer）规格

## 背景与目标

供应商配置层已支持输出模态（docs/ui/provider-model-output-modality.md），Agnes 等
网关提供真实的生图/生视频 API。本层让 agent 能**实际调用**这些模型：新增
`ImageGenerate` / `VideoGenerate` 两个工具，模型侧按输出模态自动可用。

## 行为

- `ImageGenerate`：输入 `prompt`（必填）、`size`（1K/2K/3K/4K 或精确尺寸）、
  `ratio`、`image`（图生图/多图合成的参考图 URL 数组）。调用
  `POST {baseUrl}/images/generations`；URL 输出直接返回；Base64 输出落盘到
  `<workspace>/.zcode/generated/<timestamp>-<n>.png` 并返回工作区相对路径。
- `VideoGenerate`：输入 `prompt`（必填）、`seconds`（4–12）、`aspect_ratio`、
  `mode`（text/keyframe/reference）及对应媒体字段。创建任务
  `POST {baseUrl}/videos`，轮询 `GET {网关根路径}/agnesapi?video_id&model_name`
  ——**查询端点不带 `/v1` 版本段**（文档示例 `https://apihub.agnes-ai.com/agnesapi`，
  而 baseUrl 是 `…/v1`，直接拼 baseUrl 会打到 `/v1/agnesapi` 而永远查不到任务）。
  间隔 3s，上限 10 分钟，完成后返回视频 URL。
- 任务标识与产物字段（两条都会让节点永远转圈，必须按实测而不是按字段名猜）：
  **只有 `video_id` 能用来查询**，`id` / `task_id` 是任务 ID（文档原话），所以创建响应按
  `video_id → task_id → id` 的顺序取；产物地址按 `url → video_url → metadata.url` 兜
  （文档写 `metadata.url`，实测 completed 响应里只有顶层 `url`）。**说完成了却没拿到地址
  必须判失败**，否则这条永远占着 running，把「一条跑完再排下一条」堵死。
- Flash 与 2.5 的差异只影响入参：Flash 的 `size` 只接受 `"720P"`、`images` ≤5、
  `audios` ≤3、不支持 `videos`；数量与互斥由 `generation-limits.ts` 在发出前校验
  （见「请求频次与并发」）。
- **生视频必须显式带 `size`**。文档把 `size` 标成可选，但实测省略它时 `aspect_ratio`
  不生效：请求 9:16 回片 704×704 的方形。所以宿主端口在调用方没给时补 `"720P"`
  （Flash 唯一档位），调用方给了就原样转发。具体像素由 `aspect_ratio` 决定：
  21:9→1680x720、16:9→1280x704、4:3→960x720、1:1→720x720、3:4→720x960、9:16→720x1280。
- **创建被拒 ≠ 失败**：`GenerationPort.startVideo` 返回 `created | queued` 判别联合。宿主按
  HTTP 状态/错误码分类（429、5xx、连不上 → queued，带 `retryAfterMs` 与网关原文；参数、
  鉴权、模型不可用 → 抛错），调用方据此**自动重投**，不把「稍后再试」当成失败甩给用户。
  协议 `workspace/startVideo` 的结果 schema 同步为判别联合。
- 目标选择：工具入参 `model` 可选（`providerId/modelId` 或裸 `modelId`）。缺席时按注册表
  顺序**依次尝试**该模态的全部候选，直到某个端点接受请求为止；只配了文本模型的会话因此
  不需要先切换模型，也不用记住生成模型的 id。回退边界是安全的：宿主端口只在 HTTP 非 2xx
  （任务未创建、不计费）时抛错。点名 `model` 时不回退——换了模型就不符合调用方意图，
  失败原因直接报回去。未找到任何该模态的候选时报能力缺席（不静默）。
- 连接测试按模态选端点：模型设置测试生成模型连接时不再请求
  `POST {baseUrl}/chat/completions`——Agnes 等网关对图像模型回
  `Model X is an image model. Use /v1/images/generations.`，用户看到的是失败而不是
  可达证据。分派点在 app facade（`bootstrap/src/app/session-facade.ts`，连接测试的唯一执行入口）：
  它按 Registry 中该 Model 的输出模态意图调用宿主的
  `GenerationPort.testConnectivity(target, modality)` 请求真实端点——
  image → `POST {baseUrl}/images/generations`，video → `POST {baseUrl}/videos`，载荷只带
  `model` 与空 `prompt`。网关先校验鉴权与模型路由、再校验 prompt，因此空 prompt 不会
  创建计费任务（2026-10 实测 Agnes：错误 key → 401 `Invalid token`；未知模型 →
  `model_not_found`；有效模型 + 空 prompt → 400 `prompt is required`）。文本输出模型仍走
  既有 chat/completions 单 Token 探测，语义不变。
- 系统提示路由：`# Session-specific guidance` 段在**本轮真的提供了** ImageGenerate/VideoGenerate
  时追加一条指引——图像/视频产出走这两个工具，由文本模型组织 prompt 与 size/ratio/时长，
  具体生成模型由工具解析；除非用户点名模型否则不传 `model`；有这两个工具时不要把生成请求
  改派给技能或 shell 脚本。门控与 Skill 段同源（`guidanceToolNames` 就是本轮实际提供给模型的
  工具名），没有生成工具的会话不会出现这条指引。

## 状态所有者与端口边界

- 遵循 ModelCatalogPort 同一模式：core 看不见 provider 注册表与凭据；宿主
  （bootstrap）实现 `GenerationPort`（contracts），经 AgentRuntimeDeps 注入
  ToolExecutionContext。
- `GenerationPort.listTargets()` 每次现读注册表活视图（stale registry 纪律同
  model-catalog-port.ts）；`generateImage/generateVideo` 由宿主执行 HTTP
  （宿主有 node fetch 与文件系统），core 工具层零 I/O。
- 凭据（apiKey）只存在宿主端口实现内部，不进入工具结果或模型可见内容。
- UI 面（画布节点内生成，docs/ui/canvas-pane.md T4）复用**同一个宿主端口实例**：
  工作区级 RPC 直连 `GenerationPort.generateImage`，不复制第二份生成实现，
  也不把凭据带到协议参数里。

## 可用性门控

- 注册门：`includeGeneration`（generationPort 在场即真）；subagent_child 会话
  不暴露（与 automation 同规则）。
- 模型门：仅列出 `outputFormat.supportsImage/supportsVideo === true` 且启用的
  模型。聊天选择器已排除它们（settings 侧），此处是它们唯一的运行时入口。

## 失败语义

- HTTP 非 2xx：抛 `GenerationHttpError(status, code)`，`message` 保留 API 原文（含 request id）。
- **一个响应都没拿到**（DNS/连接/重置/超时）：抛 `GenerationConnectError`，消息必须带上 undici
  `cause` 里的错误码与人类可读提示。曾经只报一句 `fetch failed`，把 2026-10-12 一次本机出网
  连接超时（`UND_ERR_CONNECT_TIMEOUT`，同一时刻多个无关域名同时失败）伪装成了"模型不可用"。
  这类失败按定义没有创建任务、不计费，所以与 5xx 同级，走同一套指数退避。
- 临时失败重试（按服务商 FAQ 的处置规范）：**创建类请求**（生图 `/images/generations`、
  生视频 `/videos`）遇 5xx（501 除外）按 1s → 2s → 4s 指数退避重发，最多三次；
  这一层只包「发出并判定状态」，因为 5xx 意味着任务/图片尚未创建，重发不会重复计费。
  429 **不自动重试**——限流按时间窗口恢复，重试只会加重；预算用完后的失败按候选计入报告，
  全部候选都失败时按 `- providerId/modelId: 原因` 逐个报告。
  调用被取消（abortSignal）时立即上抛，不把取消误当成「这个模型不行」继续打下一个。
- 失败文案：原文之后追加按状态码/错误码派生的处置提示（`video_queue_full` → 队列已满稍后重试；
  429 → 等窗口恢复；重试耗尽的 5xx → 已退避重试仍失败）。分类只用状态码与结构化错误码，
  不解析自由文本；其他 4xx 不加噪声提示。
- 视频轮询超时/任务 failed：返回任务状态与 id，不部分伪造结果。查询请求本身失败（网络抖动、
  响应不可解析）仍按「运行中」处理；但**被服务商明确拒绝**不属于抖动，见下一节的分流。

## 请求频次与并发

服务商文档给的是频次约束，而且**免费档的额度按分钟计**：生视频 Effective RPM 1、生文本/生图
10 RPM（Token 计划解锁 30,000 请求/5 小时、4,000 张图/天、500 秒视频/天）。这一分钟窗口卡的是
**创建**请求——同栈的 AIxiaoshuo 生产实现按 2 秒轮询查询、把创建滴灌到 ≥61 秒，跑得通。
但 2026-10-12 的实测补充了一条更重要的事实：用户侧被拒的时长**远超一分钟**（见下文重投节奏），
所以「等满一分钟再投」只是下限，不能当成恢复时间表。FAQ 的处置是「降低并发与请求频率，
等限流窗口恢复」。据此定死这几条规则：

- **默认查询节奏 3 秒**（文档建议 1–2 秒），但**创建后 10 秒内不查**：任务要几十秒才完成
  （文档示例 45s），前几秒查它是纯浪费。
- **查询按状态码分流**，并把冷却时长以 `retryAfterMs` 回传给调用方（宿主只翻译事实，
  谁排队谁决定节奏）：429 → 读 `Retry-After`，读不到按 **60s**（免费档一分钟窗口，给 30s
  等于再撞一次 429）；5xx → 读不到按 6s；
  其他非 2xx → 15s；401/403/404 → 判为 `failed` 并停止轮询（继续查只是白耗配额，
  节点仍可重试）。钳在 1s–120s 之间。
- **创建类 POST 按模态分队串行，冷却也分队**：生视频 1 RPM 与生图 10 RPM 是两份额度，
  共用一条冷却队列会让一次视频 429 把画布上的生图一起堵死一分钟，那是我们自己造的故障。
- **生视频不在请求内等冷却**：窗口没过就立刻回 `queued` 并带上真实剩余时长，由调用方排期重投
  （画布节点的 `retryAt`、工具面的重投循环）。理由有两个：占着一条 RPC 睡到远端窗口结束会先撞上
  客户端超时（2026-10-12 实测：60s 冷却塞进请求内部 + 客户端 60s 超时 = 用户只看到
  "Protocol request timed out"）；而在冷却期内再发一次创建只是白打一次。
  生图是同步返回的，仍允许在请求内等满窗口（上限 `CREATE_QUEUE_WAIT_MS`），等一拍比报错给用户好。
- **重投节奏按「已排队多久」拉开，不是每分钟猛打**：`nextCreateWaitMs`（宿主端口）与
  `nextQueueWaitMs`（画布）同一口径——2 分钟内 1 分钟一轮，10 分钟内 4 分钟，再往后 10/15 分钟。
  依据是同一天的另一组实测：9 次创建在 17:30–18:02 间全部 429，其中 17:36→18:00 空了 24 分钟
  没有发过任何创建，下一次仍然 429。**免费档被拒的不是分钟窗口，而是账号级的创建额度**，
  贴着分钟重投换不来放行，只会把额度压得更死。
  所以节奏要拉开、总时限到点就如实判失败（画布 2 小时），而不是无限占着「排队中」。
- **超时链路必须层层包住**：调用方 RPC 超时 > 排队上限 + 单次请求预算。当前口径——
  生视频创建 150s（客户端）> 0s（不在请求内排队）+ 45s；生图 330s > 90s + 220s；`VideoGenerate` 工具 33 分钟
  > 端口轮询上限 30 分钟；画布僵尸判定同为 30 分钟。免费档出片实测十几二十分钟，
  任何一环比下一环短都会把还在正常跑的任务判死。
- **创建前先本地校验**服务商一定会拒的入参（时长 `"4"`–`"12"` 整数、画幅白名单、
  参考图 ≤5、参考音频 ≤3、mode 与媒体字段互斥），因为这类请求「不创建任务、不计费，
  但照样消耗一次请求配额」。校验位置在宿主端口（`generation-limits.ts`），工具面与
  画布面共用同一判据。
- 无可用目标：`generation_unavailable` 能力缺席失败，指引用户先在模型设置添加
  生图/生视频模型。
- 连接探测判定（按状态码与结构化错误码，不解析自由文本）：2xx 通过；401/403 →
  认证失败；404 → 该端点不提供此模态；错误码 `model_not_found`（含网关用作 503 的
  无可用通道）→ 模型不可用；其他 5xx → 服务端错误；其余 4xx 说明请求已到达端点且
  凭据被接受，仅探测载荷被拒 → 视为连通。失败消息保留 API 原文（含 request id），
  凭据只存在于宿主端口实现内部。

## 非目标

- 多模型并发生成、生成历史管理。
