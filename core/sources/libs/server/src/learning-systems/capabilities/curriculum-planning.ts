import { GOAL_DIRECTED_TEACHING_POLICY } from "../../goal-creation/teaching-policy.js";
import {
  type ContentLanguageCode,
  getContentLanguageLabel,
  getPromptLanguageLabel,
  getLanguagePromptInstruction,
} from "../../llm/content-language.js";
import { TOPIC_CATEGORY_PROMPT_LINES } from "../../../../common/src/index.js";
import { z } from "zod";
import {
  curriculumModuleMatchesContentLanguage,
  hydrateCurriculumModule,
  preprocessGoalMapPlanPayload,
} from "./curriculum-plan-normalization.js";
import { getGenerationOptionsPromptBlock } from "../../llm/generation-options.js";
import { buildExplicitMapScopePromptBlock } from "../../llm/explicit-map-scope.js";
import type { StreamTokenHandler } from "../../llm/chat-stream.js";
import {
  runValidatedStructuredGeneration,
  type ObjectRepairSlot,
} from "../../llm/validated-structured-generation.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { CURRICULUM_PLANNING_VIEW_KEYS } from "../../llm/curriculum-planning-keys.js";
import { teachingSkillGenerationMeta } from "../../teaching-skills/prompt.js";
import { parseLlmJson } from "../../llm/sanitize-response.js";
import {
  goalMapPlanSchema,
  goalMapPlanFieldsSchema,
  goalCurriculumPlanV2BindingSchema,
  goalCurriculumIdentityBindingSchema,
  goalCurriculumJourneyBindingSchema,
  curriculumModuleJourneyStubSchema,
  curriculumModulePlanSchema,
  domainAnalysisSchema,
  majorAreaSchema,
  MAX_SEQUENTIAL_MODULES,
  MAX_TOP_LEVEL_UNITS,
  type GoalCurriculumIdentity,
  type GoalMapPlan,
} from "../../llm/schemas.js";

const planResponseSchema = goalMapPlanSchema;
const nonEmptyPlanTextSchema = z.string().trim().min(1);
/** Typical full-goal journeys; schema still allows one compact module. */
const TYPICAL_SEQUENTIAL_MODULES = 3;

function parseValidSequentialModules(
  modules: unknown[],
  contentLanguage: ContentLanguageCode,
) {
  return modules.flatMap((value) => {
    const parsed = curriculumModulePlanSchema.safeParse(
      hydrateCurriculumModule(value),
    );
    return parsed.success &&
      curriculumModuleMatchesContentLanguage(parsed.data, contentLanguage)
      ? [parsed.data]
      : [];
  });
}

function isPackedSingleModule(
  modules: ReturnType<typeof parseValidSequentialModules>,
): boolean {
  if (modules.length !== 1) return false;
  const module = modules[0]!;
  return (
    module.estimatedUnitCount >= 9 ||
    module.unitPlanningBrief.scopeSize === "large" ||
    module.unitPlanningBrief.progression.length >= 4
  );
}

export function sequentialModuleRepairTarget(params: {
  validCount: number;
  droppedCount: number;
  packedSingle: boolean;
}): number {
  if (params.validCount <= 0) return TYPICAL_SEQUENTIAL_MODULES;
  if (params.droppedCount > 0) {
    return Math.min(
      MAX_SEQUENTIAL_MODULES,
      Math.max(
        params.validCount + params.droppedCount,
        TYPICAL_SEQUENTIAL_MODULES,
      ),
    );
  }
  if (params.packedSingle) return TYPICAL_SEQUENTIAL_MODULES;
  return params.validCount;
}

function withGoalPlanField(
  root: unknown,
  key: string,
  value: unknown,
): unknown {
  if (!root || typeof root !== "object" || Array.isArray(root)) return root;
  return { ...(root as Record<string, unknown>), [key]: value };
}

