import assert from "node:assert/strict";
import test from "node:test";
import { parseCanvasDocument, type CanvasDocument } from "../src/lib/canvasDocument.js";
import {
  isVideoTaskStale,
  isVideoTaskTooYoung,
  nextVideoCooldownUntil,
  selectRunningVideoTasks,
  VIDEO_TASK_STALE_MS,
} from "../src/app-shell/canvas/useCanvasVideoTasks.js";

// 用生产默认值，别在测试里另抄一份阈值：改了默认就会漏测。
const STALE_MS = VIDEO_TASK_STALE_MS;

function videoNode(id: string, generation: unknown, url = ""): unknown {
  return {
    id,
    kind: "video",
    title: "",
    x: 0,
    y: 0,
    w: 320,
    h: 200,
    createdAt: 1,
    updatedAt: 1,
    url,
    caption: "",
    ...(generation === undefined ? {} : { generation }),
  };
}

function doc(nodes: unknown[]): CanvasDocument {
  const parsed = parseCanvasDocument(JSON.stringify({ boardId: "b", nodes, edges: [] }));
  if (!parsed) throw new Error("文档解析失败");
  return parsed;
}

const TASK = { providerId: "agnes-ai", modelId: "agnes-video-2.5-flash", videoId: "v1" };

test("只有带任务身份的 running 视频节点参与轮询", () => {
  const document = doc([
    videoNode("a", { status: "running", prompt: "p", task: TASK }),
    videoNode("b", { status: "running", prompt: "p" }),
    videoNode("c", { status: "failed", prompt: "p", task: TASK, error: "boom" }),
    videoNode("d", { status: "idle", prompt: "p", task: TASK }, "https://example.com/a.mp4"),
    { ...videoNode("e", { status: "running", prompt: "p", task: TASK }), kind: "image" },
  ]);
  assert.deepEqual(
    selectRunningVideoTasks(document).map((node) => node.id),
    ["a"],
  );
});

test("超时判定：缺 startedAt 不判超时，超过阈值才判超时", () => {
  const now = 1_000_000;
  assert.equal(isVideoTaskStale({ status: "running", prompt: "p", task: TASK }, now), false);
  assert.equal(
    isVideoTaskStale({ status: "running", prompt: "p", task: TASK, startedAt: now - 60_000 }, now),
    false,
  );
  assert.equal(
    isVideoTaskStale(
      { status: "running", prompt: "p", task: TASK, startedAt: now - STALE_MS - 1 },
      now,
    ),
    true,
  );
});

test("agent 写坏的 task 身份整块丢弃，避免恢复时查一个不存在的任务", () => {
  const document = doc([
    videoNode("a", { status: "running", prompt: "p", task: { providerId: "agnes-ai" } }),
  ]);
  const node = document.nodes[0];
  if (node?.kind !== "video") return assert.fail("video 节点被丢弃");
  assert.equal(node.generation?.task, undefined);
  assert.equal(selectRunningVideoTasks(document).length, 0);
});

test("合法 task 与 startedAt 原样保留", () => {
  const document = doc([
    videoNode("a", { status: "running", prompt: "p", task: TASK, startedAt: 12345 }),
  ]);
  const node = document.nodes[0];
  if (node?.kind !== "video") return assert.fail("video 节点被丢弃");
  assert.deepEqual(node.generation?.task, TASK);
  assert.equal(node.generation?.startedAt, 12345);
});

test("冷却只在宿主回传 retryAfterMs 时生效，且只改本地调度", () => {
  const now = 1_000_000;
  // 普通 running：不冷却，按默认节奏继续。
  assert.equal(nextVideoCooldownUntil(now, undefined), undefined);
  // 被限流/繁忙：从当前时刻往后推，不写进画布文档。
  assert.equal(nextVideoCooldownUntil(now, 30_000), now + 30_000);
  assert.equal(nextVideoCooldownUntil(now, 0), now);
});

test("创建后首查窗口内不发查询，缺 startedAt 时不猜", () => {
  const now = 1_000_000;
  const gen = (startedAt?: number) => ({
    status: "running" as const,
    prompt: "p",
    task: TASK,
    startedAt,
  });
  // 查询与创建吃同一份请求额度（免费档生视频 1 RPM），几十秒才完成的任务不必前几秒就查。
  assert.equal(isVideoTaskTooYoung(gen(now - 2_000), now), true);
  assert.equal(isVideoTaskTooYoung(gen(now - 11_000), now), false);
  assert.equal(isVideoTaskTooYoung(gen(), now), false);
});
