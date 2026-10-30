export const CHAT_PROVIDER_PRESETS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    keysUrl: "https://platform.deepseek.com/api_keys",
    recommended: true,
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    keysUrl:
      "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  },
  {
    id: "qwen",
    name: "Qwen / 阿里云",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keysUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "doubao",
    name: "Doubao / 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    keysUrl: "https://console.volcengine.com/ark/",
  },
  {
    id: "bigmodel",
    name: "GLM / 智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    keysUrl: "https://open.bigmodel.cn/",
  },
  {
    id: "fireworks",
    name: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    keysUrl: "https://app.fireworks.ai/",
  },
  { id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434" },
  { id: "codex", name: "Codex / ChatGPT", baseUrl: "" },
  { id: "custom", name: "OpenAI-compatible", baseUrl: "" },
] as const;
