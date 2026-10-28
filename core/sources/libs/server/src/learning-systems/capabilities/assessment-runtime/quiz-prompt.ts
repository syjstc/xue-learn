// Assessment prompt policy and quiz sizing owned by assessment-runtime.
type LearningMaterialContent = {
  introduction: string;
  blocks: Array<{ type: string; [key: string]: unknown }>;
  keyTakeaways: string[];
  [key: string]: unknown;
};

type QuizBatchSlot = {
  slotIndex: number;
  questionType: "mcq" | "mcq_multi" | "true_false";
  primaryLearningTargetId: string;
  primaryCognitiveEntityId: string;
  evidenceDimension: "memory" | "understanding";
  criterionRef: string;
  contextDistance: "same" | "near" | "far";
  targetLabel?: string;
};

/** Default adaptive recall batch size for unit active recall. */
export const UNIT_QUIZ_BATCH_SIZE = 4;
export const UNIT_QUIZ_BATCH_MIN = 3;
export const UNIT_QUIZ_BATCH_MAX = 5;

/** @deprecated Use UNIT_QUIZ_BATCH_SIZE for unit recall batches. */
export const UNIT_QUIZ_QUESTION_COUNT = UNIT_QUIZ_BATCH_SIZE;

/** Supported quiz difficulty levels. */
export type QuizDifficulty = "easy" | "medium" | "hard";

const QUIZ_ITEM_OUTPUT_CONTRACT = `Canonical question object shape — use these exact keys and value types:
- mcq: {"type":"mcq","question":"...","options":["...","...","..."],"correctIndex":0,"primaryLearningTargetId":"lt_1","learningTargetIds":["lt_1"],"primaryCognitiveEntityId":"entity-id-from-requirements","evidenceDimension":"memory","criterionRef":"lt_1:c1","contextDistance":"same"}
- mcq_multi: {"type":"mcq_multi","question":"...","options":["...","...","..."],"correctIndices":[0,1],"primaryLearningTargetId":"lt_2","learningTargetIds":["lt_2"],"primaryCognitiveEntityId":"entity-id-from-requirements","evidenceDimension":"understanding","criterionRef":"lt_2:c1","contextDistance":"same"}
- true_false: {"type":"true_false","question":"...","correctAnswer":true,"primaryLearningTargetId":"lt_3","learningTargetIds":["lt_3"],"primaryCognitiveEntityId":"entity-id-from-requirements","evidenceDimension":"memory","criterionRef":"lt_3:c1","contextDistance":"near"}
- evidenceDimension must be one Allowed quiz evidenceDimension for the primary target (memory and/or understanding as listed). Do not default every question to understanding.
- primaryCognitiveEntityId must be one entity declared for that target and evidenceDimension. One question observes one entity; vary this binding to cover required entities.
- Use "question", never "stem" or "prompt". Every option must be a JSON string, never an object. Do not add id, feedback, response, answer, or explanation fields.`;

/** Drop inline lesson checks so the quiz LLM cannot reuse their stems/options. */
export function materialForQuizPrompt(
  material: LearningMaterialContent,
): LearningMaterialContent {
  return {
    ...material,
    blocks: material.blocks.filter((block) => block.type !== "check"),
  };
}

