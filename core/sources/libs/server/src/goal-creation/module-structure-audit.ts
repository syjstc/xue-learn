import { GOAL_DIRECTED_TEACHING_POLICY } from "./teaching-policy.js";
import { z } from "zod";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { readUploadedPlanningSources } from "../rag/planning-sources.js";
import { tBackend } from "../../../common/src/index.js";

export const moduleStructureAuditIssueCodes = [
  "goal_drift",
  "target_level_downgrade",
  "untaught_prerequisite",
  "insufficient_practice",
  "coverage_gap",
  "duplicate_scope",
  "dependency_error",
  "missing_blueprint_phase",
  "inappropriate_lesson_merge",
  "too_fine_grain",
  "language_inconsistency",
] as const;

export const moduleStructureAuditFindingSchema = z.object({
  moduleId: z.string().trim().min(1).max(80),
  issueCode: z.enum(moduleStructureAuditIssueCodes),
  reason: z.string().trim().min(1).max(800),
});

export const moduleStructureAuditResultSchema = z.object({
  passed: z.boolean(),
  findings: z.array(moduleStructureAuditFindingSchema).max(32),
});

export type ModuleStructureAuditResult = z.infer<
  typeof moduleStructureAuditResultSchema
>;

export type ModuleStructureAuditDraft = {
  moduleId: string;
  title: string;
  candidateJson: string;
};

const MAX_UNIT_SUMMARY_CHARS = 600;
const MAX_UNITS_PER_MODULE = 20;

export const MODULE_STRUCTURE_AUDIT_INSTRUCTION = `Audit the complete unpublished module-and-unit catalog for one confirmed learning goal.
${GOAL_DIRECTED_TEACHING_POLICY}
The confirmed contract and frozen blueprint are already in this conversation prefix; do not restate them.
Judge the whole catalog together, not each module in isolation:
- Coverage: every blueprint phase/capability has a home; the ordered units can actually reach the goal outcome.
- When current uploaded sources are supplied, check every required source section against the actual catalog and coverage rationales. They supply evidence absent from older conversation excerpts; re-evaluate old source-availability findings instead of repeating them. Coverage rationales are claims to verify, not approval. Equivalent lesson wording is valid when the specified scope is actually taught. Report concrete missing requirements against the modules responsible for teaching them, not an arbitrary first module for a whole-catalog evidence issue.
- Sequence: later units depend on earlier ones; modules do not assume unpublished later skills. First-principles / understanding order is valid; do not fail a catalog for skipping textbook chapter order.
- The supplied catalog is in curriculum order. Use this order, not module ids or an older inventory in the conversation.
- knowledgeSequence.dependsOnUnits contains one-based earlier unit positions within THIS module only. Never require cross-module references in this field. An empty array is valid when prerequisites come from earlier modules; verify those prerequisites against the earlier modules' actual taught content. Still flag knowledge that has not been taught before first use unless foundationsToTeachFirst supplies it.
- Duplication: no two units (across modules) teach the same lesson under different titles. For each later unit, identify its distinct new ability, reasoning, condition or application; flag duplicate_scope when it mainly repeats an earlier definition, background or worked solution with new wording. A shared concept alone is not duplication. Brief prerequisite reminders, minimum missing bridges, purposeful retrieval, progressively harder worked applications and explicitly requested review are valid. Check prerequisites within each lesson summary and across the complete ordered catalog.
- Grain: each unit is one teachable lesson that matches the confirmed goal's actual scope. Flag collapsed distinct milestones as inappropriate_lesson_merge. Flag textbook padding, proof-substep lessons, and over-split chapters as too_fine_grain. Missing coverage is coverage_gap.
- Language: unit titles and summaries match the goal content language.
Return only server-valid moduleId values supplied in the invocation and the declared issue codes.
Do not rewrite valid modules. Do not invent new module ids. Never reveal private reasoning.`;

function compactText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function readUnits(candidate: unknown): ReadonlyArray<{
  title: string;
  contentSummary: string;
  milestoneRole: string;
  knowledgeSequence: string;
}> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return [];
  }
  const units = (candidate as { units?: unknown }).units;
  if (!Array.isArray(units)) return [];
  return units.slice(0, MAX_UNITS_PER_MODULE).flatMap((unit) => {
    if (!unit || typeof unit !== "object" || Array.isArray(unit)) return [];
    const record = unit as Record<string, unknown>;
    const title = compactText(record.title, 80);
    if (!title) return [];
    return [
      {
        title,
        contentSummary: compactText(
          record.contentSummary,
          MAX_UNIT_SUMMARY_CHARS,
        ),
        milestoneRole: compactText(record.milestoneRole, 40),
        knowledgeSequence: record.knowledgeSequence
          ? JSON.stringify(record.knowledgeSequence)
          : "",
      },
    ];
  });
}

