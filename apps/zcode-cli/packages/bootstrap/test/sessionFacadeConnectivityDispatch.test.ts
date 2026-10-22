import assert from "node:assert/strict";
import test from "node:test";
import { createSessionFacade } from "../src/app/session-facade.js";

type ProbeCall =
  | { readonly via: "generation-port"; readonly modality: string }
  | { readonly via: "runtime-chat"; readonly selection: Record<string, unknown> };

interface FacadeInput {
  /** Registry 里该 Model 的配置；undefined 表示 Model 未发布到执行 Registry。 */
  readonly modelConfig: unknown;
  readonly withGenerationPort: boolean;
  readonly calls: ProbeCall[];
}

/** 只喂 testModelConnectivity 会读到的依赖；facade 构造期不触达其它字段。 */
function buildFacade(input: FacadeInput): ReturnType<typeof createSessionFacade> {
  const registry = {
    getView: () => ({ revision: 0, providers: [] }),
    getProvider: (providerId: string) => ({ providerId, models: [] }),
    getModel: () =>
      input.modelConfig === undefined
        ? undefined
        : { modelId: "target-model", config: input.modelConfig },
    validateSelection: () => ({ ok: true as const }),
    onDidChange: () => () => {},
  };
  const deps = {
    configResult: { config: { ui: { locale: "zh-CN" } } },
    providerRegistry: registry,
    ...(input.withGenerationPort
      ? {
          generationPort: {
            listTargets: () => [],
            generateImage: async () => ({ modelId: "", images: [] }),
            generateVideo: async () => ({ modelId: "", videoId: "", url: "" }),
            testConnectivity: async (_target: unknown, modality: string) => {
              input.calls.push({ via: "generation-port", modality });
            },
          },
        }
      : {}),
    runtime: {
      testModelConnectivity: async (params: { selection: Record<string, unknown> }) => {
        input.calls.push({ via: "runtime-chat", selection: params.selection });
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    sessionId: "session-test",
  };
  return createSessionFacade(deps as never);
}

const SELECTION = { providerId: "agnes-ai", modelId: "target-model" };

test("生图模型走生成端点探测，不请求 chat/completions", async () => {
  const calls: ProbeCall[] = [];
  const facade = buildFacade({
    modelConfig: {
      enabled: true,
      properties: { outputFormat: { supportsText: false, supportsImage: true } },
      optionSpecs: {},
    },
    withGenerationPort: true,
    calls,
  });
  await facade.testModelConnectivity({ selection: SELECTION });
  assert.deepEqual(calls, [{ via: "generation-port", modality: "image" }]);
});

test("生视频模型走生视频端点探测", async () => {
  const calls: ProbeCall[] = [];
  const facade = buildFacade({
    modelConfig: {
      enabled: true,
      properties: { outputFormat: { supportsText: false, supportsVideo: true } },
      optionSpecs: {},
    },
    withGenerationPort: true,
    calls,
  });
  await facade.testModelConnectivity({ selection: SELECTION });
  assert.deepEqual(calls, [{ via: "generation-port", modality: "video" }]);
});

test("文本模型保持既有 chat 探测并补最低档位", async () => {
  const calls: ProbeCall[] = [];
  const facade = buildFacade({
    modelConfig: {
      enabled: true,
      properties: { outputFormat: { supportsText: true } },
      optionSpecs: { reasoningLevel: { values: ["low", "high"] } },
    },
    withGenerationPort: true,
    calls,
  });
  await facade.testModelConnectivity({ selection: SELECTION });
  assert.deepEqual(calls, [
    { via: "runtime-chat", selection: { ...SELECTION, options: { reasoningLevel: "low" } } },
  ]);
});

test("Registry 未发布该 Model 时仍交给执行入口按既有语义报错", async () => {
  const calls: ProbeCall[] = [];
  const facade = buildFacade({ modelConfig: undefined, withGenerationPort: true, calls });
  await facade.testModelConnectivity({ selection: SELECTION });
  assert.deepEqual(calls.map((call) => call.via), ["runtime-chat"]);
});

test("生成端口缺席时明确报能力缺席，不回退 chat 探测", async () => {
  const calls: ProbeCall[] = [];
  const facade = buildFacade({
    modelConfig: {
      enabled: true,
      properties: { outputFormat: { supportsText: false, supportsImage: true } },
      optionSpecs: {},
    },
    withGenerationPort: false,
    calls,
  });
  await assert.rejects(
    () => facade.testModelConnectivity({ selection: SELECTION }),
    /未装配生成端口/,
  );
  assert.deepEqual(calls, []);
});
