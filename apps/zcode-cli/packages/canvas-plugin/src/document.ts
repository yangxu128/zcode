// 画布文档读写（插件侧）。意图字段与 agent 侧 worker 的契约保持一致：
// 插件只写 generation.request，执行结果由宿主进程的 canvas generation worker 回写。
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type CanvasOperation =
  | { op: "upsert_node"; node: Record<string, unknown> }
  | { op: "remove_node"; id: string }
  | { op: "set_edges"; edges: Array<Record<string, unknown>> };

export interface CanvasGenerationInput {
  prompt: string;
  size?: string;
  ratio?: string;
  seconds?: string;
  model?: string;
  firstFrame?: string;
}

export function resolveWorkspace(workspace?: string): string {
  return workspace?.trim() || process.env.ZCODE_WORKSPACE_PATH?.trim() || process.cwd();
}

export function canvasDirectory(workspace: string): string {
  return join(workspace, ".zcode", "canvas");
}

async function boardNames(workspace: string): Promise<string[]> {
  const entries = await readdir(canvasDirectory(workspace)).catch(() => [] as string[]);
  return entries.filter((entry) => entry.endsWith(".json")).sort();
}

async function resolveBoard(
  workspace: string,
  board?: string,
): Promise<{ name: string; path: string }> {
  const names = await boardNames(workspace);
  if (names.length === 0) throw new Error("canvas.not-found: 工作区还没有画布文档");
  const name = board?.trim() || names.find((item) => item.startsWith("default-")) || names[0]!;
  if (!names.includes(name)) {
    throw new Error(`canvas.board-not-found: ${name}（可用：${names.join(", ")}）`);
  }
  return { name, path: join(canvasDirectory(workspace), name) };
}

export async function listBoards(workspace: string): Promise<string[]> {
  return boardNames(workspace);
}

export async function readBoard(
  workspace: string,
  board?: string,
): Promise<{ board: string; document: Record<string, unknown> }> {
  const resolved = await resolveBoard(workspace, board);
  const document = JSON.parse(await readFile(resolved.path, "utf8")) as Record<string, unknown>;
  return { board: resolved.name, document };
}

async function writeBoard(path: string, document: Record<string, unknown>): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function applyOperations(
  workspace: string,
  operations: readonly CanvasOperation[],
  board?: string,
): Promise<{ board: string; nodes: number; edges: number }> {
  const resolved = await resolveBoard(workspace, board);
  const document = JSON.parse(await readFile(resolved.path, "utf8")) as Record<string, unknown>;
  let nodes = Array.isArray(document.nodes) ? [...document.nodes] : [];
  let edges = Array.isArray(document.edges) ? [...document.edges] : [];
  for (const operation of operations) {
    if (operation.op === "upsert_node") {
      const id = operation.node.id;
      if (typeof id !== "string" || !id.trim()) throw new Error("canvas.node-id-required");
      const index = nodes.findIndex((node) => (node as { id?: unknown }).id === id);
      if (index >= 0) nodes[index] = operation.node;
      else nodes.push(operation.node);
    } else if (operation.op === "remove_node") {
      nodes = nodes.filter((node) => (node as { id?: unknown }).id !== operation.id);
      edges = edges.filter((edge) => {
        const record = edge as { from?: unknown; to?: unknown; source?: unknown; target?: unknown };
        return (
          record.from !== operation.id &&
          record.to !== operation.id &&
          record.source !== operation.id &&
          record.target !== operation.id
        );
      });
    } else {
      edges = [...operation.edges];
    }
  }
  document.nodes = nodes;
  document.edges = edges;
  await writeBoard(resolved.path, document);
  return { board: resolved.name, nodes: nodes.length, edges: edges.length };
}

/** 只写意图：requestId 幂等，worker 执行后清除 request 并写回结果。 */
export async function requestGeneration(
  workspace: string,
  nodeId: string,
  input: CanvasGenerationInput,
  board?: string,
): Promise<{ board: string; nodeId: string; requestId: string }> {
  const resolved = await resolveBoard(workspace, board);
  const document = JSON.parse(await readFile(resolved.path, "utf8")) as Record<string, unknown>;
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const node = nodes.find((item) => (item as { id?: unknown }).id === nodeId) as
    | Record<string, unknown>
    | undefined;
  if (!node) throw new Error(`canvas.node-not-found: ${nodeId}`);
  const requestId = `req-${randomUUID()}`;
  const generation =
    node.generation && typeof node.generation === "object"
      ? (node.generation as Record<string, unknown>)
      : {};
  node.generation = {
    ...generation,
    status: "requested",
    request: {
      requestId,
      prompt: input.prompt,
      ...(input.size ? { size: input.size } : {}),
      ...(input.ratio ? { ratio: input.ratio } : {}),
      ...(input.seconds ? { seconds: input.seconds } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.firstFrame ? { firstFrame: input.firstFrame } : {}),
    },
  };
  await writeBoard(resolved.path, document);
  return { board: resolved.name, nodeId, requestId };
}

export async function cancelGeneration(
  workspace: string,
  nodeId: string,
  board?: string,
): Promise<{ board: string; nodeId: string; cancelled: boolean }> {
  const resolved = await resolveBoard(workspace, board);
  const document = JSON.parse(await readFile(resolved.path, "utf8")) as Record<string, unknown>;
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const node = nodes.find((item) => (item as { id?: unknown }).id === nodeId) as
    | Record<string, unknown>
    | undefined;
  if (!node) throw new Error(`canvas.node-not-found: ${nodeId}`);
  const generation =
    node.generation && typeof node.generation === "object"
      ? (node.generation as Record<string, unknown>)
      : {};
  const cancelled = generation.request !== undefined;
  node.generation = { ...generation, status: "idle", request: undefined };
  await writeBoard(resolved.path, document);
  return { board: resolved.name, nodeId, cancelled };
}
