"use client";

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

const CJK_TEXT = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆〇ヶ]+`;
const PRONUNCIATION_TEXT =
  String.raw`[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜńňǹḿm̄ḿm̀êƏəɡɚɝŋɲɑɔɛɪʊʃʒʧʤθðʔːˈˌˇˉˊˋ˙·' -]+`;
const PIPE = "[|｜]";

/** Standard: 【ChineseChar|pīnyīn】 */
const CHINESE_RUBY_RE = new RegExp(
  `【([^|｜【】\\n]+)${PIPE}([^】\\n]+)】`,
  "gu",
);
/** Standard: 《Kanji｜kana》 */
const JAPANESE_RUBY_RE = new RegExp(
  `《([^|｜《》\\n]+)${PIPE}([^》\\n]{1,40})》`,
  "gu",
);
/** Legacy: 汉字(pīn yīn) */
const PARENTHESIZED_RE = new RegExp(
  `(${CJK_TEXT})\\((${PRONUNCIATION_TEXT})\\)`,
  "gu",
);
/** Legacy: ｜漢字《かな》 */
const LEGACY_JAPANESE_RUBY_RE = new RegExp(
  `｜(${CJK_TEXT})《([^》\\n]{1,40})》`,
  "gu",
);
/** Common LLM output: 汉字 【pīn yīn】 */
const TRAILING_CHINESE_PINYIN_RE = new RegExp(
  `(${CJK_TEXT})([\\s,，、;；:：]*)【(${PRONUNCIATION_TEXT})】`,
  "gu",
);

const PINYIN_TONE_MARKS = new Set(
  Array.from("āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿê"),
);
const PINYIN_INITIAL_STARTS = new Set(Array.from("bpmfdtnlgkhjqxrzcswy"));
const PINYIN_CODA = new Set(Array.from("ng"));

function renderRuby(base: string, annotation: string, key: string): ReactNode {
  return (
    <ruby key={key} className="pronunciation-ruby">
      {base}
      <rt>{annotation}</rt>
    </ruby>
  );
}

function splitPinyinAnnotation(annotation: string): string[] {
  const trimmed = annotation.trim();
  if (!trimmed) return [];
  if (/[\s-]+/.test(trimmed)) {
    return trimmed.split(/[\s-]+/).filter(Boolean);
  }

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
    if (PINYIN_TONE_MARKS.has(lower)) {
      hasTone = true;
    }
  }

  if (current) syllables.push(current);
  return syllables;
}

function renderChineseRuby(
  base: string,
  annotation: string,
  keyPrefix: string,
): ReactNode[] {
  const baseChars = Array.from(base);
  const syllables = splitPinyinAnnotation(annotation);
  if (syllables.length === 0) return [base];

  if (syllables.length === baseChars.length) {
    return baseChars.map((char, index) =>
      renderRuby(char, syllables[index], `${keyPrefix}-${index}`),
    );
  }

  if (syllables.length < baseChars.length) {
    const prefixLength = baseChars.length - syllables.length;
    return [
      baseChars.slice(0, prefixLength).join(""),
      ...baseChars
        .slice(prefixLength)
        .map((char, index) =>
          renderRuby(
            char,
            syllables[index],
            `${keyPrefix}-${prefixLength + index}`,
          ),
        ),
    ];
  }

  return [renderRuby(base, annotation, keyPrefix)];
}

function renderTextWithPronunciation(text: string, keyPrefix: string): ReactNode {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const combined = new RegExp(
    `${CHINESE_RUBY_RE.source}|${JAPANESE_RUBY_RE.source}|${LEGACY_JAPANESE_RUBY_RE.source}|${PARENTHESIZED_RE.source}|${TRAILING_CHINESE_PINYIN_RE.source}`,
    "gu",
  );

  for (const match of text.matchAll(combined)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));

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
      nodes.push(
        ...renderChineseRuby(
          chineseBase,
          chineseAnnotation,
          `${keyPrefix}-${index}`,
        ),
      );
    } else if (japaneseBase && japaneseAnnotation) {
      nodes.push(
        renderRuby(
          japaneseBase,
          japaneseAnnotation,
          `${keyPrefix}-${index}`,
        ),
      );
    } else if (legacyJapaneseBase && legacyJapaneseAnnotation) {
      nodes.push(
        renderRuby(
          legacyJapaneseBase,
          legacyJapaneseAnnotation,
          `${keyPrefix}-${index}`,
        ),
      );
    } else if (cjkBase && cjkAnnotation) {
      nodes.push(
        ...renderChineseRuby(cjkBase, cjkAnnotation, `${keyPrefix}-${index}`),
      );
    } else if (trailingChineseBase && trailingChineseAnnotation) {
      nodes.push(
        ...renderChineseRuby(
          trailingChineseBase,
          trailingChineseAnnotation,
          `${keyPrefix}-${index}`,
        ),
      );
      const visibleSeparator = trailingChineseSeparator?.replace(/\s+/g, "");
      if (visibleSeparator) nodes.push(visibleSeparator);
    }
    cursor = index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  if (nodes.length === 0) return text;
  return nodes;
}

export function renderPronunciationRuby(
  children: ReactNode,
  keyPrefix = "ruby",
): ReactNode {
  if (typeof children === "string") {
    return renderTextWithPronunciation(children, keyPrefix);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={`${keyPrefix}-${index}`}>
        {renderPronunciationRuby(child, `${keyPrefix}-${index}`)}
      </Fragment>
    ));
  }

  if (isValidElement(children)) {
    const element = children as ReactElement<{ children?: ReactNode }>;
    if (
      typeof element.type === "string" &&
      ["code", "pre", "kbd", "samp", "script", "style"].includes(element.type)
    ) {
      return children;
    }
    if (!element.props.children) return children;
    return cloneElement(element, {
      children: renderPronunciationRuby(
        element.props.children,
        `${keyPrefix}-child`,
      ),
    });
  }

  return Children.map(children, (child, index) =>
    renderPronunciationRuby(child, `${keyPrefix}-${index}`),
  );
}
