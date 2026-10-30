import { HumanMessage } from "@langchain/core/messages";
import {
  localCapabilityConnectionResultSchema,
  localProviderConnectionResultSchema,
  type LocalChatConnectionTestRequest,
  type LocalProviderConnectionTestRequest,
} from "@xue-learn/core/runtime-contracts";
import {
  getEnv,
  hasAnySearchConfigured,
  hasDoubaoSearchConfigured,
  hasEmbeddingProviderCredentials,
  hasProviderCredentials,
  hasTavilyConfigured,
} from "@xue-learn/core/server/env";
import { createEmbeddings } from "@xue-learn/core/server/llm/embeddings";
import { refreshLlmRuntimeConfig } from "@xue-learn/core/server/llm/runtime-config";
import { getLlmProvider } from "@xue-learn/core/server/llm/providers";
import {withExplicitLlmSelection} from "@xue-learn/core/server/providers/llm/explicit-selection-context";
import {beginLlmRequestLog} from "@xue-learn/core/server/llm/logger";
import {extractTokenUsage, usageLogFields} from "@xue-learn/core/server/llm/token-usage";
import { minimaxConnectionTestMaxTokens } from "@xue-learn/core/server/providers/llm/vendors/minimax/options";
import {
  defaultEmbeddingModel,
  defaultLlmChatModel,
} from "@xue-learn/core/server/providers/llm/defaults";
import {
  getImageProvider,
  hasImageProviderCredentials,
} from "@xue-learn/core/server/providers/image";
import {
  getAudioProvider,
  hasAudioProviderCredentials,
} from "@xue-learn/core/server/providers/audio";
import { AUDIO_PROVIDER_OPTIONS } from "@xue-learn/core/server/providers/audio/specs";
import { defaultImageModel } from "@xue-learn/core/server/images/provider-options";
import { searchLearningPathWithSources } from "@xue-learn/core/server/search/tavily";
import { searchLearningPathWithDoubaoSources } from "@xue-learn/core/server/search/doubao";
import { searchLearningPathWithAnySearchSources } from "@xue-learn/core/server/search/anysearch";

type ConnectionTestCode =
  | "ok"
  | "missing_credentials"
  | "invalid_configuration"
  | "unauthorized"
  | "unreachable"
  | "provider_error"
  | "invalid_response";

const customProviderConnectionTestMaxTokens = 1024;

const connectionMessages: Record<ConnectionTestCode, string> = {
  ok: "The provider responded successfully.",
  missing_credentials: "Save the required provider credentials first.",
  invalid_configuration: "The provider configuration is invalid.",
  unauthorized: "The provider rejected the saved credentials.",
  unreachable: "The provider could not be reached.",
  provider_error: "The provider returned an error.",
  invalid_response: "The provider returned an empty response.",
};

function connectionErrorDetail(cause: unknown): string {
  const message = (
    cause instanceof Error ? cause.message : String(cause ?? "")
  )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .trim();
  return message.slice(0, 400);
}

function connectionErrorCode(cause: unknown): ConnectionTestCode {
  const error = cause as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const status = Number(error?.status ?? error?.statusCode);
  const code = String(error?.code ?? error?.cause?.code ?? "").toLowerCase();
  const message = String(
    error?.message ?? error?.cause?.message ?? cause ?? "",
  ).toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|invalid api key|authentication/.test(message)
  )
    return "unauthorized";
  if (Number.isFinite(status) && status >= 400) return "provider_error";
  if (/krill image create hung|async may be ignored|size\/quality/i.test(message))
    return "provider_error";
  if (
    /econnrefused|enotfound|eai_again|etimedout/.test(code) ||
    /fetch failed|network|connection refused|connection test timed out/.test(
      message,
    )
  )
    return "unreachable";
  if (/configuration|base url|invalid url|model.*required/.test(message))
    return "invalid_configuration";
  return "provider_error";
}

function withConnectionTimeout<T>(work: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Connection test timed out")),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function hasSearchCredentials(providerId: "tavily" | "doubao" | "anysearch") {
  switch (providerId) {
    case "tavily":
      return hasTavilyConfigured();
    case "doubao":
      return hasDoubaoSearchConfigured();
    case "anysearch":
      return hasAnySearchConfigured();
  }
}

