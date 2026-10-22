// ============================================================
// 生视频请求的本地前置校验：把服务商一定会拒的参数挡在出门之前
// ============================================================
// 依据 Agnes Video 2.5 Flash 文档：Flash 专属校验发生在「任务创建、排队、计费和推理之前」，
// 所以校验失败不创建任务、不计费，但**照样消耗一次请求配额**（免费档按 RPM 限流）。
// 并发/频次约束见 docs/agents/image-video-generation.md「请求频次与并发」。

import type { VideoGenerateRequest } from "@zcode/contracts";

/** 文档「视频尺寸与画幅」列出的取值；不在表里的画幅会返回 400 或产出非预期尺寸。 */
export const VIDEO_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 12;
export const VIDEO_MAX_IMAGES = 5;
export const VIDEO_MAX_AUDIOS = 3;

/**
 * 返回拒发原因；undefined 表示可以发出。调用方（宿主端口）负责把它变成一次抛错，
 * 这样工具面与画布面共用同一套判据，不会出现「UI 能发、agent 发不出去」的分叉。
 */
export function describeVideoRequestRejection(
  request: VideoGenerateRequest,
): string | undefined {
  if (request.seconds !== undefined) {
    const seconds = Number(request.seconds);
    if (
      !Number.isInteger(seconds) ||
      seconds < VIDEO_SECONDS_MIN ||
      seconds > VIDEO_SECONDS_MAX
    ) {
      return `视频时长只能是 "${VIDEO_SECONDS_MIN}"–"${VIDEO_SECONDS_MAX}" 秒的整数字符串（收到 ${JSON.stringify(request.seconds)}）`;
    }
  }
  if (
    request.aspectRatio !== undefined &&
    !(VIDEO_ASPECT_RATIOS as readonly string[]).includes(request.aspectRatio)
  ) {
    return `画幅只支持 ${VIDEO_ASPECT_RATIOS.join(" / ")}（收到 ${JSON.stringify(request.aspectRatio)}）`;
  }

  const hasFrame = !!request.firstFrame || !!request.lastFrame;
  const imageCount = request.images?.length ?? 0;
  const audioCount = request.audios?.length ?? 0;
  if (request.mode === "text" && (hasFrame || imageCount > 0 || audioCount > 0)) {
    return "text 模式不接受任何媒体输入（first_frame / last_frame / images / audios）";
  }
  if (request.mode === "keyframe") {
    if (!hasFrame) return "keyframe 模式至少要提供 first_frame 或 last_frame";
    if (imageCount > 0 || audioCount > 0) return "keyframe 模式不接受 images / audios";
  }
  if (request.mode === "reference") {
    if (hasFrame) return "reference 模式不接受 first_frame / last_frame";
    if (imageCount === 0 && audioCount === 0) {
      return "reference 模式至少要有一类参考素材（images 或 audios）";
    }
  }
  if (imageCount > VIDEO_MAX_IMAGES) {
    return `参考图片最多 ${VIDEO_MAX_IMAGES} 张（收到 ${imageCount} 张）`;
  }
  if (audioCount > VIDEO_MAX_AUDIOS) {
    return `参考音频最多 ${VIDEO_MAX_AUDIOS} 段（收到 ${audioCount} 段）`;
  }
  return undefined;
}

/**
 * 重投创建的节奏：按「已经排队多久」拉开，而不是每轮都照宿主建议的 60 秒猛打。
 * 依据是 2026-10-12 的实测——免费档 429 不是分钟窗口：同一账号在 17:36 到 18:00 之间
 * 空了 24 分钟没发创建，下一次仍然 429；同期任务查询不受影响（创建成功的那条任务照常完成出片），
 * 说明被限的是创建额度。被拒后贴着分钟重投换不来放行，只会把账号级额度压得更死。
 * 画布侧同一口径见 packages/ui/src/app-shell/canvas/canvasVideoQueue.ts。
 */
export function nextCreateWaitMs(queuedElapsedMs: number, suggestedMs: number): number {
  const minute = 60_000;
  const scheduled =
    queuedElapsedMs < 2 * minute
      ? minute
      : queuedElapsedMs < 10 * minute
        ? 4 * minute
        : 10 * minute;
  return Math.max(suggestedMs, scheduled);
}
