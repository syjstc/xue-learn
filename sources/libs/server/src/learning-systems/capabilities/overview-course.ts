import { z } from "zod";
import type { StreamTokenHandler } from "../../llm/chat-stream.js";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { OVERVIEW_COURSE_VIEW_KEYS } from "../../goals/overview-course-keys.js";
import {
  learningMaterialSchema,
  sqPreviewSchema,
  type LearningMaterialContent,
} from "../../llm/schemas.js";
import {
  coreConceptsPrimerMaterialBlockRequirements,
  overviewMaterialBlockRequirements,
} from "../../domain/unit-session-duration.js";
import { getPlanContextForGoal } from "../../graph/unit-session.js";
import { UNIT_SHARED_CONTEXT_REUSE_LINE } from "../../graph/unit-session-prompts.js";
import { COURSE_MATERIAL_CHAT_VOICE_RULES } from "../../graph/course-material-prose.js";
import {
  illustrationPromptBlock,
  stripIllustrationBlocksIfDisabled,
} from "../../images/enrich-material.js";
import { isImageGenerationAvailable } from "../../images/providers/index.js";
import { ensureImageRuntimeConfig } from "../../images/runtime-config.js";
import { learningMaterialJsonShape } from "../../llm/schema-shapes.js";
import type { ContentLanguageCode } from "../../llm/content-language.js";
import { buildBoundedReferencePromptSection } from "../../citations/inline-citations.js";
import { retrieveMaterialReferenceWithSources } from "../../rag/retrieve.js";
import {
  formatLearnedKnowledgePrompt,
  retrieveLearnedKnowledge,
} from "../../rag/learned-knowledge.js";
import {
  addNarratedMaterialSequenceIssues,
  narratedTokensFromBlocks,
} from "../../llm/narrated-material-sequence.js";

export type GoalOverviewBranch = {
  title: string;
  summary: string;
};

export type OverviewCourseMode = "map_orientation" | "core_concepts_primer";

export function resolveOverviewCourseMode(
  branches: GoalOverviewBranch[],
): OverviewCourseMode {
  return branches.length > 0 ? "map_orientation" : "core_concepts_primer";
}

function flattenCatalogText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function formatOverviewCatalogLine(branch: GoalOverviewBranch): string {
  const summary = flattenCatalogText(branch.summary);
  return summary ? `${branch.title}: ${summary}` : branch.title;
}

export function parseOverviewCatalogSummary(
  summary: string,
): GoalOverviewBranch[] {
  return summary
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      const ascii = line.indexOf(":");
      const fullwidth = line.indexOf("：");
      const candidates = [ascii, fullwidth].filter((index) => index > 0);
      const separator = candidates.length > 0 ? Math.min(...candidates) : -1;
      if (separator <= 0) return [];
      const title = line.slice(0, separator).trim();
      const description = line.slice(separator + 1).trim();
      return title ? [{ title, summary: description }] : [];
    });
}

export function resolveOverviewCatalogBranches(input: {
  liveCatalog?: ReadonlyArray<GoalOverviewBranch>;
  storedSummary?: string | null;
}): GoalOverviewBranch[] {
  const live = (input.liveCatalog ?? [])
    .map((branch) => ({
      title: branch.title.trim(),
      summary: flattenCatalogText(branch.summary),
    }))
    .filter((branch) => branch.title);
  if (live.length > 0) return live;
  return parseOverviewCatalogSummary(String(input.storedSummary ?? ""));
}

export function formatOverviewCatalogBlock(
  branches: ReadonlyArray<GoalOverviewBranch>,
): string {
  if (branches.length === 0) return "(no modules listed yet)";
  return branches
    .map((branch) => `- ${formatOverviewCatalogLine(branch)}`)
    .join("\n");
}

export function resolveOverviewCourseDifficulty(
  mode: OverviewCourseMode,
): "easy" | "medium" | "hard" {
  return mode === "core_concepts_primer" ? "medium" : "easy";
}

export const goalOverviewCourseSchema = z
  .object({
    overviewCourse: z.object({
      title: z.string().min(1),
      summary: z.string().default(""),
      units: z
        .array(
          z.object({
            title: z.string().min(1),
            summary: z.string().min(1),
            keyConcepts: z.array(z.string()).min(2).max(6),
            branchIncludes: z.array(z.string()).min(2).max(12),
            sq: sqPreviewSchema.nullish().default(null),
            material: learningMaterialSchema,
            checkQuestion: z.string().optional().default(""),
          }),
        )
        .min(1)
        .max(1),
    }),
  })
  .superRefine((result, ctx) => {
    result.overviewCourse.units.forEach((unit, unitIndex) => {
      addNarratedMaterialSequenceIssues(
        narratedTokensFromBlocks(unit.material.blocks),
        ctx,
        ["overviewCourse", "units", unitIndex, "material", "blocks"],
      );
    });
  });

