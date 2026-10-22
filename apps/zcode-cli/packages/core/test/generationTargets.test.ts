import assert from "node:assert/strict";
import test from "node:test";
import {
  describeGenerationFailures,
  resolveGenerationCandidates,
  runWithGenerationFallback,
} from "../src/tool/handlers/generation-targets.js";

function portWith(
  targets: Array<{ providerId: string; modelId: string; modality: string }>,
): never {
  return { listTargets: () => targets } as never;
}

const MIXED = [
  { providerId: "new-provider", modelId: "cogview-4-test", modality: "image" },
  { providerId: "agnes-ai", modelId: "agnes-image-2.5-flash", modality: "image" },
  { providerId: "agnes-ai", modelId: "agnes-video-2.5-flash", modality: "video" },
];

test("候选按模态过滤并保持注册表顺序", () => {
  assert.deepEqual(resolveGenerationCandidates(portWith(MIXED), "image"), [
    { providerId: "new-provider", modelId: "cogview-4-test" },
    { providerId: "agnes-ai", modelId: "agnes-image-2.5-flash" },
  ]);
  assert.deepEqual(resolveGenerationCandidates(portWith(MIXED), "video"), [
    { providerId: "agnes-ai", modelId: "agnes-video-2.5-flash" },
  ]);
  assert.deepEqual(resolveGenerationCandidates(portWith([]), "image"), []);
});

test("点名 model 时只尝试该目标，不回退到别的模型", () => {
  assert.deepEqual(
    resolveGenerationCandidates(portWith(MIXED), "image", "agnes-ai/agnes-image-2.5-flash"),
    [{ providerId: "agnes-ai", modelId: "agnes-image-2.5-flash" }],
  );
  assert.deepEqual(resolveGenerationCandidates(portWith(MIXED), "image", "agnes-image-2.5-flash"), [
    { providerId: "agnes-ai", modelId: "agnes-image-2.5-flash" },
  ]);
  // 既有语义：点名的模型不在候选里时落到该模态第一个，由失败原因说明它不可用。
  assert.deepEqual(resolveGenerationCandidates(portWith(MIXED), "image", "nope/nope"), [
    { providerId: "new-provider", modelId: "cogview-4-test" },
  ]);
});

test("第一个候选被端点拒绝时自动换下一个", async () => {
  const attempted: string[] = [];
  const attempt = await runWithGenerationFallback(
    resolveGenerationCandidates(portWith(MIXED), "image"),
    async (candidate) => {
      attempted.push(`${candidate.providerId}/${candidate.modelId}`);
      if (attempted.length === 1) throw new Error("Not Found");
      return { url: "https://example.com/a.png" };
    },
  );
  assert.deepEqual(attempted, ["new-provider/cogview-4-test", "agnes-ai/agnes-image-2.5-flash"]);
  assert.equal(attempt.ok, true);
  if (!attempt.ok) return;
  assert.equal(attempt.target.modelId, "agnes-image-2.5-flash");
  assert.deepEqual(attempt.result, { url: "https://example.com/a.png" });
});

test("全部候选失败时逐个报告目标与原因", async () => {
  const attempt = await runWithGenerationFallback(
    resolveGenerationCandidates(portWith(MIXED), "image"),
    async (candidate) => {
      throw new Error(`boom ${candidate.modelId}`);
    },
  );
  assert.equal(attempt.ok, false);
  if (attempt.ok) return;
  assert.equal(attempt.failures.length, 2);
  assert.match(attempt.failures[0]!, /^new-provider\/cogview-4-test: boom/);
  const report = describeGenerationFailures(attempt.failures);
  assert.match(report, /all candidates failed/);
  assert.match(report, /- agnes-ai\/agnes-image-2\.5-flash: boom/);
});

test("取消不能当成目标不可用继续打下一个请求", async () => {
  const controller = new AbortController();
  let calls = 0;
  const attempt = runWithGenerationFallback(
    resolveGenerationCandidates(portWith(MIXED), "image"),
    async () => {
      calls += 1;
      controller.abort();
      throw new Error(" aborted ");
    },
    controller.signal,
  );
  await assert.rejects(() => attempt, /aborted/);
  assert.equal(calls, 1);
});

test("单个失败直接给原因，不加列表壳", () => {
  assert.equal(describeGenerationFailures(["a/b: Not Found"]), "a/b: Not Found");
});
