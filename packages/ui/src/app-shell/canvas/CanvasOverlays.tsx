import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Hand,
  ImagePlus,
  Magnet,
  Maximize2,
  MousePointer2,
  StickyNote,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  canvasBounds,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasViewport,
} from "@/lib/canvasDocument.js";

/**
 * 画布覆盖层：工具栏、缩放控制、小地图、多选工具条、右键菜单。
 * 均为视口坐标下的浮动层，事件不透传到画布背景。
 */

export interface CanvasSpawnRequest {
  kind: CanvasNodeKind;
  x: number;
  y: number;
}

export const CanvasToolPalette = memo(function CanvasToolPalette({
  cursorMode,
  onCursorMode,
  onSpawn,
  onPickImage,
}: {
  cursorMode: "select" | "hand";
  onCursorMode: (mode: "select" | "hand") => void;
  onSpawn: (kind: CanvasNodeKind) => void;
  onPickImage: (file: File) => void;
}) {
  const { intl } = useZCodeIntl();
  const fileRef = useRef<HTMLInputElement>(null);

  const tools: {
    id: string;
    kind: CanvasNodeKind;
    label: string;
    Icon: typeof Type;
  }[] = [
    { id: "text", kind: "text", label: intl.formatMessage({ id: "canvas.node.text" }), Icon: Type },
    {
      id: "note",
      kind: "note",
      label: intl.formatMessage({ id: "canvas.node.note" }),
      Icon: StickyNote,
    },
    {
      id: "image",
      kind: "image",
      label: intl.formatMessage({ id: "canvas.node.image" }),
      Icon: ImagePlus,
    },
  ];

  return (
    <nav
      className="zcode-canvas-palette"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-canvas-tool="select"
        className={cn("zcode-canvas-tool", cursorMode === "select" && "on")}
        title={intl.formatMessage({ id: "canvas.tool.select" })}
        onClick={() => onCursorMode("select")}
      >
        <MousePointer2 className="size-4" />
      </button>
      <button
        type="button"
        data-canvas-tool="hand"
        className={cn("zcode-canvas-tool", cursorMode === "hand" && "on")}
        title={intl.formatMessage({ id: "canvas.tool.hand" })}
        onClick={() => onCursorMode("hand")}
      >
        <Hand className="size-4" />
      </button>
      <span className="zcode-canvas-tool-sep" />
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          data-canvas-tool={tool.kind}
          draggable
          className="zcode-canvas-tool"
          title={tool.label}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/canvas-node", tool.kind);
            event.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onSpawn(tool.kind)}
        >
          <tool.Icon className="size-4" />
        </button>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = event.target.files;
          event.target.value = "";
          for (const file of Array.from(files ?? []).slice(0, 6)) onPickImage(file);
        }}
      />
      <button
        type="button"
        data-canvas-tool="upload"
        className="zcode-canvas-tool"
        title={intl.formatMessage({ id: "canvas.tool.upload" })}
        onClick={() => fileRef.current?.click()}
      >
        <ImagePlus className="size-4" />
      </button>
    </nav>
  );
});

