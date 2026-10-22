import { useRef, useState } from "react";
import { ImagePlus, Play, Sparkles } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { downscaleImageToDataUrl } from "@/lib/canvasBrowserStorage.js";
import type { CanvasNode } from "@/lib/canvasDocument.js";
import { CanvasWorkspaceImage } from "./CanvasWorkspaceImage.js";
import { describeCanvasMediaStage, pickImageSource } from "./canvasMediaStage.js";
import { queueWaitRemainingMs } from "./canvasVideoQueue.js";
import { useMediaAspect } from "./useMediaAspect.js";

/**
 * 图片/视频节点的正文渲染（T4/T5/T7）。卡片只负责呈现媒体与状态，生成入口在选中后的
 * 浮层对话框里（CanvasMediaDialog）——把 prompt 输入、两个档位下拉和按钮塞进卡片，
 * 16:9 的节点会被挤成一条缩略图，这是用户实测反馈的问题。
 */
export interface CanvasMediaBodyProps {
  node: CanvasNode;
  workspacePath?: string;
  workspaceIdentity?: string;
  onUpdate: (patch: Partial<CanvasNode>) => void;
  /** 读到媒体固有尺寸后回调：卡片按此比例贴合，避免竖屏视频两侧留大灰边（T7）。 */
  onFitAspect?: (aspect: number) => void;
}

/** 外链图片：固有宽高比通过 useMediaAspect 报出去，让卡片按出片比例贴合。 */
function RemoteImage({
  src,
  alt,
  onAspect,
}: {
  src: string;
  alt: string;
  onAspect?: (aspect: number) => void;
}) {
  const ref = useRef<HTMLImageElement | null>(null);
  useMediaAspect(ref, src, onAspect);
  return (
    <img ref={ref} src={src} alt={alt} className="size-full object-contain" draggable={false} />
  );
}

export function CanvasMediaBody({
  node,
  workspacePath,
  workspaceIdentity,
  onUpdate,
  onFitAspect,
}: CanvasMediaBodyProps) {
  const { intl } = useZCodeIntl();
  const stage = describeCanvasMediaStage(node);
  if (!stage) return null;
  const identityProps = workspaceIdentity ? { workspaceIdentity } : {};

  if (stage.stage === "image" && node.kind === "image") {
    const source = pickImageSource(node);
    return (
      <Stage busy={stage.busy}>
        {source.savedPath ? (
          <CanvasWorkspaceImage
            workspacePath={workspacePath ?? ""}
            {...identityProps}
            savedPath={source.savedPath}
            alt={node.caption || node.title}
            onAspect={onFitAspect}
          />
        ) : (
          <RemoteImage
            src={source.url ?? ""}
            alt={node.caption || node.title}
            onAspect={onFitAspect}
          />
        )}
      </Stage>
    );
  }

  if (stage.stage === "video" && node.kind === "video") {
    return (
      <VideoStage
        src={node.url}
        seconds={node.generation?.seconds}
        busy={stage.busy}
        onFitAspect={onFitAspect}
      />
    );
  }

  if (stage.stage === "video-local" && node.kind === "video") {
    // 外链会过期，本地文件是几十 MB 级：不把字节读成 data URL 塞进卡片，如实说明并给出路。
    return (
      <Stage busy={stage.busy}>
        <div className="flex size-full flex-col items-center justify-center gap-1 px-3 text-center">
          <Play className="size-5 text-foreground-subtlest" />
          <p className="text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "canvas.media.linkExpired" })}
          </p>
          <p
            className="max-w-full truncate text-ui-xs text-foreground-subtlest"
            title={node.savedPath}
          >
            {node.savedPath}
          </p>
        </div>
      </Stage>
    );
  }

  if (stage.stage === "queued") {
    // 排队中不是失败：创建被服务商暂时拒收（免费档账号级限流），面板级驱动会自动重投。
    // 把「下一次大约几点再投」写出来，用户才知道系统在替他等，而不是卡死了。
    const remainingMs =
      node.kind === "video" ? queueWaitRemainingMs(node.generation, Date.now()) : undefined;
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 rounded-lg bg-surface-hover/60 px-3 text-center">
        <Sparkles className="size-5 animate-pulse text-primary" />
        <p className="text-ui-xs text-foreground-subtle">
          {remainingMs !== undefined && remainingMs > 0
            ? intl.formatMessage(
                { id: "canvas.video.queuedIn" },
                { minutes: Math.max(1, Math.ceil(remainingMs / 60_000)) },
              )
            : intl.formatMessage({ id: "canvas.video.queued" })}
        </p>
        {stage.queuedReason ? (
          <p
            className="line-clamp-2 text-ui-xs text-foreground-subtlest"
            title={stage.queuedReason}
          >
            {stage.queuedReason}
          </p>
        ) : null}
      </div>
    );
  }

  if (stage.stage === "running") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 rounded-lg bg-surface-hover/60">
        <Sparkles className="size-5 animate-pulse text-primary" />
        <p className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({
            id: node.kind === "video" ? "canvas.video.running" : "canvas.image.generate.running",
          })}
        </p>
      </div>
    );
  }

  if (stage.stage === "failed") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-danger/40 px-3 text-center">
        <p className="text-ui-xs font-medium text-danger">
          {intl.formatMessage({ id: "canvas.image.generate.failed" })}
        </p>
        <p
          className="line-clamp-3 text-ui-xs text-foreground-subtlest"
          title={stage.error ?? undefined}
        >
          {stage.error ?? intl.formatMessage({ id: "canvas.media.retryHint" })}
        </p>
      </div>
    );
  }

  // empty：图片仍可本地上传；视频没有本地上传通路，提示选中卡片后在浮层里写提示词。
  return (
    <div className="flex size-full items-center justify-center">
      {node.kind === "image" && workspacePath ? (
        <label className="flex size-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-foreground-subtle hover:bg-surface-hover">
          <ImagePlus className="size-5" />
          <span className="text-ui-xs">{intl.formatMessage({ id: "canvas.image.pick" })}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              // 降采样为 data URL 以便持久化；解码失败保持空占位，不中断编辑。
              downscaleImageToDataUrl(file)
                .then((url) => onUpdate({ url } as Partial<CanvasNode>))
                .catch(() => undefined);
            }}
          />
        </label>
      ) : (
        <div className="flex flex-col items-center gap-1 text-center">
          {node.kind === "video" ? <Play className="size-5 text-foreground-subtlest" /> : null}
          <p className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({
              id: node.kind === "video" ? "canvas.video.empty" : "canvas.media.selectHint",
            })}
          </p>
        </div>
      )}
    </div>
  );
}

