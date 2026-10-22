// ============================================================
// 生成端点的连接探测判定（docs/agents/image-video-generation.md「失败语义」）
// ============================================================
// 探测载荷刻意留空 prompt：网关按「鉴权 → 模型路由 → 参数」顺序校验，因此空 prompt
// 只会停在参数校验，不会创建计费任务，却能证明端点可达且凭据有效。

import type { GenerationModality } from "@zcode/contracts";
import { extractErrorMessage, extractResponseErrorCode } from "./generation-http.js";

export const GENERATION_CONNECTIVITY_TIMEOUT_MS = 20_000;
export const GENERATION_CONNECTIVITY_PROMPT = "";
export const GENERATION_CONNECTIVITY_PATH: Record<GenerationModality, string> = {
  image: "/images/generations",
  video: "/videos",
};

const MODALITY_LABEL: Record<GenerationModality, string> = {
  image: "生图",
  video: "生视频",
};
const MODEL_NOT_FOUND_ERROR_CODE = "model_not_found";

/**
 * 按状态码与结构化错误码分类，不解析自由文本。
 * 返回 undefined 表示连通；返回字符串是给用户看的失败原因（保留 API 原文）。
 */
export function describeGenerationConnectivityFailure(
  modality: GenerationModality,
  path: string,
  status: number,
  json: unknown,
): string | undefined {
  if (status >= 200 && status < 300) return undefined;
  const detail = extractErrorMessage(json);
  if (extractResponseErrorCode(json) === MODEL_NOT_FOUND_ERROR_CODE) {
    return `${MODALITY_LABEL[modality]}端点没有该模型：${detail}`;
  }
  if (status === 401 || status === 403) return `认证失败：${detail}`;
  if (status === 404) {
    return `端点不支持${MODALITY_LABEL[modality]}：${path}（${detail}）`;
  }
  if (status >= 500) return `服务端错误（HTTP ${status}）：${detail}`;
  // 其余 4xx：请求已到达端点且凭据被接受，只是探测载荷被拒 → 连通性成立。
  return undefined;
}
