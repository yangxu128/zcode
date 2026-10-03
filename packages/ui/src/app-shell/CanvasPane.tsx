/* oxlint-disable eslint(max-lines) -- 画布的指针状态机、视口换算与快捷键强耦合，拆分会拆散拖拽生命周期。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/lib/utils.js";
import {
  buildCanvasStorageKey,
  downscaleImageToDataUrl,
  findFreeCanvasSpot,
  type CanvasNode,
  type CanvasNodeKind,
} from "@/lib/canvasDocument.js";
import { useCanvasStore } from "@/store/canvasStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CanvasNodeCard } from "@/app-shell/canvas/CanvasNodeCard.js";
import { CanvasEdges } from "@/app-shell/canvas/CanvasEdges.js";
import {
  CanvasContextMenu,
  CanvasControls,
  CanvasMinimap,
  CanvasToolPalette,
  type CanvasMenuItem,
} from "@/app-shell/canvas/CanvasOverlays.js";
import { CanvasSelectionToolbar } from "@/app-shell/canvas/CanvasSelectionToolbar.js";

/**
 * 无限画布侧边面板（docs/ui/canvas-pane.md）。
 * 视口/选区/连线状态在 canvasStore（按 storageKey 分桶）；文档持久化在 localStorage。
 * 所有依赖视口尺寸的计算使用容器实测 rect，键盘快捷键只绑在画布根元素上。
 */

type CanvasDragState =
  | { mode: "node"; startX: number; startY: number; ids: string[]; moved: boolean }
  | { mode: "pan"; startX: number; startY: number; originX: number; originY: number }
  | {
      mode: "marquee";
      startX: number;
      startY: number;
      curX: number;
      curY: number;
      additive: boolean;
    }
  | { mode: "link"; from: string }
  | null;

export interface CanvasPaneProps {
  workspacePath: string;
  workspaceIdentity?: string;
  boardId: string;
}