/** 媒体层容器：占满正文、裁剪圆角，忙时叠一层进度遮罩而不是换掉画面。 */
function Stage({
  busy,
  dark = false,
  children,
}: {
  busy: boolean;
  dark?: boolean;
  children: React.ReactNode;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className={`zcode-canvas-media-stage${dark ? " bg-black" : ""}`}>
      {children}
      {busy ? (
        <div className="zcode-canvas-media-busy">
          <Sparkles className="size-4 animate-pulse text-primary" />
          <span>{intl.formatMessage({ id: "canvas.image.generate.running" })}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 视频默认只当图片用：不常驻控制条（原生控制条会把 16:9 卡片压成一条黑带），
 * 首帧 + 中央播放键，点开才进入播放态。留白用黑底、遮罩不染色，否则读起来像脏灰斑。
 */
function VideoStage({
  src,
  seconds,
  busy,
  onFitAspect,
}: {
  src: string;
  seconds?: string;
  busy: boolean;
  onFitAspect?: (aspect: number) => void;
}) {
  const { intl } = useZCodeIntl();
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useMediaAspect(videoRef, src, onFitAspect);
  return (
    <Stage busy={busy} dark>
      <video
        ref={videoRef}
        src={src}
        className="size-full object-contain"
        controls={playing}
        playsInline
        preload="metadata"
        autoPlay={playing}
        onEnded={() => setPlaying(false)}
      />
      {playing ? null : (
        <>
          <button
            type="button"
            aria-label={intl.formatMessage({ id: "canvas.media.play" })}
            className="absolute inset-0 z-10 flex items-center justify-center"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPlaying(true)}
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/30 transition-colors hover:bg-black/70">
              <Play className="size-5" />
            </span>
          </button>
          {seconds ? (
            <span className="pointer-events-none absolute bottom-1.5 right-2 z-20 rounded bg-black/55 px-1.5 py-0.5 text-ui-xs text-white">
              {seconds}s
            </span>
          ) : null}
        </>
      )}
    </Stage>
  );
}
