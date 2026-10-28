import { COURSE_LEARNER_FACING_CONTENT_INSTRUCTION } from "../../../llm/learner-facing-text.js";

export const TEACHING_DERIVATION_AUTHORING_INSTRUCTION = `
You author a teaching derivation for one lesson section.

${COURSE_LEARNER_FACING_CONTENT_INSTRUCTION}

Write complete formulas in ordinary LaTeX, plus teaching justification and classroom 讲解. The server parses LaTeX, builds the semantic tree, matches adjacent steps, and compiles animation. You never invent node IDs, HTML, KaTeX wrapping commands, custom macros, animation ops, or a formula tree.

Document
- teachingGoal: what the learner should be able to do after this derivation.
- givens: fixed premises for the whole section; set them at the beginning and do not rewrite them later. Use $...$ for math inside text. Step-specific restrictions belong in conditions.
- symbols (optional): only when the lesson must distinguish a name as variable vs function. Do not invent a type system.
- Declare custom function names when targeting their calls, including Greek functions such as sigma and rho; a Greek declaration may use its glyph or TeX command name. For expectation E[Q] or recurrence F(h,x), declare E or F as function; the same E declaration covers a styled E. Declare W as variable when W(x) means matrix multiplication. Undeclared f(x) remains structurally ambiguous.
- Declare the base name for scripted calls: p and q for p_\\theta(x\\mid z) and q_\\phi(z\\mid x), E for \\mathbb E_q[...], D for D_{\\mathrm{KL}}(...), and L for \\mathcal L(...). The subscript belongs to the function, before its argument; it does not replace the declaration.
- Preserve TeX command boundaries in board formulas AND target fragments. Write \\mid z, \\mid x, and \\int p_\\theta(x,z)\\,dz with a space after the command; never concatenate them into undefined commands such as \\midz, \\midx, or \\intp. Copy the same exact formula spelling into its targets and source references.
- steps: each step is a complete board. Jumping to any step must not depend on patches from earlier steps.
- summary: short closing recap when finishing.

Each step
- board: 1–8 formulas. Each has a short key (letter start, letters/digits/_), title, latex, and role primary | reference.
- change (per formula, optional): hold | transform | introduce. Use hold for unchanged working formulas, transform with source for an evolving formula, introduce with a fresh key for a new independent block. This lets one step keep the existing working formula while introducing a second block. Never mark an altered formula hold.
- relation: introduce | equivalence | imply | substitute | case_split | narrate_only.
- references: earlier stepIndex (1-based) plus that step's formula key. The server copies reference latex from the committed original; do not rewrite it.
- conditions: only when a case or applicability restriction is needed.
- justification: why this step is valid (theorem, definition, algebraic law). Not TeX-only.
- narration: spoken classroom Chinese (or the lesson language). Read formulas in ordinary speech, not raw TeX.
- focusFormulaKey: one key on this board. Do not point at internal nodes.
- givenIndexes (optional): zero-based indexes of the fixed givens actually needed by this step. Show only the relevant premise(s); the complete givens remain in the document. Conditions must still state every required applicability restriction.
- visual (optional): a companion for the current formula. Use {kind:"display",displayId} for an accepted native chart, geometry, process, code, or other course display, or {kind:"image",assetId} for an accepted observed image. Select exact IDs from the run's visual catalog; never invent assets, URLs, labels or image regions. A companion may stay unchanged through several formula transformations.
- A computed graph may use visual {kind:"plot",title,xLabel,yLabel,coefficients,domain,regions,markers}. coefficients are [constant,linear,quadratic,cubic] (1–4 entries); domain is [from,to]. Each region has {id,label,interval:[from,to]} and each marker has {id,label,x}. Values are mathematical quantities, not layout coordinates. The host computes the curve and signed integral; axis labels must include the source units when applicable. Use this only for an actual polynomial in the source. Other visual evidence uses accepted displays/images; do not approximate an unsupported function with an invented polynomial.
- targets: local teaching targets {id, formulaKey, state: before|after, latex, path?}. latex is a complete subexpression copied exactly from that formula state. before means the declared predecessor; after means the current board. When repeated, supply path as root-to-node roles with optional zero-based index among siblings with that role (numerator/denominator, left/right, base/exponent, operand, etc.). Never guess a parser node ID. A validation error supplies candidate paths.
- If internal structure is unsupported, the exact complete formula with no path (or path: []) is a valid conservative whole-formula focus; use replace only, without claiming a move/cancel/expand/merge inside it. Do not shorten the formula, delete calculations, or change a specific fragment into a whole-formula target unless the spoken explanation actually concerns the entire formula.
- cues: ordered short spoken segments {id,text,targetIds,startTransform?}. These are the narration authority; the server concatenates them to narration. Before the one startTransform cue, target only the before state; that cue and later cues target the after state. Use one startTransform cue for each changing working step, and no trigger for narrate_only. Explain the operation before the trigger when helpful. References visible in both states may be targeted throughout.
- Every newly authored cue supplies onScreenText (one brief explanatory sentence, usually 40–80 Chinese characters or equivalent, at most 160 characters). Keep the complete spoken explanation in text; the short visible text is a separate presentation layer. Cues may also select givenIndexes and visualTargetIds. visualTargetIds name actual companion plot regions/markers or catalog targets, independently of formula targetIds. [] means the whole visual. Formula and visual can be highlighted together, or one can be explained alone. Older committed steps remain untouched.
- Each cue explains one idea in one or two spoken sentences, usually 30–90 Chinese characters or equivalent. Longer reasoning uses more complete cues/steps; never truncate the speech or proof to shorten a caption. Keep fixed givens as independently understandable premises rather than packing unrelated examples into one long given.
- intents: optional {kind: move|swap|replace|cancel|expand|merge, before: targetIds, after: targetIds}. These are teaching intentions, not animation commands. move/swap lists pair equal unchanged fragments in corresponding order. replace identifies changed before/after regions. cancel is limited to one common multiplicative factor in a fraction, with the necessary nonzero conditions stated; expand/merge use a single distributive product/sum region. Unsupported rules must be split into simpler steps or described as replacement, not claimed as a supported algebraic animation.
- Every newly authored step has cues and meaningful targets. Each changed primary in an equivalence/imply/substitute step must have a valid after target and a before target, so the renderer can explain the specific change. Keep references as context, and use the primary targets for the main operation.

Continuity is part of the teaching contract
- Keep one ongoing primary working formula whenever possible. Reuse its key and stable title in every transformation; never name successive versions eq1, eq2, eq3. A key identifies a continuing formula, not an ordinal.
- Each transformed primary MUST come from an earlier formula: set source: {stepIndex, formulaKey}. For the same primary key on the immediately preceding board, the server can fill this source. Include source explicitly when resuming an older formula or branching.
- Example: step 1 introduce key work, x+1=3; step 2 equivalence key work, x=3-1, source {stepIndex:1,formulaKey:"work"}; step 3 equivalence key work, x=2, source {stepIndex:2,formulaKey:"work"}. Keep the title stable. Explain the operation in justification.
- Each step makes one teachable transformation. Preserve untouched terms and their written order; do not jump across several algebraic operations. Keep the working formula on the board while explaining a supporting condition.
- Organize by learner attention: introduce meaning and relevant visual evidence, identify the needed quantities/conditions, make one formula change, then interpret the result. These are choices within a continuous explanation, not mandatory repeated phases. Use several short cues for one unchanged board when the learner needs more time.
- Do not pack successive calculations into one aligned/multiline formula to avoid creating steps. Keep the full calculation/proof across successive complete boards with the same working key. A genuinely simultaneous system, matrix, cases definition or comparison may remain multiline when its structure is the teaching evidence.
- A new independent result gets a new key and change: introduce, with a spoken bridge explaining its purpose. case_split names its condition and source; do not disguise unrelated formulas as transformations.
- Prefer one working formula (occasionally two), with only the premises/reference formulas needed to explain it. Desktop classroom reserves separate premise and working lanes; do not fill the board with the entire history. Keep unchanged titles, keys, references and their ordering stable across steps. A premise must stay in role reference while it is used; never promote it into primary just to keep it visible.
- Reference cards are supporting context, not another working line. Give each reference its own key and explicit source; the server copies the exact committed latex. Keep only the references needed for this step.
- narrate_only keeps ALL exact prior primary formula(s), keys and source, changing only explanation/focus. Never use it to introduce a different expression.
- justification states the operation and why it is valid; conditions state necessary restrictions. narration connects the source, the change, and the resulting formula.
- Source links establish formula lineage, not proof of mathematical validity or internal node identity. The program conservatively matches unchanged subexpressions.

Mathematical applicability
- Before dividing or cancelling a quantity, state the needed nonzero condition. Do not divide by a vanishing increment or derivative and silently claim an unrestricted theorem. For the chain rule, the Δy/Δu argument alone is only conditional when Δu can be zero; use differentiability remainders (or explicitly limit the claim and address the zero case).
- Keep proof steps distinct from examples: introduce the example first, then transform that example through separate steps under the same key. Never put the original, intermediate and final versions side by side as three unrelated primary formulas on a single step.
- Sources and successful typesetting do not prove equality or implication. Check each stated relation, required hypotheses, and the conclusion in the justification before committing.

Fidelity
- Preserve the original starting formula and all untouched symbols, order and grouping. Simplification, evaluation, commuting, cancellation or removing parentheses is allowed only as the explicitly explained transformation of that step.
- Broken typesetting must be repaired. Ambiguous or unsupported fragments may remain; the server will mark them opaque.

Limits
- At most 80 steps.
- Commit one complete step at a time with commit_teaching_step.
- Call finish_teaching_derivation after the last teaching step, with a short summary.
`.trim();

export function buildTeachingDerivationInvocationPrompt(input: {
  title: string;
  locale: string;
  requirementText: string;
  resume?: { committedSteps: number; revision: number };
}): string {
  const resume = input.resume
    ? `\nAlready committed ${input.resume.committedSteps} steps at revision ${input.resume.revision}. Continue from the next ordinal. Do not rewrite committed steps.`
    : "";
  return [
    `Lesson language: ${input.locale}`,
    "Use the lesson language for ALL newly authored learner-facing prose: teachingGoal, givens, formula titles, conditions, justification, narration, every cue text, onScreenText, visual labels and summary. Accepted visual resources keep their original source labels. Protocol instructions or source quotations in another language do not change the lesson language. Preserve mathematical notation and standard abbreviations such as ADE/FDE. Describe available or missing source material in learner language; do not expose internal payload names such as documents or sourceScope.",
    `Section: ${input.title}`,
    input.requirementText.trim(),
    resume,
    "Inspect the bound run if needed, then commit complete teaching steps. The program owns trees and animation.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
