// 画布生成意图与执行态的文档读写（docs/agents/image-video-generation.md「排队重投」）。
// 意图与执行分离：Agent/插件只写 generation.request，本模块只读它、只由 worker 写执行结果。
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const nonEmpty = z.string().min(1);

/** Agent/插件写入的生成意图；执行方不认识 request 时保持原样，不猜。 */
export const canvasGenerationRequestSchema = z
  .object({
    requestId: nonEmpty,
    prompt: nonEmpty,
    /** 可选点名 `providerId/modelId` 或裸 `modelId`，缺省按注册表候选回退。 */
    model: nonEmpty.optional(),
    size: nonEmpty.optional(),
    ratio: nonEmpty.optional(),
    /** 视频时长（秒），字符串与协议保持一致。 */
    seconds: nonEmpty.optional(),
    /** 首帧：工作区相对路径或 data URI。 */
    firstFrame: nonEmpty.optional(),
  })
  .strict();

export type CanvasGenerationRequest = z.infer<typeof canvasGenerationRequestSchema>;

const canvasNodeSchema = z
  .object({
    id: nonEmpty,
    kind: z.enum(["image", "video"]),
    generation: z
      .object({
        request: canvasGenerationRequestSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const canvasDocumentSchema = z
  .object({
    nodes: z.array(canvasNodeSchema),
  })
  .passthrough();

export type CanvasWorkerNode = z.infer<typeof canvasNodeSchema>;

export interface CanvasDocumentFile {
  path: string;
  document: z.infer<typeof canvasDocumentSchema>;
}

export function canvasDirectory(workspacePath: string): string {
  return join(workspacePath, ".zcode", "canvas");
}

/** 只挑出带合法意图的节点；类型不符的节点整块忽略，不让 worker 崩。 */
export function pendingCanvasRequests(
  file: CanvasDocumentFile,
): Array<{ node: CanvasWorkerNode; request: CanvasGenerationRequest }> {
  const pending: Array<{ node: CanvasWorkerNode; request: CanvasGenerationRequest }> = [];
  for (const node of file.document.nodes) {
    const parsed = canvasGenerationRequestSchema.safeParse(node.generation?.request);
    if (parsed.success) pending.push({ node, request: parsed.data });
  }
  return pending;
}

export async function readCanvasDocuments(workspacePath: string): Promise<CanvasDocumentFile[]> {
  const directory = canvasDirectory(workspacePath);
  const entries = await readdir(directory).catch(() => [] as string[]);
  const files: CanvasDocumentFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const path = join(directory, entry);
    try {
      const document = canvasDocumentSchema.parse(JSON.parse(await readFile(path, "utf8")));
      files.push({ path, document });
    } catch {
      // 半写入或非画布文档：跳过，等下一次 tick。
    }
  }
  return files;
}

/**
 * 只改目标节点的 generation 并原子落盘：worker 与 UI/插件可能同时写文档，
 * 因此每次写入都重新读当前内容，而不是拿 tick 开始时的快照覆盖整份文件。
 */
export async function patchCanvasGeneration(
  path: string,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return false;
  }
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  let changed = false;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    if (record.id !== nodeId) continue;
    const generation =
      record.generation && typeof record.generation === "object"
        ? (record.generation as Record<string, unknown>)
        : {};
    record.generation = { ...generation, ...patch };
    changed = true;
    break;
  }
  if (!changed) return false;
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return true;
}
