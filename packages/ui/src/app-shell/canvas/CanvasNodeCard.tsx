import { memo, useState } from "react";
import { ImagePlus, MoreHorizontal, Plus, Type, Video } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { type CanvasNode, type CanvasNoteColor } from "@/lib/canvasDocument.js";
import { CanvasMediaBody } from "./CanvasMediaBody.js";
import { describeCanvasMediaStage, fitNodeToAspect } from "./canvasMediaStage.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 画布节点卡片：世界坐标内绝对定位，标题可编辑，正文按类型渲染。
 * 拖拽/连线/菜单由父级（CanvasPane）接管，输入控件内部不触发拖拽。
 * 有结果的媒体节点不显示标题栏（T7）：媒体占满整张卡，标题与生成入口在选中浮层里。
 */

const NOTE_COLORS: Record<CanvasNoteColor, string> = {
  amber: "#fbbf24",
  sky: "#38bdf8",
  green: "#4ade80",
  violet: "#a78bfa",
  rose: "#fb7185",
};

const EDITABLE_SELECTOR = "input, textarea, select, button, [contenteditable='true']";

export interface CanvasNodeCardProps {
  node: CanvasNode;
  selected: boolean;
  dragging: boolean;
  offset: { x: number; y: number } | null;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onStartLink: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onOpenMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAdd: (side: "left" | "right", event: React.MouseEvent<HTMLButtonElement>) => void;
  onUpdate: (patch: Partial<CanvasNode>) => void;
  /** 提供后空媒体节点才出现上传退路（T4/T5 需要工作区级服务）。 */
  workspacePath?: string;
  workspaceIdentity?: string;
}

export const CanvasNodeCard = memo(function CanvasNodeCard({
  node,
  selected,
  dragging,
  offset,
  onPointerDown,
  onStartLink,
  onOpenMenu,
  onAdd,
  onUpdate,
  workspacePath,
  workspaceIdentity,
}: CanvasNodeCardProps) {
  const { intl } = useZCodeIntl();
  const [editingTitle, setEditingTitle] = useState(false);
  const x = node.x + (dragging ? (offset?.x ?? 0) : 0);
  const y = node.y + (dragging ? (offset?.y ?? 0) : 0);
  const mediaStage = describeCanvasMediaStage(node);
  const filled =
    mediaStage?.stage === "image" ||
    mediaStage?.stage === "video" ||
    mediaStage?.stage === "video-local";

  const titlePlaceholder =
    node.kind === "text"
      ? intl.formatMessage({ id: "canvas.node.text" })
      : node.kind === "note"
        ? intl.formatMessage({ id: "canvas.node.note" })
        : node.kind === "video"
          ? intl.formatMessage({ id: "canvas.node.video" })
          : intl.formatMessage({ id: "canvas.node.image" });

  return (
    <div
      data-canvas-node-id={node.id}
      className={cn(
        "zcode-canvas-node group absolute rounded-xl border bg-surface shadow-md",
        selected && "zcode-canvas-node-selected",
        dragging && "zcode-canvas-node-dragging",
        node.kind === "note" && "zcode-canvas-node-note",
        filled && "zcode-canvas-node-media",
      )}
      style={{
        left: x,
        top: y,
        width: node.w,
        height: node.h,
        ...(node.kind === "note"
          ? {
              backgroundColor: `${NOTE_COLORS[node.color]}22`,
              borderColor: `${NOTE_COLORS[node.color]}66`,
            }
          : {}),
      }}
      onPointerDown={(event) => {
        // 输入控件/按钮上不启动拖拽，保证编辑与菜单可用。
        if ((event.target as HTMLElement).closest(EDITABLE_SELECTOR)) return;
        onPointerDown(event);
      }}
    >
      {filled ? null : (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
          {node.kind === "text" ? (
            <Type className="size-3.5 shrink-0 text-foreground-subtle" />
          ) : node.kind === "note" ? (
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: NOTE_COLORS[node.color] }}
            />
          ) : node.kind === "video" ? (
            <Video className="size-3.5 shrink-0 text-foreground-subtle" />
          ) : (
            <ImagePlus className="size-3.5 shrink-0 text-foreground-subtle" />
          )}
          {editingTitle ? (
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-ui-sm font-medium text-foreground outline-none"
              value={node.title}
              onChange={(event) => onUpdate({ title: event.target.value } as Partial<CanvasNode>)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") setEditingTitle(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-ui-sm font-medium text-foreground"
              onClick={() => setEditingTitle(true)}
            >
              {node.title || <span className="text-foreground-subtlest">{titlePlaceholder}</span>}
            </button>
          )}
          <button
            type="button"
            data-canvas-node-menu
            aria-label={intl.formatMessage({ id: "canvas.menu" })}
            className="hidden rounded p-0.5 text-foreground-subtle hover:bg-surface-hover group-hover:block"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onOpenMenu}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      )}

      <div className={cn("min-h-0 flex-1", filled ? "overflow-hidden rounded-xl" : "p-2")}>
        {node.kind === "text" ? (
          <textarea
            value={node.content}
            placeholder={intl.formatMessage({ id: "canvas.placeholder.text" })}
            onChange={(event) => onUpdate({ content: event.target.value } as Partial<CanvasNode>)}
            className="zcode-canvas-editable h-full w-full resize-none bg-transparent text-ui-sm leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
          />
        ) : node.kind === "note" ? (
          <textarea
            value={node.body}
            placeholder={intl.formatMessage({ id: "canvas.placeholder.note" })}
            onChange={(event) => onUpdate({ body: event.target.value } as Partial<CanvasNode>)}
            className="zcode-canvas-editable h-full w-full resize-none bg-transparent text-ui-sm leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
          />
        ) : (
          <CanvasMediaBody
            node={node}
            {...(workspacePath ? { workspacePath } : {})}
            {...(workspaceIdentity ? { workspaceIdentity } : {})}
            onFitAspect={(aspect) => {
              // 卡片按媒体固有比例贴合；比例已对上时返回 null，不会反复写文档。
              const fit = fitNodeToAspect({ w: node.w, h: node.h }, aspect);
              if (fit) onUpdate(fit as Partial<CanvasNode>);
            }}
            onUpdate={onUpdate}
          />
        )}
      </div>

      {/* 连线起点：右缘圆点；左右「+」新建并自动连线 */}
      <button
        type="button"
        data-canvas-link-handle
        aria-label={intl.formatMessage({ id: "canvas.link.start" })}
        className="absolute -right-2 top-1/2 z-10 hidden size-4 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground-subtle hover:text-foreground group-hover:flex"
        onPointerDown={(event) => {
          event.stopPropagation();
          onStartLink(event);
        }}
      />
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "canvas.add.right" })}
        className="absolute -right-3 top-2 z-10 hidden size-5 items-center justify-center rounded-full border border-border bg-background text-foreground-subtle hover:text-foreground group-hover:flex"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => onAdd("right", event)}
      >
        <Plus className="size-3" />
      </button>
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "canvas.add.left" })}
        className="absolute -left-3 top-2 z-10 hidden size-5 items-center justify-center rounded-full border border-border bg-background text-foreground-subtle hover:text-foreground group-hover:flex"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => onAdd("left", event)}
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
});
