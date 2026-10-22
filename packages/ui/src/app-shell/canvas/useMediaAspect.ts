import { useEffect, useRef, type RefObject } from "react";

function readAspect(el: HTMLImageElement | HTMLVideoElement | null): number | null {
  if (!el) return null;
  const width = "videoWidth" in el ? el.videoWidth : el.naturalWidth;
  const height = "videoHeight" in el ? el.videoHeight : el.naturalHeight;
  return width > 0 && height > 0 ? width / height : null;
}

/**
 * 把媒体固有宽高比报给调用方，**只在换素材时报一次**。
 *
 * 不能挂在内联 ref 回调上：React 每次渲染都会以 null/元素各调一次内联 ref，
 * 报比例之后调用方会写节点宽高，写文档又触发渲染 —— 死循环（实测
 * 「Maximum update depth exceeded」把画布整块崩掉）。事件监听同理只装一次。
 */
export function useMediaAspect<T extends HTMLImageElement | HTMLVideoElement>(
  ref: RefObject<T | null>,
  source: string | undefined,
  onAspect?: (aspect: number) => void,
): void {
  const callback = useRef(onAspect);
  callback.current = onAspect;
  useEffect(() => {
    const report = () => {
      const aspect = readAspect(ref.current);
      if (aspect !== null) callback.current?.(aspect);
    };
    // 命中缓存时元素挂载就已经解码完，事件不会再补，所以先主动读一次。
    report();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("load", report);
    el.addEventListener("loadedmetadata", report);
    return () => {
      el.removeEventListener("load", report);
      el.removeEventListener("loadedmetadata", report);
    };
  }, [source, ref]);
}
