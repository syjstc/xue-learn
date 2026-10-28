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
] as const;

export type ContentLanguageCode = (typeof CONTENT_LANGUAGES)[number];

export const GOAL_CONTENT_LANGUAGE_SETTINGS = [
  "auto",
  ...CONTENT_LANGUAGES,
] as const;

export type GoalContentLanguageSetting =
  (typeof GOAL_CONTENT_LANGUAGE_SETTINGS)[number];

export function isGoalContentLanguageSetting(
  value: string | null | undefined,
): value is GoalContentLanguageSetting {
  return Boolean(
    value &&
      (GOAL_CONTENT_LANGUAGE_SETTINGS as readonly string[]).includes(value),
  );
}
const LABELS: Record<ContentLanguageCode, string> = {
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  other: "the same language as the learning goal",
};

/** Characters that usually appear only in Traditional Chinese text. */
const TRADITIONAL_SCRIPT_MARKERS = new Set(
  "臺國語對會說這個從來無時過還開關愛讓讀書畫發現網絡視頻東許準備買賣價幣飯館應該醫藥檢驗結構組織專業環節製造為學習關係種類選擇問題進行業務個體現實際過來實現數據處理解決辦法標準規範質量產業領導員經驗資訊聯繫電話傳統裡應當歷屆層機會機關機構設備設計計劃議論討論認識識別證書錄傳輸圖庫電腦號碼與變區別開發圖書館園遊戲軟體體驗證據載體註冊顯著著視覺覺實質問詢詢條件與實際經濟規則範圍種類別區別變歷與實際經".split(
    "",
  ),
);

/** Characters that usually appear only in Simplified Chinese text. */
const SIMPLIFIED_SCRIPT_MARKERS = new Set(
  "国台湾国语对于这个会从这个无时过还开关爱让读书画发现网络视频东许准备买卖价币饭馆应该医药检验结构组织专业环节制造为学习关系种类选择问题进行业务个体现实际过来实现数据处理解决办法标准规范质量产业领导员经验资讯联系电话传统里应当历届层机会机关机构设备设计计划议论讨论认识识别证书记录传输图库电脑号码与变区别开发图书馆园游戏软件体验证据载体注册显著视觉觉实质问询条件与实际经济规则范围种类别区别变历史与实际经".split(
    "",
  ),
);

