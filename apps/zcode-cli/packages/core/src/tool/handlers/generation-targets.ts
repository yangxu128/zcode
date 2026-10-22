// ============================================================
// 生成目标解析：ImageGenerate / VideoGenerate 共用
// ============================================================
// 会话本身用的是文本模型，生成模型只是配置里的执行目标。不指定 model 时不能
// 「取第一个」就收工：配置里可能混着指向错误端点的条目（例如把生图标记挂在只提供
// 对话的供应商下），第一个候选 404 就会让整次调用失败，看起来像「工具不会用生图模型」。
// 这里按注册表顺序自动尝试该模态的候选，直到某个端点接受请求；换下一个的边界是安全的，
// 因为宿主端口只在 HTTP 非 2xx（任务未被创建、不计费）时抛错。
// 显式指定 model 时不回退：调用方点名要哪个模型就不换模型，失败直接把原因报回去。

import type { GenerationModality, GenerationPort } from "@zcode/contracts";

export interface GenerationCandidate {
  readonly providerId: string;
  readonly modelId: string;
}

export type GenerationAttempt<T> =
  | { readonly ok: true; readonly target: GenerationCandidate; readonly result: T }
  | { readonly ok: false; readonly failures: readonly string[] };

/** 该模态的候选目标；`requestedModel` 支持 `providerId/modelId` 或裸 `modelId`。 */
export function resolveGenerationCandidates(
  port: GenerationPort,
  modality: GenerationModality,
  requestedModel?: string,
): GenerationCandidate[] {
  const targets = port.listTargets().filter((target) => target.modality === modality);
  if (targets.length === 0) return [];
  const pinned = requestedModel
    ? targets.find(
        (target) =>
          `${target.providerId}/${target.modelId}` === requestedModel ||
          target.modelId === requestedModel,
      )
    : undefined;
  // 点名的模型不在候选里时沿用既有语义：落到该模态的第一个目标，由失败原因说明它不可用。
  const chosen = pinned ?? (requestedModel ? targets[0]! : undefined);
  if (chosen) return [{ providerId: chosen.providerId, modelId: chosen.modelId }];
  return targets.map(({ providerId, modelId }) => ({ providerId, modelId }));
}

/**
 * 顺序尝试候选直到成功。abortSignal 已取消时直接上抛，不能把取消当成
 * 「这个目标不行」继续打下一个请求。
 */
export async function runWithGenerationFallback<T>(
  candidates: readonly GenerationCandidate[],
  generate: (candidate: GenerationCandidate) => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<GenerationAttempt<T>> {
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return { ok: true, target: candidate, result: await generate(candidate) };
    } catch (error) {
      if (abortSignal?.aborted) throw error;
      failures.push(
        `${candidate.providerId}/${candidate.modelId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { ok: false, failures };
}

/** 全部候选都不可用时的报告：逐个带上目标与原因，模型才能决定下一步。 */
export function describeGenerationFailures(failures: readonly string[]): string {
  return failures.length === 1
    ? failures[0]!
    : `all candidates failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`;
}
