import assert from "node:assert/strict";
import test from "node:test";
import { parseCanvasDocument, type CanvasNode } from "../src/lib/canvasDocument.js";
import {
  describeCanvasMediaStage,
  fitNodeToAspect,
  framePatchForRatio,
  MEDIA_NODE_MAX_SIDE,
  MEDIA_NODE_MIN_SIDE,
  nearestRatioOption,
  parseRatioAspect,
  pickImageSource,
} from "../src/app-shell/canvas/canvasMediaStage.js";

function node(raw: unknown): CanvasNode {
  const doc = parseCanvasDocument(JSON.stringify({ boardId: "b", nodes: [raw], edges: [] }));
  if (!doc) throw new Error("文档解析失败");
  const first = doc.nodes[0];
  if (!first) throw new Error("节点被丢弃");
  return first;
}

function mediaNode(id: string, kind: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    kind,
    title: "",
    x: 0,
    y: 0,
    w: 320,
    h: 180,
    createdAt: 1,
    updatedAt: 1,
    url: "",
    caption: "",
    ...extra,
  };
}

test("文本与便签不走媒体状态机", () => {
  assert.equal(describeCanvasMediaStage(node(mediaNode("a", "text", { content: "x" }))), null);
  assert.equal(describeCanvasMediaStage(node(mediaNode("b", "note", { body: "x" }))), null);
});

test("空 / 生成中 / 失败三态互斥", () => {
  assert.equal(describeCanvasMediaStage(node(mediaNode("a", "image")))?.stage, "empty");
  assert.equal(
    describeCanvasMediaStage(
      node(mediaNode("b", "image", { generation: { status: "running", prompt: "p" } })),
    )?.stage,
    "running",
  );
  const failed = describeCanvasMediaStage(
    node(mediaNode("c", "image", { generation: { status: "failed", prompt: "p", error: "boom" } })),
  );
  assert.equal(failed?.stage, "failed");
  assert.equal(failed?.error, "boom");
});

test("有结果时以媒体为准，任务在途只叠忙标记不换画面", () => {
  const info = describeCanvasMediaStage(
    node(
      mediaNode("a", "image", {
        url: "https://cdn.invalid/a.png",
        generation: { status: "running", prompt: "p" },
      }),
    ),
  );
  assert.deepEqual(info, { stage: "image", busy: true });
});

test("视频按外链是否存在分流，只剩工作区文件时不假装可播放", () => {
  assert.equal(
    describeCanvasMediaStage(node(mediaNode("a", "video", { url: "https://cdn.invalid/a.mp4" })))
      ?.stage,
    "video",
  );
  assert.equal(
    describeCanvasMediaStage(
      node(mediaNode("b", "video", { url: "", savedPath: ".zcode/generated/b.mp4" })),
    )?.stage,
    "video-local",
  );
});

test("图片优先取工作区文件，外链只是兜底（会过期）", () => {
  assert.deepEqual(
    pickImageSource({ url: "https://cdn.invalid/a.png", savedPath: ".zcode/generated/a.png" }),
    { savedPath: ".zcode/generated/a.png" },
  );
  assert.deepEqual(pickImageSource({ url: "https://cdn.invalid/a.png" }), {
    url: "https://cdn.invalid/a.png",
  });
  assert.deepEqual(pickImageSource({}), {});
});

test("卡片按媒体比例贴合：竖屏视频不再被塞进横向卡片", () => {
  const fit = fitNodeToAspect({ w: 320, h: 200 }, 9 / 16);
  assert.ok(fit);
  assert.equal(Math.abs(fit.w / fit.h - 9 / 16) < 0.02, true);
  // 面积基本不变，避免贴合比例把卡片撑爆或缩成邮票。
  assert.equal(Math.abs(fit.w * fit.h - 320 * 200) / 64_000 < 0.15, true);
});

test("比例已经对上就返回 null，加载回调不会反复改文档", () => {
  assert.equal(fitNodeToAspect({ w: 320, h: 180 }, 16 / 9), null);
  assert.equal(fitNodeToAspect({ w: 300, h: 300 }, 1), null);
  assert.equal(fitNodeToAspect({ w: 300, h: 300 }, 0), null);
  assert.equal(fitNodeToAspect({ w: 300, h: 300 }, Number.NaN), null);
});

test("极端比例：保比例与长边上限，短边让位而不撑破画布", () => {
  for (const aspect of [12, 1 / 20]) {
    const fitted = fitNodeToAspect({ w: 320, h: 200 }, aspect);
    assert.ok(fitted);
    assert.equal(Math.abs(fitted.w / fitted.h - aspect) / aspect < 0.02, true, `aspect ${aspect}`);
    assert.equal(Math.max(fitted.w, fitted.h) <= MEDIA_NODE_MAX_SIDE, true, `长边 ${aspect}`);
  }
  // 常规比例（21:9）短边仍会被抬到下限之上。
  const ultrawide = fitNodeToAspect({ w: 240, h: 220 }, 21 / 9);
  assert.ok(ultrawide);
  assert.equal(ultrawide.h >= MEDIA_NODE_MIN_SIDE, true);
});

test("画幅字符串解析与档位反推", () => {
  assert.equal(parseRatioAspect("16:9"), 16 / 9);
  assert.equal(parseRatioAspect(" 9 : 16 "), 9 / 16);
  assert.equal(parseRatioAspect("auto"), null);
  assert.equal(parseRatioAspect("1:0"), null);
  assert.equal(parseRatioAspect(undefined), null);
  const options = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
  // 对数距离：横竖对称，1.6 的框应回到 16:9，0.56 的框回到 9:16。
  assert.equal(nearestRatioOption(320 / 200, options), "16:9");
  assert.equal(nearestRatioOption(180 / 320, options), "9:16");
  assert.equal(nearestRatioOption(1, options), "1:1");
  assert.equal(nearestRatioOption(0, options), null);
});

test("选比例即改框：竖画幅把卡片变成竖框，已对上时不再写文档", () => {
  const patch = framePatchForRatio({ w: 320, h: 200 }, "9:16");
  assert.ok(patch);
  assert.equal(patch.w < patch.h, true);
  assert.equal(framePatchForRatio(patch, "9:16"), null);
  assert.equal(framePatchForRatio({ w: 320, h: 200 }, undefined), null);
});
