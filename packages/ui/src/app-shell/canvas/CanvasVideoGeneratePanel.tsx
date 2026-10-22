import { useCallback, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CanvasVideoNode } from "@/lib/canvasDocument.js";
import { nearestRatioOption } from "./canvasMediaStage.js";
import { useRatioFrame } from "./useRatioFrame.js";

/**
 * 视频节点的生成面板（docs/ui/canvas-pane.md T5）。
 * 只负责「创建任务」：返回的 task 身份写进节点，轮询由面板级的
 * useCanvasVideoTasks 统一驱动，这样刷新或换端后能继续查同一个任务，
 * 而不是每个卡片各自持有一个会被卸载的定时器。
 */
/**
 * 创建任务的 RPC 超时。宿主在撞上限流时会自动等满限流窗口再提交（免费档生视频约
 * 1 次/分钟），所以这里必须比「排队上限 + 创建预算」更长，否则用户看到的就是
 * "Protocol request timed out" 而不是系统在替他等（2026-10-12 实测踩过）。
 */
const START_VIDEO_TIMEOUT_MS = 150_000;
const SECONDS_OPTIONS = ["4", "5", "6", "8", "10", "12"] as const;
const RATIO_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

export interface CanvasVideoGeneratePanelProps {
  node: CanvasVideoNode;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 上游连线解析出的首帧（URL 或 data URI）；有值时按 keyframe 模式创建。 */
  firstFrame?: string;
  /** 节点上已有结果：按钮改成「重新生成」，复用已存的提示词与档位覆盖式再跑一次。 */
  hasResult?: boolean;
  onUpdate: (patch: Partial<CanvasVideoNode>) => void;
}

export function CanvasVideoGeneratePanel({
  node,
  workspacePath,
  workspaceIdentity,
  firstFrame,
  hasResult = false,
  onUpdate,
}: CanvasVideoGeneratePanelProps) {
  const { intl } = useZCodeIntl();
  const { zcodeAgentService } = useWorkspaceServices(workspacePath, undefined, workspaceIdentity);
  const [prompt, setPrompt] = useState(node.generation?.prompt ?? "");
  const [seconds, setSeconds] = useState(node.generation?.seconds ?? "5");
  const [ratio, setRatio] = useState(
    () => node.generation?.ratio ?? nearestRatioOption(node.w / node.h, RATIO_OPTIONS) ?? "16:9",
  );
  const running = node.generation?.status === "running";
  // 画幅决定卡片形状（即梦式）：选 9:16 卡片立刻变竖框，不等出片。
  useRatioFrame(node, ratio, onUpdate);

  const start = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    const base = {
      status: "running" as const,
      prompt: trimmed,
      seconds,
      ratio,
      startedAt: Date.now(),
      // 这条创建请求还在飞的时候就把「下一次可再投时刻」推到本次超时之后：
      // running 且没有 task 正是排队判据，不预留的话面板级驱动会把同一个节点再投一次，
      // 自己撞出两个并发创建（免费档那 1 次/分钟的额度就是这么被打光的）。
      retryAt: Date.now() + START_VIDEO_TIMEOUT_MS,
    };
    onUpdate({ generation: base });
    try {
      const result = await zcodeAgentService.startWorkspaceVideo({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        prompt: trimmed,
        seconds,
        aspectRatio: ratio,
        ...(firstFrame ? { firstFrame } : {}),
        requestTimeoutMs: START_VIDEO_TIMEOUT_MS,
      });
      // 排队：服务商这次没收（限流/繁忙/连不上）。节点保持 running 并记下 retryAt，
      // 由面板级驱动 useCanvasVideoTasks 自动重投——不把「稍后再试」甩回给用户手动点。
      if (result.status === "queued") {
        onUpdate({
          generation: {
            ...base,
            retryAt: Date.now() + result.retryAfterMs,
            queuedReason: result.reason,
          },
        });
        return;
      }
      // 任务身份必须落在节点上：这是刷新后还能继续查的依据。
      // 占位的 retryAt 一起清掉：有了 task 就归轮询管，文档里不该留着调度时间。
      onUpdate({
        generation: {
          ...base,
          model: result.model,
          retryAt: undefined,
          task: {
            providerId: result.providerId,
            modelId: result.modelId,
            videoId: result.videoId,
          },
        },
      });
    } catch (error) {
      onUpdate({
        generation: {
          ...base,
          status: "failed",
          retryAt: undefined,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, [
    firstFrame,
    onUpdate,
    prompt,
    ratio,
    running,
    seconds,
    workspaceIdentity,
    workspacePath,
    zcodeAgentService,
  ]);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <textarea
        value={prompt}
        placeholder={intl.formatMessage({ id: "canvas.video.generatePlaceholder" })}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={running}
        className="zcode-canvas-editable min-h-0 flex-1 resize-none rounded-lg bg-transparent text-ui-sm leading-5 text-foreground outline-none placeholder:text-foreground-subtlest disabled:opacity-60"
      />
      {firstFrame ? (
        <p className="shrink-0 truncate text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "canvas.video.usingReference" })}
        </p>
      ) : null}
      <div className="flex shrink-0 items-center gap-1">
        <select
          value={seconds}
          onChange={(event) => setSeconds(event.target.value)}
          disabled={running}
          className="rounded-md border border-border bg-transparent px-1 text-ui-xs text-foreground-subtle outline-none"
        >
          {SECONDS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}s
            </option>
          ))}
        </select>
        <select
          value={ratio}
          onChange={(event) => setRatio(event.target.value)}
          disabled={running}
          className="rounded-md border border-border bg-transparent px-1 text-ui-xs text-foreground-subtle outline-none"
        >
          {RATIO_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void start()}
          disabled={running || !prompt.trim()}
          className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-ui-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          {intl.formatMessage({
            id: running
              ? "canvas.video.running"
              : hasResult
                ? "canvas.video.regenerate"
                : "canvas.video.generate",
          })}
        </button>
      </div>
      {node.generation?.status === "failed" ? (
        <p className="shrink-0 truncate text-ui-xs text-danger" title={node.generation.error}>
          {node.generation.error}
        </p>
      ) : null}
    </div>
  );
}
