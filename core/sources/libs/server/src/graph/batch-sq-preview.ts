import { tBackend } from "../../../common/src/index.js";
import type {
  BatchContentGenerationRepository,
  LearnerStateMemoryInvalidationRepository,
} from "../../../domain/src/index.js";
import { hasValidSqPreview } from "../domain/sq-preview.js";
import { getBatchSqPreviewConcurrency } from "../generation/batch-config.js";
import { isGenerationCancelled } from "../generation/errors.js";
import { assertRunActive } from "../generation/run.js";
import type { TrackedWorkContext } from "../generation/tracked-sse.js";
import { createTrackedTokenHandler } from "../generation/token-handler.js";
import { streamGenerateSqPreview } from "./unit-session-stream.js";
import { getOrCreateSession } from "./unit-session.js";
import { sendUnitContentGenEvent } from "./unit-content-gen-event.js";
import { commitSqPreviewAtRevision } from "./content-revision.js";

export type BatchSqFailure = {
  unitId: string;
  title: string;
  error: string;
};

export type BatchSqResult = {
  totalLessons: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: BatchSqFailure[];
  cancelled?: boolean;
};

export async function runBatchSqPreview(
  ctx: TrackedWorkContext,
  goalId: string,
  repository: BatchContentGenerationRepository,
  options: {
    skipExisting?: boolean;
    learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
  } = {},
): Promise<BatchSqResult> {
  const skipExisting = options.skipExisting !== false;
  const onToken = createTrackedTokenHandler(ctx);

  const goal = await repository.findGoal(goalId);
  if (!goal) throw new Error("学习目标不存在");
  const goalContext = goal;

  const lessons = goalContext.lessons;
  const failures: BatchSqFailure[] = [];
  let skipped = 0;
  let succeeded = 0;

  const queue = lessons.filter((unit) => {
    if (skipExisting && hasValidSqPreview(unit.sq3rData)) {
      skipped += 1;
      return false;
    }
    return true;
  });

  const total = queue.length;

  await ctx.send({
    type: "status",
    phase: "batch_sq",
    message:
      total === 0
        ? `共 ${lessons.length} 个学习单元，均已具备预习，无需生成。`
        : `共 ${lessons.length} 个学习单元，待生成 ${total} 个（已跳过 ${skipped} 个）…`,
  });

  if (total === 0) {
    return {
      totalLessons: lessons.length,
      processed: 0,
      succeeded: 0,
      skipped,
      failed: failures,
    };
  }

  const parallel = Math.min(getBatchSqPreviewConcurrency(), total);
  let jobCursor = 0;
  let completed = 0;
  let cancelled = false;

  await ctx.send({
    type: "status",
    phase: "batch_sq",
    message: tBackend("status.generation.batchSq", { count: total }),
  });

  async function processUnit(unit: (typeof queue)[number]) {
    await ctx.send({
      type: "status",
      phase: "sq_preview",
      message: tBackend("status.generation.unitSq", { title: unit.title }),
    });

    try {
      const sq = await streamGenerateSqPreview(
        goalContext,
        unit.id,
        unit.title,
        unit.contentSummary,
        onToken,
        ctx.signal,
        {
          learnerStateMemoryInvalidation:
            options.learnerStateMemoryInvalidation,
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
      await getOrCreateSession(goalContext.userId, unit.id);
      await commitSqPreviewAtRevision({
        unitId: unit.id,
        expectedContentRevision: unit.contentRevision,
        sq3rData: JSON.stringify(sq),
      });
      await sendUnitContentGenEvent(ctx, unit.id, { hasSurvey: true });
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
      totalLessons: lessons.length,
      processed: completed,
      succeeded,
      skipped,
      failed: failures,
      cancelled: true,
    };
  }

  return {
    totalLessons: lessons.length,
    processed: total,
    succeeded,
    skipped,
    failed: failures,
  };
}
