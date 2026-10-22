import { useEffect, useMemo, useRef } from "react";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useCanvasStore } from "@/store/canvasStore.js";
import type { CanvasDocument, CanvasVideoNode } from "@/lib/canvasDocument.js";
import { materializeGeneratedMedia } from "./canvasMediaMaterialize.js";
import {
  isQueueDeadlinePassed,
  nextQueueWaitMs,
  selectQueuedVideoNodes,
} from "./canvasVideoQueue.js";

/**
 * 视频任务的轮询归属（docs/ui/canvas-pane.md T5）：由画布面板统一驱动，而不是每个
 * 卡片各自起定时器。任务身份（providerId/modelId/videoId）存在节点上，所以刷新、
 * 重开面板或换设备后都能继续查同一个任务；查询失败按「仍在运行」处理，不改节点状态。
 * 请求频次按服务商文档收敛：一轮只发一批、上一轮没回来不叠加，被限流时整体冷却。
 *
 * 同一个驱动还负责**排队重投**：running 且没有 task 的节点表示服务商这次没收
 * （免费档账号级限流），到 retryAt 就自动再投创建，用户不需要手动重点。
 */
const VIDEO_POLL_INTERVAL_MS = 3_000;
/**
 * 超过这个时长仍未完成才标为失败。免费档排队 + 出片实测要十几二十分钟，
 * 判死太早会把还在正常排队的任务误报成超时。
 * 与宿主端口 GenerationPort.generateVideo 的轮询上限（30 分钟）保持同一口径。
 */
export const VIDEO_TASK_STALE_MS = 30 * 60_000;
/** 刚创建的任务不可能完成，先不查——每次查询都算一次请求。 */
const VIDEO_TASK_FIRST_POLL_MS = 10_000;
/** 排队总时限：超过才判失败，在此之前一直替用户重试。 */
const VIDEO_QUEUE_GIVE_UP_MS = 2 * 60 * 60_000;

/** 任务太年轻就跳过本轮：startedAt 缺席（例如 agent 直接写的节点）时不猜，照常查。 */
export function isVideoTaskTooYoung(
  generation: CanvasVideoNode["generation"],
  now: number,
  minAgeMs: number = VIDEO_TASK_FIRST_POLL_MS,
): boolean {
  return !!generation?.startedAt && now - generation.startedAt < minAgeMs;
}

/** 在途视频任务：kind 正确、状态 running、且带有可继续查询的任务身份。 */
export function selectRunningVideoTasks(doc: CanvasDocument | null | undefined): CanvasVideoNode[] {
  if (!doc) return [];
  return doc.nodes.filter(
    (node): node is CanvasVideoNode =>
      node.kind === "video" && node.generation?.status === "running" && !!node.generation.task,
  );
}

/** 超过 VIDEO_TASK_STALE_MS 仍未完成即判超时：僵尸 running 会永久占住按钮与轮询。 */
export function isVideoTaskStale(
  generation: CanvasVideoNode["generation"],
  now: number,
  staleMs: number = VIDEO_TASK_STALE_MS,
): boolean {
  return !!generation?.startedAt && now - generation.startedAt > staleMs;
}

/**
 * 冷却只决定「下一次查询什么时候发」，属于本地调度事实，不写进画布文档：
 * 把服务端节奏存进文档真值会让刷新或换端把它误当成任务状态。
 */
export function nextVideoCooldownUntil(now: number, retryAfterMs?: number): number | undefined {
  return retryAfterMs === undefined ? undefined : now + retryAfterMs;
}

export interface UseCanvasVideoTasksParams {
  storageKey: string;
  doc: CanvasDocument | null | undefined;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 上游连线解析出的首帧素材，重投创建时要带上，否则排队后会退化成纯文本生成。 */
  referencesByNode?: Map<string, string[]>;
}

