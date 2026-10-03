import { create } from "zustand";
import { createUuid } from "@zcode/shared";
import {
  alignCanvasNodes,
  canvasBounds,
  clampCanvasZoom,
  createCanvasEdgeId,
  createCanvasNode,
  distributeCanvasNodes,
  loadCanvasDocument,
  scheduleCanvasPersist,
  type CanvasAlignMode,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasEdgeKind,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasViewport,
} from "@/lib/canvasDocument.js";
import { logger } from "@/logger.js";

/**
 * 无限画布状态所有者（docs/ui/canvas-pane.md）：文档（内存层）+ 会话态（视口/选区/连线中）。
 * localStorage 是持久层；所有依赖视口尺寸的动作使用画布容器实测 rect，不使用 window 尺寸。
 */

export interface CanvasRect {
  width: number;
  height: number;
}

export interface CanvasLinking {
  from: string;
  x: number;
  y: number;
}

interface CanvasBoardSession {
  viewport: CanvasViewport;
  selection: string[];
  linking: CanvasLinking | null;
  hoverEdgeId: string | null;
}

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

function emptySession(): CanvasBoardSession {
  return { viewport: { ...DEFAULT_VIEWPORT }, selection: [], linking: null, hoverEdgeId: null };
}

export interface CanvasStoreState {
  docs: Record<string, CanvasDocument>;
  hydrated: Record<string, boolean>;
  sessions: Record<string, CanvasBoardSession>;

  hydrate: (params: { storageKey: string; boardId: string }) => void;
  ensureSession: (storageKey: string) => CanvasBoardSession;

  addNode: (params: {
    storageKey: string;
    kind: CanvasNodeKind;
    x: number;
    y: number;
    patch?: Partial<CanvasNode>;
  }) => string;
  updateNode: (params: { storageKey: string; id: string; patch: Partial<CanvasNode> }) => void;
  translateNodes: (params: {
    storageKey: string;
    ids: readonly string[];
    dx: number;
    dy: number;
  }) => void;
  removeNodes: (params: { storageKey: string; ids: readonly string[] }) => void;
  duplicateNodes: (params: { storageKey: string; ids: readonly string[] }) => void;
  alignNodes: (params: {
    storageKey: string;
    ids: readonly string[];
    mode: CanvasAlignMode;
  }) => void;
  distributeNodes: (params: {
    storageKey: string;
    ids: readonly string[];
    axis: "h" | "v";
  }) => void;
  addEdge: (params: { storageKey: string; from: string; to: string; kind: CanvasEdgeKind }) => void;
  removeEdge: (params: { storageKey: string; id: string }) => void;

  select: (params: { storageKey: string; ids: readonly string[]; additive?: boolean }) => void;
  setViewport: (params: { storageKey: string; viewport: CanvasViewport }) => void;
  zoomBy: (params: {
    storageKey: string;
    factor: number;
    centerX: number;
    centerY: number;
  }) => void;
  fitView: (params: { storageKey: string; rect: CanvasRect }) => void;
  setLinking: (params: { storageKey: string; linking: CanvasLinking | null }) => void;
  setHoverEdge: (params: { storageKey: string; id: string | null }) => void;
}

