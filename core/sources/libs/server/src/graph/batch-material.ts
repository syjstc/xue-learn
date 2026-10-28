import type {
  BatchContentGenerationRepository,
  LearnerStateMemoryInvalidationRepository,
  MaterialEnrichmentRepository,
  MaterialReplacementRepository,
} from "../../../domain/src/index.js";
import { tBackend } from "../../../common/src/index.js";
import { hasValidSqPreview } from "../domain/sq-preview.js";
import { getBatchMaterialConcurrency } from "../generation/batch-config.js";
import { isGenerationCancelled } from "../generation/errors.js";
import { assertRunActive } from "../generation/run.js";
import type { TrackedWorkContext } from "../generation/tracked-sse.js";
import { createTrackedTokenHandler } from "../generation/token-handler.js";
import { enrichMaterialWithImages } from "../images/enrich-material.js";
import {
  getOrCreateSession,
  patchMaterialIllustrationBlock,
  sanitizeLearningMaterialText,
  serializeLearningMaterialBlocks,
  serializeLearningMaterialKeyTakeaways,
  serializeMaterialContextSources,
} from "./unit-session.js";
import {
  streamGenerateLearningMaterialText,
  streamGenerateSqPreview,
} from "./unit-session-stream.js";
import { sendUnitContentGenEvent } from "./unit-content-gen-event.js";
import { commitSqPreviewAtRevision } from "./content-revision.js";
import { materialToJitItems } from "../llm/jit-structured-items.js";
import { invalidateLearnerStateMemory } from "../learner-state-memory/index.js";

export type BatchMaterialFailure = {
  unitId: string;
  title: string;
  error: string;
};

export type BatchMaterialResult = {
  selectedCount: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: BatchMaterialFailure[];
  cancelled?: boolean;
};