export function useCanvasVideoTasks(params: UseCanvasVideoTasksParams): void {
  const { storageKey, doc, workspacePath, workspaceIdentity, referencesByNode } = params;
  const { zcodeAgentService } = useWorkspaceServices(workspacePath, undefined, workspaceIdentity);
  // 依赖只取「任务签名」：轮询写回节点会让 doc 变化，直接依赖 doc 会反复重启定时器
  // 并在每次重启时立刻再查一轮，把远端打成高频轮询。
  const taskSignature = useMemo(() => {
    const ids = [
      ...selectRunningVideoTasks(doc).map(
        (node) => `${node.id}:${node.generation?.task?.videoId ?? ""}`,
      ),
      ...selectQueuedVideoNodes(doc).map((node) => `${node.id}:queued`),
    ];
    return ids.join("|");
  }, [doc]);
  // 连线参考素材每帧都可能是新数组，放进 ref 只读不触发 effect 重启。
  const referencesRef = useRef(referencesByNode);
  referencesRef.current = referencesByNode;

  useEffect(() => {
    if (!taskSignature || !zcodeAgentService) return;
    let cancelled = false;
    // 上一轮没回来就不发下一轮：定时器不看响应快慢地叠加请求，等于自己把并发抬上去。
    let ticking = false;
    let cooldownUntil = 0;
    const identityProps = workspaceIdentity ? { workspaceIdentity } : {};

    const markFailed = (node: CanvasVideoNode, error: string) => {
      const generation = node.generation;
      if (!generation) return;
      useCanvasStore.getState().updateNode({
        storageKey,
        id: node.id,
        patch: {
          generation: { ...generation, status: "failed", error, retryAt: undefined },
        } as Partial<CanvasVideoNode>,
      });
    };

    /** 到点的排队节点重新投一次创建；又被拒就按退避推后 retryAt。 */
    const resubmitQueued = async () => {
      const store = useCanvasStore.getState();
      const queued = selectQueuedVideoNodes(store.docs[storageKey] ?? null);
      for (const node of queued) {
        const generation = node.generation;
        if (!generation) continue;
        if (cancelled) return;
        if (isQueueDeadlinePassed(generation.startedAt, Date.now(), VIDEO_QUEUE_GIVE_UP_MS)) {
          markFailed(node, "免费档创建额度 2 小时内未恢复，已停止自动重投；可稍后再试");
          continue;
        }
        if (generation.retryAt && Date.now() < generation.retryAt) continue;
        const firstFrame = referencesRef.current?.get(node.id)?.[0];
        try {
          const result = await zcodeAgentService.startWorkspaceVideo({
            workspacePath,
            ...identityProps,
            prompt: generation.prompt,
            ...(generation.seconds ? { seconds: generation.seconds } : {}),
            ...(generation.ratio ? { aspectRatio: generation.ratio } : {}),
            ...(firstFrame ? { firstFrame } : {}),
          });
          if (cancelled) return;
          const latest = useCanvasStore
            .getState()
            .docs[storageKey]?.nodes.find((n) => n.id === node.id);
          const latestGeneration = latest?.kind === "video" ? latest.generation : undefined;
          if (!latestGeneration) continue;
          if (result.status === "queued") {
            // 节奏按「已排队多久」推导：刷新会丢掉本地计数，若按次数翻倍就会每次都从
            // 1 分钟重新开始猛投，而实测限流不是分钟窗口（空 24 分钟仍 429）。
            const waitMs = nextQueueWaitMs(
              generation.startedAt === undefined
                ? 0
                : Math.max(0, Date.now() - generation.startedAt),
              result.retryAfterMs,
            );
            useCanvasStore.getState().updateNode({
              storageKey,
              id: node.id,
              patch: {
                generation: {
                  ...latestGeneration,
                  retryAt: Date.now() + waitMs,
                  queuedReason: result.reason,
                },
              } as Partial<CanvasVideoNode>,
            });
            continue;
          }
          useCanvasStore.getState().updateNode({
            storageKey,
            id: node.id,
            patch: {
              generation: {
                ...latestGeneration,
                model: result.model,
                task: {
                  providerId: result.providerId,
                  modelId: result.modelId,
                  videoId: result.videoId,
                },
                retryAt: undefined,
                queuedReason: undefined,
              },
            } as Partial<CanvasVideoNode>,
          });
        } catch (error) {
          if (cancelled) return;
          // 到这里是硬失败（参数、鉴权、模型不可用）：重投也不会变好，如实标失败。
          markFailed(node, error instanceof Error ? error.message : String(error));
        }
      }
    };

    const pollTasks = async () => {
      const state = useCanvasStore.getState();
      for (const node of selectRunningVideoTasks(state.docs[storageKey] ?? null)) {
        const task = node.generation?.task;
        const generation = node.generation;
        if (!task || !generation) continue;
        if (isVideoTaskTooYoung(generation, Date.now())) continue;
        if (isVideoTaskStale(generation, Date.now())) {
          state.updateNode({
            storageKey,
            id: node.id,
            patch: {
              generation: { ...generation, status: "failed", error: "任务超时未完成，可重试" },
            } as Partial<CanvasVideoNode>,
          });
          continue;
        }
        try {
          const outcome = await zcodeAgentService.getWorkspaceVideoTask({
            workspacePath,
            ...identityProps,
            providerId: task.providerId,
            modelId: task.modelId,
            videoId: task.videoId,
          });
          if (cancelled) return;
          if (outcome.status === "completed") {
            // 外链会过期（Agnes 响应带 expires_at），画布是长期文档，能落地就同时存引用。
            const savedPath = await materializeGeneratedMedia({
              service: zcodeAgentService,
              workspacePath,
              ...identityProps,
              url: outcome.url,
            });
            if (cancelled) return;
            state.updateNode({
              storageKey,
              id: node.id,
              patch: {
                url: outcome.url,
                ...(savedPath ? { savedPath } : {}),
                generation: { ...generation, status: "idle", task: undefined },
              } as Partial<CanvasVideoNode>,
            });
          } else if (outcome.status === "failed") {
            state.updateNode({
              storageKey,
              id: node.id,
              patch: {
                generation: {
                  ...generation,
                  status: "failed",
                  error: outcome.detail ?? "视频生成任务失败",
                },
              } as Partial<CanvasVideoNode>,
            });
          } else {
            // 仍在跑：若宿主回传了冷却建议（429/5xx），本轮剩余任务也不必再查——
            // 它们共用同一份请求额度，继续查只会把限流打得更重。
            const cooledUntil = nextVideoCooldownUntil(Date.now(), outcome.retryAfterMs);
            if (cooledUntil !== undefined) {
              cooldownUntil = cooledUntil;
              break;
            }
          }
        } catch {
          // 单次查询失败（网络抖动/进程重启）不改节点状态，避免把在途任务判死。
        }
      }
    };

    const pollOnce = async () => {
      if (ticking || Date.now() < cooldownUntil) return;
      ticking = true;
      try {
        await resubmitQueued();
        if (!cancelled) await pollTasks();
      } finally {
        ticking = false;
      }
    };

    void pollOnce();
    const timer = window.setInterval(() => void pollOnce(), VIDEO_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [storageKey, taskSignature, workspaceIdentity, workspacePath, zcodeAgentService]);
}
