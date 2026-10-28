import {
  contentMarkupProfilesForTopicCategory,
  isTopicCategory,
  type ContentMarkupProfile,
  type TopicCategory,
} from "../../../common/src/index.js";
import { formatHighlightCodeLanguagePromptList } from "../markdown/code-fence-languages.js";
import {
  detectLanguageLearningTarget,
  type ContentLanguageCode,
} from "./content-language.js";

/** Marker checked by {@link appendContentMarkupRules} to avoid duplicate injection. */
export const CONTENT_MARKUP_MARKER =
  "Unified special-content markup (mandatory)";

const CONTENT_MARKUP_INTRO = `Use only these forms in user-facing markdown:`;

const LANGUAGE_RUBY_INTRO = `East Asian ruby (W3C/HTML ruby pattern: base text + pronunciation above):`;

const CHINESE_PINYIN_MARKUP_RULES = `Chinese pinyin: 【ChineseChar|pīnyīn with tone marks】
   - One annotation per 【…】 pair; use group ruby — annotate whole words/phrases, not each character, when the reading spans multiple characters.
   - Use ASCII pipe | between base text and pinyin.
   - Example: 【Chinese text|nǐ hǎo】`;

const CHINESE_BOPOMOFO_MARKUP_RULES = `Chinese bopomofo/zhuyin (Traditional Chinese): 【<Chinese text>|ㄅㄛˊ ㄇㄛˊ】
   - Same 【…】 delimiter as pinyin; use Bopomofo symbols with tone marks in the annotation.
   - Example: 【Traditional Chinese text|ㄓㄨˋ ㄧㄣ】`;

const JAPANESE_FURIGANA_MARKUP_RULES = `Japanese furigana: 《Kanji｜kana》
   - One annotation per 《…》 pair; use hiragana for readings.
   - Use group ruby for jukugo/compound readings that apply to the whole word, not each kanji alone.
   - Use fullwidth pipe ｜ between kanji base and reading.
   - Example: 《Japanese kanji｜かんじ》`;

const KOREAN_HANJA_MARKUP_RULES = `Korean hanja: 『Hanja｜hangul』
   - One annotation per 『…』 pair; hangul reading for hanja base text.
   - Use fullwidth pipe ｜ between base and reading.
   - Example: 『Hanja text｜물』`;

const IPA_MARKUP_RULES = `Phonetic (IPA — linguistics standard: square brackets for pronunciation):
IPA pronunciation guide: 「word｜həˈloʊ」
   - For non-CJK words or romanized bases; use IPA symbols in the annotation.
   - Place primary stress with ˈ before the stressed syllable; use narrow phonetic detail as needed.
   - Example: 「through｜θɹuː」`;

/** All language ruby/IPA rules (fallback when the studied language is unknown). */
export const LANGUAGE_CONTENT_MARKUP_RULES = [
  LANGUAGE_RUBY_INTRO,
  `1. ${CHINESE_PINYIN_MARKUP_RULES}`,
  `2. ${CHINESE_BOPOMOFO_MARKUP_RULES}`,
  `3. ${JAPANESE_FURIGANA_MARKUP_RULES}`,
  `4. ${KOREAN_HANJA_MARKUP_RULES}`,
  "",
  IPA_MARKUP_RULES.replace(
    "IPA pronunciation guide:",
    "5. IPA pronunciation guide:",
  ),
].join("\n\n");

export const STEM_CONTENT_MARKUP_RULES = `Math/science:
- Wrap every on-screen math fragment in TeX delimiters: identifiers, sub/superscripts, operators, equalities, and implications. Inline: $f \\circ g_1 = f \\circ g_2 \\implies g_1 = g_2$ and $C^{\\mathrm{op}}$. Never leave those as plain/Unicode text (f ◦ g1, C^op, a → b, g1).
- Inline math: $E=mc^2$. Use a math fence for long/display math:
     \`\`\`math
     \\int_0^1 x^2 \\, dx
     \`\`\`
- Chemistry: always mhchem inside math delimiters, e.g. $\\ce{H2O}$ or $\\ce{SO4^2- + Ba^2+ -> BaSO4 v}$.
- Units: keep the full value/unit in one $\\pu{…}$, e.g. $\\pu{0.5 kg}$ or $\\pu{9.8 m/s^2}$.`;

export const CODE_CONTENT_MARKUP_RULES = `Programming code:
- Use backticks only for short inline identifiers. Put all longer or structured code in a fenced block with real newlines, valid indentation, and a highlight.js language id:
     \`\`\`python
     def get_tool_schemas():
         return [{"name": "search", ...}]
     \`\`\`
- Valid ids: ${formatHighlightCodeLanguagePromptList()}. Never use a bare/placeholder fence or markdown emphasis inside code.
- In single-line DSL fields, represent fence newlines with \\n.`;

const CONTENT_MARKUP_HARD_RULES = `Do not invent or mix annotation syntax, or emit HTML. Keep base text readable; use markdown for emphasis.`;

export type LanguageMarkupScript =
  | "chinese_pinyin"
  | "chinese_bopomofo"
  | "japanese_furigana"
  | "korean_hanja"
  | "ipa";

export type ContentMarkupOptions = {
  topicCategory?: TopicCategory | null;
  /**
   * Language being studied (language goals only). Prefer this over inferring
   * from {@link goalTitle}. Not the authoring contentLanguage.
   */
  targetLanguage?: ContentLanguageCode | string | null;
  /** Goal/topic text used to infer {@link targetLanguage} when unset. */
  goalTitle?: string | null;
  /** Override category-derived profiles when callers need explicit control. */
  profiles?: ContentMarkupProfile[];
};

