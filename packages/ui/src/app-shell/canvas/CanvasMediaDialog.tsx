import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CanvasImageNode, CanvasNode, CanvasVideoNode } from "@/lib/canvasDocument.js";
import { CanvasImageGeneratePanel } from "./CanvasImageGeneratePanel.js";
import { CanvasVideoGeneratePanel } from "./CanvasVideoGeneratePanel.js";

/**
 * 选中媒体节点后浮在卡片下方的生成对话框（docs/ui/canvas-pane.md T7，即梦式）。
 * 它只是外壳：提示词、档位与生成逻辑仍在那两个 panel 里，RPC 与状态写入路径不变，
 * 所以不会出现第二份生成实现。
 */
export interface CanvasMediaDialogProps {
  node: CanvasImageNode | CanvasVideoNode;
  x: number;
  y: number;
  width: number;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 上游连线解析出的参考素材（图片节点用数组，视频节点取第一张作首帧）。 */
  references: string[];
  onUpdate: (patch: Partial<CanvasNode>) => void;
}

export function CanvasMediaDialog({
  node,
  x,
  y,
  width,
  workspacePath,
  workspaceIdentity,
  references,
  onUpdate,
}: CanvasMediaDialogProps) {
  const { intl } = useZCodeIntl();
  const identityProps = workspaceIdentity ? { workspaceIdentity } : {};
  const isVideo = node.kind === "video";
  return (
    <div
      className="zcode-canvas-media-dialog"
      style={{ left: x, top: y, width }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        value={node.caption}
        placeholder={intl.formatMessage({
          id: isVideo ? "canvas.placeholder.captionVideo" : "canvas.placeholder.caption",
        })}
        onChange={(event) => onUpdate({ caption: event.target.value } as Partial<CanvasNode>)}
        className="mb-1 w-full shrink-0 bg-transparent text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest"
      />
      <div className="h-[132px]">
        {isVideo ? (
          <CanvasVideoGeneratePanel
            // 面板把 prompt/档位存在本地 state：换节点必须重挂载，否则会把上一张卡的
            // 提示词带进这张卡。
            key={node.id}
            node={node as CanvasVideoNode}
            workspacePath={workspacePath}
            {...identityProps}
            {...(references[0] ? { firstFrame: references[0] } : {})}
            hasResult={!!node.url || !!node.savedPath}
            onUpdate={(patch) => onUpdate(patch as Partial<CanvasNode>)}
          />
        ) : (
          <CanvasImageGeneratePanel
            key={node.id}
            node={node as CanvasImageNode}
            workspacePath={workspacePath}
            {...identityProps}
            references={references}
            hasResult={!!node.url || !!node.savedPath}
            onUpdate={(patch) => onUpdate(patch as Partial<CanvasNode>)}
          />
        )}
      </div>
    </div>
  );
}