export function CanvasPane({ workspacePath, workspaceIdentity, boardId }: CanvasPaneProps) {
  const { intl } = useZCodeIntl();
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CanvasDragState>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const snapRef = useRef(true);

  // workspaceKey 遵循仓库约定：身份 key 优先，路径兜底。
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const storageKey = buildCanvasStorageKey({ workspaceKey, boardId });

  const [dragIds, setDragIds] = useState<string[]>([]);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [snap, setSnap] = useState(true);
  const [cursorMode, setCursorMode] = useState<"select" | "hand">("select");
  const [menu, setMenu] = useState<{ x: number; y: number; items: CanvasMenuItem[] } | null>(null);
  const [paneRect, setPaneRect] = useState({ width: 0, height: 0 });
  const [dropActive, setDropActive] = useState(false);
  const cursorModeRef = useRef(cursorMode);
  cursorModeRef.current = cursorMode;

  const doc = useCanvasStore((s) => s.docs[storageKey]);
  const session = useCanvasStore((s) => s.sessions[storageKey]);
  const nodes = doc?.nodes ?? [];
  const edges = doc?.edges ?? [];
  const viewport = session?.viewport ?? { x: 0, y: 0, zoom: 1 };
  const selection = session?.selection ?? [];
  const linking = session?.linking ?? null;

  useEffect(() => {
    useCanvasStore.getState().hydrate({ storageKey, boardId });
  }, [storageKey, boardId]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setPaneRect({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const store = useCanvasStore;
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rootRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const view = store.getState().sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
      return {
        x: (clientX - rect.left - view.x) / view.zoom,
        y: (clientY - rect.top - view.y) / view.zoom,
      };
    },
    [storageKey, store],
  );

  const toScreen = useCallback(
    (worldX: number, worldY: number) => {
      const rect = rootRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const view = store.getState().sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
      return {
        x: rect.left + worldX * view.zoom + view.x,
        y: rect.top + worldY * view.zoom + view.y,
      };
    },
    [storageKey, store],
  );

  const byId = useCallback((id: string) => nodes.find((n) => n.id === id), [nodes]);

  const snapRefSync = snap;
  snapRef.current = snapRefSync;

  // ---------------- 指针拖拽（节点/平移/框选/连线） ----------------
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const view = store.getState().sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
      if (drag.mode === "node") {
        const dx = (event.clientX - drag.startX) / view.zoom;
        const dy = (event.clientY - drag.startY) / view.zoom;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;
        dragOffsetRef.current = { x: dx, y: dy };
        setDragOffset({ x: dx, y: dy });
      } else if (drag.mode === "pan") {
        store.getState().setViewport({
          storageKey,
          viewport: {
            x: drag.originX + (event.clientX - drag.startX),
            y: drag.originY + (event.clientY - drag.startY),
            zoom: view.zoom,
          },
        });
      } else if (drag.mode === "marquee") {
        drag.curX = event.clientX;
        drag.curY = event.clientY;
        setMarquee({ x0: drag.startX, y0: drag.startY, x1: event.clientX, y1: event.clientY });
      } else if (drag.mode === "link") {
        const world = toWorld(event.clientX, event.clientY);
        store
          .getState()
          .setLinking({ storageKey, linking: { from: drag.from, x: world.x, y: world.y } });
      }
    };

    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragIds([]);
      if (!drag) return;

      if (drag.mode === "node") {
        const offset = dragOffsetRef.current;
        dragOffsetRef.current = null;
        setDragOffset(null);
        if (drag.moved && offset) {
          let { x, y } = offset;
          if (snapRef.current) {
            const lead = nodes.find((n) => n.id === drag.ids[0]);
            if (lead) {
              const gx = Math.round((lead.x + offset.x) / 8) * 8;
              const gy = Math.round((lead.y + offset.y) / 8) * 8;
              x += gx - lead.x - offset.x;
              y += gy - lead.y - offset.y;
            }
          }
          store.getState().translateNodes({ storageKey, ids: drag.ids, dx: x, dy: y });
        }
      }

      if (drag.mode === "marquee") {
        const a = toWorld(Math.min(drag.startX, drag.curX), Math.min(drag.startY, drag.curY));
        const b = toWorld(Math.max(drag.startX, drag.curX), Math.max(drag.startY, drag.curY));
        const hit = nodes
          .filter((n) => n.x < b.x && n.x + n.w > a.x && n.y < b.y && n.y + n.h > a.y)
          .map((n) => n.id);
        store.getState().select({ storageKey, ids: hit, additive: drag.additive });
        setMarquee(null);
      }

      if (drag.mode === "link") {
        const target = document
          .elementsFromPoint(event.clientX, event.clientY)
          .find((el) => (el as HTMLElement).dataset?.canvasNodeId);
        const targetId = (target as HTMLElement | undefined)?.dataset?.canvasNodeId;
        if (targetId && targetId !== drag.from) {
          store.getState().addEdge({ storageKey, from: drag.from, to: targetId, kind: "flow" });
        }
        store.getState().setLinking({ storageKey, linking: null });
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [nodes, toWorld, storageKey, store]);

  // ---------------- 滚轮：缩放/平移 ----------------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const state = store.getState();
      if (event.ctrlKey || event.metaKey) {
        state.zoomBy({
          storageKey,
          factor: Math.exp(-event.deltaY * 0.0032),
          centerX: event.clientX - rect.left,
          centerY: event.clientY - rect.top,
        });
      } else if (event.shiftKey) {
        const view = state.sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
        state.setViewport({ storageKey, viewport: { ...view, x: view.x - event.deltaY } });
      } else {
        const view = state.sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
        state.setViewport({
          storageKey,
          viewport: { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY },
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [storageKey, store]);

  // ---------------- 快捷键：仅画布获得焦点时生效 ----------------
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable))
        return;
      const state = store.getState();
      const mod = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        state.select({ storageKey, ids: [] });
        state.setLinking({ storageKey, linking: null });
        setMenu(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const current = state.sessions[storageKey]?.selection ?? [];
        if (current.length) {
          event.preventDefault();
          state.removeNodes({ storageKey, ids: current });
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        state.duplicateNodes({ storageKey, ids: state.sessions[storageKey]?.selection ?? [] });
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        state.select({ storageKey, ids: nodes.map((n) => n.id) });
        return;
      }
      if (mod && event.key === "0") {
        event.preventDefault();
        state.fitView({ storageKey, rect: paneRect });
        return;
      }
      if (mod && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        state.zoomBy({
          storageKey,
          factor: 1.2,
          centerX: paneRect.width / 2,
          centerY: paneRect.height / 2,
        });
        return;
      }
      if (mod && event.key === "-") {
        event.preventDefault();
        state.zoomBy({
          storageKey,
          factor: 1 / 1.2,
          centerX: paneRect.width / 2,
          centerY: paneRect.height / 2,
        });
        return;
      }
      if (!mod && event.key.toLowerCase() === "s") {
        setSnap((value) => !value);
        return;
      }
      if (!mod && event.key.toLowerCase() === "h") {
        setCursorMode((mode) => (mode === "hand" ? "select" : "hand"));
      }
    },
    [nodes, paneRect, storageKey, store],
  );

  // ---------------- 背景与节点交互 ----------------
  const onBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    rootRef.current?.focus();
    setMenu(null);
    if (
      event.button === 1 ||
      (event.button === 0 && (event.shiftKey || cursorModeRef.current === "hand"))
    ) {
      const view = store.getState().sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
      dragRef.current = {
        mode: "pan",
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
      };
      return;
    }
    if (event.button === 0) {
      const additive = event.metaKey || event.ctrlKey;
      dragRef.current = {
        mode: "marquee",
        startX: event.clientX,
        startY: event.clientY,
        curX: event.clientX,
        curY: event.clientY,
        additive,
      };
      if (!additive) store.getState().select({ storageKey, ids: [] });
    }
  };

  const startNodeDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, node: CanvasNode) => {
      if (event.button !== 0 || cursorModeRef.current === "hand") return;
      event.stopPropagation();
      const state = store.getState();
      let ids = state.sessions[storageKey]?.selection ?? [];
      if (!ids.includes(node.id)) {
        state.select({ storageKey, ids: [node.id] });
        ids = [node.id];
      }
      dragRef.current = {
        mode: "node",
        startX: event.clientX,
        startY: event.clientY,
        ids,
        moved: false,
      };
      setDragIds(ids);
    },
    [storageKey, store],
  );

  const spawnAt = useCallback(
    (kind: CanvasNodeKind, worldX: number, worldY: number, patch?: Partial<CanvasNode>) => {
      const { x, y } = findFreeCanvasSpot(nodes, kind, worldX, worldY);
      const id = store.getState().addNode({ storageKey, kind, x, y, patch });
      if (id) store.getState().select({ storageKey, ids: [id] });
      return id;
    },
    [nodes, storageKey, store],
  );

  const spawnCenter = useCallback(
    (kind: CanvasNodeKind) => {
      const view = store.getState().sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
      const worldX = (-view.x + paneRect.width / 2) / view.zoom;
      const worldY = (-view.y + paneRect.height / 2) / view.zoom;
      spawnAt(kind, worldX, worldY);
    },
    [paneRect, storageKey, spawnAt, store],
  );

  const pickImage = useCallback(
    (file: File) => {
      downscaleImageToDataUrl(file)
        .then((url) => {
          const view = store.getState().sessions[storageKey]?.viewport ?? { x: 0, y: 0, zoom: 1 };
          const worldX = (-view.x + paneRect.width / 2) / view.zoom;
          const worldY = (-view.y + paneRect.height / 2) / view.zoom;
          spawnAt("image", worldX, worldY, {
            url,
            title: file.name.replace(/\.[^.]+$/, ""),
            caption: file.name,
          } as Partial<CanvasNode>);
        })
        .catch(() => {
          // 解码失败退化为空图片节点，保留用户意图。
          spawnAt("image", paneRect.width / 2, paneRect.height / 2);
        });
    },
    [paneRect, spawnAt, storageKey, store],
  );

  const backgroundMenuItems = (worldX: number, worldY: number): CanvasMenuItem[] => {
    const nodeKinds: { kind: CanvasNodeKind; key: string }[] = [
      { kind: "text", key: "canvas.node.text" },
      { kind: "note", key: "canvas.node.note" },
      { kind: "image", key: "canvas.node.image" },
    ];
    return [
      ...nodeKinds.map(({ kind, key }) => ({
        label: intl.formatMessage({ id: key }),
        onSelect: () => spawnAt(kind, worldX, worldY),
      })),
      { sep: true },
      {
        label: intl.formatMessage({ id: "canvas.menu.selectAll" }),
        onSelect: () => store.getState().select({ storageKey, ids: nodes.map((n) => n.id) }),
      },
      {
        label: intl.formatMessage({ id: "canvas.zoom.fit" }),
        onSelect: () => store.getState().fitView({ storageKey, rect: paneRect }),
      },
    ];
  };

  const nodeMenuItems = (node: CanvasNode): CanvasMenuItem[] => [
    {
      label: intl.formatMessage({ id: "canvas.menu.duplicate" }),
      onSelect: () => store.getState().duplicateNodes({ storageKey, ids: [node.id] }),
    },
    { sep: true },
    {
      label: intl.formatMessage({ id: "canvas.delete" }),
      danger: true,
      onSelect: () => store.getState().removeNodes({ storageKey, ids: [node.id] }),
    },
  ];

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(false);
    const kind = event.dataTransfer.getData("text/canvas-node") as CanvasNodeKind | "";
    const world = toWorld(event.clientX, event.clientY);
    if (kind === "text" || kind === "note" || kind === "image") {
      spawnAt(kind, world.x, world.y);
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    files.slice(0, 6).forEach((file, index) => {
      downscaleImageToDataUrl(file)
        .then((url) =>
          spawnAt("image", world.x + index * 32, world.y + index * 24, {
            url,
            title: file.name.replace(/\.[^.]+$/, ""),
            caption: file.name,
          } as Partial<CanvasNode>),
        )
        .catch(() => undefined);
    });
  };

  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectionSet.has(n.id)),
    [nodes, selectionSet],
  );
  const draggingIdSet = dragIds.length ? new Set(dragIds) : null;

  const toolbarPosition = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of selectedNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    const top = toScreen((minX + maxX) / 2, minY);
    return { x: top.x, y: top.y };
  }, [selectedNodes, toScreen]);

  const linkingFrom = linking ? byId(linking.from) : null;

  return (
    <div
      ref={rootRef}
      data-canvas-pane=""
      tabIndex={0}
      className={cn(
        "zcode-canvas relative h-full w-full select-none overflow-hidden bg-background outline-none",
        cursorMode === "hand" && "zcode-canvas-hand",
        dropActive && "zcode-canvas-drop",
      )}
      onKeyDown={handleKeyDown}
      onPointerDown={onBackgroundPointerDown}
      onContextMenu={(event) => {
        event.preventDefault();
        const world = toWorld(event.clientX, event.clientY);
        store.getState().select({ storageKey, ids: [] });
        setMenu({
          x: event.clientX,
          y: event.clientY,
          items: backgroundMenuItems(world.x, world.y),
        });
      }}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes("text/canvas-node") ||
          event.dataTransfer.files.length > 0
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div
        className="zcode-canvas-grid"
        style={{
          backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px, ${120 * viewport.zoom}px ${120 * viewport.zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px`,
        }}
      />

      <CanvasToolPalette
        cursorMode={cursorMode}
        onCursorMode={setCursorMode}
        onSpawn={spawnCenter}
        onPickImage={pickImage}
      />

      <div
        className="zcode-canvas-world"
        style={{
          transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
        }}
      >
        <CanvasEdges
          edges={edges}
          nodes={nodes}
          byId={byId}
          draggingIds={draggingIdSet}
          offset={dragOffset}
          storageKey={storageKey}
        />
        {linking && linkingFrom ? (
          <svg
            className="zcode-canvas-edge-layer"
            style={{ overflow: "visible", pointerEvents: "none" }}
          >
            <path
              className="zcode-canvas-edge-line"
              d={buildLinkPreviewPath(linkingFrom, linking.x, linking.y)}
            />
          </svg>
        ) : null}
        {nodes.map((node) => (
          <CanvasNodeCard
            key={node.id}
            node={node}
            selected={selectionSet.has(node.id)}
            dragging={!!draggingIdSet?.has(node.id)}
            offset={draggingIdSet?.has(node.id) ? dragOffset : null}
            onPointerDown={(event) => startNodeDrag(event, node)}
            onStartLink={(event) => {
              dragRef.current = { mode: "link", from: node.id };
              void event;
            }}
            onOpenMenu={(event) => {
              const state = store.getState();
              const current = state.sessions[storageKey]?.selection ?? [];
              if (!current.includes(node.id)) state.select({ storageKey, ids: [node.id] });
              setMenu({ x: event.clientX, y: event.clientY, items: nodeMenuItems(node) });
            }}
            onAdd={(side, event) => {
              event.stopPropagation();
              const size = { w: 260, h: 180 };
              const nodeWidth = node.w;
              const nodeHeight = node.h;
              const targetKind: CanvasNodeKind = "text";
              const x = side === "right" ? node.x + nodeWidth + 56 : node.x - size.w - 56;
              const y = node.y + nodeHeight / 2 - size.h / 2;
              const id = spawnAt(targetKind, x + size.w / 2, y + size.h / 2);
              if (id) {
                store.getState().addEdge({
                  storageKey,
                  from: side === "right" ? node.id : id,
                  to: side === "right" ? id : node.id,
                  kind: side === "right" ? "flow" : "depends",
                });
              }
            }}
            onUpdate={(patch) => store.getState().updateNode({ storageKey, id: node.id, patch })}
          />
        ))}
      </div>

      {marquee ? (
        <div
          className="zcode-canvas-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      ) : null}

      {toolbarPosition ? (
        <CanvasSelectionToolbar
          x={toolbarPosition.x}
          y={toolbarPosition.y - 46}
          count={selectedNodes.length}
          onAlign={(mode) => store.getState().alignNodes({ storageKey, ids: selection, mode })}
          onDistribute={(axis) =>
            store.getState().distributeNodes({ storageKey, ids: selection, axis })
          }
          onDelete={() => store.getState().removeNodes({ storageKey, ids: selection })}
        />
      ) : null}

      <CanvasControls
        zoom={viewport.zoom}
        snap={snap}
        onToggleSnap={() => setSnap((value) => !value)}
        onZoomBy={(factor) =>
          store.getState().zoomBy({
            storageKey,
            factor,
            centerX: paneRect.width / 2,
            centerY: paneRect.height / 2,
          })
        }
        onFitView={() => store.getState().fitView({ storageKey, rect: paneRect })}
      />

      <CanvasMinimap
        nodes={nodes}
        viewport={viewport}
        paneRect={paneRect}
        onJump={(x, y) =>
          store.getState().setViewport({ storageKey, viewport: { ...viewport, x, y } })
        }
      />

      {menu ? (
        <CanvasContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}

      {!nodes.length ? (
        <div className="zcode-canvas-empty">
          <h2 className="text-ui-lg font-semibold text-foreground">
            {intl.formatMessage({ id: "canvas.empty.title" })}
          </h2>
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "canvas.empty.body" })}
          </p>
        </div>
      ) : null}

      <div className="zcode-canvas-hint">
        <span>
          <kbd>Shift</kbd>+{intl.formatMessage({ id: "canvas.hint.drag" })}
        </span>
        <span>
          <kbd>Ctrl</kbd>+{intl.formatMessage({ id: "canvas.hint.wheel" })}
        </span>
        <span>
          <kbd>S</kbd> {intl.formatMessage({ id: "canvas.hint.snap" })}
        </span>
        <span>
          <kbd>H</kbd> {intl.formatMessage({ id: "canvas.hint.hand" })}
        </span>
      </div>
    </div>
  );
}

function buildLinkPreviewPath(from: CanvasNode, worldX: number, worldY: number): string {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const dx = Math.abs(worldX - x1);
  const dy = Math.abs(worldY - y1);
  if (dx >= dy) {
    const c = Math.max(40, Math.min(200, dx * 0.5));
    return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${worldX - c} ${worldY}, ${worldX} ${worldY}`;
  }
  const c = Math.max(40, Math.min(200, dy * 0.5));
  return `M ${x1} ${y1} C ${x1} ${y1 + c}, ${worldX} ${worldY - c}, ${worldX} ${worldY}`;
}
