import { goalTeachingIntentSchema } from "../../contract.js";
import { z } from "zod";
import { isPlanningMode } from "../../../../../../domain/src/index.js";
import {
  resolveGoalContentLanguage,
  type ContentLanguageCode,
} from "../../../../llm/content-language.js";
import { getCurrentLocale } from "../../../../../../common/src/index.js";
import { goalTitleNeedsRefinement } from "../../../../goals/refine-goal-title.js";
import { refineGoalTitleFromTopic } from "../../../../goals/refine-goal-title-from-topic.js";
import { defineAgentTool } from "../../../core/tools.js";
import type { AgentRunContext } from "../../../core/types.js";
import { createGoalRecord } from "../../actions.js";
import {
  goalStateFromCheckpoint,
  mergeGoalTopicContext,
  type CollectFormField,
  type DiscoveryAnswer,
  type GoalCreationState,
} from "../../state.js";
import {
  discoveryQuestionToolSchema,
  findRepeatedDiscoveryQuestion,
  mergeDiscoveryAnswerHistory,
  mergeDiscoveryQuestionHistory,
  mergeDiscoveryAnswersIntoGenerationOptions,
  normalizeChoiceLabels,
  normalizeDiscoveryQuestions,
  parseDiscoveryQuestions,
} from "./discovery-questions.js";
import {
  enrichCollectFormUiArgs,
  inferFormDefaultsFromState,
  normalizeCollectFormFieldValue,
} from "./collect-form.js";
import { patchLearnerProfile } from "../../../../persona/learner-profile.js";
import { retrieveOrSearchWebKnowledge } from "../../../../search/web-knowledge.js";
import type { LearningSpaceGoalCreationApplication } from "../../../../learning-spaces/orm-application-service.js";

const topicSummarySchema = z.object({
  topic: z.string(),
  refinedTitle: z.string(),
  intentAnalysis: z.string(),
});

const MAX_INTAKE_SEARCH_CONTEXT_CHARS = 6_000;

function compactIntakeSearchContext(context: string): string {
  if (context.length <= MAX_INTAKE_SEARCH_CONTEXT_CHARS) return context;
  return `${context.slice(0, MAX_INTAKE_SEARCH_CONTEXT_CHARS).trimEnd()}\n\n[Search context truncated for goal intake.]`;
}

export async function ensureTopicSummary(
  topic: string,
  ctx: AgentRunContext,
  options?: {
    forMicroCourse?: boolean;
    contentLanguage?: ContentLanguageCode;
  },
): Promise<z.infer<typeof topicSummarySchema>> {
  return refineGoalTitleFromTopic(topic, {
    forMicroCourse: options?.forMicroCourse,
    contentLanguage: options?.contentLanguage,
    userId: ctx.userId,
    threadId: ctx.threadId,
  });
}

function readLiveGoalState(ctx: { state: Record<string, unknown> }) {
  return goalStateFromCheckpoint({ goalState: ctx.state });
}

function getState(ctx: AgentRunContext & { state: Record<string, unknown> }) {
  return readLiveGoalState(ctx);
}

function patchState(
  ctx: AgentRunContext & { state: Record<string, unknown> },
  patch: Partial<GoalCreationState>,
) {
  const current = { ...readLiveGoalState(ctx), ...patch };
  Object.assign(ctx.state, current);
}

