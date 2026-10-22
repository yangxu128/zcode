import type { Model, ModelOptions } from "@zcode/contracts";
import { modelMaxOutputTokens, modelReasoningValues } from "./option-specs.js";

const AUXILIARY_MAX_OUTPUT_TOKENS = 5_000;

/**
 * 辅助调用统一使用公开档位的最低项，并限制输出预算；档位顺序来自 Model Config，
 * 不能再按 disabled/off 等名字推断协议行为。
 */
export function auxiliaryModelOptions(model: Model): Required<ModelOptions> {
  return {
    reasoningLevel: modelReasoningValues(model)[0]!,
    maxOutputTokens: Math.min(AUXILIARY_MAX_OUTPUT_TOKENS, modelMaxOutputTokens(model, AUXILIARY_MAX_OUTPUT_TOKENS)),
  };
}
