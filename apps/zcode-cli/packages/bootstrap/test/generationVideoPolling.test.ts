import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createGenerationPort } from "../src/app/generation-port.js";
import { isTransientGenerationFailure, postJson } from "../src/app/generation-http.js";
import type { ProviderRegistryModelSource } from "../src/app/provider-registry-model-runtime.js";
import type { VideoGenerateRequest } from "@zcode/contracts";

const PROVIDER_ID = "agnes-ai";
const MODEL_ID = "agnes-video-2.5-flash";
const TARGET = { providerId: PROVIDER_ID, modelId: MODEL_ID };
const IMAGE_TARGET = { providerId: PROVIDER_ID, modelId: "agnes-image-2.5-flash" };
const TEXT_REQUEST: VideoGenerateRequest = {
  prompt: "a red fox cub trotting through a birch forest",
  mode: "text",
};

type FakeResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  throwOnNetwork?: boolean;
  undelayed?: boolean;
};

interface RecordedCall {
  url: string;
  body?: string;
}

/**
 * 每个用例自己装 fetch、自己收请求记录：模块级数组会被上一用例里仍在飞的假响应写脏，
 * 测出来就是「莫名其妙多打了一次请求」的假象。
 */
function installFetch(respond: (call: RecordedCall) => FakeResponse) {
  const calls: RecordedCall[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      ...(init?.body === undefined ? {} : { body: String(init.body) }),
    };
    const result = respond({ ...call, url: call.url });
    calls.push(call);
    if (result.throwOnNetwork) throw new Error("network down");
    if (!result.undelayed) await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status,
      headers: result.headers,
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = previous) };
}

function buildPort() {
  const view = {
    providers: [
      {
        providerId: PROVIDER_ID,
        providerName: "Agnes AI",
        config: {
          visibility: "visible",
          access: { type: "api-key", apiKey: "sk-test-not-a-real-key" },
          api: { baseUrl: "https://gateway.invalid/v1" },
        },
        models: [
          { modelId: MODEL_ID, config: { enabled: true, properties: { outputFormat: { supportsVideo: true } } } },
        ],
      },
    ],
  };
  return createGenerationPort({
    registry: { getView: () => view } as unknown as ProviderRegistryModelSource,
    getWorkspacePath: () => undefined,
  });
}

let restore: (() => void) | undefined = undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

test("查询被明确拒绝时不按默认节奏再打：429 用 Retry-After，5xx 与其他 4xx 各有冷却", async () => {
  const port = buildPort();
  const cases: Array<[FakeResponse, unknown]> = [
    [{ status: 429, headers: { "Retry-After": "7" }, body: { message: "slow down" } }, { status: "running", retryAfterMs: 7_000 }],
    // 免费档生视频 1 RPM：限流默认冷却必须覆盖整分钟窗口。
    [{ status: 429, body: { message: "slow down" } }, { status: "running", retryAfterMs: 60_000 }],
    [{ status: 503, body: { code: "video_queue_full" } }, { status: "running", retryAfterMs: 6_000 }],
    [{ status: 400, body: { detail: "bad request" } }, { status: "running", retryAfterMs: 15_000 }],
    [{ status: 200, body: { status: "running", progress: 40 } }, { status: "running" }],
  ];
  for (const [response, expected] of cases) {
    const harness = installFetch(() => response);
    restore = harness.restore;
    assert.deepEqual(await port.getVideoStatus(TARGET, "v1"), expected, JSON.stringify(response));
    assert.equal(harness.calls.length, 1);
  }
});

test("永久性拒绝停止轮询：401/403/404 给出可重试的失败原因", async () => {
  const port = buildPort();
  for (const status of [401, 403]) {
    const harness = installFetch(() => ({ status, body: { message: "nope" } }));
    restore = harness.restore;
    const outcome = await port.getVideoStatus(TARGET, "v1");
    if (outcome.status !== "failed") assert.fail(`HTTP ${status} 应判为失败`);
    assert.match(outcome.detail ?? "", new RegExp(`HTTP ${status}`));
  }
  const harness = installFetch(() => ({ status: 404, body: {} }));
  restore = harness.restore;
  assert.equal((await port.getVideoStatus(TARGET, "v1")).status, "failed");
});

