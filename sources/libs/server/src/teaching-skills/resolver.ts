import { createHash } from "node:crypto";
import { z } from "zod";
import { getEmbeddings } from "../llm/client.js";
import {
  ensureLlmRuntimeConfig,
  getLlmRuntimeConfig,
} from "../llm/runtime-config.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { requireTeachingSkillRuntimePersistence } from "./persistence.js";

/** Keep vector skill queries short; BigModel also truncates under its token cap. */
const TEACHING_SKILL_VECTOR_QUERY_MAX_CHARS = 2000;

export const teachingSkillSelectionSchema = z.object({
  skills: z
    .array(
      z.object({
        skillId: z.string(),
        confidence: z.number().min(0).max(1),
        reason: z.string().trim().min(1),
      }),
    )
    .max(3),
  reason: z.string().trim().min(1),
});

type Candidate = {
  skillId: string;
  slug: string;
  name: string;
  description: string;
  topicCategory: string;
  domainPaths: unknown;
  tags: unknown;
  learningModes: unknown;
  score: number;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function teachingSkillSelectionInputHash(params: {
  title: string;
  level: string;
  generationOptions?: string;
  sourceSummary?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: params.title.trim(),
        level: params.level,
        generationOptions: params.generationOptions?.trim() ?? "",
        sourceSummary: params.sourceSummary?.trim().slice(0, 4000) ?? "",
      }),
    )
    .digest("hex");
}

async function candidateSet(query: string): Promise<Candidate[]> {
  let vector: number[] | null = null;
  let identity: { provider: string; model: string } | undefined;
  try {
    await ensureLlmRuntimeConfig();
    const runtime = getLlmRuntimeConfig();
    identity = {
      provider: runtime.embeddingProvider,
      model: runtime.embeddingModel,
    };
    const embeddings = await getEmbeddings();
    vector = await embeddings.embedQuery(
      query.slice(0, TEACHING_SKILL_VECTOR_QUERY_MAX_CHARS),
    );
  } catch {
    // Lexical candidate selection remains available without embeddings.
  }
  return [
    ...(await requireTeachingSkillRuntimePersistence().findCandidates(
      query,
      vector,
      identity,
    )),
  ];
}

async function generalSkill() {
  const skill =
    await requireTeachingSkillRuntimePersistence().findGeneralSkill();
  if (!skill) throw new Error("General teaching skill is unavailable");
  return skill;
}

