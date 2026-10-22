// ============================================================
// 生成结果的媒体落地：外链→工作区文件、参考素材→data URI
// ============================================================
// 画布是长期文档，只存会过期的外链等于埋坏链（docs/ui/canvas-pane.md T6）；
// 反过来，画布连线给的是工作区文件，而网关要求公网可达 URL，发出前换成 data URI。

import { createHash } from "node:crypto";
import type { Logger } from "@zcode/contracts";

export const GENERATED_MEDIA_DIR = ".zcode/generated";
/** 落地是一次额外下载：给硬超时，不无限挂住面板。 */
const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;
const MEDIA_MAX_BYTES = { image: 16 * 1024 * 1024, video: 64 * 1024 * 1024 } as const;
const MEDIA_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function mediaTypeOf(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MEDIA_TYPES[extension] ?? "application/octet-stream";
}

/**
 * 参考素材解析：已经是 URL/data URI 的原样透传；工作区相对路径由宿主读文件换成
 * data URI。读不到就按原值传，让服务端的错误原文回到用户面前，比在本地猜测更可信。
 */
export async function resolveMediaReferences(
  refs: readonly string[] | undefined,
  workspacePath: string | undefined,
): Promise<string[] | undefined> {
  if (!refs?.length) return undefined;
  const resolved: string[] = [];
  for (const ref of refs) {
    if (/^(https?:|data:)/i.test(ref) || !workspacePath) {
      resolved.push(ref);
      continue;
    }
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const bytes = await readFile(join(workspacePath, ...ref.replace(/^\/+/, "").split(/[\\/]+/)));
      resolved.push(`data:${mediaTypeOf(ref)};base64,${bytes.toString("base64")}`);
    } catch {
      resolved.push(ref);
    }
  }
  return resolved;
}

/**
 * 落地文件名只由 URL 哈希 + 受控扩展名派生：不取 URL 路径片段，避免路径穿越、
 * 非法字符与同名冲突。
 */
export function generatedMediaFileName(url: string, contentType: string): string {
  const raw =
    MEDIA_EXTENSION_BY_MIME[contentType.split(";")[0]?.trim() ?? ""] ??
    /\.(mp4|webm|mov|png|jpe?g|webp|gif)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ??
    "";
  const normalized = raw ? (raw.startsWith(".") ? raw : `.${raw === "jpeg" ? "jpg" : raw}`) : ".png";
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  return `${hash}${normalized}`;
}

/** 同名已存在即复用，所以重试不会重复下载。 */
export async function materializeMediaToWorkspace(
  url: string,
  workspacePath: string | undefined,
): Promise<{ savedPath: string; reused: boolean }> {
  if (!workspacePath) {
    throw new Error("工作区不可用，无法保存生成结果");
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("只支持落地 http(s) 生成结果");
  }
  const { mkdir, stat, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const response = await fetch(url, { signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`下载生成结果失败：HTTP ${response.status}`);
  }
  // 文件名要等 content-type 才知道扩展名，因此先取响应头再判是否已存在。
  const contentType = response.headers.get("content-type") ?? "";
  const fileName = generatedMediaFileName(url, contentType);
  const dir = join(workspacePath, ...GENERATED_MEDIA_DIR.split("/"));
  const filePath = join(dir, fileName);
  try {
    const existing = await stat(filePath);
    if (existing.isFile()) {
      response.body?.cancel().catch(() => undefined);
      return { savedPath: `${GENERATED_MEDIA_DIR}/${fileName}`, reused: true };
    }
  } catch {
    // 文件还不存在，继续读体。
  }
  const kind: "image" | "video" = contentType.startsWith("video/") ? "video" : "image";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("生成结果为空文件");
  }
  if (bytes.byteLength > MEDIA_MAX_BYTES[kind]) {
    throw new Error(`生成结果超过 ${Math.floor(MEDIA_MAX_BYTES[kind] / (1024 * 1024))}MB 上限`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, bytes);
  return { savedPath: `${GENERATED_MEDIA_DIR}/${fileName}`, reused: false };
}

/** Base64 输出直接落盘，避免把 MB 级像素塞进工具结果。 */
export async function saveBase64Image(
  b64: string,
  workspacePath: string | undefined,
  modelId: string,
  logger?: Logger,
): Promise<{ savedPath?: string }> {
  if (!workspacePath) return {};
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(workspacePath, ...GENERATED_MEDIA_DIR.split("/"));
    await mkdir(dir, { recursive: true });
    const fileName = `${modelId.replace(/[^\w.-]/g, "_")}-${Date.now()}.png`;
    await writeFile(join(dir, fileName), Buffer.from(b64, "base64"));
    return { savedPath: `${GENERATED_MEDIA_DIR}/${fileName}` };
  } catch (error) {
    logger?.warn?.("[Generation] Base64 落盘失败", { error, modelId });
    return {};
  }
}
