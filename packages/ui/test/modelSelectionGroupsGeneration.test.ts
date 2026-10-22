import assert from "node:assert/strict";
import test from "node:test";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { buildRegistryModelSelectGroups } from "../src/lib/modelSelectionGroups.js";

function registryView(models: unknown[]): unknown {
  return {
    providers: [
      {
        providerId: "agnes-ai",
        providerName: "Agnes AI",
        config: {
          api: { type: "openai-chat-completions" },
          access: { type: "api-key" },
        },
        models: models.map((properties, index) => ({
          modelId: `model-${index}`,
          config: { properties, access: { type: "api-key" } },
        })),
      },
    ],
  };
}

test("只有生成模型的供应商不出现在聊天选择器（不留空分组）", () => {
  const groups = buildRegistryModelSelectGroups(
    ZCODE_AGENT_PROVIDER as never,
    registryView([
      { outputFormat: { supportsText: false, supportsImage: true } },
      { outputFormat: { supportsText: false, supportsVideo: true } },
    ]) as never,
  );
  assert.deepEqual(groups, []);
});

test("混合供应商只列文本模型", () => {
  const groups = buildRegistryModelSelectGroups(
    ZCODE_AGENT_PROVIDER as never,
    registryView([
      { outputFormat: { supportsText: true } },
      // 内置 catch-all 会叠加 supportsText，输出模态意图仍然权威。
      { outputFormat: { supportsText: true, supportsImage: true } },
    ]) as never,
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.items.map((item: { name: string }) => item.name),
    ["model-0"],
  );
});
