import { memo, useState } from "react";
import { ImagePlus, MoreHorizontal, Plus, Type } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import {
  downscaleImageToDataUrl,
  type CanvasNode,
  type CanvasNoteColor,
} from "@/lib/canvasDocument.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 画布节点卡片：世界坐标内绝对定位，标题可编辑，正文按类型渲染。
 * 拖拽/连线/菜单由父级（CanvasPane）接管，输入控件内部不触发拖拽。
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
}: CanvasNodeCardProps) {
  const { intl } = useZCodeIntl();
  const [editingTitle, setEditingTitle] = useState(false);
  const x = node.x + (dragging ? (offset?.x ?? 0) : 0);
  const y = node.y + (dragging ? (offset?.y ?? 0) : 0);

  const titlePlaceholder =
    node.kind === "text"
      ? intl.formatMessage({ id: "canvas.node.text" })
      : node.kind === "note"
        ? intl.formatMessage({ id: "canvas.node.note" })
        : intl.formatMessage({ id: "canvas.node.image" });

  return (
    <div
      data-canvas-node-id={node.id}
      className={cn(
        "zcode-canvas-node group absolute rounded-xl border bg-surface shadow-md",
        selected && "zcode-canvas-node-selected",
        dragging && "zcode-canvas-node-dragging",
        node.kind === "note" && "zcode-canvas-node-note",
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
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        {node.kind === "text" ? (
          <Type className="size-3.5 shrink-0 text-foreground-subtle" />
        ) : node.kind === "note" ? (
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: NOTE_COLORS[node.color] }}
          />
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

      <div className="min-h-0 flex-1 p-2">
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
          <div className="flex h-full flex-col gap-1.5">
            {node.url ? (
              <img
                src={node.url}
                alt={node.caption || node.title}
                className="min-h-0 flex-1 rounded-lg object-contain"
                draggable={false}
              />
            ) : (
              <label className="flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-foreground-subtle hover:bg-surface-hover">
                <ImagePlus className="size-5" />
                <span className="text-ui-xs">
                  {intl.formatMessage({ id: "canvas.image.pick" })}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    // 降采样为 data URL 以便持久化；解码失败保持空图占位，不中断编辑。
                    downscaleImageToDataUrl(file)
                      .then((url) => onUpdate({ url } as Partial<CanvasNode>))
                      .catch(() => undefined);
                  }}
                />
              </label>
            )}
            <input
              value={node.caption}
              placeholder={intl.formatMessage({ id: "canvas.placeholder.caption" })}
              onChange={(event) => onUpdate({ caption: event.target.value } as Partial<CanvasNode>)}
              className="w-full bg-transparent text-ui-xs text-foreground-subtle outline-none placeholder:text-foreground-subtlest"
            />
          </div>
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
