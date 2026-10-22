// ============================================================
// ImageGenerate / VideoGenerate Tools - 生成模型的 agent 工具面
// ============================================================

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

export const ImageGenerateInputSchema = z.object({
  prompt: z.string().min(1).describe("What to generate. Structure: [subject] + [scene] + [style] + [lighting] + [composition] + [quality]"),
  model: z.string().optional().describe("Target model as providerId/modelId. Omit to use the first available image-generation model"),
  size: z.string().optional().describe("Output size tier: 1K / 2K / 3K / 4K (recommended), or an exact size like 1024x768"),
  ratio: z.string().optional().describe("Aspect ratio used with tiered size: 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9. Default 1:1"),
  image: z.array(z.string()).optional().describe("Reference image URLs or Data URIs for image-to-image / multi-image composition"),
});
export type ImageGenerateInput = z.infer<typeof ImageGenerateInputSchema>;
export const ImageGenerateInputJsonSchema = toToolJsonSchema(ImageGenerateInputSchema);

export interface ImageGenerateOutput {
  model: string;
  images: { url?: string; savedPath?: string }[];
  note?: string;
}
export const ImageGenerateOutputJsonSchema = toToolJsonSchema(
  z.object({
    model: z.string(),
    images: z.array(z.object({ url: z.string().optional(), savedPath: z.string().optional() })),
    note: z.string().optional(),
  }),
);

export const VideoGenerateInputSchema = z.object({
  prompt: z.string().min(1).describe("Video content description"),
  model: z.string().optional().describe("Target model as providerId/modelId. Omit to use the first available video-generation model"),
  seconds: z.string().optional().describe("Duration in seconds as string, 4-12. Default 5"),
  aspect_ratio: z.string().optional().describe("Aspect ratio: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9. Default 16:9"),
});
export type VideoGenerateInput = z.infer<typeof VideoGenerateInputSchema>;
export const VideoGenerateInputJsonSchema = toToolJsonSchema(VideoGenerateInputSchema);

export interface VideoGenerateOutput {
  model: string;
  videoId: string;
  url: string;
}
export const VideoGenerateOutputJsonSchema = toToolJsonSchema(
  z.object({ model: z.string(), videoId: z.string(), url: z.string() }),
);
