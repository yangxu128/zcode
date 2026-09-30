import { readSafeLocalStorage } from "@/lib/browserEnvironment.js";

/**
 * 皮肤（docs/ui/theme-skin.md）：在明暗主题之上独立调整强调色（primary / brand / accent），
 * 与 Theme（明暗模式）正交。default 表示跟随当前主题的黑白强调。
 * 存储键、normalize 与 DOM 应用遵循 lib/uiFontSize.ts 的同一模式，store 是唯一状态所有者。
 */
export type Skin = "default" | "ocean" | "forest" | "sunset" | "violet";

const SKIN_CLASSES: readonly Skin[] = ["default", "ocean", "forest", "sunset", "violet"];

export const SKIN_STORAGE_KEY = "zcode-skin";

export function isSkin(value: string | null | undefined): value is Skin {
  return (SKIN_CLASSES as readonly string[]).includes(value ?? "");
}

/** 非法皮肤值（旧数据、手改 localStorage、广播脏数据）统一回落 default。 */
export function normalizeSkin(skin: string | null | undefined): Skin {
  return isSkin(skin) ? skin : "default";
}

/** 皮肤 class 只挂在 documentElement 上；default 不挂任何 class。 */
export function applySkin(skin: Skin) {
  const root = document.documentElement;
  for (const candidate of SKIN_CLASSES) {
    if (candidate === "default") continue;
    root.classList.toggle(`skin-${candidate}`, candidate === skin);
  }
}

export function loadSkin(): Skin {
  return normalizeSkin(readSafeLocalStorage(SKIN_STORAGE_KEY));
}
