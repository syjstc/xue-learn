import { getEnv } from "../env.js";
import { getCurrentUserId } from "../user-context.js";
import { getUserSettingsForUser } from "../user-settings.js";
import { getExplicitLlmSelection } from "../providers/llm/explicit-selection-context.js";
import { getActiveLlmOperationRoute } from "../providers/llm/operation-routing-context.js";
import { llmRuntimeConfigToSelection } from "../providers/llm/runtime.js";
import type { LlmProviderSelection } from "../providers/llm/types.js";
import { fetchCodexModelCatalog } from "../providers/llm/vendors/codex/runtime.js";
import { ensureLlmRuntimeConfig } from "./runtime-config.js";
import { guidedImageModelFromPreferences } from "./guided-image-model-settings.js";

export type GuidedImageModelRoute = {
  selection: LlmProviderSelection;
  imageDetail: "high" | "original";
  source: "current" | "manual" | "fallback";
};

/** Known image-input models, not the separate image-generation catalog. */
export function knownImageInputModel(selection: LlmProviderSelection): boolean {
  const model = (
    selection.model ??
    selection.options?.chatModel ??
    ""
  ).toLowerCase();
  switch (selection.id) {
    case "codex":
    case "openai":
      return (
        /^gpt-(?:4o(?:-|$)|4\.1(?:-|$)|5(?:[.-]|$)|6(?:[.-]|$))/.test(model) &&
        !model.includes("spark")
      );
    case "deepseek":
      return model === "deepseek-flash";
    case "minimax":
      return model === "minimax-m3";
    case "bigmodel":
      return (
        model === "glm-5.3-flash" || /^glm-4(?:\.[56])?v(?:-|$)/.test(model)
      );
    case "doubao":
      return /^doubao-seed-(?:1-6|1-8|2-0-(?:pro|lite|mini)|2-1-(?:pro|lite|mini|turbo))(?:-|$)/.test(
        model,
      );
    case "fireworks":
      return /^accounts\/fireworks\/models\/kimi-k2p[56]$/.test(model);
    case "custom":
      // Compatible endpoints often retain the upstream model id. Only opaque
      // private aliases need a manual choice; the endpoint protocol alone does
      // not determine whether its selected model can see images.
      return (
        [
          "openai",
          "deepseek",
          "minimax",
          "bigmodel",
          "doubao",
          "fireworks",
        ] as const
      ).some((id) => knownImageInputModel({ ...selection, id }));
    default:
      // Private aliases and local model names require metadata or a manual pick.
      return false;
  }
}

function defaultImageDetail(
  selection: LlmProviderSelection,
): "high" | "original" {
  const model = selection.model ?? selection.options?.chatModel ?? "";
  return selection.id === "deepseek" ||
    ((selection.id === "codex" || selection.id === "openai") &&
      /^(?:gpt-5\.[45]$|gpt-5\.6-|gpt-6[.-])/.test(model))
    ? "original"
    : "high";
}

async function imageInputCapabilities(
  selection: LlmProviderSelection,
  signal?: AbortSignal,
) {
  if (selection.id === "codex") {
    // Read the signed-in account's capabilities. Auth/network errors must remain
    // visible rather than silently consuming a different provider's credits.
    const catalog = await fetchCodexModelCatalog(signal);
    const model = catalog.find(
      (item) => item.id === (selection.model ?? selection.options?.chatModel),
    );
    return {
      supported: model?.inputModalities
        ? model.inputModalities.includes("image")
        : knownImageInputModel(selection),
      imageDetail:
        model?.supportsImageDetailOriginal === undefined
          ? defaultImageDetail(selection)
          : model.supportsImageDetailOriginal
            ? ("original" as const)
            : ("high" as const),
    };
  }
  if (selection.id === "ollama") {
    const base = getEnv().OLLAMA_BASE_URL.replace(/\/(?:v1\/?)?$/, "");
    const response = await fetch(`${base}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: selection.model ?? selection.options?.chatModel,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Ollama model capabilities request failed (HTTP ${response.status})`,
      );
    const model = (await response.json()) as { capabilities?: string[] };
    return {
      supported: model.capabilities?.includes("vision") === true,
      imageDetail: "high" as const,
    };
  }
  return {
    supported: knownImageInputModel(selection),
    imageDetail: defaultImageDetail(selection),
  };
}

/** Shared by classroom segmentation/narration and Remotion observation. */
export async function resolveGuidedImageModelRoute(
  input: {
    selection?: LlmProviderSelection;
    signal?: AbortSignal;
  } = {},
): Promise<GuidedImageModelRoute> {
  input.signal?.throwIfAborted();
  if (input.selection) {
    return {
      selection: input.selection,
      imageDetail: defaultImageDetail(input.selection),
      source: "manual",
    };
  }
  const runtime = await ensureLlmRuntimeConfig();
  const runtimeSelection = llmRuntimeConfigToSelection(runtime);
  const userId = getCurrentUserId();
  if (process.env.XUELEARN_DESKTOP_LOCAL === "1" && userId) {
    const row = await getUserSettingsForUser(userId);
    const settings = guidedImageModelFromPreferences(
      row?.clientPreferencesJson,
    );
    if (settings.mode === "manual") {
      const selection: LlmProviderSelection = {
        id: settings.providerId,
        model: settings.model,
        options: { ...runtimeSelection.options, chatModel: settings.model },
      };
      // An explicit choice also supports private model aliases absent from any catalog.
      return {
        selection,
        imageDetail: defaultImageDetail(selection),
        source: "manual",
      };
    }
  }
  const current =
    getExplicitLlmSelection() ??
    getActiveLlmOperationRoute()?.selection ??
    runtimeSelection;
  const capabilities = await imageInputCapabilities(current, input.signal);
  input.signal?.throwIfAborted();
  if (capabilities.supported) {
    return {
      selection: current,
      imageDetail: capabilities.imageDetail,
      source: "current",
    };
  }
  return {
    selection: {
      id: "deepseek",
      model: "deepseek-flash",
      options: { chatModel: "deepseek-flash", deepseekThinkingEnabled: false },
    },
    imageDetail: "original",
    source: "fallback",
  };
}
