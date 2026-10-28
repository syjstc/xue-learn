import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getCurrentLocale, tBackend } from "../../../../common/src/index.js";
import { randomUUID } from "node:crypto";
import { gatherGoalPathContext } from "../../goals/goal-path-context.js";
import { parseMapPlan } from "../../goals/map-plan.js";
import { parseMapSummary } from "../../goals/map-summary.js";
import { persistDecomposeResult } from "../../goals/persist-decompose.js";
import { createTrackedTokenHandler } from "../../generation/token-handler.js";
import { assertRunActive } from "../../generation/run.js";
import { handleTrackedStreamPost } from "../../generation/tracked-sse.js";
import {
  detectContentLanguage,
  getContentLanguageLabel,
  resolveGoalContentLanguage,
} from "../../llm/content-language.js";
import { mergeMapRegenerationOptions } from "../../llm/generation-options.js";
import {
  decomposeGoal,
  decomposeGoalStream,
} from "../../llm/decompose.js";
import { refineMapOrderAndTitles } from "../../llm/refine-map.js";
import { runWithLlmTraceAsync } from "../../llm/trace-context.js";
import { goalHasRagDocuments } from "../../rag/retrieve.js";
import { ensureGoalTitleFromTopic } from "../../goals/refine-goal-title-from-topic.js";
import { appendLearnerProfileToPromptOptions } from "../../persona/learner-profile.js";
import type { CognitiveModelInvalidationRepository } from "../../../../domain/src/index.js";
import { COGNITIVE_MODEL_INVALIDATION_REPOSITORY } from "../../learning-spaces/cognitive-model-invalidation-token.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";
import { assertFullGoal, refreshDetailedPlanFromMap } from "./goal-map.support.js";

type MapTreeUnit = {
  id: string;
  title: string;
  unitKind: string;
  difficulty: string;
  contentSummary: string;
  orderIndex: number;
  parentUnitId: string | null;
};