function normalizedGoalPlanCandidate(
  candidate: unknown,
  contentLanguage: ContentLanguageCode,
): {
  value: unknown;
  normalizedCount: number;
  droppedCount: number;
} {
  const preprocessed = preprocessGoalMapPlanPayload(candidate);
  if (
    !preprocessed ||
    typeof preprocessed !== "object" ||
    Array.isArray(preprocessed)
  ) {
    return { value: preprocessed, normalizedCount: 0, droppedCount: 0 };
  }
  const root = { ...(preprocessed as Record<string, unknown>) };
  let normalizedCount = 0;
  let droppedCount = 0;
  for (const key of ["refinedTitle", "topicOverview"]) {
    if (typeof root[key] === "string") {
      const trimmed = root[key].trim();
      if (trimmed !== root[key]) normalizedCount += 1;
      root[key] = trimmed;
    } else if (root[key] === null && key === "refinedTitle") {
      delete root[key];
      normalizedCount += 1;
    } else if (
      key === "refinedTitle" &&
      root[key] !== undefined &&
      typeof root[key] !== "string"
    ) {
      delete root[key];
      droppedCount += 1;
    }
  }
  for (const key of ["outOfScope", "prerequisitesAssumed"]) {
    if (root[key] === null) {
      root[key] = [];
      normalizedCount += 1;
    } else if (Array.isArray(root[key])) {
      const source = root[key] as unknown[];
      root[key] = source.flatMap((value) =>
        typeof value === "string" && value.trim() ? [value.trim()] : [],
      );
      droppedCount += source.length - (root[key] as unknown[]).length;
    }
  }
  if (Array.isArray(root.whatYouWillLearn)) {
    const source = root.whatYouWillLearn;
    root.whatYouWillLearn = source
      .flatMap((value) =>
        typeof value === "string" && value.trim() ? [value.trim()] : [],
      )
      .slice(0, 12);
    droppedCount += source.length - (root.whatYouWillLearn as unknown[]).length;
  }
  if (Array.isArray(root.majorAreas)) {
    const source = root.majorAreas;
    root.majorAreas = source
      .flatMap((value) => {
        const parsed = majorAreaSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, MAX_TOP_LEVEL_UNITS);
    droppedCount += source.length - (root.majorAreas as unknown[]).length;
  }
  if (Array.isArray(root.modules)) {
    const source = root.modules;
    const valid = parseValidSequentialModules(source, contentLanguage);
    const droppedModules = source.length - valid.length;
    droppedCount += droppedModules;
    const target = sequentialModuleRepairTarget({
      validCount: valid.length,
      droppedCount: droppedModules,
      packedSingle: isPackedSingleModule(valid),
    });
    root.modules = [
      ...valid,
      ...Array.from({ length: Math.max(0, target - valid.length) }, () => ({})),
    ];
  }
  return { value: root, normalizedCount, droppedCount };
}

function goalPlanRecoveryPolicy(params: {
  title: string;
  contentLanguage: ContentLanguageCode;
}) {
  const languageLabel = getPromptLanguageLabel(params.contentLanguage);
  const topLevelFields = [
    ["domainAnalysis", domainAnalysisSchema],
    ["topicOverview", nonEmptyPlanTextSchema],
  ] as const;
  return {
    sourceSchema: z.unknown(),
    normalize: (candidate: unknown) =>
      normalizedGoalPlanCandidate(candidate, params.contentLanguage),
    repairSlots: ({ candidate }: { candidate: unknown; error: z.ZodError }) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        return [
          {
            slot: {
              description:
                `Create one complete subject-specific goal plan for "${params.title}". ` +
                `Write every user-facing string in ${languageLabel}; never use generic milestone placeholder copy.`,
              currentValue: candidate,
              schema: goalCurriculumPlanV2BindingSchema,
              expectedShape: PLAN_SCHEMA_SHAPE,
            },
            apply: (_root: unknown, value: unknown) => value,
          },
        ];
      }
      const root = candidate as Record<string, unknown>;
      const repairContext = {
        goalTitle: params.title,
        outputLanguage: languageLabel,
        domainAnalysis: root.domainAnalysis ?? null,
        topicOverview: root.topicOverview ?? null,
        existingSequentialModules: Array.isArray(root.modules)
          ? root.modules
          : [],
      };
      const repairs: ObjectRepairSlot[] = topLevelFields.flatMap(
        ([key, schema]) =>
          schema.safeParse(root[key]).success
            ? []
            : [
                {
                  slot: {
                    description:
                      `Correct the missing or invalid required goal-plan field ${key} for "${params.title}". ` +
                      `Write user-facing text in ${languageLabel}.`,
                    currentValue: {
                      invalidValue: root[key] ?? null,
                      context: repairContext,
                    },
                    schema,
                  },
                  apply: (value: unknown, repaired: unknown) =>
                    withGoalPlanField(value, key, repaired),
                },
              ],
      );
      const outcomes = Array.isArray(root.whatYouWillLearn)
        ? root.whatYouWillLearn.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : [];
      for (let index = outcomes.length; index < 3; index += 1) {
        repairs.push({
          slot: {
            description:
              `Add missing subject-specific learning outcome ${index + 1} of 3 for "${params.title}". ` +
              `Write it in ${languageLabel} and ground it in the supplied course context, not generic filler.`,
            currentValue: repairContext,
            schema: nonEmptyPlanTextSchema,
          },
          apply: (value: unknown, repaired: unknown) => {
            const object = value as Record<string, unknown>;
            return {
              ...object,
              whatYouWillLearn: [
                ...(Array.isArray(object.whatYouWillLearn)
                  ? object.whatYouWillLearn
                  : []),
                repaired,
              ],
            };
          },
        });
      }
      const modules = Array.isArray(root.modules) ? root.modules : [];
      const validModules = parseValidSequentialModules(
        modules,
        params.contentLanguage,
      );
      const moduleTarget = sequentialModuleRepairTarget({
        validCount: validModules.length,
        droppedCount: modules.length - validModules.length,
        packedSingle: isPackedSingleModule(validModules),
      });
      for (let index = validModules.length; index < moduleTarget; index += 1) {
        repairs.push({
          slot: {
            description:
              `Create the subject-specific sequential module at position ${index + 1} of ${moduleTarget} for "${params.title}". ` +
              `Continue the existing module journey with a concrete observable capability. Write every user-facing string in ${languageLabel}. ` +
              `Do not collapse remaining milestones into one large module, and do not use generic labels such as "Milestone Module", "sequential milestone", or "project wrap-up".`,
            currentValue: {
              ...repairContext,
              existingSequentialModules: validModules,
              requestedPosition: index + 1,
              minimumModuleCount: moduleTarget,
            },
            schema: curriculumModuleJourneyStubSchema,
          },
          apply: (value: unknown, repaired: unknown) => {
            const object = value as Record<string, unknown>;
            const kept = parseValidSequentialModules(
              Array.isArray(object.modules) ? object.modules : [],
              params.contentLanguage,
            );
            return {
              ...object,
              schemaVersion: 2,
              modules: [...kept, repaired],
            };
          },
        });
      }
      return repairs;
    },
  };
}