export function createIntakeTools(
  _legacyBoundUserId?: string,
  options?: {
    learningSpaceApplication?: LearningSpaceGoalCreationApplication;
  },
) {
  return [
    defineAgentTool({
      name: "search_web_knowledge",
      description:
        "Before asking the learner questions, optionally run one lightweight web search to understand an unfamiliar, niche, ambiguous, or possibly updated learning topic. Decide whether search is needed; do not search familiar stable topics or preferences only the learner can answer. Preserve unfamiliar terms exactly as written, quote them when useful, do not reinterpret them as a known product, and do not generalize them into a generic learning path. Include the year from the system current-time block for time-sensitive topics.",
      schema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            "Precise query to disambiguate the topic; preserve unfamiliar terms verbatim and quote them when useful; include the current year for time-sensitive topics.",
          ),
        reason: z
          .string()
          .min(2)
          .describe("Tell the learner why search is needed first."),
        freshnessClass: z
          .enum(["live", "rapid", "normal", "stable"])
          .optional()
          .describe(
            "How quickly the information changes; use live or rapid for clearly time-sensitive topics.",
          ),
      }),
      handler: async (args, ctx) => {
        const result = await retrieveOrSearchWebKnowledge({
          userId: ctx.userId,
          query: args.query,
          reason: args.reason,
          freshnessClass: args.freshnessClass,
          forceSearch: true,
          searchPurpose: "answer",
          resultCount: 4,
          onActivity: async (activity) => {
            await ctx.send({ type: "knowledge_activity", activity });
          },
        });
        if (result.activity.status !== "error") {
          return {
            ...result,
            context: compactIntakeSearchContext(result.context),
          };
        }
        return {
          ...result,
          context: "",
          sources: [],
          stale: false,
          activity: {
            ...result.activity,
            sources: [],
            sourceCount: 0,
            saved: false,
            stale: false,
          },
        };
      },
      renderUi: (_args, result) => {
        const activity = (result as { activity?: unknown }).activity;
        if (!activity || typeof activity !== "object") return null;
        return {
          uiKind: "knowledge_activity",
          args: { activity },
        };
      },
    }),

    defineAgentTool({
      name: "ask_clarification",
      description:
        "When the goal is too vague (for example, fewer than five characters or 'learn something'), ask the learner a clarification question with choices.",
      schema: z.object({
        question: z.string(),
        choices: z.array(z.string().min(1)).min(2).max(6),
        topic: z
          .string()
          .optional()
          .describe("The learner's current vague goal description."),
      }),
      uiKind: "discovery_questions",
      requiresHumanInput: true,
      handler: async (args, ctx) => {
        const choices = normalizeChoiceLabels(args.choices);
        const patch: Partial<GoalCreationState> = { currentPhase: "parsing" };
        if (args.topic?.trim()) {
          patch.topic = args.topic.trim();
        }
        patchState(ctx, patch);
        await ctx.send({ type: "phase", phase: "parsing", subagent: "intake" });
        return JSON.stringify({
          awaiting: "clarification",
          question: args.question,
          choices,
          topic: args.topic,
        });
      },
    }),

    defineAgentTool({
      name: "ask_discovery_questions",
      description:
        "Ask 1-3 personalized questions about the learning goal, background, and preferences. When a question allows multiple independent aspects, skills, or emphases, use answerKind: multi_choice; use single_choice for mutually exclusive choices.",
      schema: z.object({
        questions: z.array(discoveryQuestionToolSchema).min(1).max(3),
      }),
      uiKind: "discovery_questions",
      requiresHumanInput: true,
      validateHumanInput: async (args, ctx) => {
        const state = getState(ctx);
        if (state.discoverySkipped) {
          throw new Error(
            "Discovery was already skipped; continue with the collected information instead of asking again.",
          );
        }
        const questions = normalizeDiscoveryQuestions(
          parseDiscoveryQuestions(args.questions),
        );
        const repeated = findRepeatedDiscoveryQuestion(
          state.discoveryQuestions,
          questions,
        );
        if (repeated) {
          throw new Error(
            `This discovery question was already asked: ${repeated.text}. Ask only a genuinely new question or continue to collect_form.`,
          );
        }
      },
      handler: async (args, ctx) => {
        const questions = normalizeDiscoveryQuestions(
          parseDiscoveryQuestions(args.questions),
        );
        patchState(ctx, {
          currentPhase: "discovering",
          discoveryQuestions: mergeDiscoveryQuestionHistory(
            getState(ctx).discoveryQuestions,
            questions,
          ),
        });
        await ctx.send({
          type: "phase",
          phase: "discovering",
          subagent: "intake",
        });
        if (questions.length === 0) {
          return JSON.stringify({
            skipped: true,
            reason: "context sufficient",
          });
        }
        return JSON.stringify({
          awaiting: "discovery",
          count: questions.length,
        });
      },
    }),

    defineAgentTool({
      name: "collect_form",
      description:
        "Collect structured settings such as level and contentLanguage. Scheduling owns time, so do not collect it. Use ask_discovery_questions for personalized questions; do not use questions in this tool.",
      schema: z.object({
        fields: z.array(
          z.enum(["level", "contentLanguage", "isSmallCourse", "documents"]),
        ),
        defaults: z.record(z.string(), z.unknown()).optional(),
        labels: z.record(z.string(), z.string()).optional(),
      }),
      uiKind: "form",
      requiresHumanInput: true,
      handler: async (args, ctx) => {
        const state = getState(ctx);
        const enriched = enrichCollectFormUiArgs(state, {
          ...args,
          defaults: args.defaults,
        });
        const fields = enriched.fields as CollectFormField[];
        const defaults = enriched.defaults as Record<string, unknown>;
        const trackedFields = fields.filter((field) => field !== "documents");
        patchState(ctx, {
          currentPhase: "collecting",
          collectedFields: Array.from(
            new Set([...state.collectedFields, ...trackedFields]),
          ),
        });
        await ctx.send({
          type: "phase",
          phase: "collecting",
          subagent: "intake",
        });
        return JSON.stringify({
          awaiting: "form",
          fields,
          defaults,
          labels: args.labels,
        });
      },
    }),

    defineAgentTool({
      name: "show_confirmation",
      description:
        "Show all collected information for the learner's final confirmation. Learning Space and roadmap proposals are handled by the server-owned scope phase.",
      schema: z.object({
        summary: z.string().optional(),
        teachingIntent: goalTeachingIntentSchema
          .optional()
          .describe(
            "Learner-visible destination, outcomes, boundaries and foundations to teach before first use. Never infer target level from starting level.",
          ),
        spaceSuggestion: z
          .object({
            name: z.string().trim().min(1).max(80),
            purpose: z.string().trim().max(500).default(""),
            reason: z.string().trim().min(1).max(300),
          })
          .optional()
          .describe(
            "Legacy in-flight compatibility only. New intake turns must omit this field.",
          ),
      }),
      uiKind: "confirmation_card",
      requiresHumanInput: true,
      handler: async (args, ctx) => {
        const state = getState(ctx);
        const rawTopic = state.topic.trim();
        if (!rawTopic) {
          return JSON.stringify({
            error:
              "Learning goal is missing; clarify what the learner wants to learn first.",
          });
        }

        let refinedTitle = state.refinedTitle.trim();
        let intentAnalysis = state.intentAnalysis.trim();
        if (
          !intentAnalysis ||
          goalTitleNeedsRefinement(rawTopic, refinedTitle)
        ) {
          const contentLanguage = resolveGoalContentLanguage(
            state.contentLanguage,
            state.contentLanguageSourceText.trim() || rawTopic,
            getCurrentLocale(),
          );
          const summary = await ensureTopicSummary(rawTopic, ctx, {
            forMicroCourse: state.isSmallCourse,
            contentLanguage,
          });
          refinedTitle = summary.refinedTitle.trim() || rawTopic;
          intentAnalysis = summary.intentAnalysis.trim();
          patchState(ctx, {
            topic: rawTopic,
            refinedTitle,
            intentAnalysis,
            contentLanguage,
          });
        }

        const spaceSuggestion =
          !state.isSmallCourse &&
          state.scopeStatus === "pending" &&
          state.planningMode === "deep" &&
          !state.targetSpaceId &&
          args.spaceSuggestion &&
          args.spaceSuggestion.name.trim().toLocaleLowerCase("und") !==
            refinedTitle.trim().toLocaleLowerCase("und")
            ? args.spaceSuggestion
            : null;
        patchState(ctx, {
          currentPhase: "confirming",
          spaceSuggestion,
          ...(args.teachingIntent
            ? { teachingIntent: args.teachingIntent }
            : {}),
        });
        await ctx.send({
          type: "phase",
          phase: "confirming",
          subagent: "intake",
        });
        const next = getState(ctx);
        return JSON.stringify({
          awaiting: "confirmation",
          state: {
            teachingIntent: next.teachingIntent,
            topic: next.topic,
            refinedTitle: next.refinedTitle,
            intentAnalysis: next.intentAnalysis,
            discoveryAnswers: next.discoveryAnswers,
            level: next.level,
            contentLanguage: next.contentLanguage,
            generationOptions: next.generationOptions,
            isSmallCourse: next.isSmallCourse,
            planningMode: next.planningMode,
            hasDocuments: next.hasDocuments,
            documents:
              next.documentFilenames.length > 0
                ? next.documentFilenames
                : undefined,
          },
        });
      },
    }),

    defineAgentTool({
      name: "create_goal",
      description:
        "Create the learning-goal record after learner confirmation.",
      schema: z.object({ confirmed: z.boolean() }),
      handler: async (args, ctx) => {
        if (!args.confirmed) {
          return JSON.stringify({ error: "The learner has not confirmed." });
        }
        const state = getState(ctx);
        if (state.goalId) {
          return JSON.stringify({
            goalId: state.goalId,
            status: "already_created",
          });
        }
        const { goalId } = await createGoalRecord(ctx.userId, state, {
          threadId: ctx.threadId,
          learningSpaceApplication: options?.learningSpaceApplication,
          onStatus: async (message) => {
            await ctx.send({ type: "status", message, phase: "ingesting" });
          },
        });
        await patchLearnerProfile(ctx.userId, {
          onboardingCompleted: true,
        }).catch(() => undefined);
        patchState(ctx, {
          goalId,
          currentPhase: state.isSmallCourse ? "decomposing" : "generating_plan",
          currentSubagent: state.isSmallCourse ? "intake" : "plan",
        });
        return JSON.stringify({ goalId, status: "created" });
      },
    }),
  ];
}

