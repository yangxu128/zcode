import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CanvasWorkspaceImage } from "./CanvasWorkspaceImage.js";

/**
 * 媒体预览灯箱（docs/ui/canvas-pane.md T7）。卡片里的视频只显示首帧、不常驻控制条，
 * 要看清细节或完整播放走这里；图片优先用工作区文件（外链会过期）。
 */
export interface CanvasMediaLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "image" | "video";
  url?: string;
  savedPath?: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export function CanvasMediaLightbox({
  open,
  onOpenChange,
  kind,
  url,
  savedPath,
  title,
  workspacePath,
  workspaceIdentity,
}: CanvasMediaLightboxProps) {
  const { intl } = useZCodeIntl();
  const label =
    title ||
    intl.formatMessage({ id: kind === "video" ? "canvas.node.video" : "canvas.node.image" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1100px,92vw)]">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">{label}</DialogDescription>
        <div className="zcode-canvas-lightbox-stage">
          {kind === "video" ? (
            url ? (
              <video
                src={url}
                className="max-h-[76vh] w-auto object-contain"
                controls
                autoPlay
                playsInline
              />
            ) : (
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "canvas.media.linkExpired" })}
              </p>
            )
          ) : savedPath ? (
            <CanvasWorkspaceImage
              workspacePath={workspacePath}
              {...(workspaceIdentity ? { workspaceIdentity } : {})}
              savedPath={savedPath}
              alt={label}
            />
          ) : (
            <img
              src={url}
              alt={label}
              className="max-h-[76vh] w-auto rounded-lg object-contain"
              draggable={false}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
