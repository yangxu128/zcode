import assert from "node:assert/strict";
import test from "node:test";
import { describeGenerationConnectivityFailure } from "../src/app/generation-connectivity.js";
import { pickGenerationModality } from "../src/app/generation-port.js";

const IMAGE_PATH = "/images/generations";
const VIDEO_PATH = "/videos";

test("空 prompt 的参数被拒说明端点可达且凭据有效", () => {
  // Agnes 实测：有效模型 + 空 prompt → 400 invalid_request（鉴权与模型路由已先通过）。
  const image = describeGenerationConnectivityFailure("image", IMAGE_PATH, 400, {
    error: {
      message: "prompt is required (request id: 20261010012837848465735ZAR2Fl7F)",
      type: "invalid_request",
      param: "",
      code: "invalid_request",
    },
  });
  assert.equal(image, undefined);
  const video = describeGenerationConnectivityFailure("video", VIDEO_PATH, 400, {
    code: "invalid_request",
    message: "prompt is required (request id: 202610100128382645265549OQ1kbj4)",
    data: null,
  });
  assert.equal(video, undefined);
});

test("凭据无效按认证失败报告", () => {
  const message = describeGenerationConnectivityFailure("image", IMAGE_PATH, 401, {
    error: { code: "", message: "Invalid token (request id: abc)", type: "AgnesAI_error" },
  });
  assert.match(String(message), /^认证失败：Invalid token/);
  assert.equal(
    describeGenerationConnectivityFailure("video", VIDEO_PATH, 403, {
      error: { message: "forbidden" },
    }) === undefined,
    false,
  );
});

test("模型不可用用结构化错误码识别，不受网关用 503 表达影响", () => {
  const image = describeGenerationConnectivityFailure("image", IMAGE_PATH, 503, {
    error: {
      code: "model_not_found",
      message: "No available channel for model x under group default (distributor)",
      type: "AgnesAI_error",
    },
  });
  assert.match(String(image), /^生图端点没有该模型/);
  const video = describeGenerationConnectivityFailure("video", VIDEO_PATH, 503, {
    code: "model_not_found",
    message: "No available channel for model x",
  });
  assert.match(String(video), /^生视频端点没有该模型/);
});

test("端点缺失与服务端错误都是失败", () => {
  assert.match(
    String(describeGenerationConnectivityFailure("video", VIDEO_PATH, 404, { message: "not found" })),
    /^端点不支持生视频/,
  );
  assert.match(
    String(describeGenerationConnectivityFailure("image", IMAGE_PATH, 500, { error: { message: "boom" } })),
    /^服务端错误（HTTP 500）：boom/,
  );
});

test("2xx 直接通过", () => {
  assert.equal(describeGenerationConnectivityFailure("image", IMAGE_PATH, 200, { data: [] }), undefined);
});

test("输出模态判据与聊天选择器同源：先图后视频", () => {
  assert.equal(
    pickGenerationModality({ properties: { outputFormat: { supportsImage: true } } }),
    "image",
  );
  assert.equal(
    pickGenerationModality({
      properties: { outputFormat: { supportsText: true, supportsVideo: true } },
    }),
    "video",
  );
  // 内置 catch-all 叠加 supportsText 不改变生成模型意图，但图像声明优先。
  assert.equal(
    pickGenerationModality({
      properties: { outputFormat: { supportsText: true, supportsImage: true, supportsVideo: true } },
    }),
    "image",
  );
  assert.equal(
    pickGenerationModality({ properties: { outputFormat: { supportsText: true } } }),
    undefined,
  );
  assert.equal(pickGenerationModality({}), undefined);
});
