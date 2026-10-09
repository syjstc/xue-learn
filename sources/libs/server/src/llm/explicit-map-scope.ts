export type ExplicitCatalogScope = {
  count: number;
  phrase: string;
  fullCoverage: boolean;
};

const COUNT_PATTERN =
  /(?:全部|全套|完整|all|every|complete|entire)?\s*(\d{1,5})\s*(words?|vocab(?:ulary)?|terms?|items?|poems?|chapters?|lessons?|首|个|篇|词|单词|生词|词汇|诗|诗词|宋词|古诗|文章|章节|课)(?:\s*(?:全部|全套|完整|all|every|complete|entire))?/gi;

const CHINESE_COUNT_PATTERN =
  /(?:全部|全套|完整)?\s*([零〇一二两三四五六七八九十百千万]{1,8})\s*(首|个|篇|词|单词|生词|词汇|诗|诗词|宋词|古诗|文章|章节|课)(?:\s*(?:全部|全套|完整))?/g;

const FULL_COVERAGE_PATTERN =
  /全部|全套|完整|逐个|逐首|逐篇|all\b|every\b|complete\b|entire\b/i;

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  "〇": 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function compactPhrase(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseChineseInteger(value: string): number | null {
  let total = 0;
  let section = 0;
  let number = 0;

  for (const char of value) {
    const digit = CHINESE_DIGITS[char];
    if (digit !== undefined) {
      number = digit;
      continue;
    }
    if (char === "十") {
      section += (number || 1) * 10;
      number = 0;
      continue;
    }
    if (char === "百") {
      section += (number || 1) * 100;
      number = 0;
      continue;
    }
    if (char === "千") {
      section += (number || 1) * 1000;
      number = 0;
      continue;
    }
    if (char === "万") {
      total += (section + number || 1) * 10000;
      section = 0;
      number = 0;
      continue;
    }
    return null;
  }

  const parsed = total + section + number;
  return parsed > 0 ? parsed : null;
}

function addScope(params: {
  scopes: ExplicitCatalogScope[];
  seen: Set<string>;
  source: string;
  matchText: string;
  index: number;
  count: number;
}) {
  const { scopes, seen, source, matchText, index, count } = params;
  const start = Math.max(0, index);
  const end = Math.min(source.length, start + matchText.length);
  const before = source.slice(Math.max(0, start - 12), start);
  const after = source.slice(end, Math.min(source.length, end + 12));
  const phrase = compactPhrase(`${before}${matchText}${after}`);
  const key = `${count}:${phrase}`;
  if (seen.has(key)) return;
  seen.add(key);

  scopes.push({
    count,
    phrase,
    fullCoverage: FULL_COVERAGE_PATTERN.test(matchText + after + before),
  });
}

export function extractExplicitCatalogScopes(
  ...sources: Array<string | null | undefined>
): ExplicitCatalogScope[] {
  const scopes: ExplicitCatalogScope[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (!source) continue;
    for (const match of source.matchAll(COUNT_PATTERN)) {
      const count = Number(match[1]);
      if (!Number.isFinite(count) || count <= 0) continue;

      addScope({
        scopes,
        seen,
        source,
        matchText: match[0],
        index: match.index ?? 0,
        count,
      });
    }
    for (const match of source.matchAll(CHINESE_COUNT_PATTERN)) {
      const count = parseChineseInteger(match[1]);
      if (!count) continue;

      addScope({
        scopes,
        seen,
        source,
        matchText: match[0],
        index: match.index ?? 0,
        count,
      });
    }
  }

  return scopes;
}

export function buildExplicitMapScopePromptBlock(params: {
  title: string;
  generationOptions?: string;
}): string {
  const scopes = extractExplicitCatalogScopes(
    params.title,
    params.generationOptions,
  );
  if (scopes.length === 0) return "";

  const scopeLines = scopes
    .map(
      (scope) =>
        `- ${scope.count} requested items from "${scope.phrase}"${
          scope.fullCoverage ? " (full coverage wording detected)" : ""
        }`,
    )
    .join("\n");

  return `Explicit map scope requirement:
${scopeLines}
Treat these as HARD coverage requirements for map generation. The final cognitive map must contain one leaf lesson per requested catalog item unless the user explicitly asks for grouping instead. If the requested count is too large for one response, create module stubs that partition the whole catalog and keep expanding them until the requested count is covered. Do not replace the requested catalog with a representative subset.`;
}