function buildDistractorInstructions(difficulty: QuizDifficulty): string {
  const base = `Distractor quality — apply to EVERY question:
- Every distractor must be credible to a learner who has studied the material but confused two related ideas, reversed a relationship, omitted a condition, or applied the right idea in the wrong context.
- Build distractors from concepts, terminology, steps, examples, or distinctions that actually appear in the material. They must be wrong for a specific, explainable reason—not random inventions.
- Keep all options parallel in grammar, specificity, length, and tone. The correct answer must not stand out as longer, more precise, more technical, or the only option using lesson terminology.
- Never use joke answers, absurd contradictions, unrelated concepts, "all/none of the above", or giveaway absolutes such as "always" and "never" unless the material itself makes that absolute claim.
- Each wrong option must embody a different error; do not provide several superficial rewrites of the same mistake.
- A learner should need to evaluate the meaning of every option. Do not make any distractor dismissible from wording alone.
- Do not reuse lesson phrasing verbatim for stems or options.`;

  if (difficulty === "easy") {
    return `${base}
- Keep the tested concept direct, but use plausible confusions between nearby terms, steps, examples, or cause-and-effect relationships.
- Avoid obscure edge cases and multi-step inference; difficulty should come from knowing the material, not from silly options.`;
  }

  if (difficulty === "medium") {
    return `${base}
- Make every distractor represent a common misconception, incomplete rule, swapped relationship, or correct statement applied to the wrong case.
- Prefer application and comparison stems over definition lookup; require the learner to discriminate between closely related ideas.
- Include at least two near-miss options whenever the material supports them.`;
  }

  // hard
  return `${base}
- Design "near-miss" distractors that are partially correct but ultimately wrong.
- Use meaningful differences in conditions, sequence, scope, causality, or application—not trick wording or hidden negations.
- Include distractors that could seem correct if the learner misses a nuance or edge case.
- Vary the cognitive level: some questions should test deep understanding, others should test precise recall of details.`;
}

function buildDifficultyQuestionMix(
  difficulty: QuizDifficulty,
  questionCount = UNIT_QUIZ_BATCH_SIZE,
): string {
  const mcqCount = Math.round(questionCount * 0.5);
  const trueFalseCount = Math.min(1, Math.round(questionCount * 0.25));
  const multiCount = Math.max(0, questionCount - mcqCount - trueFalseCount);
  const difficultyNote =
    difficulty === "easy"
      ? "Keep stems direct; difficulty should come from plausible confusions, not trick wording."
      : difficulty === "medium"
        ? "Prefer comparison, cause-effect, and discrimination between closely related ideas."
        : "Include near-miss reasoning and nuanced distinctions without hidden negations.";
  return `- Use roughly ${mcqCount} mcq, ${multiCount} mcq_multi, and ${trueFalseCount} true_false question(s).
- Include at most one true_false per batch.
- ${difficultyNote}
- Match the requested ${questionCount}-question workload while varying recall and understanding depth.`;
}

function buildBatchSlotInstructions(
  batchSlots: readonly QuizBatchSlot[],
): string {
  const lines = batchSlots.map(
    (slot) =>
      `${slot.slotIndex + 1}. type=${slot.questionType}; primaryLearningTargetId=${slot.primaryLearningTargetId}; primaryCognitiveEntityId=${slot.primaryCognitiveEntityId}; evidenceDimension=${slot.evidenceDimension}; criterionRef=${slot.criterionRef}; contextDistance=${slot.contextDistance}${slot.targetLabel ? `; targetLabel=${slot.targetLabel}` : ""}`,
  );
  return `Fixed batch slots — generate EXACTLY these ${batchSlots.length} questions in order. Do NOT change type, target refs, entity ids, evidenceDimension, criterionRef, or contextDistance. Author only question text plus options/answers:
${lines.join("\n")}
- For true_false, set correctAnswer to true or false only; do not add options.
- For mcq/mcq_multi, provide 3-5 credible options with the correct answer indices only.`;
}