test("网络抖动与不可解析响应不判死任务：仍按运行中返回", async () => {
  const port = buildPort();
  const jitter = installFetch(() => ({ status: 0, throwOnNetwork: true }));
  restore = jitter.restore;
  assert.deepEqual(await port.getVideoStatus(TARGET, "v1"), { status: "running" });

  // 2xx 但响应体不是 JSON：任务可能好好的，只是这次没读到，放缓而不是判死。
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response("not json", { status: 200 })) as typeof globalThis.fetch;
  restore = () => (globalThis.fetch = previous);
  assert.deepEqual(await port.getVideoStatus(TARGET, "v1"), { status: "running", retryAfterMs: 15_000 });
});

test("完成判定只看顶层 status 与 url，不看 internal_*", async () => {
  const port = buildPort();
  const harness = installFetch(() => ({
    status: 200,
    body: {
      status: "completed",
      url: "https://cdn.invalid/a.mp4",
      internal_status: "pending",
      internal_progress: 0,
    },
  }));
  restore = harness.restore;
  assert.deepEqual(await port.getVideoStatus(TARGET, "v1"), {
    status: "completed",
    url: "https://cdn.invalid/a.mp4",
  });
});

test("查询端点在网关根路径下，不带 baseUrl 的 /v1 版本段", async () => {
  const port = buildPort();
  const harness = installFetch(() => ({ status: 200, body: { status: "running" } }));
  restore = harness.restore;
  await port.getVideoStatus(TARGET, "task 123");
  assert.deepEqual(harness.calls.map((call) => call.url), [
    "https://gateway.invalid/agnesapi?video_id=task%20123&model_name=agnes-video-2.5-flash",
  ]);
});

test("拿不到响应时报告真实原因而不是 fetch failed，并按临时故障重发", async () => {
  const port = buildPort();
  const previous = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    error.cause = Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    if (attempts === 1) throw error;
    return new Response(JSON.stringify({ id: "v-after-retry" }), { status: 200 });
  }) as typeof globalThis.fetch;
  restore = () => (globalThis.fetch = previous);

  const started = await port.startVideo(TARGET, TEXT_REQUEST);
  assert.deepEqual(started, { status: "created", videoId: "v-after-retry" });
  assert.equal(attempts, 2);
});

test("连不上时返回 queued 而不是抛错，调用方按建议间隔自动重投", async () => {
  const port = buildPort();
  const previous = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    error.cause = Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    throw error;
  }) as typeof globalThis.fetch;
  restore = () => (globalThis.fetch = previous);

  const started = await port.startVideo(TARGET, TEXT_REQUEST);
  assert.equal(started.status, "queued");
  if (started.status !== "queued") assert.fail("expected queued");
  assert.match(started.reason, /无法连接生成服务/);
  assert.ok(started.retryAfterMs > 0);
  // 单次尝试的退避仍会重发几轮，但不无限贴着脸打。
  assert.ok(attempts >= 2 && attempts <= 4, `attempts=${attempts}`);
});

test("传输层失败的消息带真实原因，不再是裸 fetch failed", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => {
    const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    error.cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    throw error;
  }) as typeof globalThis.fetch;
  restore = () => (globalThis.fetch = previous);

  await assert.rejects(
    postJson({ baseUrl: "https://gateway.invalid/v1" }, "/videos", {}, 1_000),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /无法连接生成服务/);
      assert.match(message, /域名解析失败/);
      assert.match(message, /ENOTFOUND/);
      assert.ok(!message.includes("fetch failed"), "不能再把 undici 的裸消息交给用户");
      assert.equal(isTransientGenerationFailure(error), true);
      return true;
    },
  );
});

test("创建响应优先取 video_id，id/task_id 不能用来查询", async () => {
  const port = buildPort();
  const harness = installFetch(() => ({
    status: 200,
    body: { id: "task_abc", task_id: "task_abc", video_id: "video_xyz" },
  }));
  restore = harness.restore;
  assert.deepEqual(await port.startVideo(TARGET, TEXT_REQUEST), {
    status: "created",
    videoId: "video_xyz",
  });
});

