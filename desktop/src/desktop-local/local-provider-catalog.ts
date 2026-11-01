import { translateCurrent } from "@xue-learn/core/i18n";
import {
  BUILTIN_EMBEDDING_MODEL_ID,
  defaultLocalChatThinkingSettings,
  type CustomThinkingProtocol,
  type LocalChatThinkingSettings,
  type LocalProviderId,
} from "@xue-learn/core/runtime-contracts";
import { minimaxThinkingConfigurable } from "@/shared/llm/minimax-thinking";
import { doubaoThinkingConfigurable } from "@/shared/llm/doubao-thinking";

export function localAudioModelLabel(modelId: string): string {
  if (modelId === "qwen-audio-3.0-tts-plus") return `${modelId} · Plus`;
  if (modelId === "qwen3-tts-vc-2026-01-22")
    return `${modelId} · ${translateCurrent("desktop.i18n.voiceClone")}`;
  return modelId;
}

export type LocalModelCapability = "chat" | "image" | "audio" | "embedding";

export type LocalProviderPreset = {
  label: string;
  baseUrl?: string;
  models: readonly string[];
  customEndpoint?: boolean;
};

export const LOCAL_PROVIDER_DEFAULT_URLS: Partial<
  Record<LocalProviderId, string>
> = {
  minimax: "https://api.minimaxi.com/v1",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  fireworks: "https://api.fireworks.ai/inference/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  bigmodel: "https://open.bigmodel.cn/api/paas/v4",
  ollama: "http://127.0.0.1:11434",
  apimart: "https://api.apimart.ai",
  krill: "https://api.krill-code.net/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  codex: "https://chatgpt.com/backend-api/codex",
};

export const LOCAL_DEFAULT_MODELS: Record<
  LocalModelCapability,
  Record<string, readonly string[]>
> = {
  chat: {
    qwen: [],
    minimax: [
      "MiniMax-M3",
      "MiniMax-M3.1-Flash",
      "MiniMax-M2.7-highspeed",
      "MiniMax-M2.7",
    ],
    openai: ["gpt-5.6-luna"],
    deepseek: ["deepseek-flash"],
    fireworks: [
      "accounts/fireworks/models/kimi-k2p6",
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
    ],
    doubao: [
      "doubao-seed-2-1-turbo-260628",
      "doubao-seed-2-0-lite-260215",
      "doubao-seed-2-0-mini-260215",
    ],
    bigmodel: ["glm-5.3-flash"],
    ollama: ["gemma4:e2b-mlx", "llama3.2", "mistral", "qwen2.5"],
    // The account-scoped catalog supplies Codex models after sign-in.
    codex: [],
  },
  image: {
    minimax: ["image-01"],
    apimart: ["gpt-image-2"],
    doubao: ["doubao-seedream-5-0-260128"],
    krill: ["gpt-image-2"],
    codex: ["gpt-image-2.5-flare", "gpt-image-2"],
  },
  audio: {
    minimax: [
      "speech-2.8-turbo",
      "speech-2.8-hd",
      "speech-02-turbo",
      "speech-02-hd",
    ],
    doubao: ["seed-tts-2.0"],
    qwen: [
      "qwen3-tts-vc-2026-01-22",
      "qwen3-tts-flash",
      "qwen3-tts-instruct-flash",
      "qwen-audio-3.0-tts-plus",
    ],
    cartesia: ["sonic-3.6"],
  },
  embedding: {
    builtin: [BUILTIN_EMBEDDING_MODEL_ID],
    ollama: [],
    custom_embedding: [],
  },
};

export const LOCAL_PROVIDER_CAPABILITIES: Partial<
  Record<LocalProviderId, readonly LocalModelCapability[]>