export function detectChineseVariant(text: string): "zh-Hans" | "zh-Hant" {
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

function normalizeStoredContentLanguage(
  stored: string,
): ContentLanguageCode | null {
  if (stored === "zh") return "zh-Hans";
  if ((CONTENT_LANGUAGES as readonly string[]).includes(stored)) {
    return stored as ContentLanguageCode;
  }
  return null;
}

export function isChineseContentLanguage(
  code: ContentLanguageCode | string | null | undefined,
): boolean {
  return code === "zh" || code === "zh-Hans" || code === "zh-Hant";
}

/** Detect dominant language from goal title / free text. */
export function detectContentLanguage(text: string): ContentLanguageCode {
  const t = text.trim();
  if (!t) return "zh-Hans";

  const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const kana = (t.match(/[\u3040-\u30ff]/g) ?? []).length;
  const hangul = (t.match(/[\uac00-\ud7af]/g) ?? []).length;
  const latin = (t.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length;
  const len = Math.max(t.length, 1);

  if (hangul > 2 && hangul >= latin) return "ko";
  if (kana > 0 || (cjk < 2 && /[\u3040-\u30ff]/.test(t))) return "ja";
  if (cjk / len > 0.15 || (cjk > 0 && latin < cjk)) {
    return detectChineseVariant(t);
  }

  const lower = t.toLowerCase();
  if (/\b(apprendre|français|francais)\b/.test(lower)) return "fr";
  if (/\b(aprender|español|espanol)\b/.test(lower)) return "es";
  if (/\b(lernen|deutsch)\b/.test(lower)) return "de";
  if (latin > 0) return "en";

  return "zh-Hans";
}

/**
 * Detect the language being studied from a language-learning goal title/topic.
 * This is not the authoring contentLanguage (explanations may be in Chinese
 * while the target is Japanese).
 */
export function detectLanguageLearningTarget(
  text: string | null | undefined,
): ContentLanguageCode | null {
  const t = text?.trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  if (
    /日语|日語|日本語|JLPT|\bN[1-5]\b/i.test(t) ||
    /\bjapanese\b|\bnihongo\b/.test(lower) ||
    /[\u3040-\u30ff]/.test(t)
  ) {
    return "ja";
  }
  if (
    /韩语|韓語|朝鲜语|朝鮮語|한국어|한글/i.test(t) ||
    /\bkorean\b|\bhangul\b/.test(lower) ||
    /[\uac00-\ud7af]/.test(t)
  ) {
    return "ko";
  }
  if (/英语|英語|英文/.test(t) || /\benglish\b|\besl\b|\befl\b/.test(lower)) {
    return "en";
  }
  if (
    /西班牙语|西班牙語|西语|西語/.test(t) ||
    /\bspanish\b|\bespañol\b|\bespanol\b/.test(lower)
  ) {
    return "es";
  }
  if (
    /法语|法語|法文/.test(t) ||
    /\bfrench\b|\bfrançais\b|\bfrancais\b/.test(lower)
  ) {
    return "fr";
  }
  if (/德语|德語|德文/.test(t) || /\bgerman\b|\bdeutsch\b/.test(lower)) {
    return "de";
  }
  if (
    /繁體中文|正體中文|國語|\btraditional chinese\b|\bmandarin \(traditional\)\b/i.test(
      t,
    ) ||
    /zh-hant|zh_tw|zh-tw/.test(lower)
  ) {
    return "zh-Hant";
  }
  if (
    /中文|汉语|漢語|普通话|普通話|国语|简体|簡體/i.test(t) ||
    /\bmandarin\b|\bchinese\b/.test(lower)
  ) {
    return detectChineseVariant(t);
  }
  return null;
}

function contentLanguageFromLocale(
  locale: string | null | undefined,
): ContentLanguageCode | null {
  const normalized = locale?.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "zh-hant" ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk") ||
    normalized.startsWith("zh-mo")
  ) {
    return "zh-Hant";
  }
  if (
    normalized === "zh-hans" ||
    normalized === "zh" ||
    normalized.startsWith("zh-cn")
  ) {
    return "zh-Hans";
  }
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

function hasLanguageSignal(text: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-zÀ-ÿ]/u.test(text);
}

export function getContentLanguageLabel(code: ContentLanguageCode): string {
  return LABELS[code] ?? LABELS.other;
}

export function getLanguagePromptInstruction(code: ContentLanguageCode): string {
  const label = getPromptLanguageLabel(code);
  if (code === "other") {
    return `Write all user-facing text in ${label}.`;
  }
  if (code === "zh-Hans") {
    return "Write all user-facing text (titles, summaries, questions, and feedback) in Simplified Chinese.";
  }
  if (code === "zh-Hant") {
    return "Write all user-facing text (titles, summaries, questions, and feedback) in Traditional Chinese.";
  }
  return `Write all user-facing text (titles, summaries, questions, and feedback) in ${label}.`;
}

/**
 * Per-topic lock appended after prompt compaction. Later commit_topic_material
 * turns otherwise drop the language block because it already appeared in the
 * transcript, and models then follow the English tool schema.
 */
export function topicMaterialLanguageLock(
  languageBlock: string,
  topicId: string,
): string {
  const instruction =
    languageBlock.trim() ||
    "Write all user-facing text in the goal content language.";
  return `Language lock for topic ${JSON.stringify(topicId)}: ${instruction} This instruction and the tool schema are English; do not switch learner-facing display copy, labels, or cue speech to English, and do not mix languages in this commit. Keep code, TeX, and established proper nouns unchanged. On-screen labels, points, and callout text must wrap math in $...$ (not Unicode such as f ◦ g1 or C^op). Cue speech verbalizes formulas and must not contain TeX.`;
}

/** Appended to image-provider prompts so on-image labels match lesson language. */
export function getImageLabelLanguageInstruction(code: ContentLanguageCode): string {
  const label = getPromptLanguageLabel(code);
  if (code === "en") {
    return "All text labels, annotations, and captions rendered inside the image must be in English.";
  }
  if (code === "other") {
    return `All text labels, annotations, and captions rendered inside the image must be in ${label}, not English.`;
  }
  return `All text labels, annotations, and captions rendered inside the image must be in ${label} — not English unless the label is a proper noun or universally used symbol.`;
}

export function getPromptLanguageLabel(code: ContentLanguageCode): string {
  return {
    "zh-Hans": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    es: "Spanish",
    fr: "French",
    de: "German",
    other: "the same language as the learning goal",
  }[code];
}

export function resolveGoalContentLanguage(
  stored: string | null | undefined,
  goalTitle: string,
  appLocale?: string | null,
): ContentLanguageCode {
  if (stored && stored !== "auto") {
    const normalized = normalizeStoredContentLanguage(stored);
    if (normalized) return normalized;
  }
  // Automatic language follows the learner-authored conversation text. The
  // caller must pass that source text rather than an AI-refined course title;
  // otherwise a language-learning topic can feed its target language back into
  // the teaching language. UI locale is only a fallback for opaque input.
  if (!hasLanguageSignal(goalTitle)) {
    return contentLanguageFromLocale(appLocale) ?? detectContentLanguage(goalTitle);
  }
  return detectContentLanguage(goalTitle);
}