test("完成态的地址在 url / video_url / metadata.url 任一处都算拿到", async () => {
  const port = buildPort();
  const cases: Array<{ body: Record<string, unknown>; url: string }> = [
    { body: { status: "completed", url: "https://cdn.invalid/a.mp4" }, url: "https://cdn.invalid/a.mp4" },
    { body: { status: "completed", video_url: "https://cdn.invalid/b.mp4" }, url: "https://cdn.invalid/b.mp4" },
    { body: { status: "succeeded", metadata: { url: "https://cdn.invalid/c.mp4" } }, url: "https://cdn.invalid/c.mp4" },
  ];
  for (const { body, url } of cases) {
    const harness = installFetch(() => ({ status: 200, body }));
    restore = harness.restore;
    assert.deepEqual(await port.getVideoStatus(TARGET, "v1"), { status: "completed", url });
  }
});

test("说完成了却没地址必须判失败，未识别状态与取消各自归位", async () => {
  const port = buildPort();
  const cases: Array<[unknown, string, RegExp?]> = [
    [{ status: "completed" }, "failed", /未返回视频地址/],
    [{ status: "cancelled" }, "failed", /取消/],
    [{ status: "failed", error: { message: "safety blocked" } }, "failed", /safety blocked/],
    [{ status: "in_progress", progress: 30 }, "running"],
    [{ status: "queued" }, "running"],
    [{}, "running"],
  ];
  for (const [body, expected, pattern] of cases) {
    const harness = installFetch(() => ({ status: 200, body }));
    restore = harness.restore;
    const outcome = await port.getVideoStatus(TARGET, "v1");
    assert.equal(outcome.status, expected, JSON.stringify(body));
    if (pattern && outcome.status === "failed") assert.match(outcome.detail ?? "", pattern);
  }
});

test("一定会被拒的参数在本地拦下，一次请求都不发", async () => {
  const port = buildPort();
  const harness = installFetch(() => ({ status: 200, body: { id: "v1" } }));
  restore = harness.restore;
  const cases: VideoGenerateRequest[] = [
    { ...TEXT_REQUEST, seconds: "13" },
    { ...TEXT_REQUEST, seconds: "4.5" },
    { ...TEXT_REQUEST, aspectRatio: "5:4" },
    { ...TEXT_REQUEST, firstFrame: "https://cdn.invalid/a.png" },
    { prompt: "p", mode: "keyframe" },
    { prompt: "p", mode: "keyframe", firstFrame: "https://cdn.invalid/a.png", images: ["https://cdn.invalid/b.png"] },
    { prompt: "p", mode: "reference" },
    {
      prompt: "p",
      mode: "reference",
      images: Array.from({ length: 6 }, (_, index) => `https://cdn.invalid/${index}.png`),
    },
    {
      prompt: "p",
      mode: "reference",
      audios: Array.from({ length: 4 }, (_, index) => `https://cdn.invalid/${index}.mp3`),
    },
  ];
  for (const request of cases) {
    await assert.rejects(
      port.startVideo(TARGET, request),
      /参数不合法/,
      JSON.stringify(request),
    );
  }
  assert.equal(harness.calls.length, 0);
});

test("合法的 keyframe 请求正常发出并带上 mode 专用字段", async () => {
  const port = buildPort();
  const harness = installFetch(() => ({ status: 200, body: { id: "v9" } }));
  restore = harness.restore;
  const started = await port.startVideo(TARGET, {
    prompt: "p",
    mode: "keyframe",
    firstFrame: "https://cdn.invalid/a.png",
    seconds: "4",
    aspectRatio: "9:16",
  });
  assert.deepEqual(started, { status: "created", videoId: "v9" });
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(JSON.parse(harness.calls[0]?.body ?? "{}"), {
    model: MODEL_ID,
    prompt: "p",
    mode: "keyframe",
    size: "720P",
    seconds: "4",
    aspect_ratio: "9:16",
    first_frame: "https://cdn.invalid/a.png",
  });
});

test("size 必带：默认 720P，调用方给了就用调用方的", async () => {
  const port = buildPort();
  const harness = installFetch(() => ({ status: 200, body: { video_id: "v1" } }));
  restore = harness.restore;
  await port.startVideo(TARGET, { ...TEXT_REQUEST, aspectRatio: "9:16" });
  await port.startVideo(TARGET, { ...TEXT_REQUEST, size: "1080P" });
  const bodies = harness.calls.map((call) => JSON.parse(call.body ?? "{}") as Record<string, unknown>);
  assert.equal(bodies[0]?.size, "720P");
  assert.equal(bodies[0]?.aspect_ratio, "9:16");
  assert.equal(bodies[1]?.size, "1080P");
});

