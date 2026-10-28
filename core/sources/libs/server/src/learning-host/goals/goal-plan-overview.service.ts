import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getCurrentLocale, tBackend } from "../../../../common/src/index.js";
import { isDev } from "../../dev.js";
import {
  parseMapPlan,
  serializeMapPlan,
} from "../../goals/map-plan.js";
import {
  excludeFoundationScopeFromPlan,
  parseFoundationGoalItems,
} from "../../goals/foundation-support.js";
import { parseMapSummary } from "../../goals/map-summary.js";
import { gatherGoalPathContext } from "../../goals/goal-path-context.js";
import { resolveRefinedGoalTitle } from "../../goals/refine-goal-title.js";
import { runBatchSqPreview } from "../../graph/batch-sq-preview.js";
import { runBatchMaterial } from "../../graph/batch-material.js";
import { createTrackedTokenHandler } from "../../generation/token-handler.js";
import { handleTrackedStreamPost } from "../../generation/tracked-sse.js";
import {
  getContentLanguageLabel,
  resolveGoalContentLanguage,
} from "../../llm/content-language.js";
import {
  goalMapPlanSchema,
  type GoalMapPlan,
} from "../../llm/schemas.js";
import { planGoalMapStream } from "../../llm/plan-goal-map.js";
import { goalHasRagDocuments } from "../../rag/retrieve.js";
import { appendLearnerProfileToPromptOptions } from "../../persona/learner-profile.js";
import { curriculumModuleMatchesContentLanguage } from "../../goals/normalize-goal-map-plan.js";
import { persistOverviewCourseShellForGoal } from "../../goals/persist-overview-course.js";
import { assertFullGoal, refreshDetailedPlanFromMap } from "./goal-map.support.js";
import { serializeGoalOverviewUnit } from "./goal-serialize.util.js";
import { isMicroGoal } from "../../domain/goal-kind.js";
import { createMicroUnitForGoal } from "../../goals/create-micro-unit.js";
import {
  buildPlanningOutlineEvent,
  gatherDeepPlanningResearch,
} from "../../goals/deep-planning-research.js";
import { withPlanningActivity } from "../../goals/planning-activity.js";
import { getLlmRuntimeConfig } from "../../llm/runtime-config.js";
import {
  reasoningCapabilityForProvider,
  withOperationReasoning,
} from "../../providers/llm/index.js";
import {
  isPlanningMode,
  type MaterialReplacementRepository,
  type LearnerStateMemoryInvalidationRepository,
  type ModuleStructureQueueRepository,
  type PlanningMode,
  type SequentialCurriculumModulePlan,
} from "../../../../domain/src/index.js";
import { MODULE_STRUCTURE_QUEUE_REPOSITORY } from "../../learning-spaces/module-structure-queue-token.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../../teaching-skills/index.js";
import { verifyAndRepairGoalPlan } from "../../content-verification/index.js";
import { seedGoalAuthoringContract } from "../../goal-authoring/runner.js";

@Injectable()
export class GoalPlanOverviewService {
  constructor(
    @Inject(MODULE_STRUCTURE_QUEUE_REPOSITORY)
    private readonly moduleStructureQueue: ModuleStructureQueueRepository,
    private readonly learningSpaceOrm: LearningSpaceOrmProvider,
  ) {}

