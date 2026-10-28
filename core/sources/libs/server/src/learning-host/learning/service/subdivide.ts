import { BadRequestException, ConflictException } from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import type { UnitSubdivisionRepository } from "../../../../../domain/src/index.js";
import { FEATURE_SUBDIVIDE_UNIT } from "../../../features.js";
import { assertRunActive } from "../../../generation/run.js";
import { createTrackedTokenHandler } from "../../../generation/token-handler.js";
import { runGenerationContextScope } from "../../../generation/kernel.js";
import { handleTrackedStreamPost } from "../../../generation/tracked-sse.js";
import {
  forceSubdivideUnit,
  getSubdivisionStatus as readSubdivisionStatus,
  regenerateSubMap,
  removeSubMap as collapseSubMapToLesson,
  localizeSubdivideUnitError,
  SubdivideUnitError,
} from "../../../goals/subdivide-unit.js";

function requestedMode(body: Record<string, unknown>) {
  return body.mode === "structural" || body.mode === "steps"
    ? body.mode
    : "auto";
}

export async function getSubdivisionStatus(
  repository: UnitSubdivisionRepository,
  userId: string,
  unitId: string,
) {
  return readSubdivisionStatus(unitId, userId, repository);
}

export async function subdivideStream(
  repository: UnitSubdivisionRepository,
  userId: string,
  unitId: string,
  body: Record<string, unknown>,
) {
  if (!FEATURE_SUBDIVIDE_UNIT) {
    throw new BadRequestException(tBackend("error.learning.subdivideDisabled"));
  }
  const unit = await repository.getStatus(unitId, userId);
  if (!unit) throw new BadRequestException(tBackend("error.learning.subdivideNotFound"));
  if (body.mode === "structural") {
    const status = await readSubdivisionStatus(unitId, userId, repository);
    if (status.hasStructuralSubmap || !status.structuralEligible) {
      throw new ConflictException({
        message: tBackend("error.learning.subdivideStepsRequired"),
        reason: status.hasStructuralSubmap
          ? "already_split"
          : status.structuralReason,
        recommendedMode: "steps",
      });
    }
  }

  const runId = typeof body.runId === "string" ? body.runId : undefined;

  return handleTrackedStreamPost(
    { runId },
    {
      scope: "unit",
      scopeId: unitId,
      goalId: unit.goalId,
      operation: "unit.subdivide",
    },
    async (ctx) => {
      const onToken = createTrackedTokenHandler(ctx);
      try {
        await assertRunActive(ctx.runId, ctx.signal);
        const result = await forceSubdivideUnit(
          unitId,
          repository,
          (message) => {
            void ctx.send({ type: "status", phase: "subdivide", message });
          },
          {
            onToken,
            signal: ctx.signal,
            onPartialMap: (partial) => {
              void ctx.send({
                type: "map_partial",
                map: partial.map,
                unitCount: partial.unitCount,
                placeholderUnitCount: partial.placeholderUnitCount,
              });
            },
          },
          requestedMode(body),
        );
        await assertRunActive(ctx.runId, ctx.signal);
        await ctx.send({
          type: "done",
          mode: result.mode,
          parentUnitId: result.parentUnitId,
          childCount: result.childCount,
          children: result.children,
          steps: result.steps,
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

export async function removeSubMap(
  repository: UnitSubdivisionRepository,
  userId: string,
  unitId: string,
) {
  try {
    const owned = await repository.getStatus(unitId, userId);
    if (!owned) throw new SubdivideUnitError("单元不存在", "not_found");
    return await collapseSubMapToLesson(unitId, repository);
  } catch (e) {
    if (e instanceof SubdivideUnitError) {
      if (e.code === "unsafe_activity") {
        throw new ConflictException({
          message: localizeSubdivideUnitError(e),
          reason: e.code,
          recommendedMode: "steps",
        });
      }
      throw new BadRequestException(localizeSubdivideUnitError(e));
    }
    throw e;
  }
}

export async function regenerateSubMapStream(
  repository: UnitSubdivisionRepository,
  userId: string,
  unitId: string,
  body: Record<string, unknown>,
) {
  const unit = await repository.getStatus(unitId, userId);
  if (!unit) throw new BadRequestException(tBackend("error.learning.subdivideNotFound"));
  if (body.mode === "structural") {
    const status = await readSubdivisionStatus(unitId, userId, repository);
    if (!status.structuralEligible) {
      throw new ConflictException({
        message: tBackend("error.learning.regenerateSubmapStepsRequired"),
        reason: status.structuralReason,
        recommendedMode: "steps",
      });
    }
  }

  const runId = typeof body.runId === "string" ? body.runId : undefined;

  return handleTrackedStreamPost(
    { runId },
    {
      scope: "unit",
      scopeId: unitId,
      goalId: unit.goalId,
      operation: "unit.subdivide",
    },
    async (ctx) => {
      const onToken = createTrackedTokenHandler(ctx);
      try {
        const adjustment =
          typeof body.adjustment === "string" ? body.adjustment : undefined;
        await assertRunActive(ctx.runId, ctx.signal);
        const result = await runGenerationContextScope(
          {
            subject: { userId, goalId: unit.goalId, unitId },
            query: `${unit.title}: regenerate sub-map`,
          },
          () =>
            regenerateSubMap(
              unitId,
              repository,
              (message) => {
                void ctx.send({
                  type: "status",
                  phase: "subdivide",
                  message,
                });
              },
              {
                onToken,
                signal: ctx.signal,
                adjustment,
                onPartialMap: (partial) => {
                  void ctx.send({
                    type: "map_partial",
                    map: partial.map,
                    unitCount: partial.unitCount,
                    placeholderUnitCount: partial.placeholderUnitCount,
                  });
                },
              },
              requestedMode(body),
            ),
        );
        await assertRunActive(ctx.runId, ctx.signal);
        await ctx.send({
          type: "done",
          mode: result.mode,
          parentUnitId: result.parentUnitId,
          childCount: result.childCount,
          children: result.children,
          steps: result.steps,
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
