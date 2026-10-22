import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useMediaAspect } from "./useMediaAspect.js";

/**
 * 显示落在工作区里的生成结果（docs/ui/canvas-pane.md T4）。
 * 走 `fileService.readMediaPreview` 而不是自造 URL：与 markdown 本地图片同一通路，
 * 桌面与 web 都能读，像素不进画布文档。读取失败（超上限/无权限）时退化为路径提示，
 * 不显示破图。
 */
export interface CanvasWorkspaceImageProps {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 工作区相对路径，如 `.zcode/generated/x.png`。 */
  savedPath: string;
  alt: string;
  /** 解码完成后回传固有宽高比，供卡片按媒体比例贴合（T7）。 */
  onAspect?: (aspect: number) => void;
}

function toAbsolutePath(workspacePath: string, savedPath: string): string {
  // 与 buildCanvasFilePath 同一约定：分隔符统一 "/"，Windows fs 同样接受。
  return `${workspacePath.replace(/[\\/]+$/, "")}/${savedPath.replace(/^\.?\//, "")}`;
}

export function CanvasWorkspaceImage({
  workspacePath,
  workspaceIdentity,
  savedPath,
  alt,
  onAspect,
}: CanvasWorkspaceImageProps) {
  const { intl } = useZCodeIntl();
  const { fileService } = useWorkspaceServices(workspacePath, undefined, workspaceIdentity);
  const [src, setSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Hook 必须在提前 return 之前调用；src 还没读出来时 ref 为空，hook 内部会跳过。
  useMediaAspect(imgRef, src ?? undefined, onAspect);

  useEffect(() => {
    if (!fileService) {
      setSrc(null);
      return;
    }
    let disposed = false;
    setSrc(null);
    void fileService
      .readMediaPreview({ path: toAbsolutePath(workspacePath, savedPath) })
      .then((preview) => {
        if (!disposed) setSrc(`data:${preview.mediaType};base64,${preview.dataBase64}`);
      })
      .catch(() => {
        if (!disposed) setSrc(null);
      });
    return () => {
      disposed = true;
    };
  }, [fileService, savedPath, workspacePath]);

  if (src) {
    return (
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="min-h-0 flex-1 rounded-lg object-contain"
        draggable={false}
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-2 text-center text-foreground-subtle">
      <ImageOff className="size-5" />
      <span className="text-ui-xs">
        {intl.formatMessage({ id: "canvas.image.previewUnavailable" }, { path: savedPath })}
      </span>
    </div>
  );
}
