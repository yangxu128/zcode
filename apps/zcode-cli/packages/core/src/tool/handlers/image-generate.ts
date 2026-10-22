// ============================================================
// ImageGenerate Tool Handler
// ============================================================
// 生成模型的 agent 工具面。零 I/O、零凭据：执行与 apiKey 都在宿主
// GenerationPort（docs/agents/image-video-generation.md）。

import {
  ImageGenerateInputJsonSchema,
  ImageGenerateInputSchema,
  ImageGenerateOutputJsonSchema,
  type ImageGenerateOutput,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";
import {
  describeGenerationFailures,
  resolveGenerationCandidates,
  runWithGenerationFallback,
} from "./generation-targets.js";

const IMAGE_GENERATE_TOOL_NAME = "ImageGenerate";
// 宿主端口：单次请求 180s + 退避预算 220s，撞限流时还会排队等窗口，所以工具超时留到 330s。
const IMAGE_GENERATE_TIMEOUT_MS = 330_000;
const IMAGE_GENERATE_ERROR_CODE = { GENERATION_UNAVAILABLE: 41 } as const;

const IMAGE_GENERATE_DESCRIPTION = [
  "Generate an image from a text prompt using a configured image-generation model.",
  "",
  "- Omit `model` to try the configured image-generation models in order until one accepts the request.",
  "- Returns image URLs and/or workspace file paths for the generated images.",
  "- Only works when an image-generation model is configured in model settings.",
].join("\n");

function generationUnavailableFailure(): { result: false; errorCode: number; message: string } {
  return {
    result: false,
    errorCode: IMAGE_GENERATE_ERROR_CODE.GENERATION_UNAVAILABLE,
    message:
      "generation_unavailable: no image-generation model is configured or the host did not provide the generation capability. Add an image-generation model (output modality: image) in model settings first.",
  };
}

const imageGenerateHandler: ToolHandler = async (input, context) => {
  const parsed = ImageGenerateInputSchema.parse(input);
  const port = context.generationPort;
  if (port === undefined) return generationUnavailableFailure();

  const candidates = resolveGenerationCandidates(port, "image", parsed.model);
  if (candidates.length === 0) return generationUnavailableFailure();

  const attempt = await runWithGenerationFallback(
    candidates,
    (candidate) =>
      port.generateImage(
        { providerId: candidate.providerId, modelId: candidate.modelId },
        {
          prompt: parsed.prompt,
          ...(parsed.size === undefined ? {} : { size: parsed.size }),
          ...(parsed.ratio === undefined ? {} : { ratio: parsed.ratio }),
          ...(parsed.image === undefined ? {} : { image: parsed.image }),
        },
      ),
    context.abortSignal,
  );
  if (!attempt.ok) {
    return {
      result: false,
      errorCode: IMAGE_GENERATE_ERROR_CODE.GENERATION_UNAVAILABLE,
      message: `generation_failed: ${describeGenerationFailures(attempt.failures)}`,
    };
  }

  const output: ImageGenerateOutput = {
    model: `${attempt.target.providerId}/${attempt.result.modelId}`,
    images: [...attempt.result.images],
  };
  return output;
};

export const imageGenerateToolEntry: ToolEntry = {
  capability: "Generate an image from a text prompt with a configured image-generation model",
  metadata: {
    name: IMAGE_GENERATE_TOOL_NAME,
    description: IMAGE_GENERATE_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
    sideEffectScope: "network",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: imageGenerateHandler,
  inputSchema: ImageGenerateInputJsonSchema,
  outputSchema: ImageGenerateOutputJsonSchema,
  runtimeInputSchema: ImageGenerateInputSchema,
  runtimeOutputSchema: ImageGenerateOutputJsonSchema,
  resultBudget: {
    maxInlineBytes: 24_000,
    maxModelBytes: 24_000,
    strategy: "truncate",
  },
  timeout: {
    defaultMs: IMAGE_GENERATE_TIMEOUT_MS,
    maxMs: IMAGE_GENERATE_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "ImageGenerate was cancelled before the request completed",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
  permission: {
    permission: "image-generate",
    reason: "ImageGenerate performs an outbound image-generation API request",
    riskLevel: "medium",
    sideEffectScope: "network",
    needsApproval: true,
    patternSources: ["network"],
    alwaysAllowPatternSources: ["network"],
    denyPriority: "beforeAsk",
  },
};
