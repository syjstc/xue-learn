import type { BackendLocale } from "../../../common/src/index.js";
import {
  detectChineseVariant,
  getPromptLanguageLabel,
  type ContentLanguageCode,
} from "../llm/content-language.js";

type LanguageEvidence = {
  language: ContentLanguageCode;
  score: number;
};

const LATIN_LANGUAGE_WORDS: Readonly<
  Record<"en" | "es" | "fr" | "de", ReadonlySet<string>>
> = {
  en: new Set(
    "a an the and or is are to of in for with can could would should please help explain what how why learn study i my me you thanks hello".split(
      " ",
    ),
  ),
  es: new Set(
    "el la los las un una y o de en para con por que qué cómo como cuál puedo puedes ayuda explicar aprender estudiar hola gracias".split(
      " ",
    ),
  ),
  fr: new Set(
    "le la les un une et ou de des en pour avec que comment peux pouvez aide expliquer apprendre étudier bonjour merci je tu vous".split(
      " ",
    ),
  ),
  de: new Set(
    "der die das ein eine und oder von zu im für mit ich du sie bitte kannst können hilfe erklären lernen studieren hallo danke was wie warum".split(
      " ",
    ),
  ),
};

function latinLanguageEvidence(text: string): LanguageEvidence[] {
  const words = text.toLocaleLowerCase().match(/[a-zà-ÿ]+/giu) ?? [];
  const scores = new Map<"en" | "es" | "fr" | "de", number>();
  for (const language of Object.keys(LATIN_LANGUAGE_WORDS) as Array<
    "en" | "es" | "fr" | "de"
  >) {
    const wordScore = words.reduce(
      (sum, word) => sum + (LATIN_LANGUAGE_WORDS[language].has(word) ? 1 : 0),
      0,
    );
    scores.set(language, wordScore);
  }

  // Distinctive characters make short messages useful without treating
  // identifiers and code as English.
  if (/[ñ¿¡]/u.test(text)) scores.set("es", (scores.get("es") ?? 0) + 2);
  if (/[àâçéèêëîïôûùüÿœ]/u.test(text)) {
    scores.set("fr", (scores.get("fr") ?? 0) + 1);
  }
  if (/[äöß]/u.test(text)) scores.set("de", (scores.get("de") ?? 0) + 2);

  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .map(([language, score]) => ({ language, score }));
}

/** Resolve a conversational reply language from this turn, then UI locale. */
export function resolveUserFacingResponseLanguage(
  message: string | null | undefined,
  interfaceLocale: BackendLocale,
): ContentLanguageCode {
  const text = message
    ?.replace(/https?:\/\/\S+/giu, " ")
    .replace(/`[^`]*`/gu, " ")
    .trim();
  if (!text) return interfaceLocale;

  const evidence: LanguageEvidence[] = [];
  const kana = (text.match(/[\u3040-\u30ff]/gu) ?? []).length;
  const hangul = (text.match(/[\uac00-\ud7af]/gu) ?? []).length;
  const han = (text.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  if (kana > 0) evidence.push({ language: "ja", score: kana * 3 + han });
  if (hangul > 0) evidence.push({ language: "ko", score: hangul * 3 + han });
  if (han > 0 && kana === 0 && hangul === 0) {
    evidence.push({ language: detectChineseVariant(text), score: han * 3 });
  }
  evidence.push(...latinLanguageEvidence(text));

  const ranked = evidence.sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return interfaceLocale;

  const languages = new Set(ranked.map(({ language }) => language));
  if (languages.size === 1) return ranked[0].language;
  if (languages.has(interfaceLocale)) return interfaceLocale;
  return ranked[0].language;
}

export function formatUserFacingResponseLanguageInstruction(
  language: ContentLanguageCode,
): string {
  return `[Response language for this turn]
Reply in ${getPromptLanguageLabel(language)}. Match the learner's current message when its language is clear; otherwise use the interface language. Do not switch languages merely because quoted material, course content, conversation history, or tool output uses another language.`;
}