  async getPlan(userId: string, goalId: string) {
    const goal = await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
      userId,
      goalId,
    );
    if (!goal) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }

    const summary = parseMapSummary(goal.mapSummaryJson);
    const storedPlan = parseMapPlan(goal.mapPlanJson);
    const isFoundationGoal =
      goal.goalRelationType === "foundation_support" &&
      Boolean(goal.parentGoalId);
    const plan =
      storedPlan && isFoundationGoal
        ? excludeFoundationScopeFromPlan(
            storedPlan,
            parseFoundationGoalItems(goal.goalRelationContextJson),
          )
        : storedPlan;
    const incompleteMapModuleCount = 0;

    return {
      goalId: goal.id,
      title: goal.title,
      level: goal.level,
      goalKind: goal.goalKind === "micro" ? "micro" : "full",
      learningMode:
        goal.learningMode === "exploration" ? "exploration" : "mastery",
      parentGoalId: goal.parentGoalId,
      goalRelationType: goal.goalRelationType,
      planningMode:
        (goal as { planningMode?: PlanningMode }).planningMode ?? "fast",
      pathSource: goal.pathSource,
      contentLanguage:
        goal.contentLanguage === "auto"
          ? resolveGoalContentLanguage("auto", "", getCurrentLocale())
          : goal.contentLanguage,
      generationOptions: goal.generationOptions,
      topicOverview: goal.topicOverview,
      mapSummaryStatus: goal.mapSummaryStatus,
      summary,
      mapPlanStatus: goal.mapPlanStatus,
      detailedPlanStatus: goal.detailedPlanStatus,
      plan,
      hasMap: goal.unitCount > 0 || goal.moduleCount > 0,
      incompleteMapModuleCount,
      documentCount: goal.documentCount,
    };
  }

  async patchPlan(
    userId: string,
    goalId: string,
    body: {
      topicOverview?: string;
      outOfScope?: string[];
    },
  ) {
    const goal = await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
      userId,
      goalId,
    );
    if (!goal) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    assertFullGoal(goal);
    if (goal.unitCount > 0 || goal.moduleCount > 0) {
      throw new BadRequestException(
        tBackend("error.goal.approvedCourseReadonly"),
      );
    }

    const existing = parseMapPlan(goal.mapPlanJson);
    if (!existing) {
      throw new BadRequestException(tBackend("error.goal.planRequired"));
    }

    const topicOverview =
      typeof body.topicOverview === "string"
        ? body.topicOverview
        : existing.topicOverview;

    const merged = goalMapPlanSchema.parse({
      ...existing,
      topicOverview,
      outOfScope: Array.isArray(body.outOfScope)
        ? body.outOfScope
        : existing.outOfScope,
    });

    const mapPlanJson = serializeMapPlan(merged);
    const updateResult =
      await this.learningSpaceOrm.learningGoalPlan.updateOwnedPlan({
        userId,
        goalId,
        topicOverview: merged.topicOverview,
        mapPlanJson,
      });
    if (updateResult.status === "not_found") {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    if (updateResult.status === "locked") {
      throw new BadRequestException(
        tBackend("error.goal.approvedCourseReadonly"),
      );
    }

    return { ok: true, plan: merged };
  }

  async approvePlan(userId: string, goalId: string) {
    const goal = await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
      userId,
      goalId,
    );
    if (!goal) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    assertFullGoal(goal);

    if (goal.unitCount > 0) {
      if (goal.boundUnitCount > 0 && goal.mapPlanStatus !== "approved") {
        throw new BadRequestException(tBackend("error.goal.mapContractLocked"));
      }
    }

    const plan = parseMapPlan(goal.mapPlanJson);
    if (!plan) {
      throw new BadRequestException(tBackend("error.goal.planIncomplete"));
    }
    const contentLanguage = resolveGoalContentLanguage(
      goal.contentLanguage,
      goal.title,
    );
    if (
      plan.schemaVersion === 2 &&
      plan.modules?.some(
        (module) =>
          !curriculumModuleMatchesContentLanguage(module, contentLanguage),
      )
    ) {
      throw new BadRequestException(
        tBackend("error.goal.planLanguageMismatch"),
      );
    }

    if (plan.schemaVersion === 2 && plan.modules?.length) {
      const modulePlans: SequentialCurriculumModulePlan[] = plan.modules.map(
        (modulePlan) => ({
          title: modulePlan.title,
          summary: modulePlan.summary,
          objective: modulePlan.objective,
          plannedOutcomes: [...modulePlan.plannedOutcomes],
          entryFoundationBriefs: modulePlan.entryFoundationBriefs.map(
            (brief) => ({
              ref: brief.ref,
              title: brief.title,
              rationale: brief.rationale,
              criticality: brief.criticality,
              verificationDimensions: [...brief.verificationDimensions],
            }),
          ),
          exitCapabilityBriefs: [...modulePlan.exitCapabilityBriefs],
          estimatedUnitCount: modulePlan.estimatedUnitCount,
          unitPlanningBrief: {
            scopeSize: modulePlan.unitPlanningBrief.scopeSize,
            rationale: modulePlan.unitPlanningBrief.rationale,
            progression: [...modulePlan.unitPlanningBrief.progression],
          },
        }),
      );
      const result =
        await this.learningSpaceOrm.sequentialCurriculumApproval.persistOwned({
          userId,
          goalId,
          modules: modulePlans,
          enqueueFirst: false,
        });
      if (result.status === "not_found") {
        throw new NotFoundException(tBackend("error.goal.notFound"));
      }
      await this.moduleStructureQueue.enqueueOwned({ userId, goalId });
    } else {
      const result =
        await this.learningSpaceOrm.learningGoalPlan.approveOwnedPlan(
          userId,
          goalId,
        );
      if (result.status === "not_found") {
        throw new NotFoundException(tBackend("error.goal.notFound"));
      }
      if (result.status === "locked") {
        throw new BadRequestException(tBackend("error.goal.mapContractLocked"));
      }
    }

    return { ok: true, curriculumVersion: plan.schemaVersion ?? 1 };
  }

  planStream(
    userId: string,
    goalId: string,
    body: {
      hasUpload?: boolean;
      regenerate?: boolean;
      runId?: string;
      adjustment?: string;
      planningMode?: PlanningMode;
    } = {},
  ) {
    const { runId } = body;

    return (async () => {
      const goal =
        await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
          userId,
          goalId,
        );
      if (!goal) {
        throw new NotFoundException(tBackend("error.goal.notFound"));
      }
      assertFullGoal(goal);

      const existingUnits = goal.unitCount;
      return handleTrackedStreamPost(
        { runId },
        {
          scope: "goal",
          scopeId: goalId,
          operation:
            existingUnits === 0
              ? "goal.curriculum.plan"
              : "goal.plan.detail.legacy",
        },
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
          let plan:
            | GoalMapPlan
            | Awaited<ReturnType<typeof refreshDetailedPlanFromMap>>;
          if (existingUnits === 0) {
            await ctx.send({
              type: "status",
              phase: "contract",
              message: tBackend("status.goal.identifyingContract"),
            });
            const hasRag = await goalHasRagDocuments(goalId);
            const requestedMode = isPlanningMode(body.planningMode)
              ? body.planningMode
              : ((goal as { planningMode?: PlanningMode }).planningMode ??
                "fast");
            const usesBlueprintPlanning =
              requestedMode === "deep" || requestedMode === "docs_first";
            const adjustment = body.adjustment?.trim() ?? "";
            const existingPlan = parseMapPlan(goal.mapPlanJson);
            const isRevision = Boolean(adjustment && existingPlan);
            if (requestedMode === "docs_first" && !hasRag && !isRevision) {
              throw new BadRequestException({
                code: "DOCS_REQUIRED_FOR_PLANNING_MODE",
                message: tBackend("error.goal.docsRequired"),
              });
            }
            if (body.planningMode && goal.mapPlanStatus !== "approved") {
              const result =
                await this.learningSpaceOrm.learningGoalPlan.updateOwnedPlanningMode(
                  userId,
                  goalId,
                  requestedMode,
                );
              if (result.status === "not_found") {
                throw new NotFoundException(tBackend("error.goal.notFound"));
              }
              if (result.status === "locked") {
                throw new BadRequestException(
                  tBackend("error.goal.mapContractLocked"),
                );
              }
            }
            if (isRevision) {
              await ctx.send({
                type: "planning_stage",
                stage: "revising_plan",
                message: tBackend("status.goal.revisingPlanFromSources"),
              });
              await ctx.send(
                buildPlanningOutlineEvent(existingPlan!, {
                  reusedSources: true,
                }),
              );
            } else {
              await ctx.send({
                type: "planning_stage",
                stage: "analyzing_goal",
                message: tBackend("status.goal.analyzingBoundaries"),
              });
            }
            const gatherContext = () =>
              gatherGoalPathContext({
                goalId,
                title: goal.title,
                hasUpload: hasRag,
                uploadedDocumentsOnly: requestedMode === "docs_first",
                extraQuery: isRevision ? adjustment : undefined,
                allowWebSearch:
                  isRevision || usesBlueprintPlanning ? false : !hasRag,
                searchPurpose: "map",
                onKnowledgeActivity: (activity) =>
                  ctx.send({ type: "knowledge_activity", activity }),
              });
            const gathered = usesBlueprintPlanning
              ? await withPlanningActivity(
                  ctx.send,
                  {
                    id: "goal_context",
                    category: "research",
                    startedMessage: tBackend("status.planning.context.started"),
                    pulseMessages: [
                      tBackend("status.planning.context.pulse1"),
                      tBackend("status.planning.context.pulse2"),
                    ],
                    completedMessage: tBackend(
                      "status.planning.context.completed",
                    ),
                  },
                  gatherContext,
                )
              : await gatherContext();
            if (!isRevision && requestedMode === "deep") {
              await ctx.send({
                type: "planning_stage",
                stage: "searching_web",
              });
              const deepResearch = await gatherDeepPlanningResearch({
                userId,
                goalId,
                title: goal.title,
                queryLimit: 1,
                onEvent: (event) => ctx.send(event),
                onKnowledgeActivity: (activity) =>
                  ctx.send({ type: "knowledge_activity", activity }),
              });
              if (deepResearch.context) {
                gathered.context = [gathered.context, deepResearch.context]
                  .filter(Boolean)
                  .join("\n\n---\n\n");
                if (!hasRag) gathered.pathSource = "search";
                gathered.sourceCount = Math.max(
                  gathered.sourceCount,
                  deepResearch.sources.length,
                );
              }
              await ctx.send({
                type: "planning_stage",
                stage: "cross_checking",
              });
            } else if (!isRevision && requestedMode === "docs_first") {
              await ctx.send({
                type: "planning_stage",
                stage: "searching_web",
              });
              const supplement = await gatherDeepPlanningResearch({
                userId,
                goalId,
                title: goal.title,
                queryLimit: 1,
                desiredSourceCount: 5,
                sourceLimit: 10,
                onEvent: (event) => ctx.send(event),
                onKnowledgeActivity: (activity) =>
                  ctx.send({ type: "knowledge_activity", activity }),
              });
              gathered.context = [
                gathered.context,
                "Supplemental web verification:",
                supplement.context,
              ]
                .filter(Boolean)
                .join("\n\n---\n\n");
              gathered.sourceCount += supplement.sources.length;
              await ctx.send({
                type: "planning_stage",
                stage: "cross_checking",
              });
            }
            const generationOptions = await appendLearnerProfileToPromptOptions(
              userId,
              [
                goal.generationOptions,
                isRevision && existingPlan
                  ? `[Current validated plan — revise this plan in place; preserve unaffected decisions]\n${serializeMapPlan(existingPlan)}`
                  : "",
                adjustment
                  ? `User adjustment request for the revised goal contract:\n${adjustment}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n\n"),
              this.learningSpaceOrm.learnerStateMemoryRead,
            );
            await seedGoalAuthoringContract({
              userId,
              goalId,
              userRequest: goal.title,
              traceId: ctx.runId,
              contract: {
                title: goal.title,
                level: goal.level,
                contentLanguage,
                planningMode: requestedMode,
                generationOptions,
              },
            });
            await resolveTeachingSkillForGoal({
              goalId,
              title: goal.title,
              level: goal.level,
              generationOptions,
              sourceSummary: gathered.context,
              authoringAgent: { userId },
            });
            const teachingSkill = await loadTeachingSkillPrompt(
              goalId,
              "goal_plan",
              `${goal.title} ${generationOptions}`,
            );
            const runtime = getLlmRuntimeConfig();
            if (usesBlueprintPlanning) {
              await ctx.send({
                type: "reasoning_status",
                status: "requested",
                provider: runtime.provider,
              });
              await ctx.send({
                type: "reasoning_status",
                status: reasoningCapabilityForProvider(
                  runtime.provider,
                  runtime.chatModel,
                ),
                provider: runtime.provider,
              });
            }
            if (usesBlueprintPlanning && !isRevision) {
              await ctx.send({
                type: "planning_stage",
                stage: "sequencing_modules",
                message: tBackend("status.goal.draftingModules"),
              });
            }
            const runPlan = () =>
              planGoalMapStream({
                title: goal.title,
                level: goal.level,
                context: gathered.context,
                pathSource: gathered.pathSource,
                contentLanguage,
                generationOptions,
                teachingSkillBlock: teachingSkill?.promptBlock,
                onToken,
                signal: ctx.signal,
                operation: usesBlueprintPlanning
                  ? "goal.curriculum.plan.deep_blueprint"
                  : "goal.curriculum.plan",
                authoringAgent: { userId, goalId },
                wrapIdentity: (run) =>
                  usesBlueprintPlanning
                    ? withPlanningActivity(
                        ctx.send,
                        {
                          id: "goal_identity",
                          category: "synthesis",
                          startedMessage: tBackend(
                            "status.planning.identity.started",
                          ),
                          pulseMessages: [
                            tBackend("status.planning.identity.pulse1"),
                            tBackend("status.planning.identity.pulse2"),
                          ],
                          completedMessage: tBackend(
                            "status.planning.identity.completed",
                          ),
                        },
                        () => withOperationReasoning(true, run),
                      )
                    : run(),
                wrapJourney: (run) =>
                  usesBlueprintPlanning
                    ? withPlanningActivity(
                        ctx.send,
                        {
                          id: "goal_journey",
                          category: "synthesis",
                          startedMessage: tBackend(
                            "status.planning.journey.started",
                          ),
                          pulseMessages: [
                            tBackend("status.planning.journey.pulse1"),
                            tBackend("status.planning.journey.pulse2"),
                            tBackend("status.planning.journey.pulse3"),
                          ],
                          completedMessage: tBackend(
                            "status.planning.journey.completed",
                          ),
                        },
                        () => withOperationReasoning(true, run),
                      )
                    : run(),
                onIdentity: async (identity) => {
                  await ctx.send(
                    buildPlanningOutlineEvent(
                      {
                        schemaVersion: 2,
                        refinedTitle: identity.refinedTitle,
                        domainAnalysis: identity.domainAnalysis,
                        topicOverview: identity.topicOverview,
                        whatYouWillLearn: identity.whatYouWillLearn,
                        prerequisitesAssumed: identity.prerequisitesAssumed,
                        majorAreas: [
                          {
                            title: identity.domainAnalysis.subdomain,
                            description: identity.topicOverview,
                            mapRole: "branch",
                          },
                        ],
                        mapStructure: {
                          recommendedDepth: 2,
                          estimatedLeafUnits: 1,
                          layeringStrategy: "Modules will be sequenced next.",
                          nestingRationale:
                            "Identity is frozen before the module journey is authored.",
                        },
                        modules: [],
                        outOfScope: [],
                      },
                      { reusedSources: isRevision },
                    ),
                  );
                },
              });
            const generatedPlan = await runPlan();
            plan = usesBlueprintPlanning
              ? await withPlanningActivity(
                  ctx.send,
                  {
                    id: "plan_validation",
                    category: "validation",
                    startedMessage: tBackend(
                      "status.planning.validation.started",
                    ),
                    pulseMessages: [],
                    completedMessage: tBackend(
                      "status.planning.validation.completed",
                    ),
                  },
                  () =>
                    verifyAndRepairGoalPlan({
                      plan: generatedPlan,
                      goalTitle: goal.title,
                      confirmedGoal: [goal.title, generationOptions]
                        .filter(Boolean)
                        .join("\n\n"),
                      evidenceContext: gathered.context,
                      signal: ctx.signal,
                    }),
                )
              : generatedPlan;
            if (usesBlueprintPlanning || isRevision) {
              await ctx.send(
                buildPlanningOutlineEvent(plan, {
                  reusedSources: isRevision,
                }),
              );
              await ctx.send({
                type: "planning_stage",
                stage: "validating_plan",
              });
            }
            const { title: refinedTitle } = resolveRefinedGoalTitle(
              goal.title,
              generatedPlan.refinedTitle,
            );
            const persistPlan = async () => {
              const mapPlanJson = serializeMapPlan(generatedPlan);
              const result =
                await this.learningSpaceOrm.learningGoalPlan.publishOwnedPlan({
                  userId,
                  goalId,
                  title: refinedTitle,
                  topicOverview: generatedPlan.topicOverview,
                  mapPlanJson,
                  pathSource: gathered.pathSource,
                  domainTag: generatedPlan.domainAnalysis.domainTag,
                  topicCategory: generatedPlan.domainAnalysis.topicCategory,
                });
              if (result.status === "not_found") {
                throw new NotFoundException(tBackend("error.goal.notFound"));
              }
              if (result.status === "locked") {
                throw new BadRequestException(
                  tBackend("error.goal.approvedCourseReadonly"),
                );
              }
            };
            if (usesBlueprintPlanning) {
              await withPlanningActivity(
                ctx.send,
                {
                  id: "plan_validation",
                  category: "validation",
                  startedMessage: tBackend(
                    "status.planning.validation.started",
                  ),
                  pulseMessages: [],
                  completedMessage: tBackend(
                    "status.planning.validation.completed",
                  ),
                },
                persistPlan,
              );
            } else {
              await persistPlan();
            }
          } else if (
            goal.mapPlanStatus === "approved" &&
            parseMapPlan(goal.mapPlanJson)
          ) {
            plan = parseMapPlan(goal.mapPlanJson)!;
            await ctx.send({
              type: "status",
              phase: "contract",
              message: tBackend("status.goal.contractPreserved"),
            });
          } else {
            await ctx.send({
              type: "status",
              phase: "plan",
              message: tBackend("status.goal.generatingDetailedPlan"),
            });
            plan = await refreshDetailedPlanFromMap({
              goalId,
              userId,
              learningGoalPlan: this.learningSpaceOrm.learningGoalPlan,
              onToken,
              signal: ctx.signal,
              cognitiveModelInvalidation:
                this.learningSpaceOrm.cognitiveModelInvalidation,
            });
          }

          await ctx.send({
            type: "done",
            goalId,
            pathSource: goal.pathSource,
            contentLanguage,
            plan,
            title: plan?.refinedTitle || goal.title,
            titleChanged: Boolean(
              plan?.refinedTitle && plan.refinedTitle !== goal.title,
            ),
          });
        },
      );
    })();
  }

  batchSqStream(
    userId: string,
    goalId: string,
    body: { runId?: string; skipExisting?: boolean } = {},
  ) {
    return (async () => {
      if (!isDev()) {
        throw new NotFoundException(tBackend("error.notFound"));
      }
      const lessonCount =
        await this.learningSpaceOrm.learningGoalPlan.countOwnedLessons(
          userId,
          goalId,
        );
      if (lessonCount === null) {
        throw new NotFoundException(tBackend("error.goal.notFound"));
      }
      if (lessonCount === 0) {
        throw new BadRequestException(tBackend("error.goal.unitNotFound"));
      }

      return handleTrackedStreamPost(
        { runId: body.runId },
        {
          scope: "goal",
          scopeId: goalId,
          operation: "goal.batch_sq",
          goalId,
        },
        async (ctx) => {
          const result = await runBatchSqPreview(
            ctx,
            goalId,
            this.learningSpaceOrm.batchContentGeneration,
            {
              skipExisting: body.skipExisting,
              learnerStateMemoryInvalidation:
                this.learningSpaceOrm.learnerStateMemoryInvalidation,
            },
          );

          const failCount = result.failed.length;
          const baseMessage = tBackend(
            result.cancelled
              ? "status.goal.batchStopped"
              : failCount === 0
                ? "status.goal.batchCompleted"
                : "status.goal.batchCompletedWithFailures",
            {
              succeeded: result.succeeded,
              skipped: result.skipped,
              failed: failCount,
            },
          );

          await ctx.send({
            type: "done",
            ...result,
            message: baseMessage,
          });
        },
      );
    })();
  }

  batchMaterialStream(
    userId: string,
    goalId: string,
    body: {
      runId?: string;
      unitIds?: string[];
      skipExisting?: boolean;
    } = {},
  ) {
    return (async () => {
      if (!isDev()) {
        throw new NotFoundException(tBackend("error.notFound"));
      }
      const goal =
        await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
          userId,
          goalId,
        );
      if (!goal) {
        throw new NotFoundException(tBackend("error.goal.notFound"));
      }

      const unitIds = body.unitIds ?? [];
      if (unitIds.length === 0) {
        throw new BadRequestException(tBackend("error.goal.unitNotFound"));
      }

      return handleTrackedStreamPost(
        { runId: body.runId },
        {
          scope: "goal",
          scopeId: goalId,
          operation: "goal.batch_material",
          goalId,
        },
        async (ctx) => {
          const result = await runBatchMaterial(
            ctx,
            goalId,
            this.learningSpaceOrm.batchContentGeneration,
            {
              unitIds,
              skipExisting: body.skipExisting,
            },
            this.learningSpaceOrm.materialReplacement,
            this.learningSpaceOrm.materialEnrichment,
            this.learningSpaceOrm.learnerStateMemoryInvalidation,
          );

          const failCount = result.failed.length;
          const baseMessage = tBackend(
            result.cancelled
              ? "status.goal.batchStopped"
              : failCount === 0
                ? "status.goal.batchCompleted"
                : "status.goal.batchCompletedWithFailures",
            {
              succeeded: result.succeeded,
              skipped: result.skipped,
              failed: failCount,
            },
          );

          await ctx.send({
            type: "done",
            ...result,
            message: baseMessage,
          });
        },
      );
    })();
  }

  overviewStream(
    userId: string,
    goalId: string,
    body: { runId?: string } = {},
  ) {
    return (async () => {
      const goal =
        await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
          userId,
          goalId,
        );
      if (!goal) {
        throw new NotFoundException(tBackend("error.goal.notFound"));
      }
      const micro = isMicroGoal(goal);
      if (!micro) assertFullGoal(goal);

      return handleTrackedStreamPost(
        { runId: body.runId },
        { scope: "goal", scopeId: goalId, operation: "goal.overview" },
        async (ctx) => {
          if (micro) {
            await ctx.send({
              type: "status",
              phase: "material",
              message: tBackend("status.goal.upgradingMicro"),
            });
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
              navigateTo: `/goals/${goalId}/units/${unitId}`,
            });
            return;
          }

          const started =
            await this.learningSpaceOrm.overviewCoursePublication.beginOwnedOverviewCourse(
              userId,
              goalId,
            );
          if (started.status === "not_found") {
            throw new NotFoundException(tBackend("error.goal.notFound"));
          }
          await ctx.send({
            type: "status",
            phase: "overview",
            message: tBackend("status.goal.savingOverviewContent"),
          });

          const branchRows =
            await this.learningSpaceOrm.learningGoalPlan.listOwnedOverviewBranches(
              userId,
              goalId,
            );
          const branches = branchRows.map((row) => ({
            title: row.title,
            summary: row.contentSummary,
          }));

          const published = await persistOverviewCourseShellForGoal(goalId, {
            userId,
            title: goal.title,
            topicOverview: goal.topicOverview,
            branches,
            overviewCoursePublication:
              this.learningSpaceOrm.overviewCoursePublication,
          });
          await ctx.send({
            type: "done",
            goalId,
            unitId: published.unitId,
            navigateTo: `/goals/${goalId}/units/${published.unitId}`,
          });
        },
      );
    })();
  }

  async markOverviewUnitComplete(
    userId: string,
    goalId: string,
    unitId: string,
    body: { completed?: boolean },
  ) {
    const completed = body.completed !== false;

    const result =
      await this.learningSpaceOrm.overviewCoursePublication.completeOwnedOverviewUnit(
        {
          userId,
          goalId,
          unitId,
          completedAt: completed ? new Date() : null,
        },
      );
    if (result.status === "not_found") {
      throw new NotFoundException(tBackend("error.goal.unitNotFound"));
    }

    return {
      unit: serializeGoalOverviewUnit({
        ...result.unit,
      }),
    };
  }
}
