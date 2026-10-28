/** Parsed assistant text that may include model reasoning wrappers. */
export type ParsedAssistantContent = {
  thinking: string | null;
  thinkingComplete: boolean;
  main: string;
  /** Input used a thinking wrapper or matched the strict deliberation fallback. */
  hadThinkingTag: boolean;
};

const THINKING_OPEN = /<think>|<thinking>/i;
const THINKING_CLOSE = /<\/think>|<\/thinking>|<\/redacted_thinking>/i;

const PRIVATE_DELIBERATION_MARKERS = [
  /(?:^|\n)\s*I need to\b/giu,
  /(?:^|\n|[.!?]\s+)Let me (?:consider|check|think|look|review|determine)\b/giu,
  /(?:^|\n)\s*Wait[,.:!?]/giu,
  /(?:^|\n|[.!?]\s+)I should (?:prefer|check|consider|determine)\b/giu,
];

/**
 * Last-resort guard for providers that put obvious private self-talk in the
 * visible content field instead of a reasoning field/tag. Keep this narrow:
 * one conversational "let me" must never hide a legitimate answer.
 */
function looksLikePrivateDeliberation(raw: string): boolean {
  if (raw.length < 240) return false;
  const markerCount = PRIVATE_DELIBERATION_MARKERS.reduce(
    (count, pattern) => count + (raw.match(pattern)?.length ?? 0),
    0,
  );
  return markerCount >= 3;
}

function parseWithTags(
  raw: string,
  open: RegExp,
  close: RegExp,
): ParsedAssistantContent | null {
  const openMatch = raw.match(open);
  if (!openMatch || openMatch.index === undefined) return null;

  const beforeOpen = raw.slice(0, openMatch.index);
  const afterOpen = raw.slice(openMatch.index + openMatch[0].length);
  const closeMatch = afterOpen.match(close);

  if (!closeMatch || closeMatch.index === undefined) {
    return {
      thinking: afterOpen,
      thinkingComplete: false,
      main: beforeOpen,
      hadThinkingTag: true,
    };
  }

  const thinking = afterOpen.slice(0, closeMatch.index);
  const main = (
    beforeOpen + afterOpen.slice(closeMatch.index + closeMatch[0].length)
  ).trim();

  return {
    thinking,
    thinkingComplete: true,
    main,
    hadThinkingTag: true,
  };
}

/** Split streaming or final assistant text into optional thinking + visible reply. */
export function parseAssistantMessageContent(
  raw: string,
): ParsedAssistantContent {
  const tagged = parseWithTags(raw, THINKING_OPEN, THINKING_CLOSE);
  if (tagged) return tagged;

  if (looksLikePrivateDeliberation(raw)) {
    return {
      thinking: raw,
      thinkingComplete: true,
      main: "",
      hadThinkingTag: true,
    };
  }

  const main = raw.replace(
    /^[\s\S]*?(?:<\/think>|<\/thinking>|<\/redacted_thinking>)\s*/i,
    "",
  );
  return {
    thinking: null,
    thinkingComplete: true,
    main,
    hadThinkingTag: false,
  };
}