export type GoalOverviewCourseResult = z.infer<typeof goalOverviewCourseSchema>;

function overviewJsonShape(includeIllustrations: boolean): string {
  const materialShape = learningMaterialJsonShape({ includeIllustrations });
  return `{
  "overviewCourse": {
    "title": "topic overview course title",
    "summary": "what this single overview course helps the learner see",
    "units": [
      {
        "title": "single overview course lesson title",
        "summary": "broad conceptual explanation of the whole map",
        "keyConcepts": ["concept"],
        "branchIncludes": ["top-level branch title"],
        "sq": null,
        "material": ${materialShape},
        "checkQuestion": "self-assessment question for the whole overview"
      }
    ]
  }
}`;
}

function fallbackBranches(topic: string): GoalOverviewBranch[] {
  return [
    {
      title: "Core ideas",
      summary: `The key concepts, vocabulary, and mental models that make ${topic} understandable.`,
    },
    {
      title: "Methods and practice",
      summary: `The common workflows, tools, exercises, and repeated skills used in ${topic}.`,
    },
    {
      title: "Applications",
      summary: `Where ${topic} appears in real work, projects, decisions, or adjacent fields.`,
    },
    {
      title: "Common pitfalls",
      summary: `Misconceptions, confusing boundaries, and places where learners usually overfit or skip context.`,
    },
  ];
}

function fallbackCoreConceptRegions(topic: string): GoalOverviewBranch[] {
  return [
    {
      title: "Foundations",
      summary: `The core vocabulary, mental models, and first principles that make ${topic} understandable.`,
    },
    {
      title: "Key mechanisms",
      summary: `How the main parts of ${topic} work together in practice.`,
    },
    {
      title: "Essential skills",
      summary: `The concrete techniques, workflows, or patterns learners must recognize early.`,
    },
    {
      title: "Connections and boundaries",
      summary: `How ${topic} relates to adjacent ideas and where beginners commonly confuse concepts.`,
    },
  ];
}

function fallbackMaterial(
  branches: GoalOverviewBranch[],
  topic: string,
  mode: OverviewCourseMode,
): LearningMaterialContent {
  const blocks = branches.flatMap((branch) => [
    { type: "heading" as const, level: 2 as const, text: branch.title },
    { type: "paragraph" as const, text: branch.summary },
    ...(mode === "core_concepts_primer"
      ? [
          {
            type: "callout" as const,
            variant: "definition" as const,
            title: "Core idea",
            body: `This section introduces a foundational concept in ${topic} with a concrete example.`,
          },
          {
            type: "paragraph" as const,
            text: `A simple example shows how ${branch.title.toLowerCase()} shows up when you start working with ${topic}.`,
          },
        ]
      : [
          {
            type: "paragraph" as const,
            text: `Within ${branch.title}, you will later study the parts of ${topic} you care about most.`,
          },
          {
            type: "callout" as const,
            variant: "definition" as const,
            title: "Branch role",
            body: `This branch groups related ideas inside ${topic} and connects to the other major regions of the map.`,
          },
        ]),
  ]);
  return {
    introduction:
      mode === "core_concepts_primer"
        ? `This lesson introduces the core concepts you need to start learning ${topic}.`
        : `This overview orients you to the top-level branches of ${topic}.`,
    blocks: [
      ...blocks,
      {
        type: "accordion",
        title:
          mode === "core_concepts_primer"
            ? "Go deeper later"
            : "What to study next",
        body:
          mode === "core_concepts_primer"
            ? "After this primer, you can expand into a full learning map for the areas you want to master."
            : "After the overview, follow the learning path for the parts you care about most.",
      },
      {
        type: "callout",
        variant: "definition",
        title:
          mode === "core_concepts_primer"
            ? `What should you be able to explain after this primer on ${topic}?`
            : `What should this overview course do for your learning goal?`,
        body:
          mode === "core_concepts_primer"
            ? "You should understand the foundational concepts, vocabulary, and how the major ideas connect — not just a list of topics."
            : "It should give you one coherent first pass over the major regions before you dive into individual units.",
      },
    ],
    keyTakeaways:
      mode === "core_concepts_primer"
        ? [
            "Each heading covers one core concept region with definitions and examples.",
            "You should be able to explain key terms, not just recognize topic names.",
            "Use this primer before diving into deeper units or a full learning map.",
          ]
        : [
            "Each top-level heading corresponds to a major branch in the map.",
            "Use the overview to decide what deserves deeper study.",
            "Your path can change as your understanding changes.",
          ],
  };
}

