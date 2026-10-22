// ============================================================
// VideoGenerate Tool Handler
// ============================================================
// 异步任务型生成：创建任务后轮询直到完成或超时。零 I/O、零凭据，
// 执行与 apiKey 都在宿主 GenerationPort（docs/agents/image-video-generation.md）。

import {
  VideoGenerateInputJsonSchema,
  VideoGenerateInputSchema,
  VideoGenerateOutputJsonSchema,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";
import {
  describeGenerationFailures,
  resolveGenerationCandidates,
  runWithGenerationFallback,
} from "./generation-targets.js";

const VIDEO_GENERATE_TOOL_NAME = "VideoGenerate";
/**
 * 宿主端口的轮询上限是 30 分钟（免费档排队 + 出片实测十几二十分钟），
 * 工具超时必须比它长，否则任务还在正常跑就被工具判死。
 */
const VIDEO_GENERATE_TIMEOUT_MS = 33 * 60_000;
const VIDEO_GENERATE_ERROR_CODE = { GENERATION_UNAVAILABLE: 42 } as const;

const VIDEO_GENERATE_DESCRIPTION = [
  "Generate a video from a text prompt using a configured video-generation model (async task, may take minutes).",
  "",
  "- Omit `model` to try the configured video-generation models in order until one accepts the request.",
  "- Returns the video URL when the task completes.",
  "- Only works when a video-generation model is configured in model settings.",
].join("\n");

function generationUnavailableFailure(): { result: false; errorCode: number; message: string } {
  return {
    result: false,
    errorCode: VIDEO_GENERATE_ERROR_CODE.GENERATION_UNAVAILABLE,
    message:
      "generation_unavailable: no video-generation model is configured or the host did not provide the generation capability. Add a video-generation model (output modality: video) in model settings first.",
  };
}

const videoGenerateHandler: ToolHandler = async (input, context) => {
  const parsed = VideoGenerateInputSchema.parse(input);
  const port = context.generationPort;
  if (port === undefined) return generationUnavailableFailure();

  const candidates = resolveGenerationCandidates(port, "video", parsed.model);
  if (candidates.length === 0) return generationUnavailableFailure();

  const attempt = await runWithGenerationFallback(
    candidates,
    (candidate) =>
      port.generateVideo(
        { providerId: candidate.providerId, modelId: candidate.modelId },
        {
          prompt: parsed.prompt,
          mode: "text",
          ...(parsed.seconds === undefined ? {} : { seconds: parsed.seconds }),
          ...(parsed.aspect_ratio === undefined ? {} : { aspect_ratio: parsed.aspect_ratio }),
        },
      ),
    context.abortSignal,
  );
  if (!attempt.ok) {
    return {
      result: false,
      errorCode: VIDEO_GENERATE_ERROR_CODE.GENERATION_UNAVAILABLE,
      message: `generation_failed: ${describeGenerationFailures(attempt.failures)}`,
    };
  }

  return {
    model: `${attempt.target.providerId}/${attempt.result.modelId}`,
    videoId: attempt.result.videoId,
    url: attempt.result.url,
  };
};

export const videoGenerateToolEntry: ToolEntry = {
  capability: "Generate a video from a text prompt with a configured video-generation model",
  metadata: {
    name: VIDEO_GENERATE_TOOL_NAME,
    description: VIDEO_GENERATE_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: VIDEO_GENERATE_TIMEOUT_MS,
    sideEffectScope: "network",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: videoGenerateHandler,
  inputSchema: VideoGenerateInputJsonSchema,
  outputSchema: VideoGenerateOutputJsonSchema,
  runtimeInputSchema: VideoGenerateInputSchema,
  runtimeOutputSchema: VideoGenerateOutputJsonSchema,
  resultBudget: {
    maxInlineBytes: 4_000,
    maxModelBytes: 4_000,
    strategy: "truncate",
  },
  timeout: {
    defaultMs: VIDEO_GENERATE_TIMEOUT_MS,
    maxMs: VIDEO_GENERATE_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage:
      "VideoGenerate was cancelled; the generation task may still complete on the provider side",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
  permission: {
    permission: "video-generate",
    reason: "VideoGenerate performs outbound video-generation API requests with polling",
    riskLevel: "medium",
    sideEffectScope: "network",
    needsApproval: true,
    patternSources: ["network"],
    alwaysAllowPatternSources: ["network"],
    denyPriority: "beforeAsk",
  },
};
