import { z } from "zod";
import type { LearningBranch } from "../../../domain/src/index.js";
import { learningTrajectoryPersistence } from "./persistence.js";
import type { LlmMessageRecord } from "../agents/core/types.js";
import { runUnitAuthoringAgentRound } from "../unit-authoring/agent-round.js";
import {
  acceptedTopicMaterials,
  createTopicMaterialCommitSchema,
  flattenTopicToJitItems,
  type TopicMaterialCommit,
} from "../llm/material-topic.js";
import { strictLearningMaterialSchema } from "../llm/schemas.js";
import { COURSE_MATERIAL_CHAT_VOICE_RULES } from "../graph/course-material-prose.js";
import { GOAL_DIRECTED_TEACHING_POLICY } from "../goal-creation/teaching-policy.js";
import { runMergedGenerationContextScope } from "../generation/kernel.js";
import { runWithLlmTraceAsync } from "../llm/trace-context.js";

const jobs = new Map<string, AbortController>();
const pending: Array<() => Promise<void>> = [];
let running = 0;
function drain() {
  while (running < 2 && pending.length) {
    const work = pending.shift()!;
    running++;
    void work().finally(() => {
      running--;
      drain();
    });
  }
}
export function cancelLearningSupplement(id: string) {
  jobs.get(id)?.abort();
}
export function stopLearningSupplementJobs() {
  for (const c of jobs.values()) c.abort();
}
export function scheduleLearningSupplement(
  userId: string,
  branch: LearningBranch,
) {
  if (!branch.generationToken || jobs.has(branch.id)) return;
  const controller = new AbortController();
  jobs.set(branch.id, controller);
  pending.push(async () => {
    try {
      await generateLearningSupplement(userId, branch, controller.signal);
    } catch (error) {
      await learningTrajectoryPersistence()
        .fail(
          userId,
          branch.id,
          branch.generationToken!,
          controller.signal.aborted ? "cancelled" : "generation_failed",
        )
        .catch(() => undefined);
    } finally {
      jobs.delete(branch.id);
    }
  });
  drain();
}

/** Uses the production topic commit dialect, validation and bounded repair with a separate transcript. */
export async function generateLearningSupplement(
  userId: string,
  branch: LearningBranch,
  signal: AbortSignal,
) {
  const repository = learningTrajectoryPersistence();
  const token = branch.generationToken!;
  const context = await repository.context(userId, branch.unitId);
  if (!context) throw new Error("Learning context unavailable");
  const topics = branch.topics.map((title, index) => ({
    id: `supplement-${branch.id}-${index + 1}`,
    title,
  }));
  const source = context.sections.find((s) => s.id === branch.origin.sectionId);
  const originBlocks = source?.blocks ?? context.legacy?.blocks ?? [];
  const prompt = `Teach a small optional learning supplement. This is NOT a new main lesson or a rewrite.
Language: ${context.locale}. Goal: ${context.goalTitle}. Original lesson: ${context.unitTitle}.
Supplement: ${branch.title}. Purpose: ${branch.purpose}. Reason: ${branch.reason}.
After this supplement the learner should be able to return to: ${branch.returnGoal}.
The question/anchored passage: ${branch.origin.anchorText ?? ""}.
Nearby material is context, NOT proof of mastery: ${JSON.stringify(originBlocks.slice(Math.max(0, (branch.origin.blockIndex ?? 0) - 2), (branch.origin.blockIndex ?? 0) + 3))}.
Explain any missing foundations before using them. Do not assume that later chapters or even the anchored concept are understood. Interest is curiosity, not a diagnosis.
${GOAL_DIRECTED_TEACHING_POLICY}
${COURSE_MATERIAL_CHAT_VOICE_RULES}
Each topic is heading + one display + spoken paragraph cues, using the existing commit_topic_material tool. Use complete callout/compare/code/conversation/stage displays. For this short reading supplement, use self-contained text, math and code; do not emit image/SVG intents, laboratories, step_sort, graph or unresolved external assets. Do not emit check blocks or mastery claims.
The server owns these ordered topic identities: ${JSON.stringify(topics)}.`;
  let transcript = branch.transcript as LlmMessageRecord[];
  if (!transcript.length) transcript = [{ role: "system", content: prompt }];
  const accepted = acceptedTopicMaterials(
    transcript,
    topics.map((t) => t.id),
  );
  for (const topic of topics) {
    if (signal.aborted) throw new Error("cancelled");
    if (accepted.has(topic.id)) continue;
    const schema = createTopicMaterialCommitSchema({
      allowedTopicIds: topics.map((t) => t.id),
      expectedTopicId: topic.id,
    }).superRefine((v, ctx) => {
      const forbidden = new Set([
        "svg_slot",
        "illustration",
        "step_sort",
        "graph",
        "interactive_html",
        "component_intent",
      ]);
      const walk = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const obj = value as Record<string, unknown>;
        if (typeof obj.type === "string" && forbidden.has(obj.type))
          ctx.addIssue({
            code: "custom",
            path: ["display"],
            message:
              "Use a self-contained callout, compare or code display without external assets.",
          });
        for (const c of Object.values(obj)) if (typeof c === "object") walk(c);
      };
      walk(v.display);
    });
    const round = await runMergedGenerationContextScope(
      {
        subject: { userId, goalId: branch.goalId, unitId: branch.unitId },
        query: branch.title,
      },
      () =>
        runWithLlmTraceAsync({ traceId: branch.id }, () =>
          runUnitAuthoringAgentRound({
            transcript,
            prompt: `Teach ${topic.title}. Call commit_topic_material for topicId ${topic.id} only.`,
            expectedTool: "commit_topic_material",
            resultSchema: schema,
            signal,
            meta: {
              scope: "unit",
              scopeId: branch.unitId,
              goalId: branch.goalId,
              learningBranchId: branch.id,
              topicId: topic.id,
            },
          }),
        ),
    );
    transcript = [
      ...transcript,
      round.userMessage,
      round.assistantMessage,
      round.toolMessage,
    ];
    if (!(await repository.checkpoint(userId, branch.id, token, transcript)))
      throw new Error("Supplement was cancelled or changed");
    accepted.set(topic.id, round.result as TopicMaterialCommit);
  }
  const blocks = topics.flatMap((topic) =>
    flattenTopicToJitItems(topic, accepted.get(topic.id)!).flatMap((item) =>
      item.kind === "block" ? [item.block] : [],
    ),
  );
  const material = strictLearningMaterialSchema.parse({
    introduction: "",
    blocks,
    keyTakeaways: [],
  });
  if (signal.aborted) throw new Error("cancelled");
  if (
    !(await repository.publish({
      userId,
      id: branch.id,
      token,
      introduction: "",
      blocks: material.blocks,
      transcript,
    }))
  )
    throw new Error("Supplement was cancelled or changed");
}
