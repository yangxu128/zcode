// ============================================================
// 生成端口的 HTTP 边界：Provider 事实、POST JSON 与失败分类
// ============================================================
// 从 generation-port.ts 拆出：端口实现只保留「调用哪个端点、拿回什么」，
// 传输与错误分类是另一层关注点（docs/agents/image-video-generation.md）。

import type { ProviderRegistryModelSource } from "./provider-registry-model-runtime.js";

export interface ProviderFacts {
  baseUrl: string;
  apiKey?: string;
}

/** 每次现读注册表活视图；凭据只在这里取出，绝不进入返回值或工具结果。 */
export function resolveProviderFacts(
  registry: ProviderRegistryModelSource,
  providerId: string,
): ProviderFacts | null {
  const provider = registry
    .getView()
    .providers.find((candidate) => candidate.providerId === providerId);
  if (!provider) return null;
  const access = provider.config.access as { type?: string; apiKey?: string } | undefined;
  const baseUrl = provider.config.api?.baseUrl?.trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    ...(access?.type === "api-key" && access.apiKey ? { apiKey: access.apiKey } : {}),
  };
}

export async function postJson(
  facts: ProviderFacts,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; json: unknown; retryAfterMs?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${facts.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...(facts.apiKey ? { Authorization: `Bearer ${facts.apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((error: unknown) => {
      // undici 只给 "fetch failed"，真正的原因在 cause 里。丢掉它用户就只能看到一句废话
      // （2026-10-12 画布生视频的 "fetch failed" 实际是本机出网连接超时）。
      throw new GenerationConnectError(path, error);
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    const retryAfterMs = parseRetryAfterMs(response.headers);
    return { status: response.status, json, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  } finally {
    clearTimeout(timer);
  }
}

export function extractErrorMessage(json: unknown): string {
  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    const detail = record.detail ?? record.error ?? record.message;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const inner = (detail as Record<string, unknown>).message ?? detail;
      if (typeof inner === "string") return inner;
      return JSON.stringify(inner).slice(0, 300);
    }
    if (typeof record.raw === "string") return record.raw;
  }
  return JSON.stringify(json ?? {}).slice(0, 300);
}

/** 网关把错误码放在 `error.code`（生图/限流）或顶层 `code`（生视频），状态码可能是 503。 */
export function extractResponseErrorCode(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const record = json as Record<string, unknown>;
  const nested = record.error;
  const candidates = [
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>).code
      : undefined,
    record.code,
  ];
  return candidates.find((code): code is string => typeof code === "string" && code.length > 0);
}

/**
 * Retry-After 允许「秒数」或「HTTP 日期」两种形式；读不出返回 undefined，由调用方按状态码兜底。
 * 钳到 [1s, 120s]：再长的冷却也不该让在途节点无限挂住，且下限避免冷却形同空转。
 */
export function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  const candidate = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(raw) - Date.now();
  if (!Number.isFinite(candidate)) return undefined;
  return Math.min(120_000, Math.max(1_000, Math.round(candidate)));
}

/**
 * 生成端口的 HTTP 失败：带状态码与结构化错误码，调用方按码分类，不解析自由文本。
 * message 保留 API 原文（含 request id）。
 */
export class GenerationHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  /** 服务商给出的冷却建议（Retry-After），调用方据此放缓后续请求。 */
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, code?: string, retryAfterMs?: number) {
    super(message);
    this.name = "GenerationHttpError";
    this.status = status;
    if (code !== undefined) this.code = code;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/** undici 的 "fetch failed" 把真因塞在 cause 里，这里把它摊平成一句能看懂的话。 */
function describeConnectFailure(error: unknown): string {
  // 优先看 cause（undici 的 TypeError 本身只有 message="fetch failed"，code 在下一层）。
  const candidates: unknown[] = [(error as { cause?: unknown })?.cause, error];
  let code: string | undefined;
  let message: string | undefined;
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      message ??= candidate;
      continue;
    }
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as { code?: unknown; message?: unknown };
    if (code === undefined && typeof record.code === "string") code = record.code;
    if (message === undefined && typeof record.message === "string") message = record.message;
  }
  const hint =
    code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT"
      ? "连接网关超时，本机出网可能不通"
      : code === "ENOTFOUND" || code === "EAI_AGAIN"
        ? "域名解析失败，检查网络或代理"
        : code === "ECONNREFUSED"
          ? "网关拒绝连接"
          : code === "ECONNRESET"
            ? "连接被重置"
            : undefined;
  const readable = message && message !== "fetch failed" ? message : undefined;
  return `${hint ?? readable ?? "网络请求失败"}（${code ?? "network error"}）`;
}

/**
 * 传输层失败：一个 HTTP 响应都没拿到，所以任务/图片必然没创建、不计费，
 * 与 5xx 同属可退避重发的临时故障（本机网络抖动也落在这一类）。
 */
export class GenerationConnectError extends Error {
  constructor(path: string, cause: unknown) {
    super(`无法连接生成服务 ${path}：${describeConnectFailure(cause)}`);
    this.name = "GenerationConnectError";
  }
}

export function isTransientGenerationFailure(error: unknown): boolean {
  return (
    error instanceof GenerationConnectError ||
    (error instanceof GenerationHttpError && isTransientGenerationStatus(error.status))
  );
}

/**
 * 5xx 按服务商 FAQ 属于「服务繁忙/临时上游异常」，用指数退避重试；
 * 429 是 RPM/配额，重试只会加重，交给调用方等窗口恢复。
 */
export function isTransientGenerationStatus(status: number): boolean {
  return status >= 500 && status <= 599 && status !== 501;
}

/**
 * 面向用户的处置提示：网关原文（含 request id）始终保留在 detail 里，这里只补「下一步做什么」。
 * 队列满与限流在网关侧措辞各异，因此按错误码/状态码分类，不解析自由文本。
 */
function describeDisposalHint(status: number, code?: string): string | undefined {
  if (code === "video_queue_full") return "生成队列已满，稍后重试";
  if (status === 429) return "账号请求过于频繁，重试会加重限流，等 1 分钟后再试";
  if (isTransientGenerationStatus(status)) return "服务临时繁忙，已按 1s/2s/4s 退避重试仍失败，稍后重试";
  return undefined;
}

/**
 * 429 通常不带 Retry-After。免费档的**生视频是 1 RPM**（生图/文本 10 RPM，见服务商文档），
 * 所以默认冷却必须覆盖一整个分钟窗口——给 30s 等于让用户再撞一次同样的 429。
 */
export const RATE_LIMITED_COOLDOWN_MS = 60_000;
/** 5xx / 连不上时的重投间隔：比限流窗口短，但也不能贴着脸重试。 */
export const TRANSIENT_CREATE_RETRY_MS = 15_000;

/**
 * 队列冷却长过等待上限时抛这个：它不是失败，是「还没轮到发出去」，
 * 端口会把它翻译成 queued 结果交给调用方继续排队。
 */
export class GenerationQueuedError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = "GenerationQueuedError";
  }
}

/**
 * 「这次没成，但过一会儿再投会同」的判定：只认错误类型与状态码，不解析错误文本
 * （AGENTS.md「不依赖错误文本做流程判断」）。返回 null 表示这是真失败——参数、鉴权、
 * 模型不可用，重投也不会变好。
 */
export function describeQueuedGenerationFailure(
  error: unknown,
): { retryAfterMs: number; reason: string } | null {
  if (error instanceof GenerationQueuedError) {
    return { retryAfterMs: error.retryAfterMs, reason: error.message };
  }
  if (error instanceof GenerationConnectError) {
    return { retryAfterMs: TRANSIENT_CREATE_RETRY_MS, reason: error.message };
  }
  if (error instanceof GenerationHttpError) {
    if (error.status !== 429 && !isTransientGenerationStatus(error.status)) return null;
    return {
      retryAfterMs:
        error.retryAfterMs ??
        (error.status === 429 ? RATE_LIMITED_COOLDOWN_MS : TRANSIENT_CREATE_RETRY_MS),
      reason: error.message,
    };
  }
  return null;
}

export function retryAfterMsOf(error: unknown): number | undefined {
  if (!(error instanceof GenerationHttpError)) return undefined;
  if (error.retryAfterMs !== undefined) return error.retryAfterMs;
  return error.status === 429 ? RATE_LIMITED_COOLDOWN_MS : undefined;
}

/**
 * 非 2xx 抛带状态码的类型化错误。只在「请求已发出且被拒」时调用：
 * 5xx 意味着任务/图片尚未创建，重发不会重复计费。
 */
export function assertGenerationAccepted(
  status: number,
  json: unknown,
  retryAfterMs?: number,
): void {
  if (status >= 200 && status < 300) return;
  const code = extractResponseErrorCode(json);
  const detail = extractErrorMessage(json);
  const hint = describeDisposalHint(status, code);
  throw new GenerationHttpError(
    hint ? `${detail}（${hint}）` : detail,
    status,
    code,
    retryAfterMs ?? (status === 429 ? RATE_LIMITED_COOLDOWN_MS : undefined),
  );
}

/** 退避节拍（ms）：1s → 2s → 4s，最多三次；避免一次点击被拖成半分钟等待。 */
export const GENERATION_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

/**
 * 只包「发出请求并判定状态」这一段：5xx 与传输层失败都意味着任务/图片没创建，重发不重复计费。
 * `backoffMs` 可注入是为了让重试预算在测试里可验证；`budgetMs` 是**整次调用**的总预算，
 * 超过就不再开新一轮，否则 4 次重试 × 单次超时会悄悄超过调用方的 RPC 超时
 * （实测画布点「生成视频」报 "Protocol request timed out"）。
 */
export async function withTransientRetry<T>(
  run: () => Promise<T>,
  backoffMs: readonly number[] = GENERATION_RETRY_BACKOFF_MS,
  budgetMs?: number,
): Promise<T> {
  const startedAt = Date.now();
  for (let index = 0; ; index += 1) {
    try {
      return await run();
    } catch (error) {
      const backoff = backoffMs[index];
      if (backoff === undefined || !isTransientGenerationFailure(error)) throw error;
      if (budgetMs !== undefined && Date.now() - startedAt + backoff >= budgetMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}