export function fallbackGoalOverviewCourse(
  title: string,
  topicOverview: string,
  branches: GoalOverviewBranch[],
): GoalOverviewCourseResult {
  const cleanTitle = title.trim() || "this topic";
  const mode = resolveOverviewCourseMode(branches);
  const effectiveBranches =
    branches.length > 0
      ? branches
      : mode === "core_concepts_primer"
        ? fallbackCoreConceptRegions(cleanTitle)
        : fallbackBranches(cleanTitle);
  const overview =
    topicOverview.trim() ||
    (mode === "core_concepts_primer"
      ? `${cleanTitle} has several foundational ideas learners need before deeper study. This single primer lesson introduces core concepts with definitions and examples.`
      : `${cleanTitle} can be explored as a landscape of core ideas, practical methods, applications, and common pitfalls. The first overview course orients the learner before they follow the detailed learning path.`);

  return {
    overviewCourse: {
      title:
        mode === "core_concepts_primer"
          ? `${cleanTitle} core concepts`
          : `${cleanTitle} overview`,
      summary: overview,
      units: [
        {
          title:
            mode === "core_concepts_primer"
              ? `${cleanTitle} core concepts primer`
              : `${cleanTitle} overview`,
          summary:
            mode === "core_concepts_primer"
              ? `A single primer lesson introducing foundational concepts in ${cleanTitle}.`
              : `A single overview course for the top-level branches of ${cleanTitle}.`,
          keyConcepts: ["scope", "relationships", "examples"],
          branchIncludes: effectiveBranches.map((branch) => branch.title),
          sq: null,
          material: fallbackMaterial(effectiveBranches, cleanTitle, mode),
          checkQuestion:
            mode === "core_concepts_primer"
              ? `Which core concepts in ${cleanTitle} are clear, and which need more practice?`
              : `Which top-level branches of ${cleanTitle} are clear, and which should you study next?`,
        },
      ],
    },
  };
}

function branchesBlock(
  branches: GoalOverviewBranch[],
  mode: OverviewCourseMode,
): string {
  if (mode === "core_concepts_primer") {
    return "No cognitive map yet — infer 4–6 core concept regions for this broad topic and teach each one substantively.";
  }
  return branches
    .map((branch) => `- ${branch.title}: ${branch.summary || "(no summary)"}`)
    .join("\n");
}

export function overviewOrientationStagePrompt(params: {
  title: string;
  topicOverview: string;
  catalogBlock: string;
  mode: OverviewCourseMode;
}): string {
  const roleLine =
    params.mode === "core_concepts_primer"
      ? "You are authoring one standalone core-concepts primer lesson for a light course on a broad topic."
      : "You are authoring one course-orientation lesson (课程导览) for a full learning goal. It sits at the same level as the module catalog and orients the learner before any module.";
  const objectiveLine =
    params.mode === "core_concepts_primer"
      ? "Teach foundational ideas before deeper study. There is no Survey and no learning-target list."
      : "Introduce this goal's course content and course arrangement (modules and their lessons). There is no Survey, no 预习, and no practice.";
  const modeRules =
    params.mode === "core_concepts_primer"
      ? `- This is a real teaching lesson for a broad topic, not a syllabus or table of contents.
- Infer 4–6 major core concept regions for this topic.
- Call commit_section_topics with one topic per core concept region, then commit_topic_material for each topic (one display plus spoken cues).
- Assume zero prior knowledge but teach at medium depth.`
      : `- This is orientation for an existing goal, not a brand-new curriculum and not a module lesson.
- Open with what this goal is for and what finishing it looks like.
- Then walk the course arrangement: one topic per module listed below, in the same order. Each topic has one display plus spoken cues that explain the module's role, what its lessons cover, and how it connects to the next module — high-level orientation, not deep unit study.
- Do not use material "check" blocks, quizzes, labs, or practice.`;
  return `${roleLine}

Learning goal title: ${params.title}
Topic overview: ${params.topicOverview || "(none yet)"}
${params.mode === "core_concepts_primer" ? "Core concept regions to infer and teach:" : "Current course modules (this is the catalog the orientation must explain):"}
${params.catalogBlock}

${objectiveLine}

Ignore Survey coverage rules. Do not teach sibling module lessons in depth.
Call commit_section_topics then commit_topic_material for each topic. Do not call commit_component_selection, commit_survey, commit_section_plan, or commit_section_material.
Use ordinary stage subviews for comparisons; never emit the retired compare block. Each cue is one spoken beat of at most three short sentences.

${modeRules}`;
}

