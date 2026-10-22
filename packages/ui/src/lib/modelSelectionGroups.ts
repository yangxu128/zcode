import {
  isZCodeAgentProvider,
  resolveModelProviderFamilySpecByProviderId,
  zcodeProviderAccountAccessSchema,
  type ZCodeProviderAccountAccess,
  type ZCodeProvider,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";

export interface ModelProviderGroupLabelOptions {
  apiKeyLabel?: string;
  apiKeyBadgeLabel?: string;
  codingPlanLabel?: string;
  codingPlanBadgeLabel?: string;
  startPlanLabel?: string;
  startPlanBadgeLabel?: string;
  teamPlanBadgeLabel?: string;
  teamPlanFallbackLabel?: string;
}

function supportsRegistryApiFormat(
  selectedProvider: ZCodeProvider,
  apiFormat: string | null | undefined,
): boolean {
  if (!apiFormat) return false;
  // 仅剩 glm（ZCode Agent）provider；三方 CLI 的 api format 差异已随 provider 下线。
  return isZCodeAgentProvider(selectedProvider);
}

export function buildRegistryModelSelectGroups(
  selectedProvider: ZCodeProvider,
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions = {},
): ModelSelectGroup[] {
  return view.providers.flatMap((provider) => {
    if (!supportsRegistryApiFormat(selectedProvider, provider.config.api?.type)) {
      return [];
    }

    const accountAccess = zcodeProviderAccountAccessSchema.safeParse(provider.config.access);
    const accountPresentation = accountAccess.success
      ? getRegistryAccountProviderGroupPresentation(provider.providerId, accountAccess.data, labels)
      : null;

    // 生图/生视频等非文本输出模型不是聊天模型（docs/ui/provider-model-output-modality.md），
    // 不进入聊天模型选择器；否则选择后必然产生无法完成的对话请求。
    // 稀疏 personal overlay 会把 supportsText=false 与基线相等的叶子剥掉，
    // 因此判定「显式声明生图/生视频且未显式声明文本输出」即排除。
    const items = provider.models
      .filter(({ config }) => {
        const outputFormat = config.properties?.outputFormat;
        if (!outputFormat) return true;
        // 声明了生图/生视频输出能力的模型是生成模型：即便内置 catch-all 规则
        // 叠加了 supportsText: true，输出模态意图仍权威，从聊天选择器排除。
        if (outputFormat.supportsImage === true || outputFormat.supportsVideo === true) {
          return false;
        }
        return outputFormat.supportsText !== false;
      })
      .map(({ modelId, config }) => ({
        key: `registry-provider:${provider.providerId}:${modelId}`,
        value: encodeCustomModelValue(provider.providerId, modelId),
        name: modelId,
        ...(shouldShowModelVisionBadge(
          modelId,
          config.properties?.inputFormat?.supportsImage,
          provider.config.access,
        )
          ? { supportsVisionInput: true }
          : {}),
      }));

    // 过滤后没有可选项的供应商（只有生成模型、或模型全部禁用）不能继续渲染：
    // 选择器会留下一个点开为空的供应商条目，用户看到的是「模型列表没出来」。
    if (items.length === 0) return [];

    // 合并菜单仍需区分同名供应商的接入方式；API 标识直接来自 access，不能从名称猜测。
    const labelBadge =
      accountPresentation?.labelBadge ??
      (provider.config.access?.type === "api-key" ||
      provider.config.access?.type === "zhipu-coding-plan-api-key"
        ? (labels.apiKeyBadgeLabel ?? "API")
        : undefined);

    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label: accountPresentation?.label || provider.providerName?.trim() || provider.providerId,
        ...(provider.config.logo ? { logo: provider.config.logo } : {}),
        ...(labelBadge ? { labelBadge } : {}),
        ...(accountPresentation ? { directItems: true } : {}),
        items,
      },
    ];
  });
}

function getRegistryAccountProviderGroupPresentation(
  providerId: string,
  access: ZCodeProviderAccountAccess,
  labels: ModelProviderGroupLabelOptions,
): Pick<ModelSelectGroup, "label" | "labelBadge"> {
  const familySpec = resolveModelProviderFamilySpecByProviderId(providerId);
  const label = familySpec?.label ?? providerId;
  if (access.mode === "start-plan") {
    return { label: "Start Plan", labelBadge: labels.startPlanBadgeLabel ?? "Free" };
  }
  if (access.mode === "team-coding-plan") {
    return { label, labelBadge: labels.teamPlanBadgeLabel ?? "Team" };
  }
  return { label, labelBadge: labels.codingPlanBadgeLabel ?? "Individual" };
}

export function resolveModelDisplayName(
  modelGroups: readonly ModelSelectGroup[],
  value: string,
): string | null {
  for (const group of modelGroups) {
    const matched = group.items.find((item) => item.value === value);
    if (matched) return matched.name;
  }

  return decodeCustomModelValue(value)?.modelName ?? null;
}
