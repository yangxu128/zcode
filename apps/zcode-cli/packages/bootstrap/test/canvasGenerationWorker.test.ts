import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCanvasGenerationWorker } from "../src/canvas-generation/worker.js";

const IMAGE_TARGET = { providerId: "agnes-ai", modelId: "agnes-image-2.5-flash", modality: "image" as const };
const VIDEO_TARGET = { providerId: "agnes-ai", modelId: "agnes-video-2.5-flash", modality: "video" as const };

async function workspaceWith(document: unknown): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "zc-canvas-worker-"));
  const directory = join(root, ".zcode", "canvas");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "b.json");
  await writeFile(path, JSON.stringify(document, null, 2));
  return { root, path };
}

function node(id: string, kind: "image" | "video", request: Record<string, unknown>) {
  return { id, kind, w: 320, h: 320, generation: { status: "requested", request } };
}

async function readGeneration(path: string, nodeId: string) {
  const document = JSON.parse(await readFile(path, "utf8"));
  const target = document.nodes.find((item: { id: string }) => item.id === nodeId);
  return target.generation as Record<string, unknown>;
}

test("执行图片与视频意图并写回文档，同一 requestId 不重复执行", async () => {
  const { root, path } = await workspaceWith({
    nodes: [
      node("img", "image", { requestId: "req-img", prompt: "a fox", size: "2K", ratio: "1:1" }),
      node("vid", "video", { requestId: "req-vid", prompt: "a fox running", seconds: "4", ratio: "9:16" }),
    ],
  });
  let images = 0;
  let videos = 0;
  const worker = createCanvasGenerationWorker({
    workspacePath: root,
    port: {
      listTargets: () => [IMAGE_TARGET, VIDEO_TARGET],
      generateImage: async (target, request) => {
        images += 1;
        assert.equal(request.size, "2K");
        return { modelId: target.modelId, images: [{ url: "https://cdn.invalid/fox.png" }] };
      },
      generateVideo: async (target, request) => {
        videos += 1;
        assert.equal(request.aspectRatio, "9:16");
        return { modelId: target.modelId, videoId: "v-1", url: "https://cdn.invalid/fox.mp4" };
      },
    },
  });

  await worker.tick();
  const image = await readGeneration(path, "img");
  const video = await readGeneration(path, "vid");
  assert.equal(image.status, "idle");
  assert.equal(image.url, "https://cdn.invalid/fox.png");
  assert.equal(image.request, undefined);
  assert.equal(image.requestId, "req-img");
  assert.equal(video.status, "idle");
  assert.equal(video.url, "https://cdn.invalid/fox.mp4");
  assert.deepEqual(video.task, {
    providerId: "agnes-ai",
    modelId: "agnes-video-2.5-flash",
    videoId: "v-1",
  });

  await worker.tick();
  assert.equal(images, 1);
  assert.equal(videos, 1);
  worker.stop();
});

test("没有候选模型时把意图标成失败并保留原因", async () => {
  const { root, path } = await workspaceWith({
    nodes: [node("img", "image", { requestId: "req-none", prompt: "a fox" })],
  });
  const worker = createCanvasGenerationWorker({
    workspacePath: root,
    port: {
      listTargets: () => [],
      generateImage: async () => {
        throw new Error("should not be called");
      },
      generateVideo: async () => {
        throw new Error("should not be called");
      },
    },
  });
  await worker.tick();
  const generation = await readGeneration(path, "img");
  assert.equal(generation.status, "failed");
  assert.match(String(generation.error), /没有可用的生成模型/);
  assert.equal(generation.request, undefined);
  worker.stop();
});

test("生成失败时写回真实原因，不把 request 留在文档里", async () => {
  const { root, path } = await workspaceWith({
    nodes: [node("img", "image", { requestId: "req-fail", prompt: "a fox" })],
  });
  const worker = createCanvasGenerationWorker({
    workspacePath: root,
    port: {
      listTargets: () => [IMAGE_TARGET],
      generateImage: async () => {
        throw new Error("rate limited");
      },
      generateVideo: async () => {
        throw new Error("should not be called");
      },
    },
  });
  await worker.tick();
  const generation = await readGeneration(path, "img");
  assert.equal(generation.status, "failed");
  assert.match(String(generation.error), /rate limited/);
  assert.equal(generation.request, undefined);
  worker.stop();
});