export const PLAN_SCHEMA_SHAPE = `{
  "schemaVersion": 2,
  "refinedTitle": "clear, accurate learning goal title (fix typos/grammar; keep language & scope)",
  "domainAnalysis": {
    "field": "broad discipline (e.g. language learning, computer science)",
    "subdomain": "specific slice within the field",
    "learningMode": "skill_practice",
    "domainTag": "humanities",
    "topicCategory": "language",
    "modeClarification": "2-3 sentences: which learning tradition this is and why (e.g. learning English for communication vs studying linguistics)",
    "alternateInterpretations": [{ "label": "other reading of the goal", "whyNotChosen": "why we did not pick it" }]
  },
  "topicOverview": "2-4 short paragraphs AFTER domain is clear — journey, motivation, how units will feel",
  "whatYouWillLearn": ["...", "..."],
  "prerequisitesAssumed": ["..."],
  "modules": [{
    "title": "first observable milestone",
    "summary": "what changes for the learner in this module",
    "objective": "observable capability achieved at exit",
    "dependsOnPrevious": "for module 1, state the entry foundation"
  }, {
    "title": "next dependent milestone",
    "summary": "the next capability that requires the previous module",
    "objective": "observable capability achieved at this later exit",
    "dependsOnPrevious": "how this builds on the prior milestone"
  }]
}`;

export const IDENTITY_SCHEMA_SHAPE = `{
  "schemaVersion": 2,
  "refinedTitle": "clear, accurate learning goal title (fix typos/grammar; keep language & scope)",
  "domainAnalysis": {
    "field": "broad discipline (e.g. language learning, computer science)",
    "subdomain": "specific slice within the field",
    "learningMode": "skill_practice",
    "domainTag": "humanities",
    "topicCategory": "language",
    "modeClarification": "2-3 sentences: which learning tradition this is and why",
    "alternateInterpretations": [{ "label": "other reading of the goal", "whyNotChosen": "why we did not pick it" }]
  },
  "topicOverview": "2-4 short paragraphs AFTER domain is clear — journey, motivation, how units will feel",
  "whatYouWillLearn": ["...", "..."],
  "prerequisitesAssumed": ["assumed foundation given the confirmed level"]
}`;

export const JOURNEY_SCHEMA_SHAPE = `{
  "modules": [{
    "title": "first observable milestone",
    "summary": "what changes for the learner in this module",
    "objective": "observable capability achieved at exit",
    "dependsOnPrevious": "for module 1, state the entry foundation"
  }]
}`;