export async function runBatchMaterial(
  ctx: TrackedWorkContext,
  goalId: string,
  repository: BatchContentGenerationRepository,
  options: { unitIds: string[]; skipExisting?: boolean } = { unitIds: [] },
  materialReplacement: MaterialReplacementRepository,
  materialEnrichment: MaterialEnrichmentRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<BatchMaterialResult> {
  const skipExisting = options.skipExisting !== false;
  const unitIdSet = new Set(options.unitIds);
  if (unitIdSet.size === 0) {
    throw new Error("请至少选择一个学习单元");
  }

  const onToken = createTrackedTokenHandler(ctx);

  const goal = await repository.findGoal(goalId);
  if (!goal) throw new Error("学习目标不存在");
  const goalContext = goal;

  const selected = goalContext.lessons.filter((unit) => unitIdSet.has(unit.id));
  if (selected.length !== unitIdSet.size) {
    throw new Error("所选单元无效或不属于该学习目标");
  }

  const failures: BatchMaterialFailure[] = [];
  let skipped = 0;
  let succeeded = 0;

  const queue = selected.filter((unit) => {
    if (skipExisting && unit.hasMaterial) {
      skipped += 1;
      return false;
    }
    return true;
  });

  const total = queue.length;

  await ctx.send({
    type: "status",
    phase: "batch_material",
    message:
      total === 0
        ? `已选 ${selected.length} 个单元，均已具备正文，无需生成。`
        : `已选 ${selected.length} 个单元，待生成 ${total} 个（已跳过 ${skipped} 个）…`,
  });

  if (total === 0) {
    return {
      selectedCount: selected.length,
      processed: 0,
      succeeded: 0,
      skipped,
      failed: failures,
    };
  }

  const parallel = Math.min(getBatchMaterialConcurrency(), total);
  let jobCursor = 0;
  let completed = 0;
  let cancelled = false;

  await ctx.send({
    type: "status",
    phase: "batch_material",
    message: tBackend("status.generation.batchMaterial", { count: total }),
  });

  async function processUnit(unit: (typeof queue)[number]) {
    await ctx.send({
      type: "status",
      phase: "material",
      message: tBackend("status.generation.unitMaterial", {
        title: unit.title,
      }),
    });

    try {
      await assertRunActive(ctx.runId, ctx.signal);
      const session = await getOrCreateSession(goalContext.userId, unit.id);
      let expectedContentRevision = unit.contentRevision;
      let sqJson = session.sq3rData;
      if (!hasValidSqPreview(sqJson)) {
        await ctx.send({
          type: "status",
          phase: "sq_preview",
          message: tBackend("status.generation.unitNeedsSq", {
            title: unit.title,
          }),
        });
        const sq = await streamGenerateSqPreview(
          goalContext,
          unit.id,
          unit.title,
          unit.contentSummary,
          onToken,
          ctx.signal,
          {
            learnerStateMemoryInvalidation,
            onSectionPlanStart: () =>
              ctx.send({
                type: "status",
                phase: "section_plan",
                message: tBackend("status.generation.unitSectionPlan", {
                  title: unit.title,
                }),
              }),
            onVerificationStart: () =>
              ctx.send({
                type: "status",
                phase: "verification",
                message: tBackend("status.generation.verifyingContent"),
              }),
          },
        );
        if (cancelled || ctx.signal.aborted) return;
        sqJson = JSON.stringify(sq);
        expectedContentRevision = await commitSqPreviewAtRevision({
          unitId: unit.id,
          expectedContentRevision,
          sq3rData: sqJson,
        });
        await sendUnitContentGenEvent(ctx, unit.id, { hasSurvey: true });
      }

      await assertRunActive(ctx.runId, ctx.signal);
      const {
        material: textMaterial,
        contextSources,
        contentLanguage,
        materialSourceItems,
      } = await streamGenerateLearningMaterialText(
        goalContext,
        unit.id,
        unit.title,
        unit.contentSummary,
        sqJson,
        onToken,
        ctx.signal,
      );
      if (cancelled || ctx.signal.aborted) return;

      const sourcesJson = serializeMaterialContextSources(contextSources);
      const committed = await materialReplacement.replace({
        userId: goalContext.userId,
        goalId: goalContext.id,
        unitId: unit.id,
        material: {
          introduction: sanitizeLearningMaterialText(textMaterial.introduction),
          sections: serializeLearningMaterialBlocks(textMaterial),
          keyTakeaways: serializeLearningMaterialKeyTakeaways(textMaterial.keyTakeaways),
          contextSources: sourcesJson,
          sourceItemsJson: JSON.stringify(materialSourceItems),
        },
        sq3rData: sqJson,
        publishChecks: false,
        materialCheckTasks: [],
        resetProgress: true,
        clearDownstream: true,
        expectedContentRevision,
      });
      await invalidateLearnerStateMemory(
        goalContext.userId,
        "unit_material_replaced",
        undefined,
        learnerStateMemoryInvalidation,
      );
      await sendUnitContentGenEvent(ctx, unit.id, {
        hasSurvey: true,
        hasMaterial: true,
      });

      let material = textMaterial;
      let contentRevision = committed.contentRevision;
      let persistTail = Promise.resolve();
      let materialStillCurrent = true;
      await enrichMaterialWithImages(
        textMaterial,
        unit.id,
        {
          goalId: goalContext.id,
          unitTitle: unit.title,
          contentLanguage,
          storageRevision: `material-${committed.contentRevision}`,
        },
        {
          onStart: async (total) => {
            await assertRunActive(ctx.runId, ctx.signal);
            if (total === 0) return;
            await ctx.send({
              type: "status",
              phase: "images",
              message: tBackend("status.generation.images", {
                current: 0,
                total,
              }),
            });
          },
          onProgress: async ({ current, total }) => {
            await assertRunActive(ctx.runId, ctx.signal);
            const message = tBackend("status.generation.images", {
              current,
              total,
            });
            await ctx.send({
              type: "status",
              phase: "images",
              message,
            });
          },
          onImageReady: async ({ blockIndex, block }) => {
            await assertRunActive(ctx.runId, ctx.signal);
            if (!materialStillCurrent) return;
            material = patchMaterialIllustrationBlock(material, blockIndex, {
              imageId: block.imageId!,
              imageUrl: block.imageUrl!,
            });
            const snapshot = material;
            const task = persistTail.then(() =>
              materialEnrichment.persistIfCurrent({
                userId: goalContext.userId,
                unitId: unit.id,
                expectedContentRevision: contentRevision,
                sections: serializeLearningMaterialBlocks(snapshot),
                sourceItemsJson: JSON.stringify(materialToJitItems(snapshot)),
              }),
            );
            persistTail = task.then(
              () => undefined,
              () => undefined,
            );
            const persisted = await task;
            if (!persisted.applied) {
              materialStillCurrent = false;
              return;
            }
            contentRevision = persisted.contentRevision;
          },
          signal: ctx.signal,
        },
      );
      await persistTail;
      if (cancelled || ctx.signal.aborted) return;

      succeeded += 1;
    } catch (e) {
      if (isGenerationCancelled(e)) {
        cancelled = true;
        return;
      }
      failures.push({
        unitId: unit.id,
        title: unit.title,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      completed += 1;
      await ctx.send({
        type: "progress",
        current: completed,
        total,
        message: unit.title,
      });
    }
  }

  async function worker() {
    while (!cancelled && !ctx.signal.aborted) {
      try {
        await assertRunActive(ctx.runId, ctx.signal);
      } catch (e) {
        if (isGenerationCancelled(e)) {
          cancelled = true;
          break;
        }
        throw e;
      }
      if (cancelled || ctx.signal.aborted) break;
      if (jobCursor >= queue.length) break;

      const unit = queue[jobCursor]!;
      jobCursor += 1;
      await processUnit(unit);
    }
  }

  await Promise.all(Array.from({ length: parallel }, () => worker()));

  if (cancelled) {
    return {
      selectedCount: selected.length,
      processed: completed,
      succeeded,
      skipped,
      failed: failures,
      cancelled: true,
    };
  }

  return {
    selectedCount: selected.length,
    processed: total,
    succeeded,
    skipped,
    failed: failures,
  };
}
