import assert from "node:assert/strict";
import test from "node:test";
import { generatedMediaFileName } from "../src/app/generated-media.js";

test("扩展名优先取 content-type，其次取 URL 后缀", () => {
  assert.match(generatedMediaFileName("https://x/a", "image/png"), /^[0-9a-f]{16}\.png$/);
  assert.match(generatedMediaFileName("https://x/a", "video/mp4"), /^[0-9a-f]{16}\.mp4$/);
  assert.match(generatedMediaFileName("https://x/a.webm", "application/octet-stream"), /\.webm$/);
  assert.match(generatedMediaFileName("https://x/a.jpeg", ""), /\.jpg$/);
  assert.match(generatedMediaFileName("https://x/a", ""), /\.png$/);
});

test("文件名不含 URL 路径片段，挡掉穿越与非法字符", () => {
  const nasty = "https://x/../../Windows/system32/config%00sam.png";
  const name = generatedMediaFileName(nasty, "image/png");
  assert.doesNotMatch(name, /[\\/]/);
  assert.doesNotMatch(name, /\.\./);
  assert.match(name, /^[0-9a-f]{16}\.png$/);
});

test("同一 URL 稳定同名，不同 URL 不同名（幂等复用依赖这一点）", () => {
  const a = generatedMediaFileName("https://x/a.png", "image/png");
  assert.equal(a, generatedMediaFileName("https://x/a.png", "image/png"));
  assert.notEqual(a, generatedMediaFileName("https://x/b.png", "image/png"));
});
