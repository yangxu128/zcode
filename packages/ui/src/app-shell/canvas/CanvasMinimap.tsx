import { memo, useMemo, useRef, useState } from "react";
import { cn } from "@/components/lib/utils.js";
import {
  canvasBounds,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasViewport,
} from "@/lib/canvasDocument.js";

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
