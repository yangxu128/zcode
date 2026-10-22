// ============================================================
// Generation Port - 生图/生视频模型的宿主执行边界
// ============================================================
// 端口契约见本文件；宿主（bootstrap）用 provider 注册表活视图 + 节点 fetch 实现之。
// core 工具层零 I/O、零凭据：apiKey 只存在宿主实现内部，绝不进入工具结果。

export type GenerationModality = "image" | "video";

export interface GenerationTarget {
  readonly providerId: string;
  readonly providerName?: string;
  readonly modelId: string;
  readonly modality: GenerationModality;
}

export interface ImageGenerateRequest {
  readonly prompt: string;
  /** 档位（1K/2K/3K/4K）或精确尺寸；缺席由服务端默认。 */
  readonly size?: string;
  readonly ratio?: string;
  /** 图生图/多图合成的参考图（URL 或 Data URI）。 */
  readonly image?: readonly string[];
}

export interface GeneratedImage {
  readonly url?: string;
  /** Base64 输出已被宿主落盘为工作区文件。 */
  readonly savedPath?: string;
}

export interface ImageGenerateResult {
  readonly modelId: string;
  readonly images: readonly GeneratedImage[];
}

export interface VideoGenerateRequest {
  readonly prompt: string;
  readonly seconds?: string;
  readonly aspectRatio?: string;
  /**
   * 输出分辨率档位（如 "720P"）。缺席时宿主按服务商文档补默认值：
   * 省略 size 会让 aspect_ratio 不生效（实测请求 9:16 回片 704×704 方形）。
   */
  readonly size?: string;
  readonly mode: "text" | "keyframe" | "reference";
  readonly firstFrame?: string;
  readonly lastFrame?: string;
  readonly images?: readonly string[];
  readonly audios?: readonly string[];
}

export interface VideoGenerateResult {
  readonly modelId: string;
  readonly videoId: string;
  readonly url: string;
}

export type VideoTaskOutcome =
  /**
   * `retryAfterMs` 是宿主从响应里读出的「下次查询不早于」建议（429/5xx 时给出）：
   * 查询频率属于调用方，服务商信号属于宿主，两边只传事实不做策略。
   */
  | { readonly status: "running"; readonly retryAfterMs?: number }
  | { readonly status: "completed"; readonly url: string }
  | { readonly status: "failed"; readonly detail?: string };

/**
 * 创建结果只有两种，且**由宿主按 HTTP 状态/错误码分类**（不解析错误文本）：
 * - created：任务已在服务商侧建立，拿 videoId 去查。
 * - queued：服务商明确说「现在不收」（429 限流、5xx 繁忙、连不上），
 *   请求没建成也不计费，调用方应当按 retryAfterMs 自动重投，而不是把失败甩给用户。
 */
export type VideoStartResult =
  | { readonly status: "created"; readonly videoId: string }
  | {
      readonly status: "queued";
      readonly retryAfterMs: number;
      /** 网关原文（含 request id），用于在界面上如实说明原因。 */
      readonly reason: string;
    };

export interface GenerationPort {
  /** 每次调用现读注册表活视图；仅列出启用且输出模态匹配的模型。 */
  listTargets(): GenerationTarget[];
  generateImage(
    target: { providerId: string; modelId: string },
    request: ImageGenerateRequest,
  ): Promise<ImageGenerateResult>;
  /**
   * 创建 + 轮询到完成的便捷面，供 VideoGenerate 工具使用。
   * UI 侧不用它：分钟级任务要走 startVideo/getVideoStatus，否则刷新即丢。
   */
  generateVideo(
    target: { providerId: string; modelId: string },
    request: VideoGenerateRequest,
  ): Promise<VideoGenerateResult>;
  /** 只创建任务，不等待完成；被拒时返回 queued 让调用方自动重投。 */
  startVideo(
    target: { providerId: string; modelId: string },
    request: VideoGenerateRequest,
  ): Promise<VideoStartResult>;
  /** 查询任务状态；宿主按 modelId 组装查询参数（部分网关要求 model_name）。 */
  getVideoStatus(
    target: { providerId: string; modelId: string },
    videoId: string,
  ): Promise<VideoTaskOutcome>;
  /**
   * 把生成端返回的临时外链落到工作区，返回相对路径（画布是长期文档，不能只存外链）。
   * 幂等：同一 URL 命中同一文件名，已存在则直接复用不重复下载。
   */
  materializeMedia(url: string): Promise<{ savedPath: string; reused: boolean }>;
  /**
   * 无副作用连通性探测：请求该模态的真实端点，载荷只带 model 与空 prompt。
   * 网关先校验鉴权与模型路由、再校验 prompt，因此不会创建计费任务；失败抛错，
   * 消息保留 API 原文（含 request id）。语义见 docs/agents/image-video-generation.md。
   */
  testConnectivity(
    target: { providerId: string; modelId: string },
    modality: GenerationModality,
  ): Promise<void>;
}