export const CanvasControls = memo(function CanvasControls({
  zoom,
  snap,
  onToggleSnap,
  onZoomBy,
  onFitView,
}: {
  zoom: number;
  snap: boolean;
  onToggleSnap: () => void;
  onZoomBy: (factor: number) => void;
  onFitView: () => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className="zcode-canvas-controls" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        data-canvas-control="zoom-out"
        className="zcode-canvas-ctl"
        title={intl.formatMessage({ id: "canvas.zoom.out" })}
        onClick={() => onZoomBy(1 / 1.25)}
      >
        <ZoomOut className="size-3.5" />
      </button>
      <button
        type="button"
        data-canvas-control="zoom-reset"
        className="zcode-canvas-ctl zcode-canvas-zoom-value"
        title={intl.formatMessage({ id: "canvas.zoom.reset" })}
        onClick={() => onZoomBy(1 / zoom)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        data-canvas-control="zoom-in"
        className="zcode-canvas-ctl"
        title={intl.formatMessage({ id: "canvas.zoom.in" })}
        onClick={() => onZoomBy(1.25)}
      >
        <ZoomIn className="size-3.5" />
      </button>
      <span className="zcode-canvas-ctl-sep" />
      <button
        type="button"
        data-canvas-control="fit"
        className="zcode-canvas-ctl"
        title={intl.formatMessage({ id: "canvas.zoom.fit" })}
        onClick={onFitView}
      >
        <Maximize2 className="size-3.5" />
      </button>
      <button
        type="button"
        data-canvas-control="snap"
        className={cn("zcode-canvas-ctl", snap && "on")}
        title={intl.formatMessage({ id: "canvas.zoom.snap" })}
        onClick={onToggleSnap}
      >
        <Magnet className="size-3.5" />
      </button>
    </div>
  );
});

const MINIMAP_WIDTH = 168;
const MINIMAP_HEIGHT = 112;
const MINIMAP_PAD = 10;

const KIND_MINIMAP_COLOR: Record<CanvasNodeKind, string> = {
  text: "#38bdf8",
  note: "#fbbf24",
  image: "#a78bfa",
};

export const CanvasMinimap = memo(function CanvasMinimap({
  nodes,
  viewport,
  paneRect,
  onJump,
}: {
  nodes: readonly CanvasNode[];
  viewport: CanvasViewport;
  paneRect: { width: number; height: number };
  onJump: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);

  const geo = useMemo(() => {
    const bounds = canvasBounds(nodes);
    if (!bounds) return null;
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const k = Math.min(
      (MINIMAP_WIDTH - MINIMAP_PAD * 2) / bw,
      (MINIMAP_HEIGHT - MINIMAP_PAD * 2) / bh,
    );
    return {
      ...bounds,
      k,
      ox: (MINIMAP_WIDTH - bw * k) / 2,
      oy: (MINIMAP_HEIGHT - bh * k) / 2,
    };
  }, [nodes]);

  if (!geo) return null;

  const viewWorldWidth = paneRect.width / viewport.zoom;
  const viewWorldHeight = paneRect.height / viewport.zoom;
  const viewWorldX = -viewport.x / viewport.zoom;
  const viewWorldY = -viewport.y / viewport.zoom;

  const project = (x: number, y: number) => [
    geo.ox + (x - geo.minX) * geo.k,
    geo.oy + (y - geo.minY) * geo.k,
  ];

  return (
    <div
      ref={ref}
      data-canvas-minimap
      className={cn("zcode-canvas-minimap", hover && "on")}
      style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(event) => {
        event.stopPropagation();
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const worldX = (event.clientX - rect.left - geo.ox) / geo.k + geo.minX;
        const worldY = (event.clientY - rect.top - geo.oy) / geo.k + geo.minY;
        onJump(
          -worldX * viewport.zoom + paneRect.width / 2,
          -worldY * viewport.zoom + paneRect.height / 2,
        );
      }}
    >
      <svg width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT}>
        {nodes.map((node) => {
          const [x, y] = project(node.x, node.y);
          return (
            <rect
              key={node.id}
              x={x}
              y={y}
              width={Math.max(2, node.w * geo.k)}
              height={Math.max(2, node.h * geo.k)}
              fill={KIND_MINIMAP_COLOR[node.kind]}
              opacity={0.6}
              rx={1}
            />
          );
        })}
        {(() => {
          const [x, y] = project(viewWorldX, viewWorldY);
          return (
            <rect
              x={x}
              y={y}
              width={viewWorldWidth * geo.k}
              height={viewWorldHeight * geo.k}
              fill="var(--color-foreground)"
              fillOpacity={0.08}
              stroke="var(--color-foreground)"
              strokeOpacity={0.55}
              rx={2}
            />
          );
        })()}
      </svg>
    </div>
  );
});

export interface CanvasMenuItem {
  label?: string;
  sep?: boolean;
  danger?: boolean;
  onSelect?: () => void;
}

export const CanvasContextMenu = memo(function CanvasContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CanvasMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y, ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, y - rect.height);
    }
    setPosition({ left, top, ready: true });
  }, [x, y, items]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      // 关闭判断按 class 就近匹配，避免父组件间传递 ref
      if (!(event.target as HTMLElement | null)?.closest(".zcode-canvas-menu")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // 下一帧再绑，避免触发它的 pointerdown 立即关闭
    const timer = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="zcode-canvas-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      {items.map((item, index) =>
        item.sep ? (
          <div key={index} className="zcode-canvas-menu-sep" />
        ) : (
          <button
            key={index}
            type="button"
            className={cn("zcode-canvas-menu-item", item.danger && "danger")}
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
});
