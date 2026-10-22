import assert from "node:assert/strict";
import test from "node:test";
import { parseCanvasDocument, type CanvasDocument } from "../src/lib/canvasDocument.js";
import {
  isQueueDeadlinePassed,
  nextQueueWaitMs,
  queueWaitRemainingMs,
  selectQueuedVideoNodes,
  VIDEO_QUEUE_MAX_RETRY_MS,
  VIDEO_QUEUE_MIN_RETRY_MS,
} from "../src/app-shell/canvas/canvasVideoQueue.js";
import { describeCanvasMediaStage } from "../src/app-shell/canvas/canvasMediaStage.js";

const TASK = { providerId: "agnes-ai", modelId: "agnes-video-2.5-flash", videoId: "v1" };

function videoNode(id: string, generation: unknown): CanvasDocument {
  const doc = parseCanvasDocument(
    JSON.stringify({
      boardId: "b",
      nodes: [
        {
          id,
          kind: "video",
          title: "",
          x: 0,
          y: 0,
          w: 240,
          h: 240,
          createdAt: 1,
          updatedAt: 1,
          url: "",
          caption: "",
          ...(generation === undefined ? {} : { generation }),
        },
      ],
      edges: [],
    }),
  );
  if (!doc) throw new Error("文档解析失败");
  return doc;
}

test("排队退避：节奏按已排队时长拉开，宿主建议只当下限", () => {
  // 实测（2026-10-12）免费档 429 不是分钟窗口：空 24 分钟仍被拒。贴着分钟重投换不来放行，
  // 只会把账号级创建额度压得更死，所以阶梯要往上拉开。
  assert.equal(nextQueueWaitMs(0, 60_000), VIDEO_QUEUE_MIN_RETRY_MS);
  assert.equal(nextQueueWaitMs(60_000, 60_000), VIDEO_QUEUE_MIN_RETRY_MS);
  assert.equal(nextQueueWaitMs(2 * 60_000, 60_000), 4 * 60_000);
  assert.equal(nextQueueWaitMs(10 * 60_000, 60_000), 10 * 60_000);
  assert.equal(nextQueueWaitMs(30 * 60_000, 60_000), VIDEO_QUEUE_MAX_RETRY_MS);
  // 服务商要求等更久时必须等更久。
  assert.equal(nextQueueWaitMs(0, 90_000), 90_000);
});

test("卡片显示还要等多久：没到点给剩余时长，到点给 0 以下由调用方立即重投", () => {
  assert.equal(queueWaitRemainingMs({ status: "running", prompt: "p", retryAt: 1_000 }, 500), 500);
  assert.equal(
    queueWaitRemainingMs({ status: "running", prompt: "p", retryAt: 1_000 }, 2_000),
    -1_000,
  );
  assert.equal(queueWaitRemainingMs({ status: "running", prompt: "p" }, 500), undefined);
});

test("running 且没有 task 才算排队，有 task 的走轮询查询", () => {
  assert.equal(
    selectQueuedVideoNodes(videoNode("a", { status: "running", prompt: "p", retryAt: 123 })).length,
    1,
  );
  assert.equal(
    selectQueuedVideoNodes(videoNode("b", { status: "running", prompt: "p", task: TASK })).length,
    0,
  );
  assert.equal(
    selectQueuedVideoNodes(videoNode("c", { status: "failed", prompt: "p", error: "boom" })).length,
    0,
  );
});

test("排队总时限：缺 startedAt 不猜，超过才放弃", () => {
  const now = 1_000_000_000;
  assert.equal(isQueueDeadlinePassed(undefined, now, 1000), false);
  assert.equal(isQueueDeadlinePassed(now - 500, now, 1000), false);
  assert.equal(isQueueDeadlinePassed(now - 1500, now, 1000), true);
});

test("卡片状态：排队中显示 queued 并带上原因，建成任务后才是 running", () => {
  const queued = videoNode("a", {
    status: "running",
    prompt: "p",
    retryAt: 5,
    queuedReason: "rate limited (request id x)",
  }).nodes[0]!;
  const info = describeCanvasMediaStage(queued);
  assert.equal(info?.stage, "queued");
  assert.equal(info?.queuedReason, "rate limited (request id x)");

  const running = videoNode("b", { status: "running", prompt: "p", task: TASK }).nodes[0]!;
  assert.equal(describeCanvasMediaStage(running)?.stage, "running");
});

test("agent 写坏的 retryAt / queuedReason 会被清洗掉，不留假状态", () => {
  const doc = videoNode("a", {
    status: "running",
    prompt: "p",
    retryAt: "soon",
    queuedReason: 42,
  });
  const node = doc.nodes[0];
  if (node?.kind !== "video") assert.fail("节点被丢弃");
  assert.equal(node.generation?.retryAt, undefined);
  assert.equal(node.generation?.queuedReason, undefined);
  // 清洗后仍是「排队中」，重投逻辑照跑，不会因为脏字段卡住。
  assert.equal(selectQueuedVideoNodes(doc).length, 1);
});
