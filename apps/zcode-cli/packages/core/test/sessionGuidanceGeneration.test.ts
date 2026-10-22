import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionGuidanceSection } from "../src/context/dynamic-sections.js";

function guidanceContent(toolNames: string[]): string {
  return buildSessionGuidanceSection(toolNames, false)?.content ?? "";
}

test("本轮提供生成工具时给出路由指引", () => {
  const both = guidanceContent(["ImageGenerate", "VideoGenerate"]);
  assert.match(both, /For image or video output, use ImageGenerate \/ VideoGenerate:/);
  assert.match(both, /don't route generation requests to a skill or shell script/);
});

test("只注册一个生成工具时指引只点名它", () => {
  const imageOnly = guidanceContent(["ImageGenerate"]);
  assert.match(imageOnly, /use ImageGenerate:/);
  assert.doesNotMatch(imageOnly, /VideoGenerate/);
});

test("没有生成工具的会话不出现该指引", () => {
  assert.equal(guidanceContent(["Bash", "Read", "Skill"]), "");
});
