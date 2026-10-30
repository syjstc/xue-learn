import { learningPositionSchema } from "../../../learning-trajectory/contracts.js";
import { tBackend } from "../../../../../common/src/index.js";
import type {
  LearnerStateMemoryReadRepository,
  MaterialFollowUpRepository,
} from "../../../../../domain/src/index.js";
import { parseMaterialAnchor } from "../../../domain/material-anchor.js";
import {
  deleteMaterialFollowUp,
  getMaterialFollowUpContext,
  listMaterialFollowUps,
  listRecentMaterialFollowUps,
  replyMaterialFollowUp,
} from "../../../graph/material-follow-up.js";
import { createSseStream, sseResponse } from "../../../llm/sse.js";
import { runWithLlmTraceAsync } from "../../../llm/trace-context.js";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export async function getRecentFollowUps(userId: string, limit?: number) {
  return {
    threads: await listRecentMaterialFollowUps(userId, limit),
  };
}

export async function getFollowUps(
  repository: MaterialFollowUpRepository,
  userId: string,
  unitId: string,
) {
  if (!(await repository.findUnitContext(userId, unitId))) {
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  }
  const threads = await listMaterialFollowUps(userId, unitId);
  return { threads };
}

export async function postFollowUps(
  repository: MaterialFollowUpRepository,
  userId: string,
  unitId: string,
  body: Record<string, unknown>,
) {
  if (!(await repository.findUnitContext(userId, unitId))) {
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  }

  const action = body.action as string;

  if (action === "delete") {
    const threadId = body.threadId as string;
    if (!threadId) {
      throw new BadRequestException(
        tBackend("error.learning.threadIdRequired"),
      );
    }
    await deleteMaterialFollowUp(userId, unitId, threadId);
    return { ok: true };
  }

  if (action === "message") {
    throw new BadRequestException(
      tBackend("error.learning.followUpStreamRequired"),
    );
  }

  throw new BadRequestException(tBackend("error.learning.invalidAction"));
}

export async function followUpsStream(
  repository: MaterialFollowUpRepository,
  userId: string,
  unitId: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  learnerStateMemoryRead?: LearnerStateMemoryReadRepository,
) {
  const unit = await repository.findUnitContext(userId, unitId);
  if (!unit) {
    return new Response(
      JSON.stringify({ error: tBackend("error.goal.unitNotFound") }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const anchor = parseMaterialAnchor(body.anchor);
  if (!anchor) {
    return new Response(
      JSON.stringify({ error: tBackend("error.learning.invalidAnchor") }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const materialContext = await getMaterialFollowUpContext(userId, unitId, anchor);
  if (!materialContext) {
    return new Response(
      JSON.stringify({ error: tBackend("error.learning.materialRequired") }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const message = typeof body.message === "string" ? body.message : "";
  const threadId =
    typeof body.threadId === "string" ? body.threadId : undefined;
  const runId = typeof body.runId === "string" ? body.runId : undefined;

  return sseResponse(
    createSseStream(async (send) => {
      send({
        type: "status",
        message: tBackend("status.generation.followUp"),
        phase: "follow_up",
      });

      const traceId = runId ?? randomUUID();

      const result = await runWithLlmTraceAsync(
        {
          traceId,
          meta: {
            scope: "unit",
            scopeId: unitId,
            goalId: unit.goalId,
            operation: "unit.follow_up",
          },
        },
        () =>
          replyMaterialFollowUp({
            userId,
            unitId,
            unitTitle: unit.unitTitle,
            goalId: unit.goalId,
            goalTitle: unit.goalTitle,
            threadId,
            anchor,
            learningPosition: learningPositionSchema.safeParse(body.learningPosition).success ? learningPositionSchema.parse(body.learningPosition) : undefined,
            activeVisitId: typeof body.activeVisitId === "string" ? body.activeVisitId : undefined,
            userMessage: message,
            quotedText: typeof body.quotedText === "string" ? body.quotedText.trim().slice(0, 240) : undefined,
            traceId,
            materialContext,
            learnerStateMemoryRead,
            signal,
            send: async (event) => {
              if (event.type === "message") {
                send({ type: "token", delta: event.delta });
                return;
              }
              if (event.type === "thinking") {
                send(event);
                return;
              }
              if (event.type === "knowledge_activity") {
                send({
                  type: "knowledge_activity",
                  activity: event.activity,
                });
                return;
              }
              if (event.type === "tool_ui") {
                send({
                  type: "tool_ui",
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  uiKind: event.uiKind,
                  args: event.args,
                });
                return;
              }
              if (event.type === "status") {
                send({
                  type: "status",
                  message: event.message,
                  phase: event.phase,
                });
              }
            },
          }),
      );

      send({
        type: "done",
        threadId: result.threadId,
        messages: result.messages,
      });
    }),
  );
}