export function buildGoalMapPlanPrompt(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  teachingSkillBlock?: string;
}): string {
  const contextBlock = params.context
    ? `\n\nReference material:\n${params.context}`
    : "\n\nNo uploaded material — reason from widely accepted curricula for this topic.";

  const langNote = getLanguagePromptInstruction(params.contentLanguage);
  const optionsBlock = getGenerationOptionsPromptBlock(
    params.generationOptions,
  );
  const explicitScopeBlock = buildExplicitMapScopePromptBlock({
    title: params.title,
    generationOptions: params.generationOptions,
  });
  const levelMeaning =
    params.level === "zero"
      ? "zero: the learner selected no prior foundation"
      : params.level === "basic"
        ? "basic: the learner explicitly selected some prior foundation; never describe them as zero-basis or a complete beginner"
        : params.level === "advanced"
          ? "advanced: the learner explicitly selected an advanced starting point"
          : `${params.level}: preserve this stated starting level exactly`;

  return `${GOAL_DIRECTED_TEACHING_POLICY}\n\nYou are XueLearn's learning strategist. Work in TWO phases before any units or cognitive entities exist:
(A) identify the learning DOMAIN and clarify the learning MODE for this goal;
(B) only then plan a STRICTLY ORDERED JOURNEY of small capability milestones.

User goal: ${params.title}
User-confirmed level: ${levelMeaning}
Path hints source: ${params.pathSource}
${contextBlock}
${optionsBlock ? `\n${optionsBlock}\n` : ""}
${explicitScopeBlock ? `\n${explicitScopeBlock}\n` : ""}
${params.teachingSkillBlock ? `\n${params.teachingSkillBlock}\n` : ""}
${langNote}

Authority and intent constraints (NON-NEGOTIABLE):
- User goal, user-confirmed level, and custom instructions are the authoritative contract. Reference material is evidence for HOW to teach; it must never redefine WHAT the learner asked to achieve.
- If custom instructions contain a marked "User-confirmed original learning goal" or "User-confirmed goal contract", that original intent outranks a model-authored/display title when they conflict.
- Preserve the learner's explicitly stated priority and use case as the primary objective. Secondary selected uses may be supporting outcomes only.
- Do not introduce an exam, certificate, grade, proficiency band, job target, or other success criterion unless it appears explicitly in the user goal or custom instructions.
- A display title by itself is not sufficient proof of an explicit exam/certification request when the custom instructions contain more specific learner answers; require support from the marked original goal or those answers.
- In particular, search queries, source titles, common curricula, and a model-authored preliminary title are never evidence that the learner requested an exam or certificate.
- refinedTitle, topicOverview, modules, and outcomes must not contradict or silently upgrade the confirmed starting level or objective.

Phase A — domainAnalysis (do this FIRST; everything else depends on it):
1. field — which discipline this belongs to (e.g. language learning, music, computer science, medicine).
2. subdomain — the specific slice (e.g. English phonetics, frontend React, linear algebra).
3. learningMode — pick ONE:
   - skill_practice: learn to DO/use (speak a language, play instrument, code)
   - conceptual_understanding: understand principles & systems (math theory, CS fundamentals)
   - research_scholarship: academic study OF a subject (linguistics, historiography)
   - professional_applied: job-ready workflows & tools
   - creative_expression: produce original work (writing, design, composition)
   - mixed: genuinely spans multiple modes — explain in modeClarification
4. domainTag — stem | humanities | general (for study rhythm & tooling).
5. topicCategory — pick ONE broad category (drives specialist content markup in generated lessons):
${TOPIC_CATEGORY_PROMPT_LINES.map((line) => `   - ${line}`).join("\n")}
   Choose language ONLY when the goal is primarily about learning/using a language (not history or literature studied in translation).
   Choose mathematics/natural_science/computer_science/engineering/health_medicine when STEM formulas or notation will appear often.
   Use general when no specialist markup profile fits.
6. modeClarification — 2-3 sentences on WHY this mode fits. Disambiguate common confusions:
   - language: "learn English" (skill_practice) vs "study English linguistics" (research_scholarship)
   - music: performance vs music theory/history
   - programming: building apps vs computer science theory
7. alternateInterpretations — up to 2 other plausible readings of the user's goal and why you rejected them.

Phase B — plan the sequential module journey (AFTER domain is clear):
7. refinedTitle — rewrite the user's goal into a clear title (fix typos; same language & intent). Never add a certification, exam level, or "zero-basis" claim that the user did not explicitly request.
8. topicOverview — learning journey tailored to the chosen learningMode (not generic).
9. whatYouWillLearn — concrete outcomes for THIS mode (e.g. communicative ability vs analytical papers).
10. prerequisitesAssumed — given user level
    - If Learner profile context is present in the custom instructions, use it as the source of truth for known foundations and skill levels.
    - Do not assume mastery beyond stated profile levels; add bridge/review scope when profile shows weak or missing prerequisites.
    - If critical prerequisite information is absent, reflect that uncertainty in prerequisitesAssumed instead of inventing it.
11. modules — generate 1–8 ordered milestone contracts that match the confirmed goal's actual scope (not a default textbook length):
    - Use one module when the entire goal is a single narrow observable capability: one named theorem, identity, proof, lemma, formula, procedure, or similarly small skill.
    - Use 2–3 modules only when the goal has a few genuine capability milestones. Use 4–8 only for a broad multi-stage journey the learner actually asked for.
    - Never pad toward 3–6 modules. "Usually 3–6" is not a quota.
    - Do not collapse a genuine multi-stage journey into one large module, and do not invent adjacent chapters, extra theorems, applications, or exam drills unless they are required to achieve the confirmed goal.
    - Prefer fewer modules for genuinely narrow goals; never pad with generic buckets such as "Introduction" or "Advanced Topics".
    - A module is a small goal with a demonstrable learner capability, NOT a topic bucket, taxonomy pillar, or renamed map branch.
    - Module N+1 must depend on capabilities expected from Module N. Parallel independent pillars are invalid.
    - Author only title, summary, objective, and dependsOnPrevious. Do not invent lesson counts, lesson titles, planning briefs, entry-foundation objects, or exit-capability lists; later module workers author those after research.
    - objective must be observable performance. Avoid vague buckets such as "Introduction", "Fundamentals", or "Advanced Topics" unless they describe a real performance transition.
    - dependsOnPrevious explains the dependency. For Module 1, name the assumed entry foundation.
12. Journey quality:
    - Cover the whole goal without repeating the same capability in multiple modules.
    - Progress from foundation to guided performance to independent/transfer performance as the domain permits.
    - Respect uploaded source order only when it is pedagogically coherent; otherwise explain the milestone sequence through the module dependencies.

Output schemaVersion 2. Do NOT output majorAreas, mapStructure, unit/session titles, targets, entities, atoms, relations, assessments, lesson counts, or content.`;
}

