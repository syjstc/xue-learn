import {localCredentialSnapshotSchema,validLocalProviderBaseUrl} from '@xue-learn/core/runtime-contracts';
/** Provider secrets stay in Electron main and the privately bundled provider runtime. */
export function pluginProviderEnvironment(credentials:unknown):Record<string,string>{
  const values=localCredentialSnapshotSchema.parse(credentials);
  const envByProvider: Record<string, Record<string, string>> = {
    custom: {
      CUSTOM_OPENAI_API_KEY: values.custom?.apiKey ?? "",
      CUSTOM_OPENAI_BASE_URL:
        validLocalProviderBaseUrl(values.custom?.baseUrl) ?? "",
    },
    custom_embedding: {
      CUSTOM_EMBEDDING_API_KEY: values.custom_embedding?.apiKey ?? "",
      CUSTOM_EMBEDDING_BASE_URL:
        validLocalProviderBaseUrl(values.custom_embedding?.baseUrl) ?? "",
    },
    minimax: {
      MINIMAX_API_KEY: values.minimax?.apiKey ?? "",
      MINIMAX_GROUP_ID: values.minimax?.groupId ?? "",
      MINIMAX_EMBEDDING_API_KEY: values.minimax?.embeddingApiKey ?? "",
    },
    openai: { OPENAI_API_KEY: values.openai?.apiKey ?? "" },
    deepseek: { DEEPSEEK_API_KEY: values.deepseek?.apiKey ?? "" },
    fireworks: { FIREWORKS_API_KEY: values.fireworks?.apiKey ?? "" },
    doubao: {
      DOUBAO_API_KEY: values.doubao?.apiKey ?? "",
      DOUBAO_SEARCH_API_KEY: values.doubao?.searchApiKey ?? "",
      DOUBAO_SPEECH_API_KEY: values.doubao?.speechApiKey ?? "",
    },
    bigmodel: { BIGMODEL_API_KEY: values.bigmodel?.apiKey ?? "" },
    qwen: {
      DASHSCOPE_API_KEY: values.qwen?.apiKey ?? "",
      DASHSCOPE_BASE_URL:
        validLocalProviderBaseUrl(values.qwen?.baseUrl) ?? "",
      DASHSCOPE_AUDIO_BASE_URL:
        validLocalProviderBaseUrl(values.qwen?.baseUrl) ?? "",
    },
    cartesia: { CARTESIA_API_KEY: values.cartesia?.apiKey ?? "" },
    tavily: { TAVILY_API_KEY: values.tavily?.apiKey ?? "" },
    anysearch: { ANYSEARCH_API_KEY: values.anysearch?.apiKey ?? "" },
    apimart: { APIMART_API_KEY: values.apimart?.apiKey ?? "" },
    krill: {
      KRILL_API_KEY: values.krill?.apiKey ?? "",
      KRILL_IMAGE_BASE_URL: "https://api.krill-code.net/v1",
    },
  };
  // Match the sidecar adapter: unset optional values are omitted, not passed
  // as empty URLs that invalidate all provider configuration in Core.
  return Object.fromEntries(Object.values(envByProvider).flatMap(provider=>Object.entries(provider))
    .filter(([,value])=>value.trim().length>0));
}
