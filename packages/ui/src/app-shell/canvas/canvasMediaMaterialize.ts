import { logger } from "@/logger.js";
import type { IZCodeAgentService } from "@zcode/services";

/**
 * 把生成端返回的临时外链落到工作区（docs/ui/canvas-pane.md T6）。
 * 落地失败不判生成失败：画布仍保留外链可用，只记 debug 日志。
 */
export async function materializeGeneratedMedia(input: {
  service: Pick<IZCodeAgentService, "saveWorkspaceGeneratedMedia">;
  workspacePath: string;
  workspaceIdentity?: string;
  url: string;
}): Promise<string | undefined> {
  try {
    const result = await input.service.saveWorkspaceGeneratedMedia({
      workspacePath: input.workspacePath,
      ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
      url: input.url,
    });
    return result.savedPath;
  } catch (error) {
    logger.debug("[Canvas] 生成结果落地失败，保留外链", {
      url: input.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
