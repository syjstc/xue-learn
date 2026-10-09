import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getCurrentLocale, tBackend } from "../../../../common/src/index.js";
import { gatherGoalPathContext } from "../../goals/goal-path-context.js";
import {
  parseMapSummary,
  serializeMapSummary,
} from "../../goals/map-summary.js";
import { runConvertMicroGoalToFull } from "../../goals/run-convert-micro-goal.js";
import { FEATURE_MICRO_EXPAND } from "../../features.js";
import { resolveRefinedGoalTitle } from "../../goals/refine-goal-title.js";
import { createTrackedTokenHandler } from "../../generation/token-handler.js";
import { assertRunActive } from "../../generation/run.js";
import { handleTrackedStreamPost } from "../../generation/tracked-sse.js";
import {
  getContentLanguageLabel,
  resolveGoalContentLanguage,
} from "../../llm/content-language.js";
import { planGoalSummaryStream } from "../../llm/plan-goal-summary.js";
import {
  goalMapSummarySchema,
  type GoalMapSummary,
} from "../../llm/schemas.js";
import { goalHasRagDocuments } from "../../rag/retrieve.js";
import { createMicroUnitForGoal } from "../../goals/create-micro-unit.js";
import { runInstantMicroCreation } from "../../goals/run-instant-micro-creation.js";
import { createMicroCourseFromTopic } from "../../goals/create-micro-course-from-topic.js";
import {
  localizeSubdivideUnitError,
  SubdivideUnitError,
} from "../../goals/subdivide-unit.js";
import { appendLearnerProfileToPromptOptions } from "../../persona/learner-profile.js";
import { isMicroGoal } from "../../domain/goal-kind.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";

@Injectable()
export class GoalSummaryMicroService {
  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  private async requireGoal(userId: string, goalId: string) {
    const goal =
      await this.learningSpaceOrm.learningGoalSummary.findOwnedContext(
        userId,
        goalId,
      );
    if (!goal) throw new NotFoundException(tBackend("error.goal.notFound"));
    return goal;
  }

  async createMiniGoal(
    userId: string,
    body: {
      title: string;
      level?: string;
      generationOptions?: string;
    },
  ) {
    const topic = body.title?.trim();
    if (!topic)
      throw new BadRequestException(tBackend("error.goal.topicRequired"));
    const result = await createMicroCourseFromTopic(
      userId,
      topic,
      {
        threadId: `wechat-mini:${userId}:${Date.now()}`,
        traceId: `wechat-mini:${Date.now()}`,
        signal: new AbortController().signal,
        send: async () => undefined,
      },
      {
        contentLanguage: resolveGoalContentLanguage(
          "auto",
          topic,
          getCurrentLocale(),
        ),
        learningSpaceApplication: this.learningSpaceOrm.service,
        microUnitPublication: this.learningSpaceOrm.microUnitPublication,
      },
    );
    return result;
  }

