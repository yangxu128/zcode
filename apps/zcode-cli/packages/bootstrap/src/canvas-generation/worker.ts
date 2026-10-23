// Agent 侧画布生成 worker（docs/agents/image-video-generation.md「意图与执行分离」）。
// 它跑在 agent 进程里，直接持有 GenerationPort（凭据与限流队列都在这里），
// 监听工作区画布文档中的 generation.request，执行后把结果写回同一份文档。
import type { GenerationPort, GenerationTarget } from "@zcode/contracts";
import {
  canvasDirectory,
  patchCanvasGeneration,
  pendingCanvasRequests,
  readCanvasDocuments,
  type CanvasGenerationRequest,
} from "./doc.js";

export interface CanvasGenerationWorkerLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
}

export interface CanvasGenerationWorkerOptions {
  port: Pick<GenerationPort, "listTargets" | "generateImage" | "generateVideo">;
  workspacePath: string;
  logger?: CanvasGenerationWorkerLogger;
  /** 扫描间隔；测试可调小。 */
  intervalMs?: number;
}

export interface CanvasGenerationWorker {
  /** 扫描一轮；测试直接调用，不依赖定时器。 */
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

type Modality = "image" | "video";

function candidatesFor(
  port: CanvasGenerationWorkerOptions["port"],
  modality: Modality,
  requestedModel?: string,
): GenerationTarget[] {
  const targets = port.listTargets().filter((target) => target.modality === modality);
  if (!requestedModel) return [...targets];
  const pinned = targets.find(
    (target) =>
      `${target.providerId}/${target.modelId}` === requestedModel ||
      target.modelId === requestedModel,
  );
  // 点名模型不可用时沿用既有语义：落到该模态第一个目标，把原因交给失败文案。
  return [pinned ?? targets[0]].filter((target): target is GenerationTarget => !!target);
}

function failureText(failures: readonly string[]): string {
  return failures.length ? `generation_failed: ${failures.join("; ")}` : "generation_failed: 没有可用的生成模型";
}

async function runWithCandidates<T>(
  candidates: readonly GenerationTarget[],
  run: (target: GenerationTarget) => Promise<T>,
): Promise<{ ok: true; target: GenerationTarget; result: T } | { ok: false; failures: string[] }> {
  const failures: string[] = [];
  for (const target of candidates) {
    try {
      return { ok: true, target, result: await run(target) };
    } catch (error) {
      failures.push(
        `${target.providerId}/${target.modelId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { ok: false, failures };
}

/** 同一进程内一个 workspace 只跑一个 worker：多会话各自构造 app 时不能重复执行同一意图。 */
const activeByWorkspace = new Map<string, CanvasGenerationWorker>();

export function createCanvasGenerationWorker(
  options: CanvasGenerationWorkerOptions,
): CanvasGenerationWorker {
  const { port, workspacePath, logger } = options;
  const existing = activeByWorkspace.get(workspacePath);
  if (existing) return existing;
  const intervalMs = options.intervalMs ?? 2_000;
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function execute(
    path: string,
    nodeId: string,
    request: CanvasGenerationRequest,
    kind: "image" | "video",
  ): Promise<void> {
    const modality: Modality = kind;
    const candidates = candidatesFor(port, modality, request.model);
    if (candidates.length === 0) {
      await patchCanvasGeneration(path, nodeId, {
        status: "failed",
        requestId: request.requestId,
        error: "generation_failed: 没有可用的生成模型",
        request: undefined,
      });
      return;
    }
    logger?.info("canvas generation request started", {
      requestId: request.requestId,
      nodeId,
      modality,
    });

    const outcome =
      modality === "image"
        ? await runWithCandidates(candidates, (target) =>
            port.generateImage(target, {
              prompt: request.prompt,
              ...(request.size ? { size: request.size } : {}),
              ...(request.ratio ? { ratio: request.ratio } : {}),
            }),
          )
        : await runWithCandidates(candidates, (target) =>
            port.generateVideo(target, {
              prompt: request.prompt,
              mode: request.firstFrame ? "keyframe" : "text",
              ...(request.firstFrame ? { firstFrame: request.firstFrame } : {}),
              ...(request.seconds ? { seconds: request.seconds } : {}),
              ...(request.ratio ? { aspectRatio: request.ratio } : {}),
              ...(request.size ? { size: request.size } : {}),
            }),
          );

    if (!outcome.ok) {
      await patchCanvasGeneration(path, nodeId, {
        status: "failed",
        requestId: request.requestId,
        error: failureText(outcome.failures),
        request: undefined,
      });
      logger?.warn("canvas generation request failed", {
        requestId: request.requestId,
        failures: outcome.failures,
      });
      return;
    }

    const model = `${outcome.target.providerId}/${outcome.target.modelId}`;
    const base = {
      status: "idle",
      requestId: request.requestId,
      prompt: request.prompt,
      model,
      ...(request.size ? { size: request.size } : {}),
      ...(request.ratio ? { ratio: request.ratio } : {}),
      ...(request.seconds ? { seconds: request.seconds } : {}),
      request: undefined,
      error: undefined,
      retryAt: undefined,
      queuedReason: undefined,
    };
    if (kind === "video") {
      const result = outcome.result as { videoId: string; url: string };
      await patchCanvasGeneration(path, nodeId, {
        ...base,
        url: result.url,
        task: {
          providerId: outcome.target.providerId,
          modelId: outcome.target.modelId,
          videoId: result.videoId,
        },
      });
    } else {
      const result = outcome.result as {
        images: ReadonlyArray<{ url?: string; savedPath?: string }>;
      };
      const first = result.images[0];
      await patchCanvasGeneration(path, nodeId, {
        ...base,
        ...(first?.savedPath ? { savedPath: first.savedPath } : {}),
        ...(first?.url ? { url: first.url } : {}),
      });
    }
    logger?.info("canvas generation request completed", {
      requestId: request.requestId,
      nodeId,
      modality,
      model,
    });
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const documents = await readCanvasDocuments(workspacePath);
      for (const file of documents) {
        for (const { node, request } of pendingCanvasRequests(file)) {
          if (inFlight.has(request.requestId)) continue;
          inFlight.add(request.requestId);
          try {
            await execute(file.path, node.id, request, node.kind);
          } finally {
            inFlight.delete(request.requestId);
          }
        }
      }
    } catch (error) {
      logger?.warn("canvas generation tick failed", {
        cause: error instanceof Error ? error.message : String(error),
        directory: canvasDirectory(workspacePath),
      });
    } finally {
      running = false;
    }
  }

  const worker: CanvasGenerationWorker = {
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (activeByWorkspace.get(workspacePath) === worker) {
        activeByWorkspace.delete(workspacePath);
      }
    },
  };
  activeByWorkspace.set(workspacePath, worker);
  return worker;
}
