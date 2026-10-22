// ============================================================
// 工作区级生图：画布节点内生成的执行入口
// ============================================================
// 与 ImageGenerate 工具共用同一份候选解析与顺序回退（tool/handlers/generation-targets.ts），
// 区别只是调用方是 UI 而不是模型。生成执行与凭据都在宿主 GenerationPort，
// core 不碰 HTTP 与 apiKey（docs/agents/image-video-generation.md、docs/ui/canvas-pane.md T4）。

import {
  describeGenerationFailures,
  resolveGenerationCandidates,
  runWithGenerationFallback,
} from "../../tool/handlers/generation-targets.js";
import type { AgentRuntimeInternal } from "../internal.js";

export interface WorkspaceGenerateImageInput {
  prompt: string;
  /** 档位（1K/2K/3K/4K）或精确尺寸。 */
  size?: string;
  ratio?: string;
  /** 图生图/多图合成的参考图。 */
  image?: readonly string[];
  /** 点名的生成模型 `providerId/modelId`；缺席时按候选顺序回退。 */
  model?: string;
}

export interface WorkspaceGenerateImageResult {
  /** 实际命中的 `providerId/modelId`。 */
  model: string;
  images: { url?: string; savedPath?: string }[];
}

export interface WorkspaceSaveMediaInput {
  url: string;
}

export interface WorkspaceSaveMediaResult {
  savedPath: string;
  /** 同名文件已存在即复用，重试不会重复下载。 */
  reused: boolean;
}

/** 把生成端外链落到工作区（画布 T6）；图片与视频共用这一条。 */
export async function saveWorkspaceGeneratedMedia(
  this: AgentRuntimeInternal,
  input: WorkspaceSaveMediaInput,
): Promise<WorkspaceSaveMediaResult> {
  const port = this.generationPort;
  if (!port) {
    throw new Error("generation_unavailable: 当前运行环境未装配生成端口");
  }
  return port.materializeMedia(input.url);
}

export async function generateWorkspaceImage(
  this: AgentRuntimeInternal,
  input: WorkspaceGenerateImageInput,
  options?: { abortSignal?: AbortSignal },
): Promise<WorkspaceGenerateImageResult> {
  const port = this.generationPort;
  if (!port) {
    throw new Error("generation_unavailable: 当前运行环境未装配生成端口");
  }
  const candidates = resolveGenerationCandidates(port, "image", input.model);
  if (candidates.length === 0) {
    throw new Error(
      "generation_unavailable: 没有可用的生图模型，请先在模型设置添加输出模态为「生图」的模型",
    );
  }
  const attempt = await runWithGenerationFallback(
    candidates,
    (candidate) =>
      port.generateImage(
        { providerId: candidate.providerId, modelId: candidate.modelId },
        {
          prompt: input.prompt,
          ...(input.size === undefined ? {} : { size: input.size }),
          ...(input.ratio === undefined ? {} : { ratio: input.ratio }),
          ...(input.image === undefined ? {} : { image: input.image }),
        },
      ),
    options?.abortSignal,
  );
  if (!attempt.ok) {
    throw new Error(`generation_failed: ${describeGenerationFailures(attempt.failures)}`);
  }
  return {
    model: `${attempt.target.providerId}/${attempt.result.modelId}`,
    images: [...attempt.result.images],
  };
}