> = {
  builtin: ["embedding"],
  custom_embedding: ["embedding"],
  custom: ["chat"],
  minimax: ["chat", "image", "audio"],
  openai: ["chat"],
  deepseek: ["chat"],
  fireworks: ["chat"],
  doubao: ["chat", "image", "audio"],
  qwen: ["chat", "audio"],
  cartesia: ["audio"],
  bigmodel: ["chat"],
  ollama: ["chat", "embedding"],
  codex: ["chat", "image"],
  apimart: ["image"],
  krill: ["image"],
};

const LOCAL_CHAT_PROVIDER_LABELS: Record<string, string> = {
  qwen: "Qwen",
  custom: "OpenAI-compatible",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  doubao: "Doubao",
  bigmodel: "BigModel",
  minimax: "MiniMax",
  codex: "Codex",
  ollama: "Ollama",
};

/**
 * One UI/runtime catalog for OpenAI-compatible chat providers. The custom
 * entry is the common contract; named vendors are presets that may add a
 * specialized server adapter for protocol differences.
 */
export const LOCAL_CHAT_PROVIDER_PRESETS: Record<string, LocalProviderPreset> =
  Object.fromEntries(
    ["custom", ...Object.keys(LOCAL_DEFAULT_MODELS.chat)].map((providerId) => [
      providerId,
      {
        get label() {
          return providerId === "codex"
            ? translateCurrent("desktop.apiKeys.codex.label")
            : (LOCAL_CHAT_PROVIDER_LABELS[providerId] ?? providerId);
        },
        baseUrl: LOCAL_PROVIDER_DEFAULT_URLS[providerId as LocalProviderId],
        models: LOCAL_DEFAULT_MODELS.chat[providerId] ?? [],
        ...(providerId === "custom" ? { customEndpoint: true } : {}),
      },
    ]),
  );

export type LocalChatThinkingControl =
  | { kind: "none" }
  | {
      kind: "switch";
      field:
        | "minimaxThinkingEnabled"
        | "deepseekThinkingEnabled"
        | "ollamaThinkingEnabled"
        | "openaiThinkingEnabled"
        | "bigmodelThinkingEnabled"
        | "qwenThinkingEnabled";
      configurable: boolean;
      customEndpoint?: boolean;
    }
  | { kind: "doubao"; configurable: boolean; customEndpoint?: boolean }
  | { kind: "minimax-effort" }
  | {
      kind: "custom";
      protocol: CustomThinkingProtocol;
      inner: Exclude<LocalChatThinkingControl, { kind: "custom" }>;
    };

function vendorChatThinkingControl(
  providerId: string,
  model: string,
  customEndpoint = false,
): Exclude<LocalChatThinkingControl, { kind: "custom" }> {
  if (providerId === "minimax") {
    if (/^MiniMax-M3\.1-Flash$/i.test(model.trim())) {
      return { kind: "minimax-effort" };
    }
    return {
      kind: "switch",
      field: "minimaxThinkingEnabled",
      configurable: customEndpoint || minimaxThinkingConfigurable(model),
      customEndpoint,
    };
  }
  if (providerId === "deepseek") {
    return {
      kind: "switch",
      field: "deepseekThinkingEnabled",
      configurable: true,
      customEndpoint,
    };
  }
  if (providerId === "openai") {
    return {
      kind: "switch",
      field: "openaiThinkingEnabled",
      configurable: true,
      customEndpoint,
    };
  }
  if (providerId === "codex") {
    return { kind: "none" };
  }
  if (providerId === "bigmodel") {
    return {
      kind: "switch",
      field: "bigmodelThinkingEnabled",
      configurable: true,
      customEndpoint,
    };
  }
  if (providerId === "qwen") {
    return {
      kind: "switch",
      field: "qwenThinkingEnabled",
      configurable: true,
      customEndpoint,
    };
  }
  if (providerId === "ollama") {
    return {
      kind: "switch",
      field: "ollamaThinkingEnabled",
      configurable: true,
      customEndpoint,
    };
  }
  if (providerId === "doubao") {
    return {
      kind: "doubao",
      configurable: customEndpoint || doubaoThinkingConfigurable(model),
      customEndpoint,
    };
  }
  return { kind: "none" };
}