test("创建串行发出：第二个请求要等第一个返回", async () => {
  const port = buildPort();
  const timeline: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    timeline.push("start");
    await new Promise((resolve) => setTimeout(resolve, 30));
    timeline.push("end");
    return new Response(JSON.stringify({ id: `v-${timeline.length}` }), { status: 200 });
  }) as typeof globalThis.fetch;
  restore = () => (globalThis.fetch = previous);

  const results = await Promise.all([
    port.startVideo(TARGET, TEXT_REQUEST),
    port.startVideo(TARGET, TEXT_REQUEST),
  ]);
  assert.deepEqual(
    results.map((result) => (result.status === "created" ? result.videoId : result.status)),
    ["v-2", "v-4"],
  );
  assert.deepEqual(timeline, ["start", "end", "start", "end"]);
});

test("撞上限流时返回 queued，节点保持排队而不是报失败", async () => {
  const port = buildPort();
  let answered = 0;
  const harness = installFetch(() => {
    answered += 1;
    return {
      status: 429,
      headers: { "Retry-After": "5" },
      body: { message: "rate limited" },
      undelayed: true,
    };
  });
  restore = harness.restore;

  const first = await port.startVideo(TARGET, TEXT_REQUEST);
  assert.equal(first.status, "queued");
  if (first.status !== "queued") assert.fail("expected queued");
  assert.equal(first.retryAfterMs, 5_000, "Retry-After 换算成毫秒");
  assert.match(first.reason, /请求过于频繁/);

  // 冷却窗口内再点：立刻回 queued 并把剩余窗口交给调用方排期。
  // 不在这里睡满窗口——生视频是一次 RPC，占着请求等远端节奏会先撞上客户端超时；
  // 也不发请求，白打一次只会把账号级额度压得更死（2026-10-12 实测）。
  const before = Date.now();
  const second = await port.startVideo(TARGET, TEXT_REQUEST);
  assert.equal(second.status, "queued");
  assert.ok(Date.now() - before < 1_000, "冷却期内不占着请求睡觉");
  assert.equal(harness.calls.length, 1, "冷却期内一次请求都不该发");
  if (second.status === "queued") {
    assert.ok(second.retryAfterMs > 0 && second.retryAfterMs <= 5_000, "带回真实剩余窗口");
  }
  assert.equal(answered, 1);
});

test("冷却长过等待上限时不再占着请求，直接回 queued 并带上真实等待时长", async () => {
  const port = buildPort();
  const harness = installFetch(() => ({
    status: 429,
    headers: { "Retry-After": "100" },
    body: { message: "rate limited" },
    undelayed: true,
  }));
  restore = harness.restore;

  await port.startVideo(TARGET, TEXT_REQUEST);
  const before = Date.now();
  const again = await port.startVideo(TARGET, TEXT_REQUEST);
  assert.equal(again.status, "queued");
  if (again.status !== "queued") assert.fail("expected queued");
  assert.ok(again.retryAfterMs > 90_000, `retryAfterMs=${again.retryAfterMs}`);
  assert.ok(Date.now() - before < 500, "超出等待上限必须立刻返回，不能睡到 RPC 超时");
  assert.equal(harness.calls.length, 1, "冷却期内不该再发请求");
});

test("生视频撞限流的冷却不拖累生图：两个模态各自排队", async () => {
  // 服务商给的是两份额度（生视频 1 次/分钟、生图 10 次/分钟）。共用一条冷却队列会让
  // 视频 429 把画布上的生图一起堵死一分钟，那是我们自己造出来的故障。
  const port = buildPort();
  const harness = installFetch((call) =>
    call.url.includes("/videos")
      ? {
          status: 429,
          headers: { "Retry-After": "60" },
          body: { message: "rate limited" },
          undelayed: true,
        }
      : { status: 200, body: { data: [{ b64_json: "aGk=" }] }, undelayed: true },
  );
  restore = harness.restore;

  const video = await port.startVideo(TARGET, TEXT_REQUEST);
  assert.equal(video.status, "queued");

  const image = await port.generateImage(IMAGE_TARGET, { prompt: "a red fox cub" });
  assert.equal(image.images.length, 1, "生图不该被视频的冷却挡住");
  assert.ok(
    harness.calls.some((call) => call.url.includes("/images/generations")),
    "生图请求必须真的发出去",
  );
});
