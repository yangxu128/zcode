import assert from "node:assert/strict";
import test from "node:test";

import {
  assertGenerationAccepted,
  GenerationConnectError,
  GenerationHttpError,
  GENERATION_RETRY_BACKOFF_MS,
  isTransientGenerationFailure,
  isTransientGenerationStatus,
  withTransientRetry,
} from "../src/app/generation-http.js";
import { nextCreateWaitMs } from "../src/app/generation-limits.js";

test("5xx 属临时失败，429 与其他 4xx 不是", () => {
  assert.equal(isTransientGenerationStatus(503), true);
  assert.equal(isTransientGenerationStatus(500), true);
  assert.equal(isTransientGenerationStatus(501), false);
  assert.equal(isTransientGenerationStatus(429), false);
  assert.equal(isTransientGenerationStatus(400), false);
});

test("退避节拍按服务商 FAQ：1s → 2s → 4s", () => {
  assert.deepEqual([...GENERATION_RETRY_BACKOFF_MS], [1000, 2000, 4000]);
});

test("限流失败不自动重试", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientRetry(async () => {
      calls += 1;
      throw new GenerationHttpError("Too Many Requests", 429, "rate_limit_exceeded");
    }),
    (error) => error instanceof GenerationHttpError && error.code === "rate_limit_exceeded",
  );
  // 429 重试只会加重限流（服务商 FAQ：等窗口恢复）。
  assert.equal(calls, 1);
});

test("队列满的 503 会重试到成功", async () => {
  let calls = 0;
  const result = await withTransientRetry(async () => {
    calls += 1;
    if (calls === 1) throw new GenerationHttpError("video_queue_full", 503, "video_queue_full");
    return { ok: true };
  }, [5]);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test("退避预算用完就把失败交回调用方", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientRetry(async () => {
      calls += 1;
      throw new GenerationHttpError("busy", 500);
    }, [1, 1, 1]),
  );
  assert.equal(calls, 4);
});

test("非 HTTP 失败原样抛出，不参与重试", async () => {
  await assert.rejects(
    withTransientRetry(async () => {
      throw new Error("AbortError");
    }, [5]),
    /AbortError/,
  );
});

test("总预算用完后不再开新一轮，免得超过调用方的 RPC 超时", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientRetry(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      throw new GenerationHttpError("busy", 503);
    }, [50, 50, 50], 150),
  );
  // 单次 60ms + 退避 50ms：第二轮结束时已越过 150ms 预算，不该再起第三轮。
  assert.equal(calls, 2);
});

test("传输层失败与 5xx 同级：没拿到响应就可以安全重发", async () => {
  let calls = 0;
  const result = await withTransientRetry(async () => {
    calls += 1;
    if (calls === 1) throw new GenerationConnectError("/videos", new Error("socket hang up"));
    return "ok";
  }, [5]);
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.equal(isTransientGenerationFailure(new GenerationConnectError("/videos", new Error("x"))), true);
});

test("失败文案保留网关原文并补处置提示", () => {
  const collect = (run: () => void): GenerationHttpError => {
    try {
      run();
    } catch (error) {
      assert.ok(error instanceof GenerationHttpError);
      return error;
    }
    assert.fail("expected rejection");
  };
  const queued = collect(() =>
    assertGenerationAccepted(503, { code: "video_queue_full", message: "queue full req-1" }),
  );
  assert.equal(queued.status, 503);
  assert.equal(queued.code, "video_queue_full");
  assert.match(queued.message, /queue full req-1/);
  assert.match(queued.message, /队列已满/);
  assert.match(collect(() => assertGenerationAccepted(429, { error: { message: "slow down" } })).message, /限流/);
  assert.match(collect(() => assertGenerationAccepted(500, { message: "boom" })).message, /退避重试/);
  // 4xx 参数类错误不加噪声提示。
  assert.equal(
    collect(() => assertGenerationAccepted(400, { message: "prompt required" })).message,
    "prompt required",
  );
  assert.equal(assertGenerationAccepted(200, { data: [] }), undefined);
});

test("重投创建的节奏按已排队时长拉开，不被宿主建议拉回分钟级猛打", () => {
  // 依据 2026-10-12 实测：免费档 429 空 24 分钟仍复现，贴着分钟重投换不来放行。
  assert.equal(nextCreateWaitMs(0, 60_000), 60_000);
  assert.equal(nextCreateWaitMs(90_000, 60_000), 60_000);
  assert.equal(nextCreateWaitMs(2 * 60_000, 60_000), 4 * 60_000);
  assert.equal(nextCreateWaitMs(10 * 60_000, 60_000), 10 * 60_000);
  // 服务商要求等更久时按更久。
  assert.equal(nextCreateWaitMs(0, 90_000), 90_000);
});