export function inferCustomThinkingProtocol(
  model: string,
  baseUrl?: string,
): CustomThinkingProtocol {
  const normalizedModel = model.trim().toLowerCase();
  const normalizedUrl = (baseUrl ?? "").trim().toLowerCase();
  if (
    /^minimax-m/i.test(model.trim()) ||
    normalizedUrl.includes("minimaxi.com") ||
    normalizedUrl.includes("minimax.chat")
  ) {
    return "minimax";
  }
  if (
    normalizedModel.includes("deepseek") ||
    normalizedUrl.includes("deepseek.com")
  ) {
    return "deepseek";
  }
  if (
    normalizedModel.includes("glm") ||
    normalizedUrl.includes("bigmodel.cn") ||
    normalizedUrl.includes("open.bigmodel")
  ) {
    return "bigmodel";
  }
  if (
    normalizedModel.includes("doubao") ||
    normalizedUrl.includes("volces.com") ||
    normalizedUrl.includes("volcengine")
  ) {
    return "doubao";
  }
  if (normalizedUrl.includes(":11434") || normalizedUrl.includes("ollama")) {
    return "ollama";
  }
  if (
    normalizedModel.includes("qwen") ||
    normalizedUrl.includes("dashscope") ||
    normalizedUrl.includes("qwencloud") ||
    normalizedUrl.includes("aliyuncs.com")
  ) {
    return "qwen";
  }
  if (
    /^gpt[-_.]/i.test(model.trim()) ||
    /^o[1-4](?:$|[-_.])/i.test(normalizedModel) ||
    normalizedUrl.includes("openai.com") ||
    normalizedUrl.includes("krill-ai.net")
  ) {
    return "openai";
  }
  return "none";
}

export function localChatThinkingControl(
  providerId: string,
  model: string,
  protocol: CustomThinkingProtocol = "none",
): LocalChatThinkingControl {
  if (providerId === "custom") {
    return {
      kind: "custom",
      protocol,
      inner:
        protocol === "none"
          ? { kind: "none" }
          : vendorChatThinkingControl(protocol, model, true),
    };
  }
  return vendorChatThinkingControl(providerId, model);
}

export function chatThinkingFromSettings(
  settings?: Partial<LocalChatThinkingSettings> | null,
): LocalChatThinkingSettings {
  return {
    minimaxThinkingEnabled:
      settings?.minimaxThinkingEnabled ??
      defaultLocalChatThinkingSettings.minimaxThinkingEnabled,
    minimaxReasoningEffort:
      settings?.minimaxReasoningEffort ??
      defaultLocalChatThinkingSettings.minimaxReasoningEffort,
    ollamaThinkingEnabled:
      settings?.ollamaThinkingEnabled ??
      defaultLocalChatThinkingSettings.ollamaThinkingEnabled,
    deepseekThinkingEnabled:
      settings?.deepseekThinkingEnabled ??
      defaultLocalChatThinkingSettings.deepseekThinkingEnabled,
    openaiThinkingEnabled:
      settings?.openaiThinkingEnabled ??
      defaultLocalChatThinkingSettings.openaiThinkingEnabled,
    bigmodelThinkingEnabled:
      settings?.bigmodelThinkingEnabled ??
      defaultLocalChatThinkingSettings.bigmodelThinkingEnabled,
    qwenThinkingEnabled:
      settings?.qwenThinkingEnabled ??
      defaultLocalChatThinkingSettings.qwenThinkingEnabled,
    doubaoThinkingMode:
      settings?.doubaoThinkingMode ??
      defaultLocalChatThinkingSettings.doubaoThinkingMode,
    customThinkingProtocol:
      settings?.customThinkingProtocol ??
      defaultLocalChatThinkingSettings.customThinkingProtocol,
  };
}
