// ============================================================
// GenerationPort 的宿主实现：Provider 注册表 → 工具层的生成执行
// ============================================================
// 端口契约见 contracts/src/interfaces/generation.port.ts。存在的理由：
// ImageGenerate/VideoGenerate 工具要真正调用生图/生视频 API，而 core 看不见
// provider 注册表与 apiKey。本模块每次调用现读注册表活视图（stale registry
// 纪律同 model-catalog-port.ts），凭据只在实现内部使用，绝不进入工具结果。
// 传输/落地/探测判定分别在同目录 generation-http.ts、generated-media.ts、
// generation-connectivity.ts。

import {
  GenerationPort,
  type GeneratedImage,
  type GenerationModality,
  type GenerationTarget,
  type ImageGenerateResult,
  type VideoGenerateRequest,
  type VideoGenerateResult,
  type VideoStartResult,
  type VideoTaskOutcome,
} from "@zcode/contracts";
import type { Logger } from "@zcode/contracts";
import {
  assertGenerationAccepted,
  describeQueuedGenerationFailure,
  GenerationQueuedError,
  isTransientGenerationStatus,
  parseRetryAfterMs,
  postJson,
  resolveProviderFacts,
  retryAfterMsOf,
  withTransientRetry,
  type ProviderFacts,
} from "./generation-http.js";
import { describeVideoRequestRejection, nextCreateWaitMs } from "./generation-limits.js";
import {
  materializeMediaToWorkspace,
  resolveMediaReferences,
  saveBase64Image,
} from "./generated-media.js";
import {
  describeGenerationConnectivityFailure,
  GENERATION_CONNECTIVITY_PATH,
  GENERATION_CONNECTIVITY_PROMPT,
  GENERATION_CONNECTIVITY_TIMEOUT_MS,
} from "./generation-connectivity.js";
import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";

interface GenerationPortDeps {
  /** 进程的 Provider Registry。整个对象存下，每次调用现读 getView()。 */
  registry: ProviderRegistryModelSource;
  /** 工作区路径：Base64 输出与外链结果落盘到 <workspace>/.zcode/generated/。 */
  getWorkspacePath: () => string | undefined;
  logger?: Logger;
}

/**
 * 生视频的默认分辨率档位。服务商文档：`size` 标着可选，但省略时画幅不生效，
 * 出片会退回方形；720P 是 Flash 唯一支持的档位，也是当前限时免费的档位。
 */
const DEFAULT_VIDEO_SIZE = "720P";
/**
 * 单次创建请求的超时与**整次调用**的总预算。总预算必须小于调用方的 RPC 超时
 * （画布生视频、生图各自都留了余量），否则重试还没跑完，客户端就先报了
 * request timed out，用户看不到真实失败原因。
 */
const IMAGE_GENERATE_TIMEOUT_MS = 180_000;
const IMAGE_GENERATE_BUDGET_MS = 220_000;
const VIDEO_CREATE_TIMEOUT_MS = 20_000;
const VIDEO_CREATE_BUDGET_MS = 45_000;
/**
 * 生图在请求内等冷却的上限：生图是同步返回的，等一拍比报错给用户好；
 * 生视频不在请求内等（见 runSerialized），额度是分钟级以上才恢复的，睡在这里只会撞 RPC 超时。
 */
const CREATE_QUEUE_WAIT_MS = 90_000;
/**
 * 默认查询节奏 3 秒。文档建议 1–2 秒；免费档那 1 RPM 卡的是**创建**请求
 * （同栈生产实现按 2 秒轮询 + 创建滴灌 61 秒跑得通），所以查询不必自我阉割到十分钟一级。
 */
const VIDEO_POLL_INTERVAL_MS = 3_000;
/**
 * 工具面等待完成的上限 30 分钟：免费档排队 + 出片本来就要十几二十分钟，
 * 画布侧的僵尸判定与之对齐，不能一边让用户等一边把任务判死。
 */
const VIDEO_POLL_TIMEOUT_MS = 30 * 60_000;
const VIDEO_QUERY_TIMEOUT_MS = 30_000;
/**
 * 被拒时的最低再试间隔。免费档生视频是 1 RPM（生图/文本 10 RPM），所以限流必须等满一分钟窗口；
 * 按默认节奏继续打只会把这份额度耗在查询上，反而让创建请求一直 429。
 */