/** Resolve which language markup scripts apply for a studied language. */
export function languageMarkupScriptsForTarget(
  target: ContentLanguageCode | string | null | undefined,
): LanguageMarkupScript[] {
  switch (target) {
    case "zh-Hans":
    case "zh":
      return ["chinese_pinyin"];
    case "zh-Hant":
      return ["chinese_bopomofo", "chinese_pinyin"];
    case "ja":
      return ["japanese_furigana"];
    case "ko":
      return ["korean_hanja"];
    case "en":
    case "es":
    case "fr":
    case "de":
      return ["ipa"];
    case "other":
    case null:
    case undefined:
      return [
        "chinese_pinyin",
        "chinese_bopomofo",
        "japanese_furigana",
        "korean_hanja",
        "ipa",
      ];
    default:
      return [
        "chinese_pinyin",
        "chinese_bopomofo",
        "japanese_furigana",
        "korean_hanja",
        "ipa",
      ];
  }
}

/** Resolve studied language for language-topic markup selection. */
export function resolveLanguageMarkupTarget(
  options?: Pick<ContentMarkupOptions, "targetLanguage" | "goalTitle">,
): ContentLanguageCode | null {
  const explicit = options?.targetLanguage?.trim();
  if (explicit) {
    if (explicit === "zh") return "zh-Hans";
    if (
      explicit === "zh-Hans" ||
      explicit === "zh-Hant" ||
      explicit === "ja" ||
      explicit === "ko" ||
      explicit === "en" ||
      explicit === "es" ||
      explicit === "fr" ||
      explicit === "de" ||
      explicit === "other"
    ) {
      return explicit;
    }
  }
  return detectLanguageLearningTarget(options?.goalTitle);
}

function buildLanguageMarkupSection(scripts: LanguageMarkupScript[]): string {
  const numbered: string[] = [];
  let index = 1;
  for (const script of scripts) {
    if (script === "chinese_pinyin") {
      numbered.push(`${index}. ${CHINESE_PINYIN_MARKUP_RULES}`);
      index += 1;
    } else if (script === "chinese_bopomofo") {
      numbered.push(`${index}. ${CHINESE_BOPOMOFO_MARKUP_RULES}`);
      index += 1;
    } else if (script === "japanese_furigana") {
      numbered.push(`${index}. ${JAPANESE_FURIGANA_MARKUP_RULES}`);
      index += 1;
    } else if (script === "korean_hanja") {
      numbered.push(`${index}. ${KOREAN_HANJA_MARKUP_RULES}`);
      index += 1;
    }
  }

  const parts: string[] = [];
  if (numbered.length > 0) {
    parts.push(LANGUAGE_RUBY_INTRO, numbered.join("\n\n"));
  }
  if (scripts.includes("ipa")) {
    const ipa = IPA_MARKUP_RULES.replace(
      "IPA pronunciation guide:",
      `${index}. IPA pronunciation guide:`,
    );
    parts.push(ipa);
  }
  return parts.join("\n\n");
}

function resolveMarkupProfiles(
  options?: ContentMarkupOptions,
): ContentMarkupProfile[] {
  if (options?.profiles) return options.profiles;
  return contentMarkupProfilesForTopicCategory(options?.topicCategory);
}

/** Build markup options from generation meta + optional topic override. */
export function contentMarkupOptionsFromMeta(
  meta: Record<string, unknown> | undefined,
  topicCategory?: TopicCategory | null,
): ContentMarkupOptions {
  const fromMeta = meta?.topicCategory;
  return {
    topicCategory:
      topicCategory ??
      (isTopicCategory(fromMeta) ? fromMeta : undefined),
    goalTitle:
      typeof meta?.goalTitle === "string" ? meta.goalTitle : undefined,
    targetLanguage:
      typeof meta?.targetLanguage === "string"
        ? meta.targetLanguage
        : undefined,
  };
}

/** Build markup rules for the given topic category (or explicit profiles). */
export function buildContentMarkupRules(
  options?: ContentMarkupOptions,
): string {
  const profiles = resolveMarkupProfiles(options);
  const sections = [
    `${CONTENT_MARKUP_MARKER}:`,
    CONTENT_MARKUP_INTRO,
    CODE_CONTENT_MARKUP_RULES,
    STEM_CONTENT_MARKUP_RULES,
  ];

  if (profiles.includes("language")) {
    const target = resolveLanguageMarkupTarget(options);
    const scripts = languageMarkupScriptsForTarget(target);
    const languageSection = buildLanguageMarkupSection(scripts);
    if (languageSection) sections.push(languageSection);
  }

  sections.push(CONTENT_MARKUP_HARD_RULES);
  return sections.join("\n\n");
}

/**
 * Global rules for pronunciation, math, and other typed inline/block markup.
 * Language ruby/IPA is included only for language-related topic categories,
 * and narrowed to the studied language when known (e.g. Japanese → furigana).
 * Math/chem/unit markup is included for every prompt so mixed-topic content
 * still renders formulas consistently.
 */
export const CONTENT_MARKUP_RULES = buildContentMarkupRules();

/** Append content markup rules once per prompt. */
export function appendContentMarkupRules(
  prompt: string,
  options?: ContentMarkupOptions,
): string {
  if (prompt.includes(CONTENT_MARKUP_MARKER)) return prompt;
  const trimmed = prompt.trimEnd();
  return `${trimmed}\n\n${buildContentMarkupRules(options)}`;
}

/** Prompt block for PlanContext and explicit prompt builders. */
export function getContentMarkupPromptBlock(
  options?: ContentMarkupOptions,
): string {
  return buildContentMarkupRules(options);
}