function buildOverviewCoursePrompt(params: {
  title: string;
  topicOverview: string;
  branches: GoalOverviewBranch[];
  mode: OverviewCourseMode;
  schemaShape: string;
  referenceSection?: string;
  planBlocks: {
    goalBlock: string;
    difficultyBlock: string;
    timeBudgetBlock: string;
    styleBlock: string;
    languageBlock: string;
    options: string;
    langCode: ContentLanguageCode;
  };
}): string {
  const { mode, schemaShape, planBlocks } = params;
  const materialRules =
    mode === "core_concepts_primer"
      ? coreConceptsPrimerMaterialBlockRequirements()
      : overviewMaterialBlockRequirements();

  const roleLine =
    mode === "core_concepts_primer"
      ? "You are designing one standalone core-concepts primer lesson for a light course on a broad topic."
      : "You are designing one course-orientation lesson (课程导览) for a full learning goal. It sits at the same level as the module catalog and orients the learner before any module.";

  const objectiveLine =
    mode === "core_concepts_primer"
      ? "Create exactly one core-concepts primer lesson that teaches foundational ideas before deeper study."
      : "Create exactly one orientation lesson that introduces this goal's course content and course arrangement (modules and their lessons).";

  const modeRules =
    mode === "core_concepts_primer"
      ? `- This is a real teaching lesson for a broad topic, not a syllabus or table of contents.
- Infer 4–6 major core concept regions for this topic (e.g. for Python: execution model & syntax, data types, control flow, functions & modules, errors & debugging mindset).
- The lesson's material.blocks must contain one level-2 heading per core concept region, in a sensible learning order.
- Author one topic per region: one display, then spoken cues that define key terms, explain why the idea matters, include a concrete mini-example, and connect to other regions.
- Assume zero prior knowledge but teach at medium depth — definitions, examples, and light practice, not motivational fluff.
- Include material "check" blocks for retrieval practice.
- branchIncludes should list the core concept region headings you teach in this lesson.`
      : `- This is orientation for an existing goal, not a brand-new curriculum and not a module lesson.
- Do not invent a lesson title, concatenate the goal title, or append English "overview". The catalog already labels this lesson.
- Open with what this goal is for and what finishing it looks like.
- Then walk the course arrangement: one topic per module listed above, in the same order. Each topic has one display plus spoken cues that explain the module's role, what its lessons cover, and how it connects to the next module — high-level orientation, not deep unit study.
- Do not use material "check" blocks, quizzes, labs, or practice.`;

  return `${roleLine}

Learning goal title: ${params.title}
Topic overview: ${params.topicOverview || "(none yet)"}
${mode === "core_concepts_primer" ? "Core concept regions to infer and teach:" : "Current course modules (this is the catalog the orientation must explain):"}
${branchesBlock(params.branches, mode)}
${params.referenceSection ? `\nReference material (use it as the factual basis for this lesson):\n${params.referenceSection}\n` : ""}

${objectiveLine}

${UNIT_SHARED_CONTEXT_REUSE_LINE}
Use the same topic-scoped lesson structure as regular unit courses: commit_section_topics then commit_topic_material (title, one display, spoken cues). Mix concise callouts, accordions, stage subviews, illustrations, and other useful display blocks.
Treat each topic title as the fixed heading of one small topic. One display per topic; cues bind to figureId.
${illustrationPromptBlock(planBlocks.langCode)}
${COURSE_MATERIAL_CHAT_VOICE_RULES}

Rules:
- The overview course must be a single lesson, not multiple overview units.
- Do not generate an SQ/survey phase; set overviewCourse.units[0].sq to null.
- overviewCourse.units must contain exactly one item.
- Introduce shared course-level background once here when the goal's course pattern calls for it; later units should only reference it briefly.
${modeRules}
${materialRules}
${planBlocks.goalBlock}
${planBlocks.difficultyBlock}
${planBlocks.timeBudgetBlock}
${planBlocks.styleBlock}
${planBlocks.options ? `\n${planBlocks.options}\n` : ""}${planBlocks.languageBlock}

Required JSON shape:
${schemaShape}

Respond with ONLY JSON.`;
}

