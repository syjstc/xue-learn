/** New sections are pedagogical containers; derivations are composable displays.
 * Historical formal_derivation records remain readable by the compatibility path. */
export const FORMAL_DERIVATION_CONTENT_KIND_RULE =
  'Omit contentKind or use "standard" for new sections. A section groups learning objectives and may contain several displays from different domains. Proofs, formula derivations and STEM worked solutions use a math:derivation display built by the installed math plugin; they do not require a separate section type. Keep one continuous argument or worked solution in one derivation display, preserving all intermediate steps, conditions and narration. Do not split the same calculation merely to fit a display or response limit.';

export const FORMAL_DERIVATION_MICRO_CONTENT_KIND_LINE =
  'This is a standalone micro course (one continuous lesson). Keep one continuous proof, formula derivation or STEM worked solution as one teaching object within a standard section; the math:derivation display builder completes the full process asynchronously. Do not split that process into many outline items.';