function planningPromptPreamble(
  params: Parameters<typeof buildGoalMapPlanPrompt>[0],
): string {
  const contextBlock = params.context
    ? `\n\nReference material:\n${params.context}`
    : "\n\nNo uploaded material — reason from widely accepted curricula for this topic.";
  const langNote = getLanguagePromptInstruction(params.contentLanguage);
  const optionsBlock = getGenerationOptionsPromptBlock(
    params.generationOptions,
  );
  const explicitScopeBlock = buildExplicitMapScopePromptBlock({
    title: params.title,
    generationOptions: params.generationOptions,
  });
  const levelMeaning =
    params.level === "zero"
      ? "zero: the learner selected no prior foundation"
      : params.level === "basic"
        ? "basic: the learner explicitly selected some prior foundation; never describe them as zero-basis or a complete beginner"
        : params.level === "advanced"
          ? "advanced: the learner explicitly selected an advanced starting point"
          : `${params.level}: preserve this stated starting level exactly`;
  return `User goal: ${params.title}
User-confirmed level: ${levelMeaning}
Path hints source: ${params.pathSource}
${contextBlock}
${optionsBlock ? `\n${optionsBlock}\n` : ""}
${explicitScopeBlock ? `\n${explicitScopeBlock}\n` : ""}
${params.teachingSkillBlock ? `\n${params.teachingSkillBlock}\n` : ""}
${langNote}

Authority and intent constraints (NON-NEGOTIABLE):
- User goal, user-confirmed level, and custom instructions are the authoritative contract. Reference material is evidence for HOW to teach; it must never redefine WHAT the learner asked to achieve.
- If custom instructions contain a marked "User-confirmed original learning goal" or "User-confirmed goal contract", that original intent outranks a model-authored/display title when they conflict.
- Preserve the learner's explicitly stated priority and use case as the primary objective. Secondary selected uses may be supporting outcomes only.
- Do not introduce an exam, certificate, grade, proficiency band, job target, or other success criterion unless it appears explicitly in the user goal or custom instructions.
- A display title by itself is not sufficient proof of an explicit exam/certification request when the custom instructions contain more specific learner answers; require support from the marked original goal or those answers.
- In particular, search queries, source titles, common curricula, and a model-authored preliminary title are never evidence that the learner requested an exam or certificate.`;
}

export function buildGoalIdentityPrompt(
  params: Parameters<typeof buildGoalMapPlanPrompt>[0],
): string {
  return `${GOAL_DIRECTED_TEACHING_POLICY}\n\nYou are XueLearn's learning strategist. Author only the GOAL IDENTITY now. Do not output modules, lesson counts, or worker briefs.

${planningPromptPreamble(params)}

Write:
- refinedTitle — clear title (fix typos; same language & intent). Never add a certification, exam level, or "zero-basis" claim that the user did not explicitly request.
- domainAnalysis — field, subdomain, learningMode, domainTag, topicCategory, modeClarification, and up to 2 rejected alternateInterpretations.
- topicOverview — 2-4 short paragraphs for this learningMode.
- whatYouWillLearn — 3–12 concrete outcomes for THIS mode.
- prerequisitesAssumed — foundations assumed at the confirmed level. Use learner-profile context when present; do not invent mastery the profile does not support. Empty is valid when the confirmed level already covers entry.

Do not output modules.`;
}

export function buildGoalJourneyPrompt(
  params: Parameters<typeof buildGoalMapPlanPrompt>[0],
  identity: GoalCurriculumIdentity,
): string {
  const prerequisites = identity.prerequisitesAssumed.length
    ? identity.prerequisitesAssumed.map((item) => `- ${item}`).join("\n")
    : "- (none listed)";
  return `${GOAL_DIRECTED_TEACHING_POLICY}\n\nYou are XueLearn's learning strategist. The goal identity is already committed and frozen. Author only the ordered MODULE JOURNEY.

${planningPromptPreamble(params)}

Frozen identity (do not rewrite):
- Title: ${identity.refinedTitle?.trim() || params.title}
- Field: ${identity.domainAnalysis.field} → ${identity.domainAnalysis.subdomain}
- Learning mode: ${identity.domainAnalysis.learningMode}
- Overview: ${identity.topicOverview}
- Outcomes:\n${identity.whatYouWillLearn.map((item) => `  - ${item}`).join("\n")}
- Assumed prerequisites:\n${prerequisites}

Author 1–8 ordered milestone modules that match the confirmed goal's actual scope. Use one module when the entire goal is a single narrow observable capability (one named theorem, identity, proof, formula, or skill). Use 2–3 only for a few genuine milestones, and 4–8 only when the learner asked for a broad journey. Never pad toward 3–6. Do not collapse a genuine multi-stage journey into one large module, and do not invent extra chapters. Never pad with generic buckets such as "Introduction" or "Advanced Topics".
Each module has only title, summary, objective, and dependsOnPrevious. Module N+1 must depend on Module N. For module 1, dependsOnPrevious names the assumed entry foundation.
Do not invent lesson counts, lesson titles, planning briefs, entry-foundation objects, or exit-capability lists.`;
}