  async patchSummary(
    userId: string,
    goalId: string,
    body: Partial<GoalMapSummary>,
  ) {
    const goal = await this.requireGoal(userId, goalId);

    const existing = parseMapSummary(goal.mapSummaryJson);
    if (!existing)
      throw new BadRequestException(tBackend("error.goal.summaryRequired"));

    const summary = goalMapSummarySchema.parse({
      ...existing,
      ...body,
    });

    const title = summary.refinedTitle || goal.title;
    const mapSummaryJson = serializeMapSummary(summary);
    const result =
      await this.learningSpaceOrm.learningGoalSummary.updateOwnedSummary({
        userId,
        goalId,
        title,
        topicOverview: summary.topicOverview,
        mapSummaryJson,
      });
    if (result.status === "not_found") {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    if (result.status === "locked") {
      throw new BadRequestException(tBackend("error.goal.summaryLocked"));
    }

    return { ok: true, summary };
  }

  async approveSummary(userId: string, goalId: string) {
    const goal = await this.requireGoal(userId, goalId);
    if (!parseMapSummary(goal.mapSummaryJson)) {
      throw new BadRequestException(tBackend("error.goal.summaryRequired"));
    }
    const result =
      await this.learningSpaceOrm.learningGoalSummary.approveOwnedSummary(
        userId,
        goalId,
      );
    if (result.status === "not_found") {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    if (result.status === "locked") {
      throw new BadRequestException(tBackend("error.goal.mapAlreadyExists"));
    }
    if (result.status === "summary_required") {
      throw new BadRequestException(tBackend("error.goal.summaryRequired"));
    }
    return { ok: true };
  }

  summaryStream(
    userId: string,
    goalId: string,
    body: {
      hasUpload?: boolean;
      regenerate?: boolean;
      runId?: string;
      adjustment?: string;
    } = {},
  ) {
    const { regenerate = false, runId, adjustment } = body;

    return (async () => {
      const goal = await this.requireGoal(userId, goalId);
      if (goal.unitCount > 0) {
        throw new BadRequestException(tBackend("error.goal.summaryLocked"));
      }
      if (
        !regenerate &&
        goal.mapSummaryStatus === "ready" &&
        goal.topicOverview.trim()
      ) {
        throw new BadRequestException(
          tBackend("error.goal.summaryAlreadyExists"),
        );
      }

      return handleTrackedStreamPost(
        { runId },
        { scope: "goal", scopeId: goalId, operation: "goal.summary" },
        async (ctx) => {
          const onToken = createTrackedTokenHandler(ctx);
          const contentLanguage = resolveGoalContentLanguage(
            goal.contentLanguage,
            goal.title,
          );
          await ctx.send({
            type: "language",
            code: contentLanguage,
            label: getContentLanguageLabel(contentLanguage),
          });
          await ctx.send({
            type: "status",
            phase: "summary",
            message: tBackend("status.goal.generatingSummary"),
          });

          const hasRag = await goalHasRagDocuments(goalId);
          await ctx.send({
            type: "status",
            phase: "context",
            message: tBackend(
              hasRag
                ? "status.goal.retrievingUploads"
                : "status.goal.collectingReferences",
            ),
          });
          const { context, pathSource } = await gatherGoalPathContext({
            goalId,
            title: goal.title,
            hasUpload: hasRag,
            extraQuery: adjustment?.trim(),
            allowWebSearch: !hasRag || Boolean(adjustment?.trim()),
            searchPurpose: adjustment?.trim() ? "map" : "summary",
            onKnowledgeActivity: (activity) =>
              ctx.send({ type: "knowledge_activity", activity }),
          });

          const result =
            await this.learningSpaceOrm.learningGoalSummary.beginOwnedSummary(
              userId,
              goalId,
              pathSource,
            );
          if (result.status === "not_found") {
            throw new NotFoundException(tBackend("error.goal.notFound"));
          }
          if (result.status === "locked") {
            throw new BadRequestException(tBackend("error.goal.summaryLocked"));
          }

          const generationOptions = await appendLearnerProfileToPromptOptions(
            userId,
            [goal.generationOptions, adjustment?.trim()]
              .filter(Boolean)
              .join("\n"),
            this.learningSpaceOrm.learnerStateMemoryRead,
          );
          const summary = await planGoalSummaryStream({
            title: goal.title,
            level: goal.level,
            context,
            pathSource,
            contentLanguage,
            generationOptions,
            onToken,
            signal: ctx.signal,
          });

          const { title: refinedTitle, changed: titleChanged } =
            resolveRefinedGoalTitle(goal.title, summary.refinedTitle);
          const finalSummary = { ...summary, refinedTitle };
          const finalContentLanguage = titleChanged
            ? resolveGoalContentLanguage(goal.contentLanguage, refinedTitle)
            : contentLanguage;

          const mapSummaryJson = serializeMapSummary(finalSummary);
          const published =
            await this.learningSpaceOrm.learningGoalSummary.publishOwnedSummary(
              {
                userId,
                goalId,
                title: refinedTitle,
                topicOverview: finalSummary.topicOverview,
                mapSummaryJson,
                pathSource,
                ...(regenerate
                  ? {}
                  : { contentLanguage: finalContentLanguage }),
              },
            );
          if (published.status === "not_found") {
            throw new NotFoundException(tBackend("error.goal.notFound"));
          }
          if (published.status === "locked") {
            throw new BadRequestException(tBackend("error.goal.summaryLocked"));
          }

          await ctx.send({
            type: "done",
            goalId,
            pathSource,
            contentLanguage: regenerate
              ? resolveGoalContentLanguage(goal.contentLanguage, refinedTitle)
              : finalContentLanguage,
            summary: finalSummary,
            title: refinedTitle,
            ...(titleChanged
              ? { titleChanged: true, previousTitle: goal.title }
              : { titleChanged: false }),
          });
        },
      );
    })();
  }

  microUnitStream(
    userId: string,
    goalId: string,
    body: {
      hasUpload?: boolean;
      runId?: string;
    } = {},
  ) {
    const { runId } = body;

    return (async () => {
      const goal = await this.requireGoal(userId, goalId);
      if (!isMicroGoal(goal)) {
        throw new BadRequestException(
          tBackend("error.goal.microUnsupportedMap"),
        );
      }

      return handleTrackedStreamPost(
        { runId },
        { scope: "goal", scopeId: goalId, operation: "goal.micro_unit" },
        async (ctx) => {
          const existing = goal.firstUnit;
          if (existing) {
            if (existing.unitKind === "overview") {
              const { unitId } = await createMicroUnitForGoal(
                userId,
                goalId,
                { send: ctx.send, signal: ctx.signal },
                {
                  autoContent: true,
                  microUnitPublication:
                    this.learningSpaceOrm.microUnitPublication,
                },
              );
              await ctx.send({
                type: "done",
                goalId,
                unitId,
                unitCount: 1,
                navigateTo: `/goals/${goalId}/units/${unitId}`,
              });
              return;
            }
            await ctx.send({
              type: "done",
              goalId,
              unitId: existing.id,
              unitCount: 1,
              navigateTo: `/goals/${goalId}/units/${existing.id}`,
            });
            return;
          }

          const { unitId, isOverview } = await createMicroUnitForGoal(
            userId,
            goalId,
            {
              send: ctx.send,
              signal: ctx.signal,
            },
            {
              autoContent: true,
              microUnitPublication: this.learningSpaceOrm.microUnitPublication,
            },
          );
          await ctx.send({
            type: "done",
            goalId,
            unitId,
            unitCount: 1,
            navigateTo: isOverview
              ? `/goals/${goalId}/overview`
              : `/goals/${goalId}/units/${unitId}`,
          });
        },
      );
    })();
  }

  instantMicroStream(
    userId: string,
    body: { topic?: string; runId?: string } = {},
    files: Array<{ filename: string; buffer: Buffer }> = [],
  ) {
    const { runId, topic } = body;

    return handleTrackedStreamPost(
      { runId },
      {
        scope: "goal",
        scopeId: userId,
        operation: "goal.instant_micro",
      },
      async (ctx) => {
        await runInstantMicroCreation(
          ctx,
          userId,
          {
            topic,
            files: files.length > 0 ? files : undefined,
          },
          this.learningSpaceOrm.materialReplacement,
          this.learningSpaceOrm.learnerStateMemoryInvalidation,
          this.learningSpaceOrm.service,
          this.learningSpaceOrm.microUnitPublication,
        );
      },
    );
  }

  convertMicroGoalToFullStream(
    userId: string,
    goalId: string,
    body: { runId?: string; adjustment?: string } = {},
  ) {
    if (!FEATURE_MICRO_EXPAND) {
      throw new BadRequestException(
        tBackend("error.learning.microExpandDisabled"),
      );
    }
    const { runId, adjustment } = body;

    return handleTrackedStreamPost(
      { runId },
      {
        scope: "goal",
        scopeId: goalId,
        operation: "goal.convert_to_full",
      },
      async (ctx) => {
        const onToken = createTrackedTokenHandler(ctx);
        await this.requireGoal(userId, goalId);

        try {
          const result = await runConvertMicroGoalToFull({
            userId,
            goalId,
            adjustment: adjustment?.trim() || undefined,
            send: (event) => ctx.send(event as Parameters<typeof ctx.send>[0]),
            onToken,
            signal: ctx.signal,
            assertActive: () => assertRunActive(ctx.runId, ctx.signal),
            cognitiveModelInvalidation:
              this.learningSpaceOrm.cognitiveModelInvalidation,
            learningGoalPlan: this.learningSpaceOrm.learningGoalPlan,
            legacyMapReplacement: this.learningSpaceOrm.legacyMapReplacement,
            microUnitPublication: this.learningSpaceOrm.microUnitPublication,
            onPartialMap: (partial) => {
              void ctx.send({
                type: "map_partial",
                map: partial.map,
                unitCount: partial.unitCount,
                placeholderUnitCount: partial.placeholderUnitCount,
              });
            },
          });

          await ctx.send({
            type: "done",
            goalId,
            unitCount: result.unitCount,
            children: result.children,
            // The learner-facing map route is a legacy alias now; continue the
            // converted goal through the shared journey/dashboard instead.
            navigateTo: `/goals/${goalId}`,
            title: result.title,
            ...(result.titleChanged
              ? { titleChanged: true, previousTitle: result.previousTitle }
              : { titleChanged: false }),
          });
        } catch (e) {
          if (e instanceof SubdivideUnitError) {
            await ctx.send({
              type: "error",
              message: localizeSubdivideUnitError(e),
            });
            return;
          }
          throw e;
        }
      },
    );
  }
}
