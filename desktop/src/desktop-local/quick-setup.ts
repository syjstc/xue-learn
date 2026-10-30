import {
  customChatProfileCredentialProviderId,
  type CredentialStatus,
  type LocalAiModelSettings,
} from "@xue-learn/core/runtime-contracts";

/** Read configuration status only. Secrets never enter React state here. */
export function chatSetupComplete(
  settings: LocalAiModelSettings,
  statuses: CredentialStatus[],
  codexSignedIn = false,
): boolean {
  if (!settings.chatModel?.trim()) return false;
  if (settings.chatProvider === "codex") return codexSignedIn;
  if (settings.chatProvider === "ollama") return true;
  const provider = settings.chatProvider;
  const profileId = settings.customChatEndpoints?.activeProfileId;
  const slot =
    provider === "custom" && profileId
      ? customChatProfileCredentialProviderId(profileId)
      : provider;
  const configured =
    statuses.find((entry) => entry.providerId === slot)?.configuredFields ?? [];
  return (provider === "custom" ? ["apiKey", "baseUrl"] : ["apiKey"]).every(
    (field) => configured.includes(field),
  );
}

export const quickSetupMessages = (locale: string) =>
  locale === "en"
    ? {
        title: "Start learning with two simple steps",
        intro:
          "Connect your learning assistant, then prepare knowledge search. Set up other features whenever you need them.",
        assistant: "Connect your learning assistant",
        knowledge: "Prepare knowledge search",
        recommended: "Recommended",
        description:
          "Create learning paths, explain ideas and answer questions. The model and service address are already set for you.",
        key: "API key",
        keyPlaceholder: "Paste your API key here",
        getKey: "Get an API key",
        pricing:
          "Cloud model APIs may charge for usage. Check your provider’s pricing; website subscriptions and API credits are separate.",
        privacy:
          "Your key is used only with the selected provider and is encrypted on this Mac when you save.",
        connect: "Save and continue",
        testing: "Saving…",
        savedKey:
          "A key for this service is already saved. Leave the field empty to use it.",
        success: "Model service saved",
        ready: "Ready to create your first learning path.",
        current: "Current learning assistant",
        keep: "Your existing configuration is ready. Keep it, or choose another service below.",
        replace: "Choose another model service",
        advanced: "Other providers and advanced settings",
        show: "Show key",
        hide: "Hide key",

        optionalTitle: "Add more when you need it",
        optionalHint:
          "Voice, generated images and web search are optional. They use their own services and may have separate usage costs.",
        voice: "Voice · listen to explanations",
        image: "Images · add visual explanations",
        search: "Web search · find external sources",
        localTitle: "Knowledge search on this Mac",
        localHint:
          "Download once, then search and connect your learning materials locally. No extra API key or per-use service charge.",
        otherSearch: "Other knowledge search options",
        setupLink: "Quick start",
        continue: "Continue learning",
        progress: "Step 2 of 2 · learning assistant connected",
      }
    : locale === "zh-Hant"
      ? {
          title: "兩步準備，開始學習",
          intro: "先連接學習助手，再準備知識檢索。其他功能可在需要時開啟。",
          assistant: "連接學習助手",
          knowledge: "準備知識檢索",
          recommended: "推薦",
          description:
            "用來規劃學習路徑、講解概念和回答問題。選擇服務商後讀取可用模型，也可以連接通用的相容服務。",
          key: "API Key",
          keyPlaceholder: "貼上你的 API Key",
          getKey: "取得 API Key",
          pricing:
            "雲端模型 API 通常按用量計費，以服務商帳單為準；聊天會員和 API 額度分開。",
          privacy: "金鑰只用於你選擇的服務，儲存後會加密保存在這台 Mac。",
          connect: "儲存並繼續",
          testing: "正在儲存…",
          savedKey: "已儲存此服務的金鑰，留空即可沿用。",
          success: "模型服務已儲存",
          ready: "可以開始建立第一條學習路徑了。",
          current: "目前的學習助手",
          keep: "現有配置已就緒，可繼續使用，也可在下方選擇其他服務。",
          replace: "選擇其他模型服務",
          advanced: "其他服務與進階設定",
          show: "顯示金鑰",
          hide: "隱藏金鑰",

          optionalTitle: "需要時，再加一點能力",
          optionalHint:
            "語音、圖片與網路搜尋都是可選項，各自使用獨立服務，可能另有用量費用。",
          voice: "語音 · 聽老師講解",
          image: "圖片 · 補充視覺講解",
          search: "網路搜尋 · 查找外部資料",
          localTitle: "在這台 Mac 上檢索知識",
          localHint:
            "一次下載，在本機搜尋、關聯學習資料，無需額外金鑰，也沒有按次服務費。",
          otherSearch: "其他知識檢索方式",
          setupLink: "快速開始",
          continue: "繼續學習",
          progress: "第 2 步，共 2 步 · 學習助手已連接",
        }
      : {
          title: "两步准备，开始学习",
          intro: "先连接学习助手，再准备知识检索。其他功能可以在需要时开启。",
          assistant: "连接学习助手",
          knowledge: "准备知识检索",
          recommended: "推荐",
          description:
            "用来规划学习路径、讲解概念和回答问题。选择服务商后读取可用模型，也可以连接通用的兼容服务。",
          key: "API Key",
          keyPlaceholder: "粘贴你的 API Key",
          getKey: "获取 API Key",
          pricing:
            "云端模型 API 通常按用量计费，以服务商账单为准；聊天会员和 API 额度分开。",
          privacy: "密钥只用于你选择的服务，保存后会加密存储在这台 Mac。",
          connect: "保存并继续",
          testing: "正在保存…",
          savedKey: "已保存此服务的密钥，留空即可沿用。",
          success: "模型服务已保存",
          ready: "可以开始创建第一条学习路径了。",
          current: "当前的学习助手",
          keep: "现有配置已就绪，可以继续使用，也可以在下方选择其他服务。",
          replace: "选择其他模型服务",
          advanced: "其他服务与高级设置",
          show: "显示密钥",
          hide: "隐藏密钥",

          optionalTitle: "需要时，再加一点能力",
          optionalHint:
            "语音、图片与联网搜索都是可选项，各自使用独立服务，可能另有用量费用。",
          voice: "语音 · 听老师讲解",
          image: "图片 · 补充视觉讲解",
          search: "联网搜索 · 查找外部资料",
          localTitle: "在这台 Mac 上检索知识",
          localHint:
            "一次下载，在本机搜索、关联学习资料，不需要额外密钥，也没有按次服务费。",
          otherSearch: "其他知识检索方式",
          setupLink: "快速开始",
          continue: "继续学习",
          progress: "第 2 步，共 2 步 · 学习助手已连接",
        };
