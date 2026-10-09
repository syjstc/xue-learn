/**
 * Client-only content language helpers.
 * Generation prompts use PlanContext on the server; the UI reads resolved codes from the API.
 */

export type ContentLanguageCode =
  | "zh-Hans"
  | "zh-Hant"
  | "en"
  | "ja"
  | "ko"
  | "es"
  | "fr"
  | "de"
  | "other"
  | "auto";

export const CONTENT_LANGUAGES = [
  "zh-Hans",
  "zh-Hant",
  "en",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "other",
] as const satisfies readonly Exclude<ContentLanguageCode, "auto">[];

const LABELS: Record<Exclude<ContentLanguageCode, "auto">, string> = {
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  other: "Auto",
};

const LEGACY_LABELS: Record<string, string> = {
  zh: "简体中文",
};

export function getContentLanguageLabel(
  code: string | null | undefined,
): string {
  if (!code || code === "auto") return "自动";
  return (
    LABELS[code as keyof typeof LABELS] ??
    LEGACY_LABELS[code] ??
    code
  );
}

const TRADITIONAL_SCRIPT_MARKERS = new Set(
  "臺國語對會說這個從來無時過還開關愛讓讀書畫發現網絡視頻東許準備買賣價幣飯館應該醫藥檢驗結構組織專業環節製造為學習關係種類選擇問題進行業務個體現實際過來實現數據處理解決辦法標準規範質量產業領導員經驗資訊聯繫電話傳統裡應當歷屆層機會機關機構設備設計計劃議論討論認識識別證書錄傳輸圖庫電腦號碼與變區別開發圖書館園遊戲軟體體驗證據載體註冊顯著著視覺覺實質問詢詢條件與實際經濟規則範圍種類別區別變歷與實際經".split(
    "",
  ),
);

const SIMPLIFIED_SCRIPT_MARKERS = new Set(
  "国台湾国语对于这个会从这个无时过还开关爱让读书画发现网络视频东许准备买卖价币饭馆应该医药检验结构组织专业环节制造为学习关系种类选择问题进行业务个体现实际过来实现数据处理解决办法标准规范质量产业领导员经验资讯联系电话传统里应当历届层机会机关机构设备设计计划议论讨论认识识别证书记录传输图库电脑号码与变区别开发图书馆园游戏软件体验证据载体注册显著视觉觉实质问询条件与实际经济规则范围种类别区别变历史与实际经".split(
    "",
  ),
);

function detectChineseVariant(text: string): "zh-Hans" | "zh-Hant" {
  let traditionalScore = 0;
  let simplifiedScore = 0;
  for (const char of text) {
    if (TRADITIONAL_SCRIPT_MARKERS.has(char)) traditionalScore++;
    if (SIMPLIFIED_SCRIPT_MARKERS.has(char)) simplifiedScore++;
  }
  if (traditionalScore > simplifiedScore) return "zh-Hant";
  if (simplifiedScore > traditionalScore) return "zh-Hans";
  if (/繁體|臺灣|台灣|香港|澳門|粵語|正體/.test(text)) return "zh-Hant";
  return "zh-Hans";
}

/** Fallback detection for legacy rows when API has not resolved contentLanguage yet. */
export function detectContentLanguage(text: string): ContentLanguageCode {
  const t = text.trim();
  if (!t) return "zh-Hans";

  const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const kana = (t.match(/[\u3040-\u30ff]/g) ?? []).length;
  const hangul = (t.match(/[\uac00-\ud7af]/g) ?? []).length;
  const latin = (t.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length;

  if (hangul > 2 && hangul >= latin) return "ko";
  if (kana > 0 || (cjk < 2 && /[\u3040-\u30ff]/.test(t))) return "ja";
  if (cjk / Math.max(t.length, 1) > 0.15 || (cjk > 0 && latin < cjk)) {
    return detectChineseVariant(t);
  }

  const lower = t.toLowerCase();
  if (/\b(apprendre|français|francais)\b/.test(lower)) return "fr";
  if (/\b(aprender|español|espanol)\b/.test(lower)) return "es";
  if (/\b(lernen|deutsch)\b/.test(lower)) return "de";
  if (latin > 0) return "en";

  return "zh-Hans";
}

/** Flatten learning material for client-side TTS language detection. */
export function collectLearningMaterialPlainText(material: unknown): string {
  if (!material || typeof material !== "object") return "";
  const m = material as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof m.introduction === "string") parts.push(m.introduction);
  if (typeof m.title === "string") parts.push(m.title);
  if (Array.isArray(m.keyTakeaways)) {
    parts.push(
      ...m.keyTakeaways.filter((item): item is string => typeof item === "string"),
    );
  }

  const blocks = m.blocks ?? m.sections;
  if (!Array.isArray(blocks)) return parts.join("\n");

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const row = block as Record<string, unknown>;
    for (const key of [
      "title",
      "body",
      "content",
      "text",
      "heading",
      "caption",
      "formula",
      "prompt",
      "question",
      "explanation",
    ]) {
      if (typeof row[key] === "string") parts.push(row[key]);
    }
    for (const listKey of ["items", "left", "right", "options", "points"]) {
      const list = row[listKey];
      if (Array.isArray(list)) {
        parts.push(
          ...list.filter((item): item is string => typeof item === "string"),
        );
      }
    }
  }

  return parts.join("\n");
}

export function resolveClientContentLanguage(
  stored: string | null | undefined,
  goalTitle: string,
): Exclude<ContentLanguageCode, "auto"> {
  if (stored === "zh") return "zh-Hans";
  if (
    stored &&
    stored !== "auto" &&
    stored in LABELS
  ) {
    return stored as Exclude<ContentLanguageCode, "auto">;
  }
  const detected = detectContentLanguage(goalTitle);
  return detected === "auto" ? "zh-Hans" : detected;
}