function buildDetailedPlanPrompt(params: {
  title: string;
  level: string;
  currentMap: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  teachingSkillBlock?: string;
}): string {
  const langNote = getLanguagePromptInstruction(params.contentLanguage);
  const optionsBlock = getGenerationOptionsPromptBlock(
    params.generationOptions,
  );
  const contextBlock = params.context
    ? `\n\nReference material:\n${params.context.slice(0, 10000)}`
    : "";
  return `${GOAL_DIRECTED_TEACHING_POLICY}\n\nYou are XueLearn's post-map learning planner.
Generate a detailed learning plan FROM THE CURRENT COGNITIVE MAP. Do not redesign the map.

Goal: ${params.title}
User level: ${params.level}
Path source: ${params.pathSource}
${contextBlock}
${optionsBlock ? `\n${optionsBlock}\n` : ""}
${params.teachingSkillBlock ? `\n${params.teachingSkillBlock}\n` : ""}
${langNote}

Current cognitive map:
${params.currentMap}

Rules:
- Base majorAreas on the current top-level map units exactly.
- Use mapRole "branch" for top-level branch pillars (learnable now; may have children after subdivision); use "leaf" for focused session units.
- Use the "Actual map totals" line as the source of truth for top-level count, module count, lesson leaf count, and planned minutes. Do not invent or inflate unit counts.
- Estimate full depth from the actual map tree.
- In topicOverview and whatYouWillLearn, emphasize the learner's outcome progression through the plan.
- Do not add top-level areas that are not in the current map.
- Do not add exclusions that are not in the confirmed goal or custom instructions.`;
}

export const CURRICULUM_PLANNING_CAPABILITY_ID = "curriculum-planning" as const;
export const CURRICULUM_PLANNING_CAPABILITY_VERSION = "1.3.0" as const;

export const CURRICULUM_PLANNING_INSTRUCTION = `Create the requested XueLearn curriculum artifact from the invocation input.
- Treat the learner's confirmed goal, level, scope, language, and approved map as authoritative.
- Match module count to that confirmed scope. A narrow goal (one named theorem, identity, proof, formula, or skill) is one module. Do not expand a small request into a textbook, chapter sequence, or survey course.
- Allowed range is 1–8 modules. Never pad toward 3–6. Use extra modules only for genuine capability milestones the learner asked for.
- Keep assumed foundations in prerequisitesAssumed; do not open modules that only review them.
- If the teaching persona specifies first-principles or non-textbook sequencing, order modules for the fastest path to understanding. Do not copy a syllabus or textbook table of contents. Still cover the confirmed goal and teach genuinely blocking prerequisites first.
- Follow the invocation's complete planning rules and declared structured-output contract.
- Do not invent learner constraints, credentials, exams, or outcomes that the supplied goal contract does not support.`;

export type GoalCurriculumPlanningMode = "fast" | "deep" | "docs_first";
export type PrepareGoalCurriculumPlanAuthoringInput = {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  teachingSkillBlock?: string;
  planningMode?: GoalCurriculumPlanningMode;
  operation?:
    | "goal.curriculum.plan"
    | "goal.curriculum.replan"
    | "goal.curriculum.plan.deep_blueprint"
    | "goal.curriculum.plan.deep_draft"
    | "goal.curriculum.plan.deep_synthesis";
};

/** Shared authoring boundary after mode-specific context gathering. */
export function prepareGoalCurriculumPlanAuthoring(
  input: PrepareGoalCurriculumPlanAuthoringInput,
) {
  if (
    input.planningMode === "docs_first" &&
    (input.pathSource !== "rag" || !input.context?.trim())
  ) {
    throw new Error("Docs-first planning requires prepared document context");
  }
  const operation =
    input.operation ??
    (input.planningMode === "deep" || input.planningMode === "docs_first"
      ? "goal.curriculum.plan.deep_blueprint"
      : "goal.curriculum.plan");
  const contextInvocation = {
    title: input.title,
    level: input.level,
    context: input.context,
    pathSource: input.pathSource,
    contentLanguage: input.contentLanguage,
    generationOptions: input.generationOptions,
    teachingSkillBlock: input.teachingSkillBlock,
  };
  const prompt = buildGoalMapPlanPrompt(contextInvocation);
  const recoveryPolicy = goalPlanRecoveryPolicy(input);
  const parseResult = (candidate: unknown) => {
    const normalized = normalizedGoalPlanCandidate(
      candidate,
      input.contentLanguage,
    ).value;
    return planResponseSchema.parse(normalized);
  };
  return {
    operation,
    prompt,
    standalonePrompt: `${CURRICULUM_PLANNING_INSTRUCTION}\n\n${prompt}`,
    contextInvocation,
    schema: planResponseSchema,
    bindingSchema: goalCurriculumPlanV2BindingSchema,
    schemaShape: PLAN_SCHEMA_SHAPE,
    recoveryPolicy,
    parseResult,
    parseProviderOutput: (content: string) =>
      parseResult(parseLlmJson<unknown>(content)),
  };
}