function formatCurrentMap(units: readonly MapTreeUnit[]): string {
  const childrenByParent = new Map<string | null, MapTreeUnit[]>();
  for (const unit of units) {
    const key = unit.parentUnitId ?? null;
    const list = childrenByParent.get(key) ?? [];
    list.push(unit);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  const topLevelCount = childrenByParent.get(null)?.length ?? 0;
  const lessonUnits = units.filter((unit) => unit.unitKind === "lesson");
  const moduleCount = units.filter((unit) => unit.unitKind === "module").length;
  const lines: string[] = [
    `Actual map totals: ${topLevelCount} top-level units, ${moduleCount} modules, ${lessonUnits.length} lesson leaves.`,
  ];
  const walk = (parentId: string | null, depth: number) => {
    for (const unit of childrenByParent.get(parentId) ?? []) {
      const indent = "  ".repeat(depth);
      lines.push(
        `${indent}- ${unit.title} [${unit.unitKind}, ${unit.difficulty}]: ${unit.contentSummary}`,
      );
      walk(unit.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

@Injectable()
export class GoalDecomposeService {
  constructor(
    @Inject(COGNITIVE_MODEL_INVALIDATION_REPOSITORY)
    private readonly cognitiveModelInvalidation: CognitiveModelInvalidationRepository,
    private readonly learningSpaceOrm: LearningSpaceOrmProvider,
  ) {}

  private async refineExistingMapInPlace(params: {
    userId: string;
    goalId: string;
    goalTitle: string;
    parentUnitId?: string | null;
    adjustment?: string;
    onToken: ReturnType<typeof createTrackedTokenHandler>;
    signal?: AbortSignal;
  }) {
    const context =
      await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
        params.userId,
        params.goalId,
      );
    const units = (context?.units ?? []).filter(
      (unit) =>
        unit.parentUnitId === (params.parentUnitId ?? null) &&
        unit.unitKind !== "overview",
    );
    if (units.length === 0) {
      throw new BadRequestException(
        tBackend("error.goal.mapRefreshUnavailable"),
      );
    }

    const result = await refineMapOrderAndTitles({
      goalTitle: params.goalTitle,
      units,
      adjustment:
        params.adjustment?.trim() ||
        "Improve title clarity, summary usefulness, and sibling order.",
      onToken: params.onToken,
      signal: params.signal,
    });

    const returnedById = new Map(result.nodes.map((node) => [node.id, node]));
    const ordered = [...units].sort((a, b) => {
      const aOrder = returnedById.get(a.id)?.orderIndex ?? a.orderIndex;
      const bOrder = returnedById.get(b.id)?.orderIndex ?? b.orderIndex;
      return aOrder - bOrder || a.orderIndex - b.orderIndex;
    });
    const nextOrderById = new Map(
      ordered.map((unit, orderIndex) => [unit.id, orderIndex]),
    );
    const updates = units.map((unit) => {
      const proposal = returnedById.get(unit.id);
      const title = proposal?.title.trim() || unit.title;
      const contentSummary =
        proposal?.contentSummary.trim() || unit.contentSummary;
      return {
        unitId: unit.id,
        title,
        contentSummary,
        orderIndex: nextOrderById.get(unit.id) ?? unit.orderIndex,
      };
    });

    const mutationResult =
      await this.learningSpaceOrm.legacyMapUnitMutation.refineOwnedEditableUnits(
        {
          userId: params.userId,
          goalId: params.goalId,
          updates,
        },
      );
    if (mutationResult.status !== "refined") {
      throw new BadRequestException(
        tBackend("error.goal.mapRefreshUnavailable"),
      );
    }
    await this.cognitiveModelInvalidation.invalidate({
      goalId: params.goalId,
      reason: "map_units_refined",
    });
    return mutationResult.units;
  }

  async decompose(
    userId: string,
    body: {
      title?: string;
      level?: string;
      goalId?: string;
    },
  ) {
    const { title: rawTitle, level = "zero", goalId } = body;

    const execute = async () => {
      let pathSource: "rag" | "search" | "generic" = "generic";
      let context = "";
      const existing = goalId
        ? await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
            userId,
            goalId,
          )
        : null;
      let title = rawTitle?.trim();

      if (goalId) {
        if (!existing) {
          throw new NotFoundException(tBackend("error.goal.notFound"));
        }
        if (!title) {
          title = existing?.title;
        }
      }

      if (!goalId && !title) {
        throw new BadRequestException(tBackend("error.goal.missing"));
      }

      if (!title) {
        throw new BadRequestException(tBackend("error.goal.missing"));
      }

      if (!goalId) {
        const contentLanguage = resolveGoalContentLanguage(
          "auto",
          title,
          getCurrentLocale(),
        );
        const refined = await ensureGoalTitleFromTopic(title, undefined, {
          userId,
          contentLanguage,
        });
        title = refined.refinedTitle || title;
      }

      if (goalId) {
        const hasRag = await goalHasRagDocuments(goalId);
        const gathered = await gatherGoalPathContext({
          goalId,
          title,
          hasUpload: hasRag,
          allowWebSearch: !hasRag,
          searchPurpose: "map",
        });
        context = gathered.context;
        pathSource = gathered.pathSource;
      }

      if (existing) {
        assertFullGoal(existing);
        if (existing.curriculumVersion === 2) {
          const modules =
            await this.learningSpaceOrm.learningGoalPlan.listOwnedModules(
              userId,
              existing.id,
            );
          return {
            goalId: existing.id,
            pathSource: existing.pathSource,
            units: [],
            modules,
          };
        }
        const existingUnitCount = existing.unitCount;
        if (
          existingUnitCount === 0 &&
          (existing.mapPlanStatus !== "approved" ||
            !parseMapPlan(existing.mapPlanJson))
        ) {
          throw new BadRequestException(
            tBackend("error.goal.contractRequired"),
          );
        }
      }
      const contentLanguage = existing
        ? resolveGoalContentLanguage(existing.contentLanguage, title)
        : detectContentLanguage(title);

      const generationOptions = await appendLearnerProfileToPromptOptions(
        userId,
        existing?.generationOptions,
      );
      const result = await decomposeGoal({
        title,
        level,
        context,
        pathSource,
        contentLanguage,
        mapSummary: existing
          ? (parseMapSummary(existing.mapSummaryJson) ?? undefined)
          : undefined,
        generationOptions,
      });

      if (!goalId) {
        const goal = await this.learningSpaceOrm.service.createOwnedGoal(
          userId,
          {
            title,
            level,
            domainTag: result.domainTag,
            pathSource,
            contentLanguage,
          },
        );
        const { units } = await persistDecomposeResult({
          userId,
          goalId: goal.id,
          title,
          level,
          pathSource,
          contentLanguage,
          result,
          cognitiveModelInvalidation: this.cognitiveModelInvalidation,
          legacyMapReplacement: this.learningSpaceOrm.legacyMapReplacement,
        });
        if (!existing || existing.mapPlanStatus !== "approved") {
          void refreshDetailedPlanFromMap({
            goalId: goal.id,
            userId,
            learningGoalPlan: this.learningSpaceOrm.learningGoalPlan,
            cognitiveModelInvalidation: this.cognitiveModelInvalidation,
          }).catch(() => {
            // Legacy maps remain usable even if display-plan refresh fails.
          });
        }
        return { goalId: goal.id, pathSource, units };
      }

      const { goal, units } = await persistDecomposeResult({
        userId,
        goalId,
        title,
        level,
        pathSource,
        contentLanguage,
        result,
        cognitiveModelInvalidation: this.cognitiveModelInvalidation,
        legacyMapReplacement: this.learningSpaceOrm.legacyMapReplacement,
      });
      if (!existing || existing.mapPlanStatus !== "approved") {
        void refreshDetailedPlanFromMap({
          goalId: goal.id,
          userId,
          learningGoalPlan: this.learningSpaceOrm.learningGoalPlan,
          cognitiveModelInvalidation: this.cognitiveModelInvalidation,
        }).catch(() => {
          // The plan page exposes retry for legacy maps.
        });
      }

      return { goalId: goal.id, pathSource, units };
    };

    if (goalId) {
      return runWithLlmTraceAsync(
        {
          traceId: randomUUID(),
          meta: {
            scope: "goal",
            scopeId: goalId,
            goalId,
            operation: "goal.map",
          },
        },
        execute,
      );
    }

    return execute();
  }

  decomposeStream(
    userId: string,
    body: {
      title: string;
      level?: string;
      goalId?: string;
      runId?: string;
      regenerate?: boolean;
      adjustment?: string;
    },
  ) {
    const {
      title,
      level = "zero",
      goalId,
      runId,
      regenerate = false,
      adjustment,
    } = body;

    if (!title?.trim()) {
      throw new BadRequestException(tBackend("error.goal.missing"));
    }
    if (!goalId) {
      throw new BadRequestException(tBackend("error.goal.idRequired"));
    }

    return handleTrackedStreamPost(
      { runId },
      {
        scope: "goal",
        scopeId: goalId,
        operation: regenerate ? "goal.map.regenerated" : "goal.map",
      },
      async (ctx) => {
        const onToken = createTrackedTokenHandler(ctx);
        const existing =
          await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
            userId,
            goalId,
          );
        if (!existing) {
          throw new NotFoundException(tBackend("error.goal.notFound"));
        }
        assertFullGoal(existing);
        if (existing.curriculumVersion === 2) {
          const modules =
            await this.learningSpaceOrm.learningGoalPlan.listOwnedModules(
              userId,
              goalId,
            );
          await ctx.send({
            type: "status",
            phase: "modules",
            message: tBackend("status.goal.sequentialModulesCreated"),
          });
          await ctx.send({
            type: "done",
            goalId,
            modules,
            units: [],
            pathSource: existing.pathSource,
            contentLanguage: existing.contentLanguage,
          });
          return;
        }
        const effectiveTitle = existing?.title.trim() || title.trim();
        const languageTitle = regenerate
          ? existing.title.trim()
          : effectiveTitle;
        const contentLanguage = existing
          ? resolveGoalContentLanguage(existing.contentLanguage, languageTitle)
          : detectContentLanguage(effectiveTitle);

        const existingUnits = existing.units;
        if (regenerate) {
          if (existingUnits.length === 0) {
            throw new BadRequestException(
              tBackend("error.goal.mapRequiredForRegeneration"),
            );
          }
        } else if (existingUnits.length > 0) {
          throw new BadRequestException(
            tBackend("error.goal.mapAlreadyExists"),
          );
        } else if (
          existing.mapPlanStatus !== "approved" ||
          !parseMapPlan(existing.mapPlanJson)
        ) {
          throw new BadRequestException(
            tBackend("error.goal.contractRequired"),
          );
        }

        await ctx.send({
          type: "language",
          code: contentLanguage,
          label: getContentLanguageLabel(contentLanguage),
        });
        await ctx.send({
          type: "status",
          phase: "language",
          message: tBackend("status.goal.language", {
            language: getContentLanguageLabel(contentLanguage),
          }),
        });

        const mapSummary =
          parseMapSummary(existing?.mapSummaryJson ?? "{}") ?? undefined;
        const mapPlan =
          parseMapPlan(existing?.mapPlanJson ?? "{}") ?? undefined;

        if (regenerate) {
          await ctx.send({
            type: "status",
            phase: "regenerate",
            message: tBackend("status.goal.regeneratingMap"),
          });
        } else if (mapSummary) {
          await ctx.send({
            type: "status",
            phase: "summary",
            message: tBackend("status.goal.generatingMapFromSummary"),
          });
        }

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
        const gathered = await gatherGoalPathContext({
          goalId,
          title: effectiveTitle,
          hasUpload: hasRag,
          extraQuery: regenerate ? adjustment?.trim() : undefined,
          allowWebSearch: !hasRag || Boolean(regenerate && adjustment?.trim()),
          searchPurpose: "map",
          onKnowledgeActivity: (activity) =>
            ctx.send({ type: "knowledge_activity", activity }),
        });
        const context = gathered.context;
        let pathSource = gathered.pathSource;
        await assertRunActive(ctx.runId, ctx.signal);
        if (pathSource === "rag") {
          await ctx.send({
            type: "status",
            phase: "rag",
            message: tBackend("status.goal.uploadsRetrieved"),
          });
        } else if (pathSource === "search") {
          await ctx.send({
            type: "status",
            phase: "search",
            message: tBackend("status.goal.authoritativePathFound"),
          });
        }

        await ctx.send({
          type: "status",
          phase: "generate",
          message: tBackend("status.goal.generatingMap"),
        });

        const effectiveLevel = regenerate ? existing.level : level;

        const baseGenerationOptions = regenerate
          ? mergeMapRegenerationOptions(existing?.generationOptions, {
              currentMap: formatCurrentMap(existingUnits),
              adjustment,
            })
          : (existing?.generationOptions ?? undefined);
        const generationOptions = await appendLearnerProfileToPromptOptions(
          userId,
          baseGenerationOptions,
        );

        const result = await decomposeGoalStream({
          title: effectiveTitle,
          level: effectiveLevel,
          context,
          pathSource,
          contentLanguage,
          mapPlan,
          mapSummary,
          generationOptions,
          onToken,
          onPartialMap: (partial) => {
            void ctx.send({
              type: "map_partial",
              map: partial.map,
              unitCount: partial.unitCount,
              placeholderUnitCount: partial.placeholderUnitCount,
            });
          },
          signal: ctx.signal,
        });

        await ctx.send({
          type: "status",
          phase: "save",
          message: tBackend("status.goal.savingUnits", {
            count: result.units.length,
          }),
        });

        const { goal } = await persistDecomposeResult({
          userId,
          goalId,
          title: effectiveTitle,
          level: effectiveLevel,
          pathSource,
          contentLanguage: regenerate
            ? existing.contentLanguage
            : contentLanguage,
          mapSummaryStatus: mapSummary ? "approved" : undefined,
          detailedPlanStatus:
            existing.mapPlanStatus === "approved" && mapPlan
              ? "ready"
              : undefined,
          result,
          cognitiveModelInvalidation: this.cognitiveModelInvalidation,
          legacyMapReplacement: this.learningSpaceOrm.legacyMapReplacement,
        });

        const finalGoal =
          await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
            userId,
            goal.id,
          );

        if (existing.mapPlanStatus === "approved" && mapPlan) {
          await ctx.send({
            type: "status",
            phase: "plan",
            message: tBackend("status.goal.mapSavedToContract"),
          });
        } else {
          await ctx.send({
            type: "status",
            phase: "plan",
            message: tBackend("status.goal.mapSaved"),
          });
          void refreshDetailedPlanFromMap({
            goalId: goal.id,
            userId,
            learningGoalPlan: this.learningSpaceOrm.learningGoalPlan,
            cognitiveModelInvalidation: this.cognitiveModelInvalidation,
          }).catch(() => {
            // Keep legacy map generation successful; users can retry.
          });
        }

        for (let i = 0; i < result.units.length; i++) {
          await assertRunActive(ctx.runId, ctx.signal);
          await ctx.send({
            type: "progress",
            current: i + 1,
            total: result.units.length,
            message: result.units[i]?.title,
          });
        }

        await ctx.send({
          type: "done",
          goalId: goal.id,
          pathSource,
          contentLanguage,
          unitCount: finalGoal?.unitCount ?? result.units.length,
        });
      },
    );
  }

  refreshMapStream(
    userId: string,
    goalId: string,
    body: { runId?: string; parentUnitId?: string | null } = {},
  ) {
    return handleTrackedStreamPost(
      { runId: body.runId },
      {
        scope: "goal",
        scopeId: goalId,
        operation: "goal.map.refresh",
      },
      async (ctx) => {
        const onToken = createTrackedTokenHandler(ctx);
        const goal =
          await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
            userId,
            goalId,
          );
        if (!goal) {
          throw new NotFoundException(tBackend("error.goal.notFound"));
        }
        assertFullGoal(goal);

        await ctx.send({
          type: "language",
          code: goal.contentLanguage,
          label: getContentLanguageLabel(
            resolveGoalContentLanguage(goal.contentLanguage, goal.title),
          ),
        });
        await ctx.send({
          type: "status",
          phase: "refresh",
          message: tBackend("status.goal.refreshingOrder"),
        });

        const finalUnits = await this.refineExistingMapInPlace({
          userId,
          goalId,
          goalTitle: goal.title,
          parentUnitId: body.parentUnitId ?? null,
          onToken,
          signal: ctx.signal,
        });

        await ctx.send({
          type: "status",
          phase: "plan",
          message: tBackend("status.goal.mapOrderRefreshed"),
        });
        void refreshDetailedPlanFromMap({
          goalId,
          userId,
          learningGoalPlan: this.learningSpaceOrm.learningGoalPlan,
          cognitiveModelInvalidation: this.cognitiveModelInvalidation,
        }).catch(() => {
          // Keep map refresh successful; users can retry from the plan page.
        });

        for (let i = 0; i < finalUnits.length; i++) {
          await assertRunActive(ctx.runId, ctx.signal);
          await ctx.send({
            type: "progress",
            current: i + 1,
            total: finalUnits.length,
            message: finalUnits[i]?.title,
          });
        }
        await ctx.send({
          type: "done",
          goalId,
          pathSource: goal.pathSource,
          contentLanguage: goal.contentLanguage,
          unitCount: finalUnits.length,
        });
      },
    );
  }
}