export function createOverviewCourseCapability() {
  const capabilityId = "overview-course";
  const version = "1.0.0";
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [OVERVIEW_COURSE_VIEW_KEYS.instructionContext]: async ({
        subject,
        invocation,
      }): Promise<ContextEnvelope | null> => {
        const input = invocation as
          Parameters<typeof buildOverviewCoursePrompt>[0] | undefined;
        if (!input?.title || !input.mode || !input.schemaShape) return null;
        return {
          ownerCapabilityId: capabilityId,
          ownerCapabilityVersion: version,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: buildOverviewCoursePrompt(input) },
        };
      },
    },
  });
}

async function finalizeOverviewMaterial(
  material: LearningMaterialContent,
): Promise<LearningMaterialContent> {
  await ensureImageRuntimeConfig();
  return stripIllustrationBlocksIfDisabled(material);
}

export async function generateOverviewCourse(params: {
  userId: string;
  goalId: string;
  title: string;
  topicOverview: string;
  branches: GoalOverviewBranch[];
  onToken?: StreamTokenHandler;
  signal?: AbortSignal;
}): Promise<GoalOverviewCourseResult> {
  const mode = resolveOverviewCourseMode(params.branches);
  const plan = await getPlanContextForGoal(params.goalId);
  const options = plan.optionsBlock();
  await ensureImageRuntimeConfig();
  const imagesEnabled = isImageGenerationAvailable();
  const schemaShape = overviewJsonShape(imagesEnabled);
  const retrieved = await retrieveMaterialReferenceWithSources(
    params.goalId,
    params.title,
    params.topicOverview
      ? `Course overview and core concepts: ${params.topicOverview}`
      : "Course overview and core concepts",
    10,
  );
  const referenceSection = buildBoundedReferencePromptSection(
    retrieved.context,
    retrieved.sources,
    12_000,
  );
  const learned = await retrieveLearnedKnowledge(
    params.userId,
    `${params.title}: ${params.topicOverview}`,
    { k: 6 },
  );
  const personalizedReferenceSection = [
    referenceSection,
    formatLearnedKnowledgePrompt(learned.context),
  ]
    .filter(Boolean)
    .join("\n\n");

  const promptInvocation = {
    title: params.title,
    topicOverview: params.topicOverview,
    branches: params.branches,
    mode,
    schemaShape,
    referenceSection: personalizedReferenceSection,
    planBlocks: {
      goalBlock: plan.goalBlock(),
      difficultyBlock: plan.difficultyBlock(),
      timeBudgetBlock: plan.timeBudgetBlock(),
      styleBlock: plan.styleBlock(),
      languageBlock: plan.languageBlock(),
      options,
      langCode: plan.langCode,
    },
  };

  try {
    const result = await runValidatedStructuredGeneration(
      {
        mode: "object",
        schema: goalOverviewCourseSchema,
        prompt: "",
        options: {
          operation: "goal.overview",
          meta: { title: params.title, goalId: params.goalId },
          schemaShape,
        },
        contextSubject: {
          userId: params.userId,
          goalId: params.goalId,
        },
        contextQuery: `${params.title}: ${params.topicOverview}`.slice(
          0,
          2_000,
        ),
        contextInvocation: promptInvocation,
      },
      { onToken: params.onToken, signal: params.signal },
    );
    const unit = result.overviewCourse.units[0];
    if (!unit) return result;
    return {
      overviewCourse: {
        ...result.overviewCourse,
        units: [
          {
            ...unit,
            material: await finalizeOverviewMaterial(unit.material),
          },
        ],
      },
    };
  } catch (error) {
    console.warn(
      `[overview] structured generation failed, using fallback: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    const fallback = fallbackGoalOverviewCourse(
      params.title,
      params.topicOverview,
      params.branches,
    );
    const unit = fallback.overviewCourse.units[0];
    if (!unit) return fallback;
    return {
      overviewCourse: {
        ...fallback.overviewCourse,
        units: [
          {
            ...unit,
            material: await finalizeOverviewMaterial(unit.material),
          },
        ],
      },
    };
  }
}