function identityRecoveryPolicy(params: {
  title: string;
  contentLanguage: ContentLanguageCode;
}) {
  const languageLabel = getPromptLanguageLabel(params.contentLanguage);
  const combined = goalPlanRecoveryPolicy(params);
  return {
    sourceSchema: z.unknown(),
    normalize: combined.normalize,
    repairSlots: ({
      candidate,
      error,
    }: {
      candidate: unknown;
      error: z.ZodError;
    }) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        return [
          {
            slot: {
              description:
                `Create the goal identity for "${params.title}". ` +
                `Write every user-facing string in ${languageLabel}. Do not output modules.`,
              currentValue: candidate,
              schema: goalCurriculumIdentityBindingSchema,
              expectedShape: IDENTITY_SCHEMA_SHAPE,
            },
            apply: (_root: unknown, value: unknown) => value,
          },
        ];
      }
      return combined.repairSlots({ candidate, error }).filter((repair) => {
        const description = String(repair.slot.description);
        return (
          !description.includes("sequential module") &&
          !description.includes("complete subject-specific goal plan")
        );
      });
    },
  };
}

function journeyRecoveryPolicy(params: {
  title: string;
  contentLanguage: ContentLanguageCode;
}) {
  const combined = goalPlanRecoveryPolicy(params);
  return {
    sourceSchema: z.unknown(),
    normalize: (candidate: unknown) => {
      const root =
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? (candidate as Record<string, unknown>)
          : {};
      return combined.normalize({
        schemaVersion: 2,
        modules: root.modules,
      });
    },
    repairSlots: ({
      candidate,
      error,
    }: {
      candidate: unknown;
      error: z.ZodError;
    }) =>
      combined
        .repairSlots({ candidate, error })
        .filter((repair) =>
          String(repair.slot.description).includes("sequential module"),
        ),
  };
}

export function prepareGoalCurriculumIdentityAuthoring(
  input: PrepareGoalCurriculumPlanAuthoringInput,
) {
  const prepared = prepareGoalCurriculumPlanAuthoring(input);
  const prompt = buildGoalIdentityPrompt(prepared.contextInvocation);
  return {
    ...prepared,
    prompt,
    standalonePrompt: `${CURRICULUM_PLANNING_INSTRUCTION}\n\n${prompt}`,
    bindingSchema: goalCurriculumIdentityBindingSchema,
    schemaShape: IDENTITY_SCHEMA_SHAPE,
    recoveryPolicy: identityRecoveryPolicy(input),
    parseResult: (candidate: unknown) =>
      goalCurriculumIdentityBindingSchema.parse(candidate),
  };
}

export function prepareGoalCurriculumJourneyAuthoring(
  input: PrepareGoalCurriculumPlanAuthoringInput & {
    identity: GoalCurriculumIdentity;
  },
) {
  const prepared = prepareGoalCurriculumPlanAuthoring(input);
  const prompt = buildGoalJourneyPrompt(
    prepared.contextInvocation,
    input.identity,
  );
  return {
    ...prepared,
    prompt,
    standalonePrompt: `${CURRICULUM_PLANNING_INSTRUCTION}\n\n${prompt}`,
    bindingSchema: goalCurriculumJourneyBindingSchema,
    schemaShape: JOURNEY_SCHEMA_SHAPE,
    recoveryPolicy: journeyRecoveryPolicy(input),
    parseResult: (candidate: unknown) =>
      goalCurriculumJourneyBindingSchema.parse(candidate),
  };
}

export function createCurriculumPlanningCapability() {
  return defineLearningSystemCapability({
    id: CURRICULUM_PLANNING_CAPABILITY_ID,
    version: CURRICULUM_PLANNING_CAPABILITY_VERSION,
    kind: "learning_system",
    views: {
      [CURRICULUM_PLANNING_VIEW_KEYS.journeyInstructionContext]: async ({
        subject,
      }): Promise<ContextEnvelope | null> => {
        return {
          ownerCapabilityId: CURRICULUM_PLANNING_CAPABILITY_ID,
          ownerCapabilityVersion: CURRICULUM_PLANNING_CAPABILITY_VERSION,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: CURRICULUM_PLANNING_INSTRUCTION },
        };
      },
      [CURRICULUM_PLANNING_VIEW_KEYS.detailInstructionContext]: async ({
        subject,
      }): Promise<ContextEnvelope | null> => {
        return {
          ownerCapabilityId: CURRICULUM_PLANNING_CAPABILITY_ID,
          ownerCapabilityVersion: CURRICULUM_PLANNING_CAPABILITY_VERSION,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: CURRICULUM_PLANNING_INSTRUCTION },
        };
      },
    },
  });
}

