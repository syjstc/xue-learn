/** Shared KaTeX macros for LLM-generated physics notation. */
export const KATEX_MACROS: Record<string, string> = {
  "\\VEC": "\\vec{#1}",
  "\\PSI": "\\psi",
  "\\RANGLE": "\\rangle",
  "\\LANGLE": "\\langle",
  "\\KET": "|#1\\rangle",
  "\\BRA": "\\langle#1|",
};
