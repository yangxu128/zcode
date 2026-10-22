import assert from "node:assert/strict";
import test from "node:test";
import { parseCanvasDocument, serializeCanvasToMarkdown } from "../src/lib/canvasDocument.js";

function imageNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cn:1",
    kind: "image",
    title: "5G 基站",
    x: 0,
    y: 0,
    w: 232,
    h: 200,
    createdAt: 1,
    updatedAt: 1,
    url: "",
    caption: "",
    ...overrides,
  };
}

function parseWith(node: Record<string, unknown>): ReturnType<typeof parseCanvasDocument> {
  return parseCanvasDocument(JSON.stringify({ boardId: "b1", nodes: [node], edges: [] }));
}

test("生成结果按引用解析：远程 url 与工作区 savedPath 都不内联像素", () => {
  const remote = parseWith(imageNode({ url: "https://example.com/a.png" }));
  assert.equal(remote?.nodes[0]?.kind, "image");
  if (remote?.nodes[0]?.kind !== "image") return;
  assert.equal(remote.nodes[0].url, "https://example.com/a.png");

  const local = parseWith(
    imageNode({ savedPath: ".zcode/generated/a.png", generation: { status: "idle", prompt: "p" } }),
  );
  if (local?.nodes[0]?.kind !== "image") return assert.fail("image 节点被丢弃");
  assert.equal(local.nodes[0].savedPath, ".zcode/generated/a.png");
  assert.equal(local.nodes[0].generation?.prompt, "p");
});

test("agent 写坏的生成字段整块丢弃，不崩面板也不保留假状态", () => {
  const parsed = parseWith(
    imageNode({ savedPath: 42, generation: { status: "running-ish", prompt: 7 } }),
  );
  if (parsed?.nodes[0]?.kind !== "image") return assert.fail("image 节点被丢弃");
  assert.equal(parsed.nodes[0].savedPath, undefined);
  assert.equal(parsed.nodes[0].generation, undefined);
});

test("running 状态被保留，用于刷新后禁用重复提交", () => {
  const parsed = parseWith(
    imageNode({ generation: { status: "running", prompt: "p", size: "1K", ratio: "1:1" } }),
  );
  if (parsed?.nodes[0]?.kind !== "image") return assert.fail("image 节点被丢弃");
  assert.equal(parsed.nodes[0].generation?.status, "running");
  assert.equal(parsed.nodes[0].generation?.size, "1K");
});

test("导出给 agent 的 Markdown 带图片文件引用与提示词", () => {
  const doc = parseWith(
    imageNode({
      savedPath: ".zcode/generated/a.png",
      caption: "基站",
      generation: { status: "idle", prompt: "黄昏的基站铁塔" },
    }),
  );
  if (!doc) return assert.fail("文档解析失败");
  const markdown = serializeCanvasToMarkdown(doc);
  assert.match(markdown, /图片文件：\.zcode\/generated\/a\.png/);
  assert.match(markdown, /生成提示词：黄昏的基站铁塔/);
});
