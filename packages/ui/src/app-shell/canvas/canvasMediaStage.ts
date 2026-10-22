// ============================================================
// 画布媒体节点的呈现状态机（docs/ui/canvas-pane.md T7）
// ============================================================
// 单独成模块是为了让「卡片该画什么」这件事可被单测覆盖：卡片外壳、生成面板和浮层
// 都只消费这里给出的 stage，不再各自 if 一遍 url/savedPath/status 的组合。

import type { CanvasNode } from "@/lib/canvasDocument.js";

export type CanvasMediaStage =
  /** 还没有任何结果，也没有进行中的任务：卡片给生成入口/上传占位。 */
  | "empty"
  /** 无结果且任务在途：骨架。 */
  | "running"
  /** 无结果、创建被服务商暂时拒收，正在自动排队重投：显示排队而不是失败。 */
  | "queued"
  /** 无结果且上一次失败：原因 + 重试。 */
  | "failed"
  /** 有图片可显示。 */
  | "image"
  /** 有可播放的视频外链。 */
  | "video"
  /** 视频只剩工作区文件（外链缺失或已过期）：不假装能播放。 */
  | "video-local";

export interface CanvasMediaStageInfo {
  stage: CanvasMediaStage;
  /** 有结果时任务仍在跑（「再来一张」覆盖式重跑）：卡片保留旧结果并叠进度遮罩。 */
  busy: boolean;
  /** 失败原因原文（含网关 request id），只在 failed 时有值。 */
  error?: string;
  /** 排队中（running 但没有任务身份）时的原因原文，卡片如实显示，不写成失败。 */
  queuedReason?: string;
}

/** 只有 image / video 两种 kind 走媒体状态机；其余返回 null 让调用方按文本/便签渲染。 */
export function describeCanvasMediaStage(node: CanvasNode): CanvasMediaStageInfo | null {
  if (node.kind !== "image" && node.kind !== "video") return null;
  const generation = node.generation;
  const busy = generation?.status === "running";
  const hasResult = !!node.url || !!node.savedPath;
  if (hasResult) {
    if (node.kind === "video") {
      return { stage: node.url ? "video" : "video-local", busy };
    }
    return { stage: "image", busy };
  }
  if (busy) {
    // 只有视频有异步任务身份：running 但没有 task 才是「创建被拒、正在排队重投」。
    // 生图是同步请求，永远没有 task，不能按排队处理，否则每次生成中都会显示成排队。
    if (node.kind === "video" && !generation.task) {
      return {
        stage: "queued",
        busy: true,
        ...(generation.queuedReason ? { queuedReason: generation.queuedReason } : {}),
      };
    }
    return { stage: "running", busy: true };
  }
  if (generation?.status === "failed") {
    return {
      stage: "failed",
      busy: false,
      ...(generation.error ? { error: generation.error } : {}),
    };
  }
  return { stage: "empty", busy: false };
}

/**
 * 图片取源优先级：工作区文件是长期真值，外链会过期（Agnes 响应带 expires_at），
 * 所以 savedPath 在前。两者都没有即无源。
 */
export function pickImageSource(node: { url?: string; savedPath?: string }): {
  savedPath?: string;
  url?: string;
} {
  if (node.savedPath) return { savedPath: node.savedPath };
  return node.url ? { url: node.url } : {};
}

export const MEDIA_NODE_MIN_SIDE = 140;
export const MEDIA_NODE_MAX_SIDE = 720;

/** "16:9" / "2.35:1" → 数值比例；读不出返回 null，调用方保持原样不乱改。 */
export function parseRatioAspect(ratio?: string): number | null {
  if (!ratio) return null;
  const w = Number(ratio.split(":")[0]?.trim());
  const h = Number(ratio.split(":")[1]?.trim());
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/**
 * 按目标画幅给出的新框；比例已经对得上时返回 null（避免每次渲染都写一遍文档）。
 */
export function framePatchForRatio(
  box: { w: number; h: number },
  ratio?: string,
): { w: number; h: number } | null {
  const aspect = parseRatioAspect(ratio);
  return aspect === null ? null : fitNodeToAspect(box, aspect);
}

/**
 * 从可选档位里挑最接近当前框的一个。用对数距离，16:9 与 9:16 到 1:1 的偏离是对称的。
 * 面板初次挂载时用它反推档位：刷新后 generation.ratio 可能还没写（用户只选了比例没生成），
 * 这时如果按默认档位去改框，会把用户已经选好的竖框又掰回横框。
 */
export function nearestRatioOption(aspect: number, options: readonly string[]): string | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const value = parseRatioAspect(option);
    if (value === null) continue;
    const distance = Math.abs(Math.log(value / aspect));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

/**
 * 让卡片贴合媒体自身的比例（即梦的做法）：9:16 的视频塞进横向卡片会留下两条大留白，
 * 看着像渲染坏了。保持面积不变按目标比例重算宽高再钳边界；比例已经对得上就返回 null，
 * 于是加载回调可以重复触发而不会反复改文档。
 */
export function fitNodeToAspect(
  box: { w: number; h: number },
  aspect: number,
  tolerance = 0.02,
): { w: number; h: number } | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  if (Math.abs(box.w / box.h - aspect) / aspect <= tolerance) return null;
  let w = Math.sqrt(box.w * box.h * aspect);
  let h = w / aspect;
  const longSide = () => Math.max(w, h);
  const shortSide = () => Math.min(w, h);
  // 长边先钳到上限：极端比例下短边无法同时抬到下限，此时保比例和上限，不撑破画布。
  if (longSide() > MEDIA_NODE_MAX_SIDE) {
    const scale = MEDIA_NODE_MAX_SIDE / longSide();
    w *= scale;
    h *= scale;
  } else if (shortSide() < MEDIA_NODE_MIN_SIDE) {
    const scale = MEDIA_NODE_MIN_SIDE / shortSide();
    const grownW = w * scale;
    const grownH = h * scale;
    if (Math.max(grownW, grownH) <= MEDIA_NODE_MAX_SIDE) {
      w = grownW;
      h = grownH;
    }
  }
  return { w: Math.round(w), h: Math.round(h) };
}
