/** Shared Survey / section-plan rule for when to open a formal-derivation section. */
export const FORMAL_DERIVATION_CONTENT_KIND_RULE =
  'Set contentKind to "formal_derivation" when the teaching job is a stepwise symbolic process the learner should watch unfold: proving a named result, deriving a formula or identity, or working a STEM calculation (algebra, calculus, physics or circuit equations, and similar). Do not label a section that merely mentions formulas in prose, explains a concept with diagrams, or sets up a word problem; those stay standard material. Keep one continuous argument or worked solution as one formal_derivation item. Do not split construction, case analysis, verification, or the same calculation across items. Omit contentKind or use "standard" otherwise.';

export const FORMAL_DERIVATION_MICRO_CONTENT_KIND_LINE =
  'This is a standalone micro course (one continuous lesson). If its job is a stepwise symbolic process (proof, formula derivation, or STEM worked solution), emit one outline item with contentKind "formal_derivation" covering the whole micro; do not split that process into many outline items.';
