/** Fixed code metrics: CJK/emoji reserve two monospace cells; tabs reserve four. */
export function wrapStoryCodeLine(value: string, maxColumns = 68): string[] {
  const lines: string[] = [];
  let line = '', width = 0;
  for (const char of Array.from(value)) {
    const cp = char.codePointAt(0)!;
    const cells = char === '\t' ? 4 : cp > 0xff ? 2 : 1;
    if (width + cells > maxColumns && line) {lines.push(line); line = ''; width = 0;}
    line += char; width += cells;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Line breaks only at top-level binary operators; never inside a TeX group,
 * paired delimiter or environment. The original operator stream is retained. */
export function wrapStoryMath(value: string, maxColumns = 44): string {
  if (/\\(?:begin|end|left|right)\b/u.test(value)) return value;
  const atoms: string[] = [];
  let depth = 0, atom = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\') {atom += char; if (i + 1 < value.length) atom += value[++i]; continue;}
    if ('{(['.includes(char)) depth++;
    if ('})]'.includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && '+='.includes(char) && atom) {atoms.push(atom); atom = '';}
    atom += char;
  }
  if (atom) atoms.push(atom);
  const lines: string[] = [];
  let line = '', columns = 0;
  for (const part of atoms) {
    const width = part.replace(/\\[a-zA-Z]+/gu, 'x').replace(/[{}_^]/gu, '').length;
    if (line && columns + width > maxColumns) {lines.push(line); line = ''; columns = 0;}
    line += part; columns += width;
  }
  if (line) lines.push(line);
  return lines.length > 1 ? `\\begin{aligned}${lines.map(line => `&${line}`).join('\\\\')}\\end{aligned}` : value;
}