export const useCanvasStore = create<CanvasStoreState>((set, get) => {
  const ensureDoc = (storageKey: string, boardId: string): CanvasDocument => {
    const state = get();
    if (state.docs[storageKey]) return state.docs[storageKey];
    if (!state.hydrated[storageKey]) {
      const doc = loadCanvasDocument(storageKey, boardId);
      set((s) => ({
        docs: { ...s.docs, [storageKey]: doc },
        hydrated: { ...s.hydrated, [storageKey]: true },
        sessions: { ...s.sessions, [storageKey]: s.sessions[storageKey] ?? emptySession() },
      }));
      return doc;
    }
    return (
      state.docs[storageKey] ?? {
        boardId,
        nodes: [],
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    );
  };

  const sessionOf = (storageKey: string): CanvasBoardSession =>
    get().sessions[storageKey] ?? emptySession();

  const mutateDoc = (storageKey: string, fn: (doc: CanvasDocument) => CanvasDocument) => {
    set((s) => {
      const doc = s.docs[storageKey];
      if (!doc) return s;
      const next = { ...fn(doc), updatedAt: Date.now() };
      scheduleCanvasPersist(storageKey, next);
      return { docs: { ...s.docs, [storageKey]: next } };
    });
  };

  const withSession = (
    storageKey: string,
    fn: (session: CanvasBoardSession) => Partial<CanvasBoardSession>,
  ) => {
    set((s) => ({
      sessions: {
        ...s.sessions,
        [storageKey]: {
          ...(s.sessions[storageKey] ?? emptySession()),
          ...fn(s.sessions[storageKey] ?? emptySession()),
        },
      },
    }));
  };

  return {
    docs: {},
    hydrated: {},
    sessions: {},

    hydrate({ storageKey, boardId }) {
      ensureDoc(storageKey, boardId);
    },

    ensureSession(storageKey) {
      const session = get().sessions[storageKey];
      if (!session) {
        set((s) => ({ sessions: { ...s.sessions, [storageKey]: emptySession() } }));
        return emptySession();
      }
      return session;
    },

    addNode({ storageKey, kind, x, y, patch }) {
      // 文档由组件挂载时的 hydrate 载入；未 hydrate 时静默丢弃操作，避免写入错误分桶。
      if (!get().docs[storageKey]) return "";
      const now = Date.now();
      const node = { ...createCanvasNode(kind, x, y, now), ...patch } as CanvasNode;
      mutateDoc(storageKey, (doc) => ({ ...doc, nodes: [...doc.nodes, node] }));
      return node.id;
    },

    updateNode({ storageKey, id, patch }) {
      mutateDoc(storageKey, (doc) => ({
        ...doc,
        nodes: doc.nodes.map((n) =>
          n.id === id ? ({ ...n, ...patch, updatedAt: Date.now() } as CanvasNode) : n,
        ),
      }));
    },

    translateNodes({ storageKey, ids, dx, dy }) {
      const idSet = new Set(ids);
      mutateDoc(storageKey, (doc) => ({
        ...doc,
        nodes: doc.nodes.map((n) =>
          idSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy, updatedAt: Date.now() } : n,
        ),
      }));
    },

    removeNodes({ storageKey, ids }) {
      const idSet = new Set(ids);
      mutateDoc(storageKey, (doc) => ({
        ...doc,
        nodes: doc.nodes.filter((n) => !idSet.has(n.id)),
        edges: doc.edges.filter((e) => !idSet.has(e.from) && !idSet.has(e.to)),
      }));
      withSession(storageKey, (session) => ({
        selection: session.selection.filter((id) => !idSet.has(id)),
      }));
    },

    duplicateNodes({ storageKey, ids }) {
      const doc = get().docs[storageKey];
      if (!doc) return;
      const idSet = new Set(ids);
      const now = Date.now();
      const clones: CanvasNode[] = [];
      const idMap = new Map<string, string>();
      for (const node of doc.nodes) {
        if (!idSet.has(node.id)) continue;
        const clone = {
          ...node,
          id: `cn:${createUuid()}`,
          x: node.x + 40,
          y: node.y + 40,
          createdAt: now,
          updatedAt: now,
        } as CanvasNode;
        idMap.set(node.id, clone.id);
        clones.push(clone);
      }
      if (!clones.length) return;
      const newEdges: CanvasEdge[] = doc.edges
        .filter((e) => idSet.has(e.from) && idSet.has(e.to))
        .map((e) => ({
          ...e,
          id: createCanvasEdgeId(),
          from: idMap.get(e.from)!,
          to: idMap.get(e.to)!,
        }));
      mutateDoc(storageKey, (d) => ({
        ...d,
        nodes: [...d.nodes, ...clones],
        edges: [...d.edges, ...newEdges],
      }));
      withSession(storageKey, () => ({ selection: clones.map((c) => c.id) }));
    },

    alignNodes({ storageKey, ids, mode }) {
      mutateDoc(storageKey, (doc) => ({
        ...doc,
        nodes: alignCanvasNodes(doc.nodes, ids, mode),
      }));
    },

    distributeNodes({ storageKey, ids, axis }) {
      mutateDoc(storageKey, (doc) => ({
        ...doc,
        nodes: distributeCanvasNodes(doc.nodes, ids, axis),
      }));
    },

    addEdge({ storageKey, from, to, kind }) {
      if (from === to) return;
      mutateDoc(storageKey, (doc) => {
        if (doc.edges.some((e) => e.from === from && e.to === to)) return doc;
        return { ...doc, edges: [...doc.edges, { id: createCanvasEdgeId(), from, to, kind }] };
      });
    },

    removeEdge({ storageKey, id }) {
      mutateDoc(storageKey, (doc) => ({ ...doc, edges: doc.edges.filter((e) => e.id !== id) }));
      withSession(storageKey, () => ({ hoverEdgeId: null }));
    },

    select({ storageKey, ids, additive }) {
      withSession(storageKey, (session) => {
        if (!additive) return { selection: [...ids] };
        const current = new Set(session.selection);
        for (const id of ids) {
          if (current.has(id)) current.delete(id);
          else current.add(id);
        }
        return { selection: [...current] };
      });
    },

    setViewport({ storageKey, viewport }) {
      withSession(storageKey, () => ({ viewport }));
    },

    zoomBy({ storageKey, factor, centerX, centerY }) {
      const session = sessionOf(storageKey);
      const { x, y, zoom } = session.viewport;
      const nextZoom = clampCanvasZoom(zoom * factor);
      // 保持指针位置下的世界坐标不动
      const k = 1 - zoom / nextZoom;
      withSession(storageKey, () => ({
        viewport: { zoom: nextZoom, x: x + centerX * k, y: y + centerY * k },
      }));
    },

    fitView({ storageKey, rect }) {
      const doc = get().docs[storageKey];
      const bounds = canvasBounds(doc?.nodes ?? []);
      if (!bounds) return;
      const pad = 72;
      const spanX = Math.max(1, bounds.maxX - bounds.minX);
      const spanY = Math.max(1, bounds.maxY - bounds.minY);
      const zoom = clampCanvasZoom(
        Math.min((rect.width - pad * 2) / spanX, (rect.height - pad * 2) / spanY),
      );
      withSession(storageKey, () => ({
        viewport: {
          zoom,
          x: (rect.width - spanX * zoom) / 2 - bounds.minX * zoom,
          y: (rect.height - spanY * zoom) / 2 - bounds.minY * zoom,
        },
      }));
    },

    setLinking({ storageKey, linking }) {
      withSession(storageKey, () => ({ linking }));
    },

    setHoverEdge({ storageKey, id }) {
      withSession(storageKey, () => ({ hoverEdgeId: id }));
    },
  };
});

export function getCanvasDocSnapshot(
  state: CanvasStoreState,
  storageKey: string,
): CanvasDocument | null {
  return state.docs[storageKey] ?? null;
}

// E2E 桥：与 whiteboardStore 的 __whiteboardStoreE2E 同模式，仅用于自动化验证。
declare global {
  interface Window {
    __canvasStoreE2E?: {
      getDoc: (storageKey: string) => CanvasDocument | null;
      spawnNode: (params: {
        storageKey: string;
        kind: CanvasNodeKind;
        x: number;
        y: number;
        patch?: Partial<CanvasNode>;
      }) => string;
      getStyle: (storageKey: string) => { selection: string[]; viewport: CanvasViewport };
    };
  }
}

if (typeof window !== "undefined") {
  window.__canvasStoreE2E = {
    getDoc: (storageKey) => useCanvasStore.getState().docs[storageKey] ?? null,
    spawnNode: (params) => useCanvasStore.getState().addNode(params),
    getStyle: (storageKey) => {
      const session = useCanvasStore.getState().sessions[storageKey];
      return {
        selection: session?.selection ?? [],
        viewport: session?.viewport ?? DEFAULT_VIEWPORT,
      };
    },
  };
  logger.debug("[Canvas] E2E 桥已注册");
}