export function buildQuizGenerationPrompt(
  unitTitle: string,
  materialJson: string,
  extras: {
    lang: string;
    style?: string;
    options?: string;
    difficulty?: QuizDifficulty;
    learningTargetsBlock?: string;
    questionCount?: number;
    standaloneMicro?: boolean;
    batchSlots?: readonly QuizBatchSlot[];
  },
): string {
  const styleBlock = extras.style ? `${extras.style}\n` : "";
  const optionsBlock = extras.options ? `${extras.options}\n` : "";
  const difficulty = extras.difficulty ?? "medium";
  const questionCount = extras.questionCount ?? UNIT_QUIZ_BATCH_SIZE;
  const distractorInstructions = buildDistractorInstructions(difficulty);
  const questionMix = extras.batchSlots?.length
    ? buildBatchSlotInstructions(extras.batchSlots)
    : buildDifficultyQuestionMix(difficulty, questionCount);
  if (extras.standaloneMicro) {
    return `Generate a quick self-check quiz for standalone micro course "${unitTitle}" with difficulty level: ${difficulty.toUpperCase()}.

This micro course has no cognitive model and records no cognitive evidence. Test only the supplied lesson material.

Question originality:
- Do NOT copy or lightly rephrase questions from the lesson body or inline practice.
- Write fresh, clear questions that help the learner check understanding quickly.
${distractorInstructions}

Question types — ONLY multiple choice:
- "mcq": single-answer multiple choice (exactly one correct option). Use correctIndex (0-based).
- "mcq_multi": multiple-answer ("select all that apply"). Use correctIndices (0-based array, at least 2 correct options).
- Do NOT use true/false or short-answer question types.
- For schema transport only, set learningTargetIds to ["lt_1"], primaryLearningTargetId to "lt_1", evidenceDimension to "understanding", criterionRef to "micro:self_check", and contextDistance to "same". These placeholders do not represent a cognitive model and must not be used as evidence.

${QUIZ_ITEM_OUTPUT_CONTRACT}

Output:
- Return ONLY a minified JSON array of EXACTLY ${questionCount} question objects testing THIS micro course.
- Do NOT wrap the array in an object. No "questions", "qs", or "interleaved" keys — the response must start with "[" and end with "]".
${questionMix}
- Each question must have 3-5 options (4-5 options preferred for medium/hard difficulty).
- Before returning JSON, silently audit every question for one defensible answer set and plausible distractors.

${extras.lang}
${styleBlock}${optionsBlock}Micro-course lesson reference (Compact JSON; keys: intro, b, kt, t, tx, …):
${materialJson}`;
  }
  const learningTargetsBlock = extras.learningTargetsBlock?.trim()
    ? `\nUnit learning targets — each question MUST cite one or more of these local refs in learningTargetIds; cover the set across the quiz. For each primary target, evidenceDimension MUST be one of that target's "Allowed quiz evidenceDimension" values:\n${extras.learningTargetsBlock.trim()}\n`
    : "";

  return `Generate a closed-book evidence task for unit "${unitTitle}" with difficulty level: ${difficulty.toUpperCase()}.

CRITICAL — competency grounding:
- The learning-target definitions are the source of truth for what must be demonstrated.
- Use the learning material only for terminology, factual grounding, and optional context. Do not test exact wording, lesson order, or examples that only make sense after seeing the course.
- Prefer fresh comparison and causal-reasoning situations that can be answered from the stated learning-target competency. A selected response can establish memory or understanding evidence only; application and transfer require direct performance.
${learningTargetsBlock}
Question originality (closed-book quiz, not a worksheet replay):
- Do NOT copy or lightly rephrase questions from the lesson body, key takeaways, or any inline practice checks the learner already saw.
- Write fresh stems and option wording: paraphrase freely, change the scenario or angle, or test the same fact via comparison or cause-effect reasoning.
${distractorInstructions}

Question types:
- "mcq": single-answer multiple choice (exactly one correct option). Use correctIndex (0-based).
- "mcq_multi": multiple-answer ("select all that apply"). Use correctIndices (0-based array, at least 2 correct options).
- "true_false": one declarative statement with correctAnswer true or false. Do not add options.
- Include at most one true_false per batch unless fixed batch slots specify otherwise.
- Every question object MUST include "learningTargetIds": string[] (min 1) using the published lt_* refs above (e.g. ["lt_1"]).
- Every question object MUST include "primaryLearningTargetId" using one id from learningTargetIds. Integrated context may involve other competencies, but answering it records evidence only for that primary id.
- Every question object MUST include "primaryCognitiveEntityId" using the exact entity id from one declared requirement for the chosen evidenceDimension. A question directly observes only this entity.
- Every question object MUST include "evidenceDimension": memory | understanding (only values listed as Allowed quiz evidenceDimension for that primary target), "criterionRef": the exact assessment criterion ref supplied with the target, and "contextDistance": same | near | far.
- If a target allows only memory, every question for it must use evidenceDimension "memory". If it allows only understanding, use "understanding". Never assert a dimension the target does not declare.
- Never mark a multiple-choice question as application or transfer. Those dimensions require direct, verifiable performance; scenario wording does not change a selected response into performance evidence.
- Never invent a target ref, dimension, or criterion. The server rejects undeclared combinations.
- Allocate more of the fixed quiz to core, hard, and analyze/evaluate/create points according to any "Summative questions" hints in the competency block. Supporting points receive at most one question; enrichment does not require a summative question.

${QUIZ_ITEM_OUTPUT_CONTRACT}

Output:
- Return ONLY a minified JSON array of EXACTLY ${questionCount} question objects testing THIS unit.
- Do NOT wrap the array in an object. No "questions", "qs", or "interleaved" keys — the response must start with "[" and end with "]".
${questionMix}
- For mcq/mcq_multi, each question must have 3-5 options (4-5 options preferred for medium/hard difficulty).
- Before returning JSON, silently audit every question: replace any option that is obviously irrelevant, comical, uniquely worded, grammatically incompatible with the stem, or debatable under the material. Confirm that mcq has exactly one defensible answer, mcq_multi has no accidentally correct distractors, and true_false statements are unambiguous.

${extras.lang}
${styleBlock}${optionsBlock}Optional lesson reference (Compact JSON; keys: intro, b, kt, t, tx, …):
${materialJson}`;
}

