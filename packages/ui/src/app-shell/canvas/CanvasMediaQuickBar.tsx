import { memo } from "react";
import { Bot, Eye, Link2, MessageSquarePlus, Trash2 } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 单个媒体节点选中后的浮层工具栏（docs/ui/canvas-pane.md T7）。
 * 只放真的能执行的动作：即梦那些「智能改图/超清/抠图」我们没有对应能力，不放假按钮。
 * 「重新生成」也不在这里——生成入口只有浮层对话框一个，避免两条写入路径。
 */
export interface CanvasMediaQuickBarProps {
  x: number;
  y: number;
  hasResult: boolean;
  hasLink: boolean;
  onPreview: () => void;
  onCopyLink: () => void;
  onSendToChat: () => void;
  onAskAgent: () => void;
  onDelete: () => void;
}

export const CanvasMediaQuickBar = memo(function CanvasMediaQuickBar({
  x,
  y,
  hasResult,
  hasLink,
  onPreview,
  onCopyLink,
  onSendToChat,
  onAskAgent,
  onDelete,
}: CanvasMediaQuickBarProps) {
  const { intl } = useZCodeIntl();
  const button = "zcode-canvas-selection-btn";
  return (
    <div
      className="zcode-canvas-selection-toolbar zcode-canvas-media-bar"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {hasResult ? (
        <button
          type="button"
          className={button}
          title={intl.formatMessage({ id: "canvas.media.preview" })}
          aria-label={intl.formatMessage({ id: "canvas.media.preview" })}
          onClick={onPreview}
        >
          <Eye className="size-4" />
        </button>
      ) : null}
      {hasLink ? (
        <button
          type="button"
          className={button}
          title={intl.formatMessage({ id: "canvas.media.copyLink" })}
          aria-label={intl.formatMessage({ id: "canvas.media.copyLink" })}
          onClick={onCopyLink}
        >
          <Link2 className="size-4" />
        </button>
      ) : null}
      <span className="zcode-canvas-ctl-sep" />
      <button
        type="button"
        className={button}
        title={intl.formatMessage({ id: "canvas.sendToChat" })}
        aria-label={intl.formatMessage({ id: "canvas.sendToChat" })}
        onClick={onSendToChat}
      >
        <MessageSquarePlus className="size-4" />
      </button>
      <button
        type="button"
        className={button}
        title={intl.formatMessage({ id: "canvas.askAgent.title" })}
        aria-label={intl.formatMessage({ id: "canvas.askAgent.title" })}
        onClick={onAskAgent}
      >
        <Bot className="size-4" />
      </button>
      <span className="zcode-canvas-ctl-sep" />
      <button
        type="button"
        className={`${button} danger`}
        title={intl.formatMessage({ id: "canvas.delete" })}
        aria-label={intl.formatMessage({ id: "canvas.delete" })}
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
});
