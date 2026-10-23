import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyOperations,
  cancelGeneration,
  listBoards,
  readBoard,
  requestGeneration,
} from "../src/document.js";

async function board(document: unknown): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "zcode-canvas-plugin-"));
  const directory = join(root, ".zcode", "canvas");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "default-test.json");
  await writeFile(path, JSON.stringify(document, null, 2));
  return { root, path };
}

describe("canvas document tools", () => {
  it("applies node/edge operations and reads them back", async () => {
    const { root, path } = await board({
      nodes: [{ id: "n1", kind: "image", x: 0, y: 0, w: 320, h: 320 }],
      edges: [],
    });
    const result = await applyOperations(
      root,
      [
        {
          op: "upsert_node",
          node: { id: "n2", kind: "video", x: 360, y: 0, w: 320, h: 320 },
        },
        { op: "set_edges", edges: [{ id: "e1", from: "n1", to: "n2" }] },
      ],
      "default-test.json",
    );
    expect(result).toEqual({ board: "default-test.json", nodes: 2, edges: 1 });
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.nodes).toHaveLength(2);
    expect(await listBoards(root)).toEqual(["default-test.json"]);
    const read = await readBoard(root);
    expect(read.board).toBe("default-test.json");
    expect((read.document.nodes as unknown[]).length).toBe(2);

    await applyOperations(root, [{ op: "remove_node", id: "n1" }], "default-test.json");
    const afterRemove = JSON.parse(await readFile(path, "utf8"));
    expect(afterRemove.nodes).toHaveLength(1);
    expect(afterRemove.edges).toHaveLength(0);
  });

  it("writes a generation intent without executing it", async () => {
    const { root, path } = await board({
      nodes: [{ id: "n1", kind: "video", x: 0, y: 0, w: 320, h: 320 }],
    });
    const result = await requestGeneration(
      root,
      "n1",
      { prompt: "a fox running", seconds: "4", ratio: "9:16" },
      "default-test.json",
    );
    expect(result.requestId).toMatch(/^req-/);
    const saved = JSON.parse(await readFile(path, "utf8"));
    const generation = saved.nodes[0].generation;
    expect(generation.status).toBe("requested");
    expect(generation.request).toMatchObject({
      requestId: result.requestId,
      prompt: "a fox running",
      seconds: "4",
      ratio: "9:16",
    });

    await cancelGeneration(root, "n1", "default-test.json");
    const cancelled = JSON.parse(await readFile(path, "utf8"));
    expect(cancelled.nodes[0].generation.status).toBe("idle");
    expect(cancelled.nodes[0].generation.request).toBeUndefined();
  });

  it("reports missing boards and nodes explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-canvas-plugin-empty-"));
    await expect(readBoard(root)).rejects.toThrow(/canvas\.not-found/);
    const { root: withBoard } = await board({ nodes: [] });
    await expect(requestGeneration(withBoard, "missing", { prompt: "x" })).rejects.toThrow(
      /canvas\.node-not-found/,
    );
  });
});
