import { createUuid } from "@zcode/shared";
import {
  sanitizeMediaGenerationFields,
  type CanvasMediaNodeFields,
} from "@/lib/canvasGeneration.js";

/**
 * 无限画布数据层（docs/ui/canvas-pane.md）：文档模型、几何工具与持久化。
 * localStorage 是持久层，store（canvasStore）是内存层，组件只经 store 读写。
 * 交互架构参考外部项目 shortdrama-studio 的自研画布，按 ZCode 约定重新适配。
 */

/** T1 联动：画布内容作为附件发送到聚焦中的对话（消费方在 useComposerAttachments）。 */
export const ADD_CANVAS_TO_CHAT_EVENT = "zcode:add-canvas-to-chat";

export interface AddCanvasToChatEventDetail {
  workspacePath: string;
  workspaceIdentity?: string;
  files: File[];
}

export function isAddCanvasToChatEvent(
  event: Event,
): event is CustomEvent<AddCanvasToChatEventDetail> {
  return (
    event instanceof CustomEvent &&
    event.type === ADD_CANVAS_TO_CHAT_EVENT &&
    event.detail?.files instanceof Array
  );
}

/** 画布文档 → Markdown（对话附件）。图片 data URL 不内联，仅标注存在。 */
export function serializeCanvasToMarkdown(
  doc: CanvasDocument,
  selectedIds?: readonly string[],
): string {
  const idSet = selectedIds?.length ? new Set(selectedIds) : null;
  const nodes = idSet ? doc.nodes.filter((n) => idSet.has(n.id)) : doc.nodes;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = doc.edges.filter((e) => nodeById.has(e.from) && nodeById.has(e.to));
  const kindLabel = (kind: CanvasNode["kind"]) =>
    kind === "text" ? "文本" : kind === "note" ? "便签" : kind === "video" ? "视频" : "图片";
  const lines: string[] = [
    "# 无限画布",
    "",
    `> 导出于 ${new Date().toLocaleString("zh-CN")}，共 ${nodes.length} 个节点 / ${edges.length} 条连线`,
    "",
  ];
  if (nodes.length) {
    lines.push("## 节点", "");
    for (const node of nodes) {
      lines.push(`### [${kindLabel(node.kind)}] ${node.title || "(未命名)"}`, "");
      if (node.kind === "text") {
        if (node.content.trim()) lines.push(node.content.trim(), "");
      } else if (node.kind === "note") {
        if (node.body.trim()) lines.push(node.body.trim(), "");
      } else {
        if (node.caption.trim()) lines.push(`说明：${node.caption.trim()}`, "");
        // 生成结果给 agent 的是引用而不是像素：告诉它文件在哪，它才能续用（图生图/首帧）。
        const mediaLabel = node.kind === "video" ? "视频" : "图片";
        if (node.savedPath) lines.push(`${mediaLabel}文件：${node.savedPath}`, "");
        else if (node.url) lines.push(`${mediaLabel}地址：${node.url}`, "");
        else lines.push(`（无${mediaLabel}）`, "");
        if (node.generation?.prompt) {
          lines.push(`生成提示词：${node.generation.prompt}`, "");
        }
      }
    }
  }
  if (edges.length) {
    const nameOf = (id: string) => {
      const node = nodeById.get(id);
      return `「${node?.title || "(未命名)"}」`;
    };
    lines.push("## 连线", "");
    for (const edge of edges) {
      lines.push(
        `- ${nameOf(edge.from)} --${edge.kind === "flow" ? "流程" : "依赖"}--> ${nameOf(edge.to)}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function createCanvasChatFile(doc: CanvasDocument, selectedIds?: readonly string[]): File {
  const content = serializeCanvasToMarkdown(doc, selectedIds);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const scope = selectedIds?.length ? "selection" : "board";
  return new File([content], `canvas-${scope}-${stamp}.md`, { type: "text/markdown" });
}

export type CanvasNodeKind = "text" | "note" | "image" | "video";
export type CanvasEdgeKind = "flow" | "depends";
export type CanvasNoteColor = "amber" | "sky" | "green" | "violet" | "rose";

export interface CanvasNodeBase {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasTextNode extends CanvasNodeBase {
  kind: "text";
  content: string;
}

export interface CanvasNoteNode extends CanvasNodeBase {
  kind: "note";
  body: string;
  color: CanvasNoteColor;
}

export interface CanvasImageNode extends CanvasNodeBase, CanvasMediaNodeFields {
  kind: "image";
  /** 远程 URL 或上传降采样得到的 data URL；空串表示暂无图像。 */
  url: string;
  caption: string;
}

/** 视频节点：结果只会是远程 URL（生成端不落盘大文件），任务态见 canvasGeneration.ts。 */
export interface CanvasVideoNode extends CanvasNodeBase, CanvasMediaNodeFields {
  kind: "video";
  url: string;
  caption: string;
}

export type {
  CanvasGeneration,
  CanvasGenerationStatus,
  CanvasGenerationTaskRef,
} from "./canvasGeneration.js";

export type CanvasNode = CanvasTextNode | CanvasNoteNode | CanvasImageNode | CanvasVideoNode;

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  kind: CanvasEdgeKind;
}

export interface CanvasDocument {
  boardId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export const CANVAS_MIN_ZOOM = 0.15;
export const CANVAS_MAX_ZOOM = 2.5;

export const CANVAS_NODE_DEFAULT_SIZE: Record<CanvasNodeKind, { w: number; h: number }> = {
  text: { w: 260, h: 180 },
  note: { w: 200, h: 160 },
  image: { w: 232, h: 200 },
  video: { w: 320, h: 200 },
};

function hashString(value: string): string {
  // djb2：workspaceKey 含路径分隔符与盘符，不能直接作 localStorage 键名。
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function buildCanvasStorageKey(params: { workspaceKey: string; boardId: string }): string {
  return `zcode-canvas-${hashString(`${params.workspaceKey}::${params.boardId}`)}`;
}

/**
 * 工作区固定画布的 boardId：同工作区重复打开复用同一块画布
 * （tab id = canvas:<boardId>，activateSidePaneTab 按它去重）。
 */
export function buildCanvasBoardId(workspaceKey: string): string {
  return `default-${hashString(workspaceKey)}`;
}

/**
 * 画布文档在工作区内的工作区文件路径（T2，docs/ui/canvas-pane.md）：
 * <workspace>/.zcode/canvas/<boardId>.json。agent 用既有文件工具读写该文件
 * 即可查看/修改画布。boardId 由 buildCanvasBoardId 产出（小写字母数字，文件名安全）。
 * 斜杠统一用 "/"：Windows fs API 同样接受，且对远端（Linux）工作区安全。
 */
export function buildCanvasFilePath(workspacePath: string, boardId: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, "");
  return `${trimmed}/.zcode/canvas/${boardId}.json`;
}

export function createCanvasNodeId(): string {
  return `cn:${createUuid()}`;
}

export function createCanvasEdgeId(): string {
  return `ce:${createUuid()}`;
}

export function clampCanvasZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom));
}

export function createCanvasNode(
  kind: CanvasNodeKind,
  x: number,
  y: number,
  now: number,
): CanvasNode {
  const size = CANVAS_NODE_DEFAULT_SIZE[kind];
  const base = {
    id: createCanvasNodeId(),
    x: Math.round(x),
    y: Math.round(y),
    w: size.w,
    h: size.h,
    createdAt: now,
    updatedAt: now,
  };
  switch (kind) {
    case "text":
      return { ...base, kind, title: "", content: "" };
    case "note":
      return { ...base, kind, title: "", body: "", color: "amber" };
    case "image":
      return { ...base, kind, title: "", url: "", caption: "" };
    case "video":
      return { ...base, kind, title: "", url: "", caption: "" };
  }
  // switch 已穷举 kind；保留不可达分支的显式返回以满足返回类型。
  return { ...base, kind: "text", title: "", content: "" };
}

/**
 * 从偏好位置向外做螺旋搜索，找一个不与任何节点重叠的落点，
 * 避免新建节点直接盖在已有内容上。
 */
export function findFreeCanvasSpot(
  nodes: readonly CanvasNode[],
  kind: CanvasNodeKind,
  prefX: number,
  prefY: number,
): { x: number; y: number } {
  const { w, h } = CANVAS_NODE_DEFAULT_SIZE[kind];
  const pad = 20;
  const hit = (x: number, y: number) =>
    nodes.some(
      (n) =>
        !(x + w + pad <= n.x || x - pad >= n.x + n.w || y + h + pad <= n.y || y - pad >= n.y + n.h),
    );

  const x0 = Math.round(prefX - w / 2);
  const y0 = Math.round(prefY - h / 2);
  if (!hit(x0, y0)) return { x: x0, y: y0 };

  const step = 28;
  for (let ring = 1; ring <= 60; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      const isEdge = dy === -ring || dy === ring;
      for (let dx = -ring; dx <= ring; dx += isEdge ? 1 : ring * 2) {
        const x = x0 + dx * step;
        const y = y0 + dy * step;
        if (!hit(x, y)) return { x, y };
      }
    }
  }
  return { x: x0, y: y0 };
}

/** 节点右侧中点到目标点的三次贝塞尔路径（连线与连线中场景共用）。 */
export function canvasEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx >= dy) {
    const c = Math.max(40, Math.min(200, dx * 0.5));
    return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
  }
  const c = Math.max(40, Math.min(200, dy * 0.5));
  return `M ${x1} ${y1} C ${x1} ${y1 + c}, ${x2} ${y2 - c}, ${x2} ${y2}`;
}

export function canvasBounds(nodes: readonly CanvasNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return { minX, minY, maxX, maxY };
}

export type CanvasAlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** 多选对齐：以选区包围盒为基准改写节点位置，返回新节点数组。 */
export function alignCanvasNodes(
  nodes: readonly CanvasNode[],
  ids: readonly string[],
  mode: CanvasAlignMode,
): CanvasNode[] {
  const selected = nodes.filter((n) => ids.includes(n.id));
  const bounds = canvasBounds(selected);
  if (!bounds || selected.length < 2) return [...nodes];
  const idSet = new Set(ids);
  return nodes.map((n) => {
    if (!idSet.has(n.id)) return n;
    switch (mode) {
      case "left":
        return { ...n, x: bounds.minX };
      case "right":
        return { ...n, x: bounds.maxX - n.w };
      case "hcenter":
        return { ...n, x: Math.round((bounds.minX + bounds.maxX) / 2 - n.w / 2) };
      case "top":
        return { ...n, y: bounds.minY };
      case "bottom":
        return { ...n, y: bounds.maxY - n.h };
      case "vcenter":
        return { ...n, y: Math.round((bounds.minY + bounds.maxY) / 2 - n.h / 2) };
    }
  });
}

/** 多选分布：按选择顺序在包围盒内等间距排列（横向或纵向）。 */
export function distributeCanvasNodes(
  nodes: readonly CanvasNode[],
  ids: readonly string[],
  axis: "h" | "v",
): CanvasNode[] {
  const selected = nodes.filter((n) => ids.includes(n.id));
  if (selected.length < 3) return [...nodes];
  const sorted = [...selected].sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [...nodes];
  const totalSpan = axis === "h" ? last.x - first.x : last.y - first.y;
  const sizes = sorted.reduce((sum, n) => sum + (axis === "h" ? n.w : n.h), 0);
  const gap = (totalSpan - sizes) / (sorted.length - 1);
  const positions = new Map<string, number>();
  let cursor = axis === "h" ? first.x : first.y;
  for (const node of sorted) {
    positions.set(node.id, Math.round(cursor));
    cursor += (axis === "h" ? node.w : node.h) + gap;
  }
  const idSet = new Set(ids);
  return nodes.map((n) =>
    idSet.has(n.id)
      ? axis === "h"
        ? { ...n, x: positions.get(n.id) ?? n.x }
        : { ...n, y: positions.get(n.id) ?? n.y }
      : n,
  );
}

// ---------------------------------------------------------------------------
// 持久化：防抖写入；配额溢出剥离图片 data URL 重试一次；坏数据回落空画布。
// ---------------------------------------------------------------------------

function isValidCanvasNode(value: unknown): value is CanvasNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Partial<CanvasNode>;
  return (
    typeof node.id === "string" &&
    (node.kind === "text" ||
      node.kind === "note" ||
      node.kind === "image" ||
      node.kind === "video") &&
    typeof node.x === "number" &&
    typeof node.y === "number" &&
    typeof node.w === "number" &&
    typeof node.h === "number"
  );
}

/**
 * 图片节点的生成引用清洗：agent 手写的画布 JSON 可能带错误类型，
 * 坏字段整块剥掉而不是让面板崩（与 kind 白名单同一纪律）。
 */
function sanitizeMediaNode<T extends CanvasImageNode | CanvasVideoNode>(node: T): T {
  if (node.savedPath === undefined && node.generation === undefined) return node;
  // 先剥原值再放回校验通过的部分：直接沿用原 node 会把 `savedPath: 42` 这类脏数据留在文档里。
  const { savedPath: _rawSavedPath, generation: _rawGeneration, ...rest } = node;
  return { ...rest, ...sanitizeMediaGenerationFields(node) } as T;
}

/** 解析画布文档 JSON；形状不符返回 null（agent 写入的脏数据不崩面板）。 */
export function parseCanvasDocument(raw: string): CanvasDocument | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasDocument>;
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    const nodes = parsed.nodes
      .filter(isValidCanvasNode)
      .map((node) =>
        node.kind === "image" || node.kind === "video" ? sanitizeMediaNode(node) : node,
      );
    const edges = Array.isArray(parsed.edges)
      ? parsed.edges.filter(
          (e): e is CanvasEdge =>
            typeof e?.id === "string" &&
            typeof e?.from === "string" &&
            typeof e?.to === "string" &&
            (e.kind === "flow" || e.kind === "depends"),
        )
      : [];
    return {
      boardId: typeof parsed.boardId === "string" ? parsed.boardId : "",
      nodes,
      edges,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}
