import { LockKeyholeIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type {
  ProviderModelInputFormatDraft,
  ProviderModelOutputFormatDraft,
} from "@/settings/model-provider-section/ProviderModelMetadata.js";
import { modelEditorControlStyle } from "@/settings/model-provider-section/modelEditorControlStyle.js";
import { ModelOptionCheckbox } from "@/settings/model-provider-section/ProviderModelMetadataFields.js";

// PDF 已经是正式的模型输入事实和可执行附件能力，旧列表漏掉它后用户无法修正该事实。
// Audio 仍没有设置页附件入口，因此继续只在 Draft 中无损保留。
const INPUT_MODALITY_OPTIONS = ["text", "image", "video", "pdf"] as const;

const INPUT_MODALITY_FIELDS = {
  image: "supportsImage",
  video: "supportsVideo",
  pdf: "supportsPdf",
} as const satisfies Record<Exclude<(typeof INPUT_MODALITY_OPTIONS)[number], "text">, string>;

type VisibleModelFormat = (typeof INPUT_MODALITY_OPTIONS)[number];
type ProviderModelInputFormatOverlay = Partial<
  Record<keyof ProviderModelInputFormatDraft, boolean | null>
>;

function ModalityOption({
  modality,
  selected,
  disabled = false,
  overridden = false,
  onToggle,
}: {
  modality: VisibleModelFormat;
  selected: boolean;
  disabled?: boolean;
  overridden?: boolean;
  onToggle?: () => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      aria-pressed={selected}
      disabled={disabled}
      data-selected={selected}
      data-personal-override={overridden}
      data-model-input-modality={modality}
      className={cn(
        "gap-2 px-3 disabled:opacity-100",
        modelEditorControlStyle(overridden, selected),
      )}
      onClick={onToggle}
    >
      <ModelOptionCheckbox selected={selected} />
      <span>{intl.formatMessage({ id: `settings.modelProvider.modality.${modality}` })}</span>
      {disabled ? (
        <LockKeyholeIcon
          className="size-3.5 shrink-0 text-foreground-subtle"
          aria-hidden="true"
          data-model-modality-lock="true"
        />
      ) : null}
    </Button>
  );
}

export function ProviderModelInputModalityOptions({
  value,
  onChange,
  personalValue,
  overrideFields,
}: {
  value: ProviderModelInputFormatDraft;
  onChange: (value: ProviderModelInputFormatDraft) => void;
  personalValue?: ProviderModelInputFormatOverlay | null;
  overrideFields?: ReadonlySet<string>;
}) {
  const selected = {
    text: value.supportsText,
    image: value.supportsImage,
    video: value.supportsVideo,
    pdf: value.supportsPdf,
  };
  return (
    <div className="flex flex-wrap gap-2">
      {INPUT_MODALITY_OPTIONS.map((modality) => {
        const disabled = modality === "text";
        const field = disabled ? "supportsText" : INPUT_MODALITY_FIELDS[modality];
        const overridden =
          !disabled &&
          (overrideFields
            ? overrideFields.has(`inputFormatValue.${field}`)
            : personalValue?.[field] !== undefined);
        return (
          <div key={modality}>
            <ModalityOption
              modality={modality}
              selected={disabled || selected[modality]}
              disabled={disabled}
              overridden={overridden}
              onToggle={
                disabled
                  ? undefined
                  : () => onChange({ ...value, supportsText: true, [field]: !value[field] })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

const OUTPUT_MODALITY_OPTIONS = ["text", "image", "video"] as const;

const OUTPUT_MODALITY_FIELDS = {
  image: "supportsImage",
  video: "supportsVideo",
} as const satisfies Record<Exclude<(typeof OUTPUT_MODALITY_OPTIONS)[number], "text">, string>;

type VisibleOutputModelFormat = (typeof OUTPUT_MODALITY_OPTIONS)[number];
type ProviderModelOutputFormatOverlay = Partial<
  Record<keyof ProviderModelOutputFormatDraft, boolean | null>
>;

export function ProviderModelOutputModalityOptions({
  value,
  onChange,
  personalValue,
  overrideFields,
}: {
  value: ProviderModelOutputFormatDraft;
  onChange: (value: ProviderModelOutputFormatDraft) => void;
  personalValue?: ProviderModelOutputFormatOverlay | null;
  overrideFields?: ReadonlySet<string>;
}) {
  const { intl } = useZCodeIntl();
  // 输出的生图/生视频字段是可选扩展，缺省按 false 语义。
  const selected = {
    text: value.supportsText,
    image: Boolean(value.supportsImage),
    video: Boolean(value.supportsVideo),
  };
  // 输出的 text 可取消勾选（生图/生视频专用模型）；至少一项由提交校验兜底。
  return (
    <div className="flex flex-wrap gap-2">
      {OUTPUT_MODALITY_OPTIONS.map((modality) => {
        const field = modality === "text" ? "supportsText" : OUTPUT_MODALITY_FIELDS[modality];
        const overridden = overrideFields
          ? overrideFields.has(`outputFormatValue.${field}`)
          : personalValue?.[field] !== undefined;
        return (
          <div key={modality}>
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-pressed={selected[modality]}
              data-selected={selected[modality]}
              data-personal-override={overridden}
              data-model-output-modality={modality}
              className={cn("gap-2 px-3", modelEditorControlStyle(overridden, selected[modality]))}
              onClick={() => onChange({ ...value, [field]: !value[field] })}
            >
              <ModelOptionCheckbox selected={selected[modality]} />
              <span>
                {intl.formatMessage({
                  id: `settings.modelProvider.outputModality.${modality}`,
                })}
              </span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
