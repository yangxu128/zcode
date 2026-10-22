import { memo } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export const CanvasSelectionToolbar = memo(function CanvasSelectionToolbar({
  x,
  y,
  count,
  onAlign,
  onDistribute,
  onDelete,
}: {
  x: number;
  y: number;
  count: number;
  onAlign: (mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => void;
  onDistribute: (axis: "h" | "v") => void;
  onDelete: () => void;
}) {
  const { intl } = useZCodeIntl();
  const alignModes: {
    mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
    key: string;
  }[] = [
    { mode: "left", key: "canvas.align.left" },
    { mode: "hcenter", key: "canvas.align.hcenter" },
    { mode: "right", key: "canvas.align.right" },
    { mode: "top", key: "canvas.align.top" },
    { mode: "vcenter", key: "canvas.align.vcenter" },
    { mode: "bottom", key: "canvas.align.bottom" },
  ];
  return (
    <div
      className="zcode-canvas-selection-toolbar"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {alignModes.map(({ mode, key }) => (
        <button
          key={mode}
          type="button"
          className="zcode-canvas-selection-btn"
          title={intl.formatMessage({ id: key })}
          onClick={() => onAlign(mode)}
        >
          {intl.formatMessage({ id: key }).slice(0, 1)}
        </button>
      ))}
      <button
        type="button"
        className="zcode-canvas-selection-btn"
        title={intl.formatMessage({ id: "canvas.distribute.h" })}
        onClick={() => onDistribute("h")}
      >
        ↔
      </button>
      <button
        type="button"
        className="zcode-canvas-selection-btn"
        title={intl.formatMessage({ id: "canvas.distribute.v" })}
        onClick={() => onDistribute("v")}
      >
        ↕
      </button>
      <span className="zcode-canvas-ctl-sep" />
      <span className="text-ui-xs text-foreground-subtle">{count}</span>
      <button
        type="button"
        className="zcode-canvas-selection-btn danger"
        title={intl.formatMessage({ id: "canvas.delete" })}
        onClick={onDelete}
      >
        ⌫
      </button>
    </div>
  );
});
