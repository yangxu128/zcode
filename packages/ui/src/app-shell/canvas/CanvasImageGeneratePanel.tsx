import { useCallback, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CanvasGeneration, CanvasImageNode } from "@/lib/canvasDocument.js";
import { materializeGeneratedMedia } from "./canvasMediaMaterialize.js";
import { nearestRatioOption } from "./canvasMediaStage.js";
import { useRatioFrame } from "./useRatioFrame.js";

/**
 * 图片节点的生成面板（docs/ui/canvas-pane.md T4/T6）。
 * 执行在宿主：UI 只交 prompt 与档位，生成模型由服务端按注册表候选解析，凭据不进协议参数。
 * 结果先取外链再尽力落到工作区；compact 形态用于「已有结果 + 再来一张」，复用节点上
 * 已存的 prompt 与档位，不新建节点。
 */

/** 生图是分钟级请求：宿主侧还有排队与退避预算，客户端超时必须盖住它们。 */
const CANVAS_IMAGE_GENERATE_TIMEOUT_MS = 330_000;
const SIZE_OPTIONS = ["1K", "2K", "3K", "4K"] as const;
const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;

export interface CanvasImageGeneratePanelProps {
  node: CanvasImageNode;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 上游连线解析出的参考图（URL 或工作区相对路径）；非空时走图生图。 */
  references?: string[];
  /** 节点上已有结果：按钮改成「再来一张」，复用已存的提示词与档位覆盖式再跑一次。 */
  hasResult?: boolean;
  onUpdate: (patch: Partial<CanvasImageNode>) => void;
}

export function CanvasImageGeneratePanel({
  node,
  workspacePath,
  workspaceIdentity,
  references = [],
  hasResult = false,
  onUpdate,
}: CanvasImageGeneratePanelProps) {
  const { intl } = useZCodeIntl();
  const { zcodeAgentService } = useWorkspaceServices(workspacePath, undefined, workspaceIdentity);
  const [prompt, setPrompt] = useState(node.generation?.prompt ?? "");
  const [size, setSize] = useState<string>(node.generation?.size ?? "1K");
  const [ratio, setRatio] = useState<string>(
    () => node.generation?.ratio ?? nearestRatioOption(node.w / node.h, RATIO_OPTIONS) ?? "1:1",
  );
  const running = node.generation?.status === "running";
  // 画幅决定卡片形状（即梦式）：换档位立刻改框，空卡挂载时也按默认 1:1 预占位。
  useRatioFrame(node, ratio, onUpdate);

  const generate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    const base: CanvasGeneration = { status: "running", prompt: trimmed, size, ratio };
    onUpdate({ generation: base });
    const identityProps = workspaceIdentity ? { workspaceIdentity } : {};
    try {
      const result = await zcodeAgentService.generateWorkspaceImage({
        workspacePath,
        ...identityProps,
        prompt: trimmed,
        size,
        ratio,
        ...(references.length ? { image: references } : {}),
        requestTimeoutMs: CANVAS_IMAGE_GENERATE_TIMEOUT_MS,
      });
      const image = result.images[0] ?? {};
      // 外链会过期：能落地就同时写引用，渲染优先工作区文件；落地失败保留 url 不算失败。
      const savedPath = image.url
        ? await materializeGeneratedMedia({
            service: zcodeAgentService,
            workspacePath,
            ...identityProps,
            url: image.url,
          })
        : undefined;
      onUpdate({
        url: image.url ?? "",
        ...(savedPath || image.savedPath ? { savedPath: savedPath ?? image.savedPath } : {}),
        caption: node.caption || trimmed.slice(0, 40),
        generation: { ...base, status: "idle", model: result.model },
      });
    } catch (error) {
      // 失败保留 prompt 与原因原文（含 request id），用户可直接重试。
      onUpdate({
        generation: {
          ...base,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, [
    node.caption,
    onUpdate,
    prompt,
    ratio,
    references,
    running,
    size,
    workspaceIdentity,
    workspacePath,
    zcodeAgentService,
  ]);

  const actionLabel = intl.formatMessage({
    id: running
      ? "canvas.image.generate.running"
      : hasResult
        ? "canvas.image.regenerate"
        : "canvas.image.generate.action",
  });

  return (
    <div className="flex h-full flex-col gap-1.5">
      <textarea
        value={prompt}
        placeholder={intl.formatMessage({ id: "canvas.image.generatePlaceholder" })}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={running}
        className="zcode-canvas-editable min-h-0 flex-1 resize-none rounded-lg bg-transparent text-ui-sm leading-5 text-foreground outline-none placeholder:text-foreground-subtlest disabled:opacity-60"
      />
      <div className="flex shrink-0 items-center gap-1">
        <select
          value={size}
          onChange={(event) => setSize(event.target.value)}
          disabled={running}
          className="rounded-md border border-border bg-transparent px-1 text-ui-xs text-foreground-subtle outline-none"
        >
          {SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
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
          onClick={() => void generate()}
          disabled={running || !prompt.trim()}
          title={actionLabel}
          className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-ui-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          {actionLabel}
        </button>
      </div>
      {node.generation?.status === "failed" ? (
        <p className="shrink-0 truncate text-ui-xs text-danger" title={node.generation.error}>
          {node.generation.error || intl.formatMessage({ id: "canvas.image.generate.failed" })}
        </p>
      ) : null}
    </div>
  );
}
