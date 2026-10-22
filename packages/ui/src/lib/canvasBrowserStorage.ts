// ============================================================
// 画布的浏览器本地存储与图片录入（localStorage 降级通路）
// ============================================================
// 文档真值已迁到工作区文件（docs/ui/canvas-pane.md T2）；这里只保留文件服务不可用时的
// localStorage 降级持久化，以及本地图片降采样。与 canvasDocument 的数据模型分开放，
// 是为了让「形状」与「浏览器 I/O」各自可独立测试。

import { readSafeLocalStorage } from "@/lib/browserEnvironment.js";
import { logger } from "@/logger.js";
import { parseCanvasDocument, type CanvasDocument } from "./canvasDocument.js";

const PERSIST_DEBOUNCE_MS = 600;

export function loadCanvasDocument(storageKey: string, boardId: string): CanvasDocument {
  try {
    const raw = readSafeLocalStorage(storageKey);
    if (raw) {
      const parsed = parseCanvasDocument(raw);
      if (parsed) return { ...parsed, boardId };
    }
  } catch (error) {
    logger.debug("[Canvas] 读取画布文档失败，使用空画布", { storageKey, error });
  }
  const now = Date.now();
  return { boardId, nodes: [], edges: [], createdAt: now, updatedAt: now };
}

const persistTimers = new Map<string, number>();

function stripImagePayloads(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.kind === "image" ? { ...n, url: "" } : n)),
  };
}

function writeCanvasDocument(storageKey: string, doc: CanvasDocument) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(doc));
  } catch (error) {
    // 配额溢出：剥离图片 data URL（体积大头）再试一次；仍失败则跳过本次持久化。
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(stripImagePayloads(doc)));
      logger.debug("[Canvas] 持久化时剥离了图片载荷", { storageKey });
    } catch (retryError) {
      logger.debug("[Canvas] 画布持久化失败，已跳过", { storageKey, error, retryError });
    }
  }
}

export function scheduleCanvasPersist(storageKey: string, doc: CanvasDocument) {
  const existing = persistTimers.get(storageKey);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    persistTimers.delete(storageKey);
    writeCanvasDocument(storageKey, doc);
  }, PERSIST_DEBOUNCE_MS);
  persistTimers.set(storageKey, timer);
}

/**
 * 本地图片降采样为 data URL（最长边 1280、JPEG 0.85），
 * 使上传图片可以安全进入 localStorage 持久化（objectURL 刷新即失效）。
 */
export function downscaleImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const bitmapUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(bitmapUrl);
      try {
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("canvas 2d context unavailable"));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(bitmapUrl);
      reject(new Error(`图片解码失败: ${file.name}`));
    };
    image.src = bitmapUrl;
  });
}