export function formatModuleStructureAuditInventory(
  drafts: ReadonlyArray<ModuleStructureAuditDraft>,
): string {
  return drafts
    .map((draft, index) => {
      let candidate: unknown = null;
      try {
        candidate = JSON.parse(draft.candidateJson);
      } catch {
        candidate = null;
      }
      const kind =
        candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        typeof (candidate as { kind?: unknown }).kind === "string"
          ? String((candidate as { kind: string }).kind)
          : "unknown";
      const units = readUnits(candidate);
      const coverage =
        candidate && typeof candidate === "object" && !Array.isArray(candidate) &&
        typeof (candidate as { coverageRationale?: unknown }).coverageRationale === "string"
          ? (candidate as { coverageRationale: string }).coverageRationale.trim()
          : "";
      const unitLines =
        units.length === 0
          ? "    (no units)"
          : units
              .map((unit, unitIndex) => {
                const role = unit.milestoneRole
                  ? ` [${unit.milestoneRole}]`
                  : "";
                const summary = unit.contentSummary
                  ? ` — ${unit.contentSummary}`
                  : "";
                return `    ${unitIndex + 1}. ${unit.title}${role}${summary}${unit.knowledgeSequence ? `\n       Knowledge sequence: ${unit.knowledgeSequence}` : ""}`;
              })
              .join("\n");
      return `${index + 1}. ${draft.moduleId} ${draft.title} (${kind}, ${units.length} units)\n${unitLines}${coverage ? `\n    Source/exit coverage rationale (verify against the lessons): ${coverage}` : ""}`;
    })
    .join("\n\n");
}

export async function auditGoalModuleStructures(input: {
  goalId: string;
  userId?: string;
  learningMode?: "exploration" | "mastery";
  planningMode?: string;
  drafts: ReadonlyArray<ModuleStructureAuditDraft>;
  signal?: AbortSignal;
}): Promise<ModuleStructureAuditResult> {
  const sources = input.planningMode === "docs_first"
    ? await readUploadedPlanningSources(input.goalId)
    : undefined;
  if (sources && !sources.context) {
    throw new Error(tBackend("error.goal.docsRequired"));
  }
  const modeInstruction =
    input.learningMode === "exploration"
      ? "This goal uses exploration mode. Do not require graded assessments, evidence contracts, or mastery gates. If the confirmed objective calls for independent application or analysis, check that the catalog offers a concrete ungraded learner-produced attempt on new material plus feedback or a comparison for revision. A worked demonstration alone does not satisfy that confirmed outcome."
      : "For mastery mode, check that the catalog supports the confirmed observable exit abilities and appropriate verification opportunities.";
  const prompt = `${modeInstruction}${sources ? `\n\nCurrent uploaded source evidence for this audit:\n${sources.context}` : ""}\n\nUnpublished module-and-unit catalog:
${formatModuleStructureAuditInventory(input.drafts)}

Return passed=true with an empty findings list when the complete catalog is coherent. Otherwise list only the flagged moduleId values.`;

  if (input.userId) {
    const { runGoalAuthoringRound } =
      await import("../goal-authoring/runner.js");
    return runGoalAuthoringRound({
      userId: input.userId,
      goalId: input.goalId,
      branchId: "audit",
      expectedTool: "commit_module_audit",
      prompt: `${MODULE_STRUCTURE_AUDIT_INSTRUCTION}\n\n${prompt}`,
      resultSchema: moduleStructureAuditResultSchema,
      operation: "goal.authoring_agent",
      signal: input.signal,
      meta: { goalId: input.goalId, moduleCount: input.drafts.length },
    });
  }

  return runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: moduleStructureAuditResultSchema,
      prompt: `${MODULE_STRUCTURE_AUDIT_INSTRUCTION}\n\n${prompt}`,
      options: {
        operation: "goal.module_structure.audit",
        bindingSchema: moduleStructureAuditResultSchema,
        meta: {
          goalId: input.goalId,
          moduleCount: input.drafts.length,
        },
      },
      contextSubject: {
        ...(input.userId ? { userId: input.userId } : {}),
        goalId: input.goalId,
      },
      contextQuery: input.goalId,
    },
    { signal: input.signal },
  );
}

export function sanitizeAuditFindings(
  result: ModuleStructureAuditResult,
  validModuleIds: ReadonlySet<string>,
): ModuleStructureAuditResult {
  const findings = result.findings.filter((finding) =>
    validModuleIds.has(finding.moduleId),
  );
  // Never convert a failed or malformed audit into approval by filtering ids.
  if ((!result.passed || result.findings.length > 0) && findings.length === 0) {
    for (const moduleId of validModuleIds) {
      findings.push({
        moduleId,
        issueCode: "coverage_gap",
        reason:
          "Audit did not pass but supplied no actionable valid module reference. Re-audit destination coverage and prerequisite order before publishing.",
      });
    }
  }
  return {
    passed: result.passed && result.findings.length === 0,
    findings,
  };
}