export const DIAGNOSTIC_STABLE_INSTRUCTION = `Author a closed-book test-out diagnostic against supplied immutable learning-target requirements. The server owns scoring, evidence, and progression.

Invariant diagnostic rules:
- The learning-target definitions are the source of truth. Do not ask about course wording, slide order, examples unique to a lesson, or facts outside those definitions.
- Follow each target's summative allocation exactly (default: two when omitted) and cover every declared required/gated memory or understanding dimension with at least two independent questions.
- Multiple-choice diagnostics cannot establish application or transfer. Every question targets exactly one primary target: learningTargetIds must contain only that target's lt_* ref, and primaryLearningTargetId must be that same ref.
- Set primaryCognitiveEntityId to one exact entity id declared under the target and evidenceDimension. Cover allocated entity requirements independently; never let one answer stand for all entities.
- Include an allowed evidenceDimension, exact criterionRef, and an honest contextDistance on every question. Never use understanding for a memory-only target, or invent a target ref, dimension, criterion, or entity.
- Multiple questions for one point must use different recall, comparison, or causal-reasoning angles.
- Use only mcq and mcq_multi. Keep distractors plausible, avoid wording clues, and do not reveal a learning-target label in a way that gives away the answer.
- Propose questions only. Never decide passing, emit evidence claims, or unlock progression.

${QUIZ_ITEM_OUTPUT_CONTRACT}`;

export function buildDiagnosticQuizPrompt(params: {
  unitTitle: string;
  scopeKind?: "unit" | "module";
  competencyBlock: string;
  questionCount: number;
  languageBlock: string;
  styleBlock?: string;
}): string {
  const scopeLabel = params.scopeKind === "module" ? "module" : "unit";
  return `Generate exactly ${params.questionCount} closed-book test-out diagnostic questions for ${scopeLabel} "${params.unitTitle}".

${
  params.scopeKind === "module"
    ? "They are required module exit capabilities, not a concatenation of unit quizzes. Test integrated capability across the module boundary."
    : "Test whether the learner can recall, explain, and distinguish each target."
}

Learning-target definitions and declared criteria:
${params.competencyBlock}

${params.languageBlock}
${params.styleBlock ?? ""}

Return only the JSON quiz array.`;
}
