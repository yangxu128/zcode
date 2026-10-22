// ============================================================
// 画布生成态数据模型（docs/ui/canvas-pane.md T4/T5）
// ============================================================
// 只放「节点内生成」的引用与任务态形状及其清洗，画布文档本体在 canvasDocument.ts。

/** 节点内生成的任务态。running 表示有在途任务，视频靠 task 跨刷新恢复。 */
export type CanvasGenerationStatus = "idle" | "running" | "failed";

/** 异步视频任务身份：刷新或换端后据此继续查询同一个任务。 */
export interface CanvasGenerationTaskRef {
  providerId: string;
  modelId: string;
  videoId: string;
}

export interface CanvasGeneration {
  status: CanvasGenerationStatus;
  prompt: string;
  /** 图片档位（1K/2K/3K/4K）。 */
  size?: string;
  ratio?: string;
  /** 视频时长秒数字符串。 */
  seconds?: string;
  /** 实际命中的生成模型 `providerId/modelId`，成功与失败都回填，便于排查候选回退。 */
  model?: string;
  /** 在途/已创建的异步任务；仅视频使用。 */
  task?: CanvasGenerationTaskRef;
  /** 任务创建时刻（ms）：前台轮询据此判定超时，避免僵尸 running 永久占位。 */
  startedAt?: number;
  /**
   * 排队重投的最早时刻（ms）：status 仍是 running 但 task 缺席，表示服务商这次没收
   * （限流/繁忙/连不上），面板级驱动到点自动再投。写进文档是为了刷新、换端后
   * 队列状态不丢（docs/ui/canvas-pane.md T5）。
   */
  retryAt?: number;
  /** 排队原因（网关原文，含 request id）；仅排队期间有值，用于界面如实说明。 */
  queuedReason?: string;
  /** 失败原因原文（含 request id）；仅 status === "failed" 时有值。 */
  error?: string;
}

export interface CanvasMediaNodeFields {
  /**
   * 生成结果的本地引用：工作区相对路径（如 `.zcode/generated/x.png`）。
   * 生成媒体是 MB 级，禁止以 data URL 写进画布文档；有 savedPath 时优先于 url 渲染。
   */
  savedPath?: string;
  /** 缺省表示该节点从未发起生成。 */
  generation?: CanvasGeneration;
}

type RawMediaNode = CanvasMediaNodeFields & { url?: unknown };

function sanitizeTask(value: unknown): CanvasGenerationTaskRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const task = value as Record<string, unknown>;
  const providerId = typeof task.providerId === "string" ? task.providerId : "";
  const modelId = typeof task.modelId === "string" ? task.modelId : "";
  const videoId = typeof task.videoId === "string" ? task.videoId : "";
  return providerId && modelId && videoId ? { providerId, modelId, videoId } : undefined;
}

/**
 * 清洗 agent 手写的生成字段：类型不符的整块剥掉，而不是让面板崩或留下假状态
 * （与节点 kind 白名单同一纪律）。
 */
export function sanitizeMediaGenerationFields(node: RawMediaNode): {
  savedPath?: string;
  generation?: CanvasGeneration;
  url?: string;
} {
  if (node.savedPath === undefined && node.generation === undefined) return {};
  const savedPath =
    typeof node.savedPath === "string" && node.savedPath.trim() ? node.savedPath : undefined;
  const rawGeneration = node.generation;
  const status =
    rawGeneration && typeof rawGeneration === "object"
      ? (rawGeneration as { status?: unknown }).status
      : undefined;
  const knownStatus: CanvasGenerationStatus | undefined =
    status === "idle" || status === "running" || status === "failed" ? status : undefined;
  const fields = knownStatus ? (rawGeneration as unknown as Record<string, unknown>) : undefined;
  const generation: CanvasGeneration | undefined = fields
    ? {
        status: knownStatus!,
        prompt: typeof fields.prompt === "string" ? fields.prompt : "",
        ...(typeof fields.size === "string" ? { size: fields.size } : {}),
        ...(typeof fields.ratio === "string" ? { ratio: fields.ratio } : {}),
        ...(typeof fields.seconds === "string" ? { seconds: fields.seconds } : {}),
        ...(typeof fields.model === "string" ? { model: fields.model } : {}),
        ...(typeof fields.error === "string" ? { error: fields.error } : {}),
        ...(typeof fields.startedAt === "number" ? { startedAt: fields.startedAt } : {}),
        ...(typeof fields.retryAt === "number" ? { retryAt: fields.retryAt } : {}),
        ...(typeof fields.queuedReason === "string" ? { queuedReason: fields.queuedReason } : {}),
        ...(() => {
          const task = sanitizeTask(fields.task);
          return task ? { task } : {};
        })(),
      }
    : undefined;
  return {
    url: typeof node.url === "string" ? node.url : "",
    ...(savedPath === undefined ? {} : { savedPath }),
    ...(generation === undefined ? {} : { generation }),
  };
}
