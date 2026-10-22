import type { Model } from "@zcode/contracts";

/**
 * optionSpecs 访问器（docs/ui/provider-model-output-modality.md）：
 * 生图/生视频等非文本输出模型没有 optionSpecs；这些访问器统一给出缺省，
 * 聊天链路（必然持有完整 specs）行为不变。
 */
export function modelMaxOutputTokens(model: Model, fallback = Number.MAX_SAFE_INTEGER): number {
  return model.optionSpecs.maxOutputTokens?.max ?? fallback;
}

export function modelReasoningValues(model: Model): readonly string[] {
  return model.optionSpecs.reasoningLevel?.values ?? [];
}