export async function planGoalMapStream(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  teachingSkillBlock?: string;
  onToken?: StreamTokenHandler;
  signal?: AbortSignal;
  operation?:
    | "goal.curriculum.plan"
    | "goal.curriculum.replan"
    | "goal.curriculum.plan.deep_blueprint"
    | "goal.curriculum.plan.deep_draft"
    | "goal.curriculum.plan.deep_synthesis";
  authoringAgent?: { userId: string; goalId: string };
  onIdentity?: (identity: GoalCurriculumIdentity) => void | Promise<void>;
  wrapIdentity?: <T>(run: () => Promise<T>) => Promise<T>;
  wrapJourney?: <T>(run: () => Promise<T>) => Promise<T>;
}): Promise<GoalMapPlan> {
  const prepared = prepareGoalCurriculumPlanAuthoring(params);
  const wrapIdentity =
    params.wrapIdentity ?? (<T>(run: () => Promise<T>) => run());
  const wrapJourney =
    params.wrapJourney ?? (<T>(run: () => Promise<T>) => run());
  if (params.authoringAgent) {
    const { runGoalAuthoringRound } =
      await import("../../goal-authoring/runner.js");
    const identityPrepared = prepareGoalCurriculumIdentityAuthoring(params);
    const identity = await wrapIdentity(() =>
      runGoalAuthoringRound({
        ...params.authoringAgent!,
        expectedTool: "commit_goal_identity",
        prompt: identityPrepared.standalonePrompt,
        resultSchema: identityPrepared.bindingSchema,
        operation: "goal.authoring_agent",
        signal: params.signal,
        onToken: params.onToken,
        meta: {
          goalTitle: params.title,
          level: params.level,
          pathSource: params.pathSource,
          contentLanguage: params.contentLanguage,
          stage: "identity",
        },
      }),
    );
    await params.onIdentity?.(identity);
    const journeyPrepared = prepareGoalCurriculumJourneyAuthoring({
      ...params,
      identity,
    });
    const journey = await wrapJourney(() =>
      runGoalAuthoringRound({
        ...params.authoringAgent!,
        expectedTool: "commit_goal_journey",
        prompt: journeyPrepared.standalonePrompt,
        resultSchema: journeyPrepared.bindingSchema,
        operation: "goal.authoring_agent",
        signal: params.signal,
        onToken: params.onToken,
        meta: {
          goalTitle: params.title,
          level: params.level,
          pathSource: params.pathSource,
          contentLanguage: params.contentLanguage,
          stage: "journey",
        },
      }),
    );
    return prepared.parseResult({ ...identity, ...journey });
  }
  return runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: prepared.schema,
      prompt: prepared.prompt,
      recoveryPolicy: prepared.recoveryPolicy,
      options: {
        operation: prepared.operation,
        contract: { sizeProfile: "long" },
        meta: {
          goalTitle: params.title,
          level: params.level,
          pathSource: params.pathSource,
          contentLanguage: params.contentLanguage,
          languageLabel: getContentLanguageLabel(params.contentLanguage),
          ...teachingSkillGenerationMeta(params.teachingSkillBlock),
        },
        schemaShape: prepared.schemaShape,
        bindingSchema: prepared.bindingSchema,
      },
      contextSubject: {},
      contextQuery: params.title.slice(0, 2_000),
      contextInvocation: prepared.contextInvocation,
    },
    { onToken: params.onToken, signal: params.signal },
  );
}

export async function planGoalMapFromCurrentMapStream(params: {
  title: string;
  level: string;
  currentMap: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  teachingSkillBlock?: string;
  onToken?: StreamTokenHandler;
  signal?: AbortSignal;
}): Promise<GoalMapPlan> {
  return runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: planResponseSchema,
      prompt: buildDetailedPlanPrompt(params),
      recoveryPolicy: goalPlanRecoveryPolicy(params),
      options: {
        operation: "goal.plan.detail",
        meta: {
          goalTitle: params.title,
          level: params.level,
          pathSource: params.pathSource,
          contentLanguage: params.contentLanguage,
          languageLabel: getContentLanguageLabel(params.contentLanguage),
          ...teachingSkillGenerationMeta(params.teachingSkillBlock),
        },
        schemaShape: PLAN_SCHEMA_SHAPE,
        bindingSchema: goalMapPlanFieldsSchema,
      },
      contextSubject: {},
      contextQuery: params.title.slice(0, 2_000),
      contextInvocation: params,
    },
    { onToken: params.onToken, signal: params.signal },
  );
}

export async function planGoalMap(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
}): Promise<GoalMapPlan> {
  return planGoalMapStream(params);
}
