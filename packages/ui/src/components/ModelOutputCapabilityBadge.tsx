import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export const MODEL_OUTPUT_CAPABILITY_BADGE_CLASS_NAME =
  "pointer-events-none inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-1 py-px text-ui-xs font-medium leading-normal text-foreground-subtle";

/** 生图/生视频输出徽标（docs/ui/provider-model-output-modality.md）。 */
export function ModelOutputCapabilityBadge({
  kind,
  className,
}: {
  kind: "image" | "video";
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: `model.capability.output.${kind}` });

  return (
    <span
      className={cn(MODEL_OUTPUT_CAPABILITY_BADGE_CLASS_NAME, className)}
      data-model-output-capability={kind}
      aria-label={label}
      title={label}
    >
      {label}
    </span>
  );
}
