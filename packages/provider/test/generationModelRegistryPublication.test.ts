import assert from "node:assert/strict";
import test from "node:test";
import {
  createRegistryModelConfig,
  ModelConfig,
  ModelOptionSpecsConfig,
  ModelPropertiesConfig,
} from "../src/index.js";

/** 生图模型的完整属性；optionSpecs 由用例分别缺省、置空或给出。 */
function generationProperties(overrides?: {
  supportsImage?: boolean;
  supportsVideo?: boolean;
  supportsText?: boolean;
}): ModelPropertiesConfig {
  return new ModelPropertiesConfig({
    requiresMfjsToolSchema: false,
    contextWindow: 8000,
    inputFormat: {
      supportsText: true,
      supportsImage: false,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: false,
    },
    outputFormat: {
      supportsText: overrides?.supportsText ?? false,
      supportsImage: overrides?.supportsImage ?? true,
      supportsVideo: overrides?.supportsVideo ?? false,
    },
    supportsToolCall: false,
    supportsJsonSchemaOutput: false,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: false,
  });
}

test("生成模型省略 optionSpecs 仍进入执行 Registry（Provider 不被整体摘除）", () => {
  const result = createRegistryModelConfig(
    new ModelConfig({ enabled: true, properties: generationProperties() }),
    ["providers", "agnes-ai", "models", "agnes-image-2.5-flash"],
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // RegistryModelConfig 的 optionSpecs 恒定可读，消费方不需要再判空。
  assert.deepEqual(result.config.optionSpecs?.toJSON(), {});
  assert.deepEqual(result.config.toJSON().optionSpecs, {});
  assert.equal(result.config.toJSON().properties?.outputFormat?.supportsImage, true);
});

test("生视频模型同样容忍 optionSpecs 为 null", () => {
  const result = createRegistryModelConfig(
    new ModelConfig({
      enabled: true,
      properties: generationProperties({ supportsImage: false, supportsVideo: true }),
      optionSpecs: null,
    }),
    ["providers", "agnes-ai", "models", "agnes-video-2.5-flash"],
  );
  assert.equal(result.ok, true);
});

test("文本输出模型仍必须物化 optionSpecs（缺档位不能发布）", () => {
  const result = createRegistryModelConfig(
    new ModelConfig({
      enabled: true,
      properties: generationProperties({
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
      }),
    }),
    ["providers", "agnes-ai", "models", "agnes-2.5-flash"],
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(
    result.issues.filter((issue) => issue.path.at(-1) === "optionSpecs").map((issue) => issue.code),
    ["required-field-missing"],
  );
});

test("已有 optionSpecs 的生成模型原样保留档位", () => {
  const optionSpecs = new ModelOptionSpecsConfig({
    reasoningLevel: { values: ["disabled", "enabled"], map: '{"thinking":{"type":"disabled"}}' },
  });
  const result = createRegistryModelConfig(
    new ModelConfig({ enabled: true, properties: generationProperties(), optionSpecs }),
    ["providers", "agnes-ai", "models", "hybrid"],
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.optionSpecs?.reasoningLevel?.values, ["disabled", "enabled"]);
});