export function applyIntakeResumeResult(
  toolName: string,
  result: unknown,
  ctx: { state: Record<string, unknown> },
): void {
  const data =
    typeof result === "object" && result
      ? (result as Record<string, unknown>)
      : {};

  if (toolName === "ask_clarification") {
    const answers = data.answers as DiscoveryAnswer[] | undefined;
    const answerFromCard = answers?.[0]?.answer;
    const answer = String(
      (Array.isArray(answerFromCard)
        ? answerFromCard.join("、")
        : answerFromCard) ??
        data.answer ??
        data.userResponse ??
        "",
    );
    if (answer) {
      const state = readLiveGoalState(ctx);
      patchState(
        { state: ctx.state } as AgentRunContext & {
          state: Record<string, unknown>;
        },
        { topic: mergeGoalTopicContext(state.topic, answer) },
      );
    }
    return;
  }

  if (toolName === "ask_discovery_questions") {
    if (data.skipped === true) {
      patchState(
        { state: ctx.state } as AgentRunContext & {
          state: Record<string, unknown>;
        },
        { discoverySkipped: true, discoveryAnswers: [] },
      );
      return;
    }
    const answers = data.answers as DiscoveryAnswer[] | undefined;
    if (answers?.length) {
      const state = readLiveGoalState(ctx);
      const newAnswers = answers.filter(
        (answer) =>
          !(state.discoveryAnswers ?? []).some(
            (existing) =>
              existing.questionId === answer.questionId &&
              JSON.stringify(existing.answer) === JSON.stringify(answer.answer),
          ),
      );
      const mergedOptions = mergeDiscoveryAnswersIntoGenerationOptions(
        {
          generationOptions: state.generationOptions,
          discoveryQuestions:
            Array.isArray(ctx.state.discoveryQuestions) &&
            ctx.state.discoveryQuestions.length > 0
              ? (ctx.state
                  .discoveryQuestions as typeof state.discoveryQuestions)
              : state.discoveryQuestions,
        },
        newAnswers,
      );
      patchState(
        { state: ctx.state } as AgentRunContext & {
          state: Record<string, unknown>;
        },
        {
          discoverySkipped: false,
          discoveryAnswers: mergeDiscoveryAnswerHistory(
            state.discoveryAnswers ?? [],
            answers,
          ),
          generationOptions: mergedOptions,
        },
      );
    }
    return;
  }

  if (toolName === "collect_form") {
    const patch: Partial<GoalCreationState> = {};
    const state = readLiveGoalState(ctx);
    const inferred = inferFormDefaultsFromState(state);
    const fields = ["level", "contentLanguage"] as const;
    const acceptedFields = new Set<CollectFormField>();
    for (const f of fields) {
      const submitted = normalizeCollectFormFieldValue(f, data[f]);
      const inferredValue = normalizeCollectFormFieldValue(f, inferred[f]);
      if (submitted !== undefined) {
        (patch as Record<string, unknown>)[f] = submitted;
        acceptedFields.add(f);
      } else if (data[f] === undefined && inferredValue !== undefined) {
        (patch as Record<string, unknown>)[f] = inferredValue;
        acceptedFields.add(f);
      }
    }
    // Backward compatibility for an already-open legacy form. New intake forms
    // collect detailed requirements in the original goal textarea instead.
    if (typeof data.generationOptions === "string") {
      patch.generationOptions = data.generationOptions;
    }
    if (data.isSmallCourse !== undefined) {
      patch.isSmallCourse = data.isSmallCourse === true;
    } else if (inferred.isSmallCourse !== undefined) {
      patch.isSmallCourse = inferred.isSmallCourse === true;
    }
    if (data.hasDocuments === true || data.documents) {
      patch.hasDocuments = true;
      const isSmallCourse =
        patch.isSmallCourse === true ||
        (patch.isSmallCourse === undefined && state.isSmallCourse);
      patch.planningMode = isSmallCourse ? "fast" : "docs_first";
      if (Array.isArray(data.documents)) {
        patch.documentFilenames = data.documents.map((name) => String(name));
      }
    }
    const answers = data.answers as DiscoveryAnswer[] | undefined;
    if (answers?.length) {
      const newAnswers = answers.filter(
        (answer) =>
          !(state.discoveryAnswers ?? []).some(
            (existing) =>
              existing.questionId === answer.questionId &&
              JSON.stringify(existing.answer) === JSON.stringify(answer.answer),
          ),
      );
      patch.discoveryAnswers = mergeDiscoveryAnswerHistory(
        state.discoveryAnswers ?? [],
        answers,
      );
      patch.generationOptions = mergeDiscoveryAnswersIntoGenerationOptions(
        {
          generationOptions: String(
            patch.generationOptions ?? state.generationOptions,
          ),
          discoveryQuestions: state.discoveryQuestions,
        },
        newAnswers,
      );
    }
    const collected = new Set(state.collectedFields);
    for (const f of fields) {
      if (acceptedFields.has(f)) {
        collected.add(f);
      }
    }
    if (
      data.isSmallCourse !== undefined ||
      inferred.isSmallCourse !== undefined
    ) {
      collected.add("isSmallCourse");
    } else if (state.isSmallCourse) {
      collected.add("isSmallCourse");
    }
    collected.add("documents");
    patch.collectedFields = Array.from(collected);
    patchState(
      { state: ctx.state } as AgentRunContext & {
        state: Record<string, unknown>;
      },
      patch,
    );
    return;
  }

  if (toolName === "show_confirmation") {
    const approved = data.approved === true;
    if (approved && data.edits && typeof data.edits === "object") {
      const state = readLiveGoalState(ctx);
      const edits = data.edits as Record<string, unknown>;
      const requestedPlanningMode = isPlanningMode(edits.planningMode)
        ? edits.planningMode
        : undefined;
      const requestedLearningMode =
        edits.learningMode === "exploration" || edits.learningMode === "mastery"
          ? edits.learningMode
          : undefined;
      const planningMode =
        requestedPlanningMode === "docs_first" && !state.hasDocuments
          ? "deep"
          : requestedPlanningMode;
      const safeEdits = { ...edits };
      if (planningMode) {
        safeEdits.planningMode = planningMode;
      } else {
        delete safeEdits.planningMode;
      }
      if (requestedLearningMode) {
        safeEdits.learningMode = requestedLearningMode;
      } else {
        delete safeEdits.learningMode;
      }
      patchState(
        { state: ctx.state } as AgentRunContext & {
          state: Record<string, unknown>;
        },
        safeEdits as Partial<GoalCreationState>,
      );
    }
  }
}
