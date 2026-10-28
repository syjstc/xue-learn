const CJK_TEXT = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆〇ヶ]+`;
const PRONUNCIATION_TEXT =
  String.raw`[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜńňǹḿm̄ḿm̀êƏəɡɚɝŋɲɑɔɛɪʊʃʒʧʤθðʔːˈˌˇˉˊˋ˙·' -]+`;
const PIPE = "[|｜]";

const CHINESE_RUBY_RE = new RegExp(
  `【([^|｜【】\\n]+)${PIPE}([^】\\n]+)】`,
  "gu",
);
const JAPANESE_RUBY_RE = new RegExp(
  `《([^|｜《》\\n]+)${PIPE}([^》\\n]{1,40})》`,
  "gu",
);
const PARENTHESIZED_RE = new RegExp(
  `(${CJK_TEXT})\\((${PRONUNCIATION_TEXT})\\)`,
  "gu",
);
const LEGACY_JAPANESE_RUBY_RE = new RegExp(
  `｜(${CJK_TEXT})《([^》\\n]{1,40})》`,
  "gu",
);
const TRAILING_CHINESE_PINYIN_RE = new RegExp(
  `(${CJK_TEXT})([\\s,，、;；:：]*)【(${PRONUNCIATION_TEXT})】`,
  "gu",
);

const PINYIN_TONE_MARKS = new Set(
  Array.from("āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿê"),
);
const PINYIN_INITIAL_STARTS = new Set(Array.from("bpmfdtnlgkhjqxrzcswy"));
const PINYIN_CODA = new Set(Array.from("ng"));

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitPinyinAnnotation(annotation: string): string[] {
  const trimmed = annotation.trim();
  if (!trimmed) return [];
  if (/[\s-]+/.test(trimmed)) return trimmed.split(/[\s-]+/).filter(Boolean);

  const chars = Array.from(trimmed);
  const syllables: string[] = [];
  let current = "";
  let hasTone = false;

  for (const char of chars) {
    const lower = char.toLocaleLowerCase();
    if (
      current &&
      hasTone &&
      PINYIN_INITIAL_STARTS.has(lower) &&
      !PINYIN_CODA.has(lower)
    ) {
      syllables.push(current);
      current = "";
      hasTone = false;
    }

    current += char;
    if (PINYIN_TONE_MARKS.has(lower)) hasTone = true;
  }

  if (current) syllables.push(current);
  return syllables;
}

function rubyHtml(base: string, annotation: string): string {
  return `<ruby class="pronunciation-ruby">${escapeHtmlText(base)}<rt>${escapeHtmlText(annotation)}</rt></ruby>`;
}

function chineseRubyHtml(base: string, annotation: string): string {
  const baseChars = Array.from(base);
  const syllables = splitPinyinAnnotation(annotation);
  if (syllables.length === 0) return escapeHtmlText(base);

  if (syllables.length === baseChars.length) {
    return baseChars.map((char, i) => rubyHtml(char, syllables[i])).join("");
  }

  if (syllables.length < baseChars.length) {
    const prefixLength = baseChars.length - syllables.length;
    const prefix = escapeHtmlText(baseChars.slice(0, prefixLength).join(""));
    const annotated = baseChars
      .slice(prefixLength)
      .map((char, i) => rubyHtml(char, syllables[i]))
      .join("");
    return `${prefix}${annotated}`;
  }

  return rubyHtml(base, annotation);
}

function renderPronunciationText(text: string): string {
  const combined = new RegExp(
    `${CHINESE_RUBY_RE.source}|${JAPANESE_RUBY_RE.source}|${LEGACY_JAPANESE_RUBY_RE.source}|${PARENTHESIZED_RE.source}|${TRAILING_CHINESE_PINYIN_RE.source}`,
    "gu",
  );

  return text.replace(combined, (...args: unknown[]) => {
    const match = args as string[];
    const chineseBase = match[1];
    const chineseAnnotation = match[2];
    const japaneseBase = match[3];
    const japaneseAnnotation = match[4];
    const legacyJapaneseBase = match[5];
    const legacyJapaneseAnnotation = match[6];
    const cjkBase = match[7];
    const cjkAnnotation = match[8];
    const trailingChineseBase = match[9];
    const trailingChineseSeparator = match[10];
    const trailingChineseAnnotation = match[11];

    if (chineseBase && chineseAnnotation) {
      return chineseRubyHtml(chineseBase, chineseAnnotation);
    }
    if (japaneseBase && japaneseAnnotation) {
      return rubyHtml(japaneseBase, japaneseAnnotation);
    }
    if (legacyJapaneseBase && legacyJapaneseAnnotation) {
      return rubyHtml(legacyJapaneseBase, legacyJapaneseAnnotation);
    }
    if (cjkBase && cjkAnnotation) {
      return chineseRubyHtml(cjkBase, cjkAnnotation);
    }
    if (trailingChineseBase && trailingChineseAnnotation) {
      const separator = trailingChineseSeparator?.replace(/\s+/g, "") ?? "";
      return `${chineseRubyHtml(trailingChineseBase, trailingChineseAnnotation)}${escapeHtmlText(separator)}`;
    }
    return match[0];
  });
}

export function renderPronunciationHtml(html: string): string {
  const protectedBlocks: string[] = [];
  const protectedHtml = html.replace(
    /<(pre|code|kbd|samp|script|style)\b[\s\S]*?<\/\1>/gi,
    (block) => {
      const token = `__PDF_PRONUNCIATION_PROTECTED_${protectedBlocks.length}__`;
      protectedBlocks.push(block);
      return token;
    },
  );

  const rendered = renderPronunciationText(protectedHtml);
  return rendered.replace(
    /__PDF_PRONUNCIATION_PROTECTED_(\d+)__/g,
    (_, index: string) => protectedBlocks[Number(index)] ?? "",
  );
}
