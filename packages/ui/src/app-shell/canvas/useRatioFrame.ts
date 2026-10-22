import { useEffect, useRef } from "react";
import { framePatchForRatio } from "./canvasMediaStage.js";

/** 只用到框与「有没有结果」两件事，避免依赖 CanvasNode 联合类型里的分支字段。 */
interface RatioFrameTarget {
  w: number;
  h: number;
  url?: string;
  savedPath?: string;
}

/**
 * 选比例即改卡片形状（docs/ui/canvas-pane.md T7，即梦行为）。
 *
 * 两条规则：换画幅时立刻按目标比例重算节点宽高；还没有结果的卡片在挂载时也按当前档位
 * 预占位，这样新建的竖屏节点一上来就是竖框，而不是等出片后才突然变形。已有结果时挂载
 * 不改框——出片的固有比例才是画面的事实，之后由媒体加载回调负责贴合。
 *
 * 不会循环写文档：贴合后比例已对上，framePatchForRatio 返回 null。
 */
export function useRatioFrame(
  node: RatioFrameTarget,
  ratio: string,
  onUpdate: (patch: { w: number; h: number }) => void,
): void {
  // 只读最新值，不作为依赖：出片贴合会改宽高，若把它们列进依赖，
  // 比例贴合就会反过来把画面比例掰回请求值，两边来回写文档就是死循环。
  const latest = useRef({ node, onUpdate });
  latest.current = { node, onUpdate };
  const mounted = useRef(false);
  useEffect(() => {
    const isMount = !mounted.current;
    mounted.current = true;
    const current = latest.current;
    if (isMount && (current.node.url || current.node.savedPath)) return;
    const patch = framePatchForRatio({ w: current.node.w, h: current.node.h }, ratio);
    if (patch) current.onUpdate(patch);
    // 只在用户换档位（和首次挂载）时改框。
  }, [ratio]);
}
