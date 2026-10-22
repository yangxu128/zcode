// ============================================================
// 工作区级生视频：画布视频节点的创建与查询
// ============================================================
// 与 ImageGenerate 分工不同：视频是分钟级异步任务，UI 不能靠一条阻塞 RPC 等到底，
// 否则刷新/切窗就丢任务。这里把「创建」和「查询」拆成两个方法，任务身份（provider/
// model/videoId）由画布节点自己持久化，恢复时继续查同一个任务。
// 工具面（VideoGenerate）仍然用 GenerationPort.generateVideo 的创建+轮询便捷面。

import {
  describeGenerationFailures,
  resolveGenerationCandidates,
  runWithGenerationFallback,
} from "../../tool/handlers/generation-targets.js";
import type { VideoTaskOutcome } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";

export interface WorkspaceStartVideoInput {
  prompt: string;
  seconds?: string;
  aspectRatio?: string;
  /** 首帧（URL 或 data URI）；提供时按 keyframe 模式创建。 */
  firstFrame?: string;
  model?: string;
}

export interface WorkspaceStartVideoCreated {
  status: "created";
  model: string;
  providerId: string;
  modelId: string;
  videoId: string;
}

/** 服务商这次没收（限流 / 繁忙 / 连不上）：不是失败，调用方按 retryAfterMs 自动重投。 */
export interface WorkspaceStartVideoQueued {
  status: "queued";
  reason: string;
  retryAfterMs: number;
}

export type WorkspaceStartVideoResult = WorkspaceStartVideoCreated | WorkspaceStartVideoQueued;

export interface WorkspaceVideoTaskInput {
  providerId: string;
  modelId: string;
  videoId: string;
}

export async function startWorkspaceVideo(
  this: AgentRuntimeInternal,
  input: WorkspaceStartVideoInput,
  options?: { abortSignal?: AbortSignal },
): Promise<WorkspaceStartVideoResult> {
  const port = this.generationPort;
  if (!port) {
    throw new Error("generation_unavailable: 当前运行环境未装配生成端口");
  }
  const candidates = resolveGenerationCandidates(port, "video", input.model);
  if (candidates.length === 0) {
    throw new Error(
      "generation_unavailable: 没有可用的生视频模型，请先在模型设置添加输出模态为「生视频」的模型",
    );
  }
  // 排队结果不往下一个候选传：限流是账号级的，换候选只会再吃一次 429。
  // 硬失败（参数、鉴权、模型不可用）仍按既有语义逐个候选回退。
  const attempt = await runWithGenerationFallback(
    candidates,
    async (candidate) => ({
      candidate,
      started: await port.startVideo(
        { providerId: candidate.providerId, modelId: candidate.modelId },
        {
          prompt: input.prompt,
          mode: input.firstFrame ? "keyframe" : "text",
          ...(input.firstFrame ? { firstFrame: input.firstFrame } : {}),
          ...(input.seconds === undefined ? {} : { seconds: input.seconds }),
          ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
        },
      ),
    }),
    options?.abortSignal,
  );
  if (!attempt.ok) {
    throw new Error(`generation_failed: ${describeGenerationFailures(attempt.failures)}`);
  }
  const { candidate, started } = attempt.result;
  if (started.status === "queued") {
    return { status: "queued", reason: started.reason, retryAfterMs: started.retryAfterMs };
  }
  return {
    status: "created",
    model: `${candidate.providerId}/${candidate.modelId}`,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    videoId: started.videoId,
  };
}

export async function getWorkspaceVideoTask(
  this: AgentRuntimeInternal,
  input: WorkspaceVideoTaskInput,
): Promise<VideoTaskOutcome> {
  const port = this.generationPort;
  if (!port) {
    throw new Error("generation_unavailable: 当前运行环境未装配生成端口");
  }
  return port.getVideoStatus(
    { providerId: input.providerId, modelId: input.modelId },
    input.videoId,
  );
}