export async function testLocalChatConnection(
  request: LocalChatConnectionTestRequest,
) {
  const startedAt = Date.now();
  const config = await refreshLlmRuntimeConfig();
  const providerId = request.providerId;
  const model =
    request.model?.trim() ||
    (providerId === config.provider
      ? config.chatModel
      : defaultLlmChatModel(providerId));
  const result = (code: ConnectionTestCode, detail?: string) =>
    localProviderConnectionResultSchema.parse({
      providerId,
      model,
      healthy: code === "ok",
      checkedAt: Date.now(),
      latencyMs: Math.max(0, Date.now() - startedAt),
      code,
      message: detail?.trim() || connectionMessages[code],
    });

  if (providerId !== "ollama" && !hasProviderCredentials(providerId))
    return result("missing_credentials");
  try {
    const selection = {
      id: providerId,
      model,
      options: {
        chatModel: model,
        ...(providerId === "minimax"
          ? { minimaxReasoningEffort: config.minimaxReasoningEffort }
          : {}),
      },
    };
    return await withExplicitLlmSelection(selection, async () => {
      const log = await beginLlmRequestLog({operation: "local.chat_connection_test", kind: "chat", label: "connection test",
        request: {provider: providerId, model, connectionTest: true, platformFunded: true}});
      try {
        const response = await getLlmProvider(selection)
          .getChatModel({
            maxTokens:
              providerId === "custom"
                ? customProviderConnectionTestMaxTokens
                : providerId === "minimax"
                  ? minimaxConnectionTestMaxTokens(model)
                  : 8,
          })
          .invoke([new HumanMessage("Connection test. Reply with exactly: OK")], {
            signal: AbortSignal.timeout(20_000),
          });
        const hasContent = typeof response.content === "string"
          ? response.content.trim().length > 0 : response.content.length > 0;
        const durationMs = Math.max(0, Date.now() - startedAt);
        await log?.finish({status: hasContent ? "success" : "error", durationMs,
          response: {...usageLogFields(extractTokenUsage(response), durationMs), connectionTest: true},
          ...(!hasContent ? {error: connectionMessages.invalid_response} : {})});
        return result(hasContent ? "ok" : "invalid_response");
      } catch (cause) {
        await log?.finish({status: "error", durationMs: Math.max(0, Date.now() - startedAt), error: connectionErrorDetail(cause)});
        throw cause;
      }
    });
  } catch (cause) {
    const code = connectionErrorCode(cause);
    const detail = connectionErrorDetail(cause);
    console.warn(`[local-connection-test] chat/${providerId}: ${detail}`);
    return result(code, detail);
  }
}

export async function testLocalCapabilityConnection(
  request: LocalProviderConnectionTestRequest,
) {
  const startedAt = Date.now();
  const model =
    request.capability === "embedding"
      ? request.model?.trim() || defaultEmbeddingModel(request.providerId)
      : request.capability === "image"
        ? request.model?.trim() || defaultImageModel(request.providerId)
        : request.capability === "audio"
          ? request.model?.trim() ||
            AUDIO_PROVIDER_OPTIONS.find(
              (provider) => provider.id === request.providerId,
            )?.models[0] ||
            null
          : null;
  const result = (code: ConnectionTestCode, detail?: string) =>
    localCapabilityConnectionResultSchema.parse({
      capability: request.capability,
      providerId: request.providerId,
      model,
      healthy: code === "ok",
      checkedAt: Date.now(),
      latencyMs: Math.max(0, Date.now() - startedAt),
      code,
      message: detail?.trim() || connectionMessages[code],
    });

  try {
    switch (request.capability) {
      case "embedding": {
        if (
          request.providerId !== "ollama" &&
          !hasEmbeddingProviderCredentials(request.providerId)
        )
          return result("missing_credentials");
        const vector = await withConnectionTimeout(
          createEmbeddings(
            getEnv(),
            request.providerId,
            model ?? undefined,
          ).embedQuery("XueLearn connection test"),
          20_000,
        );
        return result(
          vector.length > 0 && vector.every(Number.isFinite)
            ? "ok"
            : "invalid_response",
        );
      }
      case "search": {
        if (!hasSearchCredentials(request.providerId))
          return result("missing_credentials");
        const payload = await withConnectionTimeout(
          request.providerId === "tavily"
            ? searchLearningPathWithSources("OpenAI", {
                purpose: "answer",
                maxResults: 1,
                extractTopUrls: 0,
              })
            : request.providerId === "doubao"
              ? searchLearningPathWithDoubaoSources("OpenAI", {
                  purpose: "answer",
                  maxResults: 1,
                })
              : searchLearningPathWithAnySearchSources("OpenAI", {
                  purpose: "answer",
                  maxResults: 1,
                  extractTopUrls: 0,
                }),
          20_000,
        );
        return result(payload.sources.length > 0 ? "ok" : "invalid_response");
      }
      case "image": {
        if (!hasImageProviderCredentials(request.providerId))
          return result("missing_credentials");
        const provider = getImageProvider({
          id: request.providerId,
          model: model!,
        });
        if (!provider) return result("invalid_configuration");
        const image = await withConnectionTimeout(
          provider.generateImage({
            prompt:
              "A single blue circle on a plain white background, no text.",
            aspectRatio: "1:1",
            noText: true,
            compact: true,
            resolution: request.providerId === "krill" ? "1k" : undefined,
          }),
          request.providerId === "krill"
            ? 300_000
            : request.providerId === "codex"
              ? 180_000
              : 60_000,
        );
        return result(image.data.length > 0 ? "ok" : "invalid_response");
      }
      case "audio": {
        if (!hasAudioProviderCredentials(request.providerId))
          return result("missing_credentials");
        const provider = getAudioProvider({
          id: request.providerId,
          model: model!,
          options: { model: model! },
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const speech = provider.synthesizeSpeech
            ? await provider.synthesizeSpeech(
                "Connection test.",
                undefined,
                controller.signal,
              )
            : await provider.synthesizeChatNarration(
                ["Connection test."],
                undefined,
                controller.signal,
              );
          const hasAudio =
            "audioBase64" in speech
              ? speech.audioBase64.length > 0
              : speech.audio.length > 0;
          return result(hasAudio ? "ok" : "invalid_response");
        } finally {
          clearTimeout(timer);
        }
      }
    }
  } catch (cause) {
    const code = connectionErrorCode(cause);
    const detail = connectionErrorDetail(cause);
    console.warn(
      `[local-connection-test] ${request.capability}/${request.providerId}: ${detail}`,
    );
    return result(code, detail);
  }
}
