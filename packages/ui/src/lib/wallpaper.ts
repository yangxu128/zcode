import { readSafeLocalStorage } from "@/lib/browserEnvironment.js";

/**
 * 壁纸（docs/ui/theme-skin.md）：用户自选图片作为应用背景。
 * 持久化真值在 IndexedDB（同源多窗口共享），store 只持内存副本与版本号同步令牌。
 * 存储键、normalize、DOM 应用遵循 lib/uiFontSize.ts 的 lib 模块模式。
 */
const WALLPAPER_IDB_NAME = "zcode-ui";
const WALLPAPER_IDB_STORE = "ui-preferences";
const WALLPAPER_IDB_KEY = "wallpaper";

export const WALLPAPER_LAYER_ID = "zcode-wallpaper-layer";

/** 最长边上限：桌面全屏背景 2560px 已足够，控制 IDB 与解码内存体积。 */
const MAX_IMAGE_EDGE = 2560;
const JPEG_QUALITY = 0.85;

/** 显示调节范围与默认值：默认值精确复现固定参数时期的观感（见 docs/ui/theme-skin.md）。 */
export const WALLPAPER_STRENGTH_MAX = 80;
export const WALLPAPER_STRENGTH_DEFAULT = 40;
export const WALLPAPER_DIM_MAX = 100;
export const WALLPAPER_DIM_DEFAULT = 25;
export const WALLPAPER_STRENGTH_STORAGE_KEY = "zcode-wallpaper-strength";
export const WALLPAPER_DIM_STORAGE_KEY = "zcode-wallpaper-dim";

export function normalizeWallpaperStrength(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(WALLPAPER_STRENGTH_MAX, Math.max(0, Math.round(value)))
    : WALLPAPER_STRENGTH_DEFAULT;
}

export function normalizeWallpaperDim(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(WALLPAPER_DIM_MAX, Math.max(0, Math.round(value)))
    : WALLPAPER_DIM_DEFAULT;
}

/** localStorage 里存的是字符串；读取时先做类型转换，null/NaN 回落默认（仿 loadUiFontSizePx）。 */
export function loadWallpaperStrength(): number {
  const raw = readSafeLocalStorage(WALLPAPER_STRENGTH_STORAGE_KEY);
  return raw === null ? WALLPAPER_STRENGTH_DEFAULT : normalizeWallpaperStrength(Number(raw));
}

export function loadWallpaperDim(): number {
  const raw = readSafeLocalStorage(WALLPAPER_DIM_STORAGE_KEY);
  return raw === null ? WALLPAPER_DIM_DEFAULT : normalizeWallpaperDim(Number(raw));
}

/**
 * 把显示参数写入根节点内联变量，styles.css 的 has-wallpaper 规则引用这些变量。
 * 强度 s：工作区/框架表面 color-mix 占比 (1−s)，侧边栏 (1−0.7s)（侧边栏少露一点）；
 * 浓度 d：壁纸层 ::after 的不透明度。
 */
export function applyWallpaperStyle(strength: number, dim: number) {
  const rootStyle = document.documentElement.style;
  const s = normalizeWallpaperStrength(strength) / 100;
  const d = normalizeWallpaperDim(dim) / 100;
  // 百分比保留两位小数，避免 (1 - 0.8) * 100 之类的浮点尾巴进入 CSS 变量。
  const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
  rootStyle.setProperty("--wallpaper-bg-mix", pct((1 - s) * 100));
  rootStyle.setProperty("--wallpaper-win-alt-mix", pct((1 - s) * 100));
  rootStyle.setProperty("--wallpaper-sidebar-mix", pct((1 - s * 0.7) * 100));
  rootStyle.setProperty("--wallpaper-scrim-opacity", String(d));
}

function openWallpaperDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(WALLPAPER_IDB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(WALLPAPER_IDB_STORE)) {
          request.result.createObjectStore(WALLPAPER_IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      // 打开失败（隐私模式、配额等）按无壁纸降级，不阻断启动。
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withWallpaperStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openWallpaperDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(WALLPAPER_IDB_STORE, mode);
      const request = run(tx.objectStore(WALLPAPER_IDB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

/** 读取壁纸；任何失败都返回 null（无壁纸），由调用方保持原状。 */
export function loadWallpaper(): Promise<string | null> {
  return withWallpaperStore("readonly", (store) => store.get(WALLPAPER_IDB_KEY)).then((value) =>
    typeof value === "string" && value.startsWith("data:image/") ? value : null,
  );
}

export function saveWallpaper(dataUrl: string): Promise<number> {
  // 版本号即毫秒时间戳，作为跨窗口同步的比较令牌。
  const version = Date.now();
  return withWallpaperStore("readwrite", (store) => store.put(dataUrl, WALLPAPER_IDB_KEY)).then(
    (saved) => (saved === null ? 0 : version),
  );
}

export function clearWallpaperStorage(): Promise<void> {
  return withWallpaperStore("readwrite", (store) => store.delete(WALLPAPER_IDB_KEY)).then(
    () => undefined,
  );
}

/**
 * 解码并缩放用户选择的图片，重编码为 JPEG data URL。
 * 解码失败抛错，由调用方决定保持原状。
 */
export async function processWallpaperImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("wallpaper: canvas 2d context unavailable");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

let wallpaperLayer: HTMLDivElement | null = null;

/**
 * 壁纸层挂在 body 首位、z-index -1：位于画布背景之上、React 内容之下。
 * Electron 的 html/body/#root 保持透明（vibrancy），Web 端 body 的不透明画布背景
 * 同样被该层盖住；遮罩由层内 ::after 基于 solid 背景色提供。
 */
export function applyWallpaper(dataUrl: string | null) {
  const root = document.documentElement;
  if (!dataUrl) {
    wallpaperLayer?.remove();
    wallpaperLayer = null;
    root.classList.remove("has-wallpaper");
    return;
  }
  if (!wallpaperLayer) {
    wallpaperLayer = document.createElement("div");
    wallpaperLayer.id = WALLPAPER_LAYER_ID;
    document.body.prepend(wallpaperLayer);
  }
  wallpaperLayer.style.backgroundImage = `url("${dataUrl}")`;
  root.classList.add("has-wallpaper");
}
