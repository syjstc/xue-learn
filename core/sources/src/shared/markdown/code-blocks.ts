const FENCED_CODE_RE = /```[^\n`]*\n([\s\S]*?)```/g;

/** Extract source bodies from fenced markdown code blocks, in document order. */
export function extractMarkdownCodeBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(FENCED_CODE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    blocks.push(match[1]!.replace(/\n$/, ""));
  }
  return blocks;
}

export function markdownCodeBlockTargets(
  blockKey: string,
  markdown: string,
): Array<{ key: string; text: string }> {
  return extractMarkdownCodeBlocks(markdown).map((text, index) => ({
    key: `${blockKey}:code:${index}`,
    text,
  }));
}
