import { memo, useMemo } from "react";
import { canvasEdgePath, type CanvasEdge, type CanvasNode } from "@/lib/canvasDocument.js";
import { useCanvasStore } from "@/store/canvasStore.js";

/**
 * 画布连线层：SVG 绘制，支持悬停高亮与双击删除。
 * 拖拽中的节点以偏移量参与端点计算，连线实时跟随。
 */

const EDGE_STYLE: Record<CanvasEdge["kind"], { stroke: string; width: number; dash?: string }> = {
  flow: { stroke: "var(--color-brand)", width: 1.6 },
  depends: { stroke: "var(--color-destructive)", width: 1.5, dash: "4 3" },
};

interface CanvasEdgesProps {
  edges: readonly CanvasEdge[];
  nodes: readonly CanvasNode[];
  byId: (id: string) => CanvasNode | undefined;
  draggingIds: ReadonlySet<string> | null;
  offset: { x: number; y: number } | null;
  storageKey: string;
}

export const CanvasEdges = memo(function CanvasEdges({
  edges,
  byId,
  draggingIds,
  offset,
  storageKey,
}: CanvasEdgesProps) {
  const hoverEdgeId = useCanvasStore((s) => s.sessions[storageKey]?.hoverEdgeId ?? null);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const setHoverEdge = useCanvasStore((s) => s.setHoverEdge);

  const items = useMemo(() => {
    return edges
      .map((edge) => {
        const a = byId(edge.from);
        const b = byId(edge.to);
        if (!a || !b) return null;
        const ax = a.x + (draggingIds?.has(a.id) ? (offset?.x ?? 0) : 0);
        const ay = a.y + (draggingIds?.has(a.id) ? (offset?.y ?? 0) : 0);
        const bx = b.x + (draggingIds?.has(b.id) ? (offset?.x ?? 0) : 0);
        const by = b.y + (draggingIds?.has(b.id) ? (offset?.y ?? 0) : 0);
        return {
          edge,
          d: canvasEdgePath(ax + a.w, ay + a.h / 2, bx, by + b.h / 2),
        };
      })
      .filter(Boolean) as { edge: CanvasEdge; d: string }[];
  }, [edges, byId, draggingIds, offset]);

  if (!items.length) return null;

  return (
    <svg className="zcode-canvas-edge-layer">
      <defs>
        {Object.entries(EDGE_STYLE).map(([kind, style]) => (
          <marker
            key={kind}
            id={`zcode-canvas-arrow-${kind}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={style.stroke} />
          </marker>
        ))}
      </defs>
      {items.map(({ edge, d }) => {
        const hovered = hoverEdgeId === edge.id;
        const style = EDGE_STYLE[edge.kind];
        return (
          <g key={edge.id} className="zcode-canvas-edge">
            {/* 加粗透明命中区：细线也需要可点 */}
            <path
              className="zcode-canvas-edge-hit"
              d={d}
              onPointerEnter={() => setHoverEdge({ storageKey, id: edge.id })}
              onPointerLeave={() => setHoverEdge({ storageKey, id: null })}
              onDoubleClick={() => removeEdge({ storageKey, id: edge.id })}
            />
            <path
              className="zcode-canvas-edge-line"
              d={d}
              stroke={hovered ? "var(--color-destructive)" : style.stroke}
              strokeWidth={hovered ? style.width + 1.2 : style.width}
              strokeDasharray={style.dash}
              markerEnd={`url(#zcode-canvas-arrow-${edge.kind})`}
            />
          </g>
        );
      })}
    </svg>
  );
});