export async function resolveTeachingSkillForGoal(params: {
  goalId: string;
  title: string;
  level: string;
  generationOptions?: string;
  sourceSummary?: string;
  force?: boolean;
  persist?: boolean;
  /** Continue the learner-confirmed durable goal-authoring transcript. */
  authoringAgent?: { userId: string };
}) {
  const inputHash = teachingSkillSelectionInputHash(params);
  const persistence = requireTeachingSkillRuntimePersistence();
  const existing = await persistence.findPrimaryBinding(params.goalId);
  // A goal's primary teaching skill is a durable pedagogical decision. Later
  // module and unit generation often supplies narrower context, but that must
  // not silently replace the goal-wide binding. Goal revisions that genuinely
  // need a different skill must request reselection explicitly with `force`.
  if (existing && !params.force) {
    return existing;
  }

  await persistence.ensureBuiltins();

  const query = [
    params.title,
    `Learner level: ${params.level}`,
    params.generationOptions,
    params.sourceSummary,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000);
  // The independent Godot sidecar uses the protected built-in teaching prompt.
  // Process identity survives durable background jobs; HTTP headers do not.
  const candidates = process.env.XUELEARN_CLIENT_KIND === "godot"
    ? []
    : await candidateSet(query);
  let selectedSpecialists: Array<{
    skillId: string;
    confidence: number;
    reason: string;
  }> = [];
  let reason = "No specialist teaching skill matched; use general teaching.";
  if (candidates.length > 0) {
    try {
      const candidatePrompt = candidates
        .map(
          (candidate) =>
            `- id=${candidate.skillId}; ${candidate.name}; category=${candidate.topicCategory}; paths=${strings(candidate.domainPaths).join(",")}; modes=${strings(candidate.learningModes).join(",")}; tags=${strings(candidate.tags).join(",")}; ${candidate.description}`,
        )
        .join("\n");
      const offeredIds = new Set(
        candidates.map((candidate) => candidate.skillId),
      );
      const authoringSelectionSchema = teachingSkillSelectionSchema.superRefine(
        (selection, ctx) => {
          const seen = new Set<string>();
          for (const [index, skill] of selection.skills.entries()) {
            if (!offeredIds.has(skill.skillId)) {
              ctx.addIssue({
                code: "custom",
                path: ["skills", index, "skillId"],
                message: "Skill id was not offered",
              });
            }
            if (seen.has(skill.skillId)) {
              ctx.addIssue({
                code: "custom",
                path: ["skills", index, "skillId"],
                message: "Skill id must be unique",
              });
            }
            if (skill.confidence < 0.65) {
              ctx.addIssue({
                code: "custom",
                path: ["skills", index, "confidence"],
                message: "Selected specialist confidence must be at least 0.65",
              });
            }
            seen.add(skill.skillId);
          }
        },
      );
      const selection = params.authoringAgent
        ? await (
            await import("../goal-authoring/runner.js")
          ).runGoalAuthoringRound({
            userId: params.authoringAgent.userId,
            goalId: params.goalId,
            expectedTool: "commit_goal_teaching_skill",
            prompt: `Select up to three complementary specialist domain-teaching skills for this confirmed learning goal, ordered from primary to secondary.
Choose multiple skills only when the goal genuinely spans distinct domains that need different teaching methods. Avoid redundant or weakly related helpers. Do not select language-learning for linguistics or literature, or coding-by-building for purely theoretical computer science. Return an empty skills list when no specialist is a confident match.

Goal context:
${query}

Candidates:
${candidatePrompt}`,
            resultSchema: authoringSelectionSchema,
            operation: "goal.authoring_agent",
            meta: {
              goalId: params.goalId,
              candidateCount: candidates.length,
              decisionKind: "teaching_skill_selection",
            },
          })
        : await runValidatedStructuredGeneration({
            mode: "object",
            schema: teachingSkillSelectionSchema,
            prompt: "",
            options: {
              operation: "goal.teaching_skill.select",
              bindingSchema: teachingSkillSelectionSchema,
              schemaShape:
                '{"skills":[{"skillId":"offered id","confidence":0.0,"reason":"brief reason"}],"reason":"brief overall reason"}',
              meta: {
                goalId: params.goalId,
                candidateCount: candidates.length,
              },
            },
            contextSubject: { goalId: params.goalId },
            contextQuery: query.slice(0, 2_000),
            contextInvocation: {
              goalContext: query,
              candidates: candidatePrompt,
            },
          });
      const seen = new Set<string>();
      selectedSpecialists = selection.skills.filter((skill) => {
        if (
          skill.confidence < 0.65 ||
          !offeredIds.has(skill.skillId) ||
          seen.has(skill.skillId)
        ) {
          return false;
        }
        seen.add(skill.skillId);
        return true;
      });
      if (selectedSpecialists.length > 0) reason = selection.reason;
    } catch {
      // Fail closed to the protected general skill.
    }
  }
  const specialistRows = selectedSpecialists.length
    ? await persistence.findSkills(
        selectedSpecialists.map((skill) => skill.skillId),
      )
    : [];
  const specialistsById = new Map(
    specialistRows.map((skill) => [skill.id, skill]),
  );
  const selectedSkills = selectedSpecialists.flatMap((selection) => {
    const skill = specialistsById.get(selection.skillId);
    return skill ? [{ skill, ...selection }] : [];
  });
  const primarySelection = selectedSkills[0];
  const primary = primarySelection?.skill ?? (await generalSkill());
  if (params.persist === false) {
    return {
      preview: true,
      skill: primary,
      skills: selectedSkills.length
        ? selectedSkills.map(({ skill, confidence, reason: skillReason }) => ({
            skill,
            confidence,
            reason: skillReason,
          }))
        : [{ skill: primary, confidence: 0, reason }],
      selectionSource: "automatic",
      selectionReason: reason,
      selectionConfidence: primarySelection?.confidence ?? 0,
      selectionInputHash: inputHash,
      candidates,
    };
  }
  const binding = await persistence.saveAutomaticBindings({
    goalId: params.goalId,
    inputHash,
    reason,
    primary: {
      skillId: primary.id,
      confidence: primarySelection?.confidence ?? 0,
      reason: primarySelection?.reason ?? reason,
    },
    helpers: selectedSkills.slice(1).map(({ skill, confidence, reason }) => ({
      skillId: skill.id,
      confidence,
      reason,
    })),
  });
  if (params.authoringAgent) {
    await (
      await import("../goal-authoring/runner.js")
    ).ensureGoalAuthoringTeachingSkillFallback({
      userId: params.authoringAgent.userId,
      goalId: params.goalId,
      reason,
    });
  }
  return binding;
}

export async function setTeachingSkillForGoal(params: {
  goalId: string;
  skillId: string;
  adminLocked: boolean;
}) {
  const binding =
    await requireTeachingSkillRuntimePersistence().setPrimaryBinding(params);
  if (!binding) throw new Error("Published teaching skill not found");
  return binding;
}
