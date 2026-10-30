const en = {
  provider: "Model service",
  chooseProvider: "Choose a provider",
  custom: "Generic / OpenAI-compatible",
  model: "Model",
  chooseModel: "Choose an available model",
  read: "Read available models",
  refresh: "Refresh model list",
  reading: "Reading model list…",
  manual: "Enter a model ID manually",
  useList: "Choose from the live list",
  manualHint:
    "Use the exact model ID from your provider. It has not been verified against a live catalog.",
  baseUrl: "API base URL",
  catalogHint:
    "Model choices come from the selected provider, not a bundled model list.",
  catalogSource: "Read from provider",
  unsupported:
    "This provider did not expose a model list here. You can enter a model ID from its console.",
  unavailable:
    "Could not read the model list. Check the network, key and service address, then retry or enter a model ID.",
  unauthorized:
    "The provider did not accept this key. Check it before retrying.",
  missing: "Add an API key for this service first.",
  empty:
    "The provider returned no chat models. Check your account access or enter a model ID.",
  restart: "Restart Desktop to enable live model discovery.",
  login: "Sign in to ChatGPT",
  loginHint:
    "Use your existing ChatGPT account. Model choices are read after sign-in.",
  loginWait: "Complete sign-in in your browser, then refresh this list.",
  saveError:
    "Could not save this setup. Your key has not been shown in the error; check the local service and retry.",
};
const zh = {
  provider: "模型服务",
  chooseProvider: "请选择服务商",
  custom: "通用 / OpenAI 兼容服务",
  model: "模型",
  chooseModel: "请选择可用模型",
  read: "读取可用模型",
  refresh: "刷新模型列表",
  reading: "正在读取模型列表…",
  manual: "手动填写模型 ID",
  useList: "从实时列表选择",
  manualHint: "请填写服务商控制台中的准确模型 ID；此项尚未通过模型列表验证。",
  baseUrl: "API 服务地址",
  catalogHint: "模型选项来自所选服务商，不使用内置的固定型号列表。",
  catalogSource: "从服务商读取",
  unsupported:
    "此服务没有提供可读取的模型列表，可从其控制台复制模型 ID 后手动填写。",
  unavailable:
    "暂时未能读取模型列表，请检查网络、密钥和服务地址，重试或手动填写模型 ID。",
  unauthorized: "服务商未接受此密钥，请核对后重试。",
  missing: "请先填写此服务的 API Key。",
  empty: "服务商未返回可用的对话模型，请检查账号权限或手动填写模型 ID。",
  restart: "请重启 Desktop，启用实时读取模型列表。",
  login: "登录 ChatGPT",
  loginHint: "使用你已有的 ChatGPT 账号，登录后读取该账号可用的模型。",
  loginWait: "请在浏览器中完成登录，再刷新模型列表。",
  saveError: "配置未能保存，请检查本地服务后重试；错误信息不会显示你的密钥。",
};
export function providerSetupMessages(locale: string) {
  return locale === "en"
    ? en
    : locale === "zh-Hant"
      ? {
          ...zh,
          provider: "模型服務",
          chooseProvider: "請選擇服務商",
          custom: "通用 / OpenAI 相容服務",
          chooseModel: "請選擇可用模型",
          read: "讀取可用模型",
          refresh: "重新整理模型列表",
          reading: "正在讀取模型列表…",
          manual: "手動填寫模型 ID",
          useList: "從即時列表選擇",
          baseUrl: "API 服務地址",
          catalogHint: "模型選項來自所選服務商，不使用內建的固定型號列表。",
          catalogSource: "從服務商讀取",
          restart: "請重新啟動 Desktop，啟用即時讀取模型列表。",
          login: "登入 ChatGPT",
          loginHint: "使用你已有的 ChatGPT 帳號，登入後讀取該帳號可用的模型。",
          loginWait: "請在瀏覽器中完成登入，再重新整理模型列表。",
        }
      : zh;
}
