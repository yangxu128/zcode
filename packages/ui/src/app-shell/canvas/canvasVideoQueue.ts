// ============================================================
// 生视频「排队重投」的纯策略（docs/ui/canvas-pane.md T5）
// ============================================================
// 免费档视频创建是账号级限流，不是用户的错，也不该让他盯着「请 1 分钟后再试」手动重点。
// 所以节点保持 running、由面板级驱动按退避自动重投，直到建成或超过总时限。
// 这里只放可单测的纯函数，副作用留在 hook 里。

import type { CanvasDocument, CanvasGeneration, CanvasVideoNode } from "@/lib/canvasDocument.js";

/** 首次重投至少等这么久（与宿主对 429 的判断一致：一分钟窗口）。 */
export const VIDEO_QUEUE_MIN_RETRY_MS = 60_000;
/**
 * 退避上限。实测（2026-10-12）限流不是 1 分钟窗口：9 次创建在 17:30–18:02 间被拒，
 * 其中 17:36→18:00 空了 24 分钟仍然 429；同期任务查询不受影响（创建成功的那条
 * 任务照常完成出片），说明被限的是创建额度，贴着分钟猛重投换不来放行，只会把额度压得更死。
 */
export const VIDEO_QUEUE_MAX_RETRY_MS = 15 * 60_000;
/** 排队总时限：超过就判失败，别让节点无限占着「排队中」。 */
export const VIDEO_QUEUE_DEADLINE_MS = 2 * 60 * 60_000;

/** 排队中的节点：running 且没有 task（还没在服务商侧建成）。 */
export function isQueuedVideoGeneration(generation: CanvasGeneration | undefined): boolean {
  return generation?.status === "running" && !generation.task;
}

export function selectQueuedVideoNodes(doc: CanvasDocument | null | undefined): CanvasVideoNode[] {
  if (!doc) return [];
  return doc.nodes.filter(
    (node): node is CanvasVideoNode =>
      node.kind === "video" && isQueuedVideoGeneration(node.generation),
  );
}

/**
 * 下一次重投要等多久：按「已经排队多久」推导，而不是按上一轮的次数翻倍。
 * 内存里的翻倍计数会在刷新或换端时归零，等于在限流最重的时候退回 1 一分钟一轮从头猛投；
 * elapsed 是写进画布文档的 startedAt 派生量，跨刷新稳定。宿主建议（Retry-After 派生）只当下限。
 */
export function nextQueueWaitMs(queuedElapsedMs: number, suggestedMs: number): number {
  const minute = 60_000;
  const scheduled =
    queuedElapsedMs < 2 * minute
      ? minute
      : queuedElapsedMs < 10 * minute
        ? 4 * minute
        : queuedElapsedMs < 30 * minute
          ? 10 * minute
          : VIDEO_QUEUE_MAX_RETRY_MS;
  return Math.max(VIDEO_QUEUE_MIN_RETRY_MS, scheduled, suggestedMs);
}

/** 还要等多久轮到重投（负数表示到点）；缺 retryAt 时不猜，交给调用方立即处理。 */
export function queueWaitRemainingMs(
  generation: CanvasGeneration | undefined,
  now: number,
): number | undefined {
  return generation?.retryAt === undefined ? undefined : generation.retryAt - now;
}

/** 排队是否已经超时（缺 startedAt 时不猜，交给调用方按当前时间起算）。 */
export function isQueueDeadlinePassed(
  startedAt: number | undefined,
  now: number,
  deadlineMs: number = VIDEO_QUEUE_DEADLINE_MS,
): boolean {
  return startedAt !== undefined && now - startedAt > deadlineMs;
}