const RATE_LIMIT_POLL_COOLDOWN_MS = 60_000;
const TRANSIENT_POLL_COOLDOWN_MS = 6_000;
const UNKNOWN_REJECT_COOLDOWN_MS = 15_000;

/**
 * 查询端点在网关**根路径**下，不带版本段：文档示例是
 * `https://apihub.agnes-ai.com/agnesapi?video_id=…`，而 baseUrl 是 `…/v1`。
 * 直接拼 baseUrl 会打到 `/v1/agnesapi`，任务永远查不到。
 */
function gatewayRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v\d+(?:\.\d+)?$/, "");
}

/** 查询响应的任务记录。地址与失败原因在网关侧有好几种写法，全部兜住。 */
interface VideoTaskRecord {
  status?: unknown;
  url?: unknown;
  video_url?: unknown;
  metadata?: { url?: unknown } | null;
  error?: { message?: unknown; detail?: unknown } | string | null;
}

/**
 * 文档写产物在 `metadata.url`，但实测 completed 响应里没有 metadata 字段、地址在顶层 `url`
 * （同栈的 AIxiaoshuo 生产实现踩过：只认 metadata.url 会让已完成的任务永远停在 running）。
 */
function pickVideoUrl(record: VideoTaskRecord): string | undefined {
  return [record.url, record.video_url, record.metadata?.url].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function pickTaskFailureDetail(record: VideoTaskRecord): string {
  const error = record.error;
  if (typeof error === "string" && error) return error.slice(0, 300);
  if (error && typeof error === "object") {
    const message = error.message ?? error.detail;
    if (typeof message === "string" && message) return message.slice(0, 300);
  }
  return JSON.stringify(record).slice(0, 300);
}

/**
 * 模型的输出模态意图：声明生图/生视频就是生成模型，判据与聊天选择器和工具目标选取同源
 * （docs/ui/provider-model-output-modality.md）。先图后视频。
 */
export function pickGenerationModality(config: {
  readonly properties?: {
    readonly outputFormat?: {
      readonly supportsImage?: boolean;
      readonly supportsVideo?: boolean;
    } | null;
  } | null;
}): GenerationModality | undefined {
  const outputFormat = config.properties?.outputFormat;
  if (!outputFormat) return undefined;
  if (outputFormat.supportsImage === true) return "image";
  if (outputFormat.supportsVideo === true) return "video";
  return undefined;
}

function pickModalityTargets(registry: ProviderRegistryModelSource): GenerationTarget[] {
  const view = registry.getView();
  const targets: GenerationTarget[] = [];
  for (const provider of view.providers) {
    if (provider.config.visibility === "hidden") continue;
    for (const model of provider.models) {
      if (model.config.enabled === false) continue;
      const modality = pickGenerationModality(model.config);
      if (!modality) continue;
      targets.push({
        providerId: provider.providerId,
        ...(provider.providerName ? { providerName: provider.providerName } : {}),
        modelId: model.modelId,
        modality,
      });
    }
  }
  return targets;
}

function requireFacts(
  registry: ProviderRegistryModelSource,
  providerId: string,
): ProviderFacts {
  const facts = resolveProviderFacts(registry, providerId);
  if (!facts) {
    throw new Error(`Provider 不可用或缺少 baseUrl: ${providerId}`);
  }
  return facts;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 创建请求的额度分组：生图与生视频在服务商侧是两份 RPM，冷却与串行不能互相拖累。 */
type GenerationLimitKey = "image" | "video";

export function createGenerationPort(deps: GenerationPortDeps): GenerationPort {
  /**
   * 创建类 POST 按模态分队串行发出，并在撞上限流时冷却**同模态**的那条队：
   * 免费档生视频约 1 次/分钟、生图 10 次/分钟是两份额度（服务商文档），
   * 共用一份冷却会让视频 429 把生图一起堵死。多个节点同时点「生成」只会把自己打进
   * 429（FAQ「降低并发与请求频率」），所以同模态必须串行。
   */
  const createQueues: Record<GenerationLimitKey, { tail: Promise<void>; cooldownUntil: number }> =
    {
      image: { tail: Promise.resolve(), cooldownUntil: 0 },
      video: { tail: Promise.resolve(), cooldownUntil: 0 },
    };
  const runSerialized = async <T>(
    limitKey: GenerationLimitKey,
    maxQueueWaitMs: number,
    run: () => Promise<T>,
  ): Promise<T> => {
    const queue = createQueues[limitKey];
    const previous = queue.tail;
    let release: () => void = () => undefined;
    queue.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    // 冷却只等到 maxQueueWaitMs 为止：生视频把这一步交给调用方（画布节点的排队态、
    // 工具面的重投循环），不在一条 RPC 里睡满窗口——占着请求等远端节奏会先撞上客户端超时。
    const cooldown = queue.cooldownUntil - Date.now();
    if (cooldown > maxQueueWaitMs) {
      throw new GenerationQueuedError(
        `生成请求过于频繁，约 ${Math.ceil(cooldown / 1000)} 秒后可再试`,
        cooldown,
      );
    }
    if (cooldown > 0) await sleep(cooldown);
    try {
      return await run();
    } catch (error) {
      const retryAfterMs = retryAfterMsOf(error);
      if (retryAfterMs !== undefined) {
        queue.cooldownUntil = Math.max(queue.cooldownUntil, Date.now() + retryAfterMs);
      }
      throw error;
    } finally {
      release();
    }
  };

  /**
   * 只创建任务：分钟级的等待交给调用方（画布节点）自己轮询，刷新后才能恢复。
   * 被限流/繁忙/连不上时返回 queued（带建议重投间隔），调用方自动排队重投；
   * 只有参数、鉴权、模型不可用这类「再投也不会变好」的错误才抛出去。
   */
  const startVideoTask = async (
    target: { providerId: string; modelId: string },
    request: VideoGenerateRequest,
  ): Promise<VideoStartResult> => {
    // 服务商一定会拒的参数先本地拦下：校验失败不创建任务也不计费，但照样吃掉一次请求配额。
    const rejection = describeVideoRequestRejection(request);
    if (rejection) throw new Error(`视频请求参数不合法：${rejection}`);
    const facts = requireFacts(deps.registry, target.providerId);
    const createBody: Record<string, unknown> = {
      model: target.modelId,
      prompt: request.prompt,
      mode: request.mode,
      // 必须显式带 size：省略时上游不按 aspect_ratio 出片（实测请求 9:16 回片 704×704）。
      // 文档里 720P 是 Flash 唯一档位，2.5 也支持更高档，所以调用方传了就用调用方的。
      size: request.size ?? DEFAULT_VIDEO_SIZE,
      ...(request.seconds ? { seconds: request.seconds } : {}),
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
    };
    // 参考素材同样可能是画布里的工作区文件，发出去前换成 data URI。
    if (request.mode === "keyframe") {
      const firstFrame = (await resolveMediaReferences([request.firstFrame ?? ""], deps.getWorkspacePath()))?.[0];
      const lastFrame = (await resolveMediaReferences([request.lastFrame ?? ""], deps.getWorkspacePath()))?.[0];
      if (firstFrame) createBody.first_frame = firstFrame;
      if (lastFrame) createBody.last_frame = lastFrame;
    }
    if (request.mode === "reference") {
      const images = await resolveMediaReferences(request.images, deps.getWorkspacePath());
      if (images?.length) createBody.images = images;
      if (request.audios?.length) createBody.audios = [...request.audios];
    }
    // 串行排队 + 5xx 指数退避都在这一层：排队避免自己打自己限流，退避只重发未创建成功的请求。
    // 冷却不在这里等（maxQueueWaitMs=0）：由画布节点的排队态或工具面的重投循环按节奏再投。
    let created: { status: number; json: unknown; retryAfterMs?: number };
    try {
      created = await runSerialized("video", 0, () =>
        withTransientRetry(async () => {
          const attempt = await postJson(facts, "/videos", createBody, VIDEO_CREATE_TIMEOUT_MS);
          assertGenerationAccepted(attempt.status, attempt.json, attempt.retryAfterMs);
          return attempt;
        }, undefined, VIDEO_CREATE_BUDGET_MS),
      );
    } catch (error) {
      const queued = describeQueuedGenerationFailure(error);
      if (!queued) throw error;
      return { status: "queued", ...queued };
    }
    // 文档明确：`id` 与 `task_id` 是任务 ID，**只有 `video_id` 能用来查询**。
    // 优先取 id 会拿一个查不到的标识去轮询，任务永远停在 running（AIxiaoshuo 的
    // 生产实现同样按 video_id → id 的顺序取）。
    const createdRecord = created.json as { id?: unknown; task_id?: unknown; video_id?: unknown };
    const videoId = [createdRecord.video_id, createdRecord.task_id, createdRecord.id].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (!videoId) {
      throw new Error("视频任务创建响应缺少任务 id");
    }
    return { status: "created", videoId };
  };

  /**
   * 单次查询：网络抖动按「仍在跑」返回，不能把一次查询失败误判成任务失败；
   * 但 429/5xx 是服务商明确说「现在别再来」，必须带上冷却时长回传，否则调用方会
   * 继续按默认节奏把配额打空（文档建议 1–2s 查一次，我们默认 3s 已更保守）。
   */
  const queryVideoTask = async (
    target: { providerId: string; modelId: string },
    videoId: string,
  ): Promise<VideoTaskOutcome> => {
    const facts = requireFacts(deps.registry, target.providerId);
    // 网关要求带 model_name 才能查 keyframe/reference 模式的任务。
    const pollUrl = `${gatewayRoot(facts.baseUrl)}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(target.modelId)}`;
    let response: Response;
    try {
      response = await fetch(pollUrl, {
        headers: facts.apiKey ? { Authorization: `Bearer ${facts.apiKey}` } : {},
        signal: AbortSignal.timeout(VIDEO_QUERY_TIMEOUT_MS),
      });
    } catch (error) {
      deps.logger?.debug("[Generation] 视频轮询请求失败，按运行中处理", { error, videoId });
      return { status: "running" };
    }
    if (response.status === 429) {
      return {
        status: "running",
        retryAfterMs: parseRetryAfterMs(response.headers) ?? RATE_LIMIT_POLL_COOLDOWN_MS,
      };
    }
    if (isTransientGenerationStatus(response.status)) {
      return {
        status: "running",
        retryAfterMs: parseRetryAfterMs(response.headers) ?? TRANSIENT_POLL_COOLDOWN_MS,
      };
    }
    // 永久性的查询拒绝：继续轮询只是白耗配额，停下来并把原因交回用户（节点仍可重试）。
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return {
        status: "failed",
        detail:
          response.status === 404
            ? "任务不存在或已过期（HTTP 404），可重新生成"
            : `凭据或权限被拒（HTTP ${response.status}），已停止查询该任务`,
      };
    }
    if (response.status < 200 || response.status >= 300) {
      return {
        status: "running",
        retryAfterMs: parseRetryAfterMs(response.headers) ?? UNKNOWN_REJECT_COOLDOWN_MS,
      };
    }
    let record: VideoTaskRecord | null;
    try {
      record = (await response.json()) as VideoTaskRecord | null;
    } catch (error) {
      deps.logger?.debug("[Generation] 视频轮询响应不可解析，按运行中处理", { error, videoId });
      return { status: "running", retryAfterMs: UNKNOWN_REJECT_COOLDOWN_MS };
    }
    const state = String(record?.status ?? "").toLowerCase();
    if (state === "completed" || state === "succeeded") {
      const videoUrl = pickVideoUrl(record ?? {});
      // 说完成了却没地址必须判失败：否则节点永远占着 running，把「一条跑完再排下一条」堵死。
      return videoUrl
        ? { status: "completed", url: videoUrl }
        : { status: "failed", detail: "任务已完成但未返回视频地址，可重新生成" };
    }
    if (state === "failed") {
      return { status: "failed", detail: pickTaskFailureDetail(record ?? {}) };
    }
    if (state === "cancelled") {
      return { status: "failed", detail: "任务已取消" };
    }
    // queued / pending / in_progress / running 及未识别状态：等下一轮，不改节点。
    return { status: "running" };
  };

  const port: GenerationPort = {
    listTargets(): GenerationTarget[] {
      return pickModalityTargets(deps.registry);
    },

    async generateImage(target, request): Promise<ImageGenerateResult> {
      const facts = requireFacts(deps.registry, target.providerId);
      const imageRefs = (await resolveMediaReferences(request.image, deps.getWorkspacePath())) ?? [];
      const body: Record<string, unknown> = {
        model: target.modelId,
        prompt: request.prompt,
        ...(request.size ? { size: request.size } : {}),
        ...(request.ratio ? { ratio: request.ratio } : {}),
        ...(imageRefs.length ? { extra_body: { image: imageRefs } } : {}),
      };
      const responded = await runSerialized("image", CREATE_QUEUE_WAIT_MS, () =>
        withTransientRetry(async () => {
          const attempt = await postJson(
            facts,
            "/images/generations",
            body,
            IMAGE_GENERATE_TIMEOUT_MS,
          );
          assertGenerationAccepted(attempt.status, attempt.json, attempt.retryAfterMs);
          return attempt;
        }, undefined, IMAGE_GENERATE_BUDGET_MS),
      );
      const data = (responded.json as { data?: unknown }).data;
      if (!Array.isArray(data)) {
        throw new Error("生图响应缺少 data 数组");
      }
      const workspacePath = deps.getWorkspacePath();
      const images: GeneratedImage[] = [];
      for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const record = item as { url?: unknown; b64_json?: unknown };
        if (typeof record.url === "string" && record.url) {
          images.push({ url: record.url });
          continue;
        }
        if (typeof record.b64_json === "string" && record.b64_json) {
          const saved = await saveBase64Image(
            record.b64_json,
            workspacePath,
            target.modelId,
            deps.logger,
          );
          // 落盘失败也不丢结果：整段保留 data URI，模型可见输出由 resultBudget 截断。
          images.push(
            saved.savedPath
              ? { savedPath: saved.savedPath }
              : { url: `data:image/png;base64,${record.b64_json}` },
          );
        }
      }
      return { modelId: target.modelId, images };
    },

    async generateVideo(target, request): Promise<VideoGenerateResult> {
      // 工具面同样自动排队：撞限流就自动重投，不把「稍后再试」当成失败抛回给模型。
      // 重投节奏按已排队时长拉开，见 nextCreateWaitMs 的实测依据。
      const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
      const queuedAt = Date.now();
      let videoId = "";
      let createAttempts = 0;
      for (;;) {
        createAttempts += 1;
        const started = await startVideoTask(target, request);
        if (started.status === "created") {
          videoId = started.videoId;
          break;
        }
        const waitMs = nextCreateWaitMs(Date.now() - queuedAt, started.retryAfterMs);
        if (Date.now() + waitMs >= deadline) {
          // 报「实际等了多久 / 投了几次」而不是只报预算：2026-10-13 实测这一跑是 20 分钟、
          // 5 次创建全被拒，只写「排队超时（30 分钟）」会让人以为还要再等 10 分钟才有结论。
          throw new Error(
            `视频生成排队 ${Math.round((Date.now() - queuedAt) / 60_000)} 分钟仍未放行` +
              `（已重投 ${createAttempts} 次，等待上限 ${Math.round(VIDEO_POLL_TIMEOUT_MS / 60_000)} 分钟）：` +
              started.reason,
          );
        }
        await sleep(waitMs);
      }
      let waitMs = VIDEO_POLL_INTERVAL_MS;
      while (Date.now() < deadline) {
        await sleep(waitMs);
        const outcome = await queryVideoTask(target, videoId);
        // 被限流/服务端繁忙时按宿主回传的冷却放慢，其余情况保持默认节奏。
        waitMs = outcome.status === "running" ? (outcome.retryAfterMs ?? VIDEO_POLL_INTERVAL_MS) : waitMs;
        if (outcome.status === "completed") {
          return { modelId: target.modelId, videoId, url: outcome.url };
        }
        if (outcome.status === "failed") {
          throw new Error(`视频生成任务失败: ${outcome.detail ?? videoId}`);
        }
      }
      throw new Error(`视频生成轮询超时（${VIDEO_POLL_TIMEOUT_MS / 1000}s），任务 id: ${videoId}`);
    },

    startVideo: startVideoTask,

    getVideoStatus: queryVideoTask,

    async materializeMedia(url): Promise<{ savedPath: string; reused: boolean }> {
      return materializeMediaToWorkspace(url, deps.getWorkspacePath());
    },

    async testConnectivity(target, modality): Promise<void> {
      const facts = requireFacts(deps.registry, target.providerId);
      const path = GENERATION_CONNECTIVITY_PATH[modality];
      const { status, json } = await postJson(
        facts,
        path,
        { model: target.modelId, prompt: GENERATION_CONNECTIVITY_PROMPT },
        GENERATION_CONNECTIVITY_TIMEOUT_MS,
      );
      const failure = describeGenerationConnectivityFailure(modality, path, status, json);
      if (failure) throw new Error(failure);
    },
  };
  return port;
}
