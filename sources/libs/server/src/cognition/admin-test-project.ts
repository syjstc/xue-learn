// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { PersistenceClient } from "../persistence/persistence-compat.js";
import { ensureGoalCapstoneProject } from "./goal-capstone.js";
import {
  ensureProjectBlueprint,
  ProjectValidationError,
  type ProjectBlueprint,
  type ProjectCriterionDefinition,
} from "./projects.js";

export const ADMIN_TEST_PROJECT_STABLE_KEY = "project:admin-test:v1" as const;
export const ADMIN_TEST_SKILL_STABLE_KEY = "admin_test:skill:execute" as const;
export const ADMIN_TEST_COMPETENCY_STABLE_KEY =
  "admin_test:competency:adapt" as const;

export type AdminTestProjectMode = "fixture" | "from_model";

export type AdminTestProjectResult =
  | {
      status: "published";
      mode: AdminTestProjectMode;
      goalId: string;
      rootTaskId: string;
      milestoneTaskIds: string[];
      blueprintHash: string;
      title: string;
      entitySource: "existing" | "admin_test";
    }
  | {
      status: "not_ready" | "not_applicable";
      mode: "from_model";
      goalId: string;
      reason?: string;
    };

function criterion(
  ref: string,
  description: string,
  evaluators: ProjectCriterionDefinition["evaluators"] = ["human", "llm"],
  deterministicRule?: ProjectCriterionDefinition["deterministicRule"],
): ProjectCriterionDefinition {
  return {
    ref,
    description,
    evaluators,
    ...(deterministicRule ? { deterministicRule } : {}),
  };
}

export function buildAdminTestBlueprint(
  goalId: string,
  skill: { id: string; definitionVersion: number },
  competency: { id: string; definitionVersion: number },
): ProjectBlueprint {
  const skillReq = {
    cognitiveEntityId: skill.id,
    definitionVersion: skill.definitionVersion,
  };
  const competencyReq = {
    cognitiveEntityId: competency.id,
    definitionVersion: competency.definitionVersion,
  };
  const rootArtifact = criterion(
    "root_portfolio_present",
    "A versioned test portfolio is present.",
    ["deterministic"],
    { type: "artifact_present", deliverableKey: "capstone_portfolio" },
  );
  const rootProcess = criterion(
    "root_process_verification",
    "Process log verifies a referenced artifact version.",
    ["deterministic"],
    {
      type: "process_verification",
      deliverableKey: "capstone_portfolio",
    },
  );
  const rootAssistance = criterion(
    "root_assistance_ceiling",
    "Assistance stays within the declared ceiling.",
    ["deterministic"],
    { type: "assistance_ceiling", maxLevel: "guided", maxEvents: 8 },
  );
  const m1Artifact = criterion(
    "m1_artifact_present",
    "Integrated solution artifact is present.",
    ["deterministic"],
    { type: "artifact_present", deliverableKey: "integrated_solution" },
  );
  const m1Assistance = criterion(
    "m1_assistance_ceiling",
    "Milestone assistance stays within the ceiling.",
    ["deterministic"],
    { type: "assistance_ceiling", maxLevel: "guided", maxEvents: 6 },
  );
  const m1Quality = criterion(
    "m1_integration_quality",
    "Solution coordinates required skills under the stated constraints.",
  );
  const m2Artifact = criterion(
    "m2_artifact_present",
    "Verification record is present.",
    ["deterministic"],
    { type: "artifact_present", deliverableKey: "verification_record" },
  );
  const m2Process = criterion(
    "m2_process_verification",
    "Verification references artifactId@version.",
    ["deterministic"],
    {
      type: "process_verification",
      deliverableKey: "verification_record",
    },
  );
  const m2Quality = criterion(
    "m2_verification_quality",
    "Verification method, observations, and residual risk are explicit.",
  );
  const m3Artifact = criterion(
    "m3_artifact_present",
    "Far-context adaptation artifact is present.",
    ["deterministic"],
    { type: "artifact_present", deliverableKey: "adapted_solution" },
  );
  const m3Process = criterion(
    "m3_process_verification",
    "Adaptation verification references artifactId@version.",
    ["deterministic"],
    {
      type: "process_verification",
      deliverableKey: "adapted_solution",
    },
  );
  const m3Assistance = criterion(
    "m3_assistance_ceiling",
    "Far-transfer assistance stays independent or lightly guided.",
    ["deterministic"],
    { type: "assistance_ceiling", maxLevel: "light_hint", maxEvents: 3 },
  );
  const m3Quality = criterion(
    "m3_far_transfer_quality",
    "Adaptation shows material context difference and transferred principles.",
  );
  const rootCoordination = criterion(
    "root_coordination_quality",
    "Portfolio shows coordinated execution across milestones.",
  );
  const rootTransfer = criterion(
    "root_transfer_quality",
    "Portfolio includes a far-context transfer milestone.",
  );

  return {
    goalId,
    stableKey: ADMIN_TEST_PROJECT_STABLE_KEY,
    title: "Admin test · 项目实战",
    instructions:
      "Admin-created test project for UI and API verification. Complete three milestones: integrate, verify, and far-context transfer. Submit versioned artifacts, process notes that cite artifactId@version, and an assistance trace.",
    difficulty: "medium",
    definitionVersion: 1,
    origin: "admin:test-project",
    projectContext: {
      scenarioKey: "admin_test_project_v1",
      title: "Admin test delivery under constraints",
      description:
        "A synthetic scenario used only for admin testing of the project workspace.",
      domain: "admin-test",
      setting: "versioned-test-project-with-far-context-transfer",
      stakeholders: ["learner", "admin-reviewer"],
    },
    constraints: [
      {
        key: "root_verification_required",
        title: "Verification trail",
        description: rootProcess.description,
        kind: "hard",
        verification: rootProcess,
      },
      {
        key: "root_assistance_limit",
        title: "Assistance ceiling",
        description: rootAssistance.description,
        kind: "hard",
        verification: rootAssistance,
      },
    ],
    deliverables: [
      {
        key: "capstone_portfolio",
        title: "Test portfolio",
        description:
          "Versioned milestone artifacts, process records, and trade-off notes.",
        artifactType: "other",
        required: true,
        acceptanceCriteria: [rootArtifact, rootCoordination, rootTransfer],
      },
    ],
    evidencePolicy: {
      taskKind: "project",
      contextDistance: "far",
      rubricId: "admin_test_project_overall_v1",
    },
    requirements: [
      {
        ...competencyReq,
        dimension: "application",
        criterionRef: "root_coordination_quality",
        role: "primary",
        weight: 2,
        orderIndex: 0,
      },
      {
        ...skillReq,
        dimension: "transfer",
        criterionRef: "root_transfer_quality",
        role: "supporting",
        weight: 1,
        orderIndex: 1,
      },
      {
        ...competencyReq,
        dimension: "application",
        criterionRef: "root_portfolio_present",
        role: "supporting",
        required: false,
        weight: 0.25,
        orderIndex: 2,
      },
    ],
    milestones: [
      {
        orderIndex: 0,
        stableKey: `${ADMIN_TEST_PROJECT_STABLE_KEY}:integrate`,
        title: "Milestone 1: Integrate",
        instructions:
          "Produce an integrated solution under the stated constraints and record how you verified the first version.",
        difficulty: "medium",
        constraints: [
          {
            key: "m1_assistance_limit",
            title: "Assistance ceiling",
            description: m1Assistance.description,
            kind: "hard",
            verification: m1Assistance,
          },
        ],
        deliverables: [
          {
            key: "integrated_solution",
            title: "Integrated solution",
            description:
              "A reviewable artifact with rationale, main output, and version identity.",
            artifactType: "other",
            required: true,
            acceptanceCriteria: [m1Artifact, m1Quality],
          },
        ],
        evidencePolicy: {
          taskKind: "integration",
          contextDistance: "near",
          rubricId: "admin_test_project_integrate_v1",
        },
        requirements: [
          {
            ...skillReq,
            dimension: "application",
            criterionRef: "m1_integration_quality",
            role: "primary",
            weight: 2,
            orderIndex: 0,
          },
          {
            ...skillReq,
            dimension: "application",
            criterionRef: "m1_artifact_present",
            role: "supporting",
            required: false,
            weight: 0.25,
            orderIndex: 1,
          },
          {
            ...competencyReq,
            dimension: "independence",
            criterionRef: "m1_assistance_ceiling",
            role: "supporting",
            required: false,
            weight: 0.5,
            orderIndex: 2,
          },
        ],
        rubric: { phase: "integrate", origin: "admin:test-project" },
      },
      {
        orderIndex: 1,
        stableKey: `${ADMIN_TEST_PROJECT_STABLE_KEY}:verify`,
        title: "Milestone 2: Verify and revise",
        instructions:
          "Design a verification method, cite the checked artifactId@version, decide whether revision is needed, and note residual risk.",
        difficulty: "medium",
        constraints: [
          {
            key: "m2_verification_required",
            title: "Verification required",
            description: m2Process.description,
            kind: "hard",
            verification: m2Process,
          },
        ],
        deliverables: [
          {
            key: "verification_record",
            title: "Verification record",
            description:
              "Methods, observations, version references, revision decision, and residual risk.",
            artifactType: "document",
            required: true,
            acceptanceCriteria: [m2Artifact, m2Quality],
          },
        ],
        evidencePolicy: {
          taskKind: "integration",
          contextDistance: "near",
          rubricId: "admin_test_project_verify_v1",
        },
        requirements: [
          {
            ...skillReq,
            dimension: "application",
            criterionRef: "m2_verification_quality",
            role: "primary",
            weight: 2,
            orderIndex: 0,
          },
          {
            ...skillReq,
            dimension: "application",
            criterionRef: "m2_process_verification",
            role: "supporting",
            required: false,
            weight: 0.5,
            orderIndex: 1,
          },
          {
            ...skillReq,
            dimension: "application",
            criterionRef: "m2_artifact_present",
            role: "supporting",
            required: false,
            weight: 0.25,
            orderIndex: 2,
          },
        ],
        rubric: { phase: "verify", origin: "admin:test-project" },
      },
      {
        orderIndex: 2,
        stableKey: `${ADMIN_TEST_PROJECT_STABLE_KEY}:far-transfer`,
        title: "Milestone 3: Far-context transfer",
        instructions:
          "Choose a new context materially different in domain, constraints, or stakeholders. Decide which principles transfer, adapt the approach, and verify the result.",
        difficulty: "hard",
        constraints: [
          {
            key: "m3_far_context",
            title: "Far-context constraint",
            description: m3Quality.description,
            kind: "hard",
            verification: m3Quality,
          },
          {
            key: "m3_assistance_limit",
            title: "Independent execution",
            description: m3Assistance.description,
            kind: "hard",
            verification: m3Assistance,
          },
          {
            key: "m3_verification_required",
            title: "Verify the adaptation",
            description: m3Process.description,
            kind: "hard",
            verification: m3Process,
          },
        ],
        deliverables: [
          {
            key: "adapted_solution",
            title: "Far-context adaptation",
            description:
              "Context differences, principle selection, tactical adaptation, verification, and version identity.",
            artifactType: "other",
            required: true,
            acceptanceCriteria: [m3Artifact],
          },
        ],
        evidencePolicy: {
          taskKind: "novel_application",
          contextDistance: "far",
          rubricId: "admin_test_project_far_transfer_v1",
        },
        requirements: [
          {
            ...competencyReq,
            dimension: "transfer",
            criterionRef: "m3_far_transfer_quality",
            role: "primary",
            weight: 2,
            orderIndex: 0,
          },
          {
            ...skillReq,
            dimension: "application",
            criterionRef: "m3_process_verification",
            role: "supporting",
            required: false,
            weight: 0.5,
            orderIndex: 1,
          },
          {
            ...skillReq,
            dimension: "application",
            criterionRef: "m3_artifact_present",
            role: "supporting",
            required: false,
            weight: 0.25,
            orderIndex: 2,
          },
          {
            ...competencyReq,
            dimension: "independence",
            criterionRef: "m3_assistance_ceiling",
            role: "supporting",
            required: false,
            weight: 0.5,
            orderIndex: 3,
          },
        ],
        rubric: {
          phase: "far_transfer",
          novelty: "far",
          requiresMaterialContextDifference: true,
          origin: "admin:test-project",
        },
      },
    ],
  };
}

async function ensureAdminTestEntity(
  persistence: PersistenceClient,
  goalId: string,
  input: {
    stableKey: string;
    kind: "skill" | "competency";
    title: string;
    objective: string;
  },
) {
  const scopeKey = `goal:${goalId}`;
  const existing = await persistence.cognitiveEntity.findUnique({
    where: {
      goalId_stableKey: { goalId, stableKey: input.stableKey },
    },
    select: {
      id: true,
      definitionVersion: true,
      status: true,
      construct: { select: { entityId: true } },
    },
  });
  if (existing) {
    if (existing.status !== "active") {
      await persistence.cognitiveEntity.update({
        where: { id: existing.id },
        data: { status: "active" },
      });
    }
    if (!existing.construct) {
      await persistence.cognitiveConstruct.create({
        data: {
          entityId: existing.id,
          constructType: input.kind,
          objective: input.objective,
          inputs: ["need"],
          outputs: ["solution"],
          qualityCriteria: ["correct", "verified"],
          compositionStrategy: {},
        },
      });
    }
    return {
      id: existing.id,
      definitionVersion: existing.definitionVersion,
    };
  }

  const created = await persistence.cognitiveEntity.create({
    data: {
      stableKey: input.stableKey,
      scopeKey,
      kind: input.kind,
      scope: "goal",
      goalId,
      title: input.title,
      description: "Synthetic entity created by admin test project tooling.",
      language: "zh-Hans",
      definitionVersion: 1,
      status: "active",
      provenance: {
        origin: "admin:test-project",
        purpose: "ui_api_fixture",
      },
      construct: {
        create: {
          constructType: input.kind,
          objective: input.objective,
          inputs: ["need"],
          outputs: ["solution"],
          qualityCriteria: ["correct", "verified"],
          compositionStrategy: {},
        },
      },
    },
    select: { id: true, definitionVersion: true },
  });
  return created;
}

async function resolveFixtureEntities(persistence: PersistenceClient, goalId: string) {
  const existing = await persistence.cognitiveEntity.findMany({
    where: {
      goalId,
      status: "active",
      kind: { in: ["skill", "competency"] },
    },
    select: {
      id: true,
      kind: true,
      definitionVersion: true,
    },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  });
  const skill = existing.find((entity) => entity.kind === "skill");
  const competency = existing.find((entity) => entity.kind === "competency");
  if (skill && competency) {
    return {
      skill: { id: skill.id, definitionVersion: skill.definitionVersion },
      competency: {
        id: competency.id,
        definitionVersion: competency.definitionVersion,
      },
      entitySource: "existing" as const,
    };
  }
  if (skill || competency) {
    const primary = skill ?? competency!;
    return {
      skill: { id: primary.id, definitionVersion: primary.definitionVersion },
      competency: {
        id: primary.id,
        definitionVersion: primary.definitionVersion,
      },
      entitySource: "existing" as const,
    };
  }

  const [createdSkill, createdCompetency] = await Promise.all([
    ensureAdminTestEntity(persistence, goalId, {
      stableKey: ADMIN_TEST_SKILL_STABLE_KEY,
      kind: "skill",
      title: "Admin test skill",
      objective: "Execute and verify a solution under constraints.",
    }),
    ensureAdminTestEntity(persistence, goalId, {
      stableKey: ADMIN_TEST_COMPETENCY_STABLE_KEY,
      kind: "competency",
      title: "Admin test competency",
      objective: "Coordinate skills adaptively in a novel context.",
    }),
  ]);
  return {
    skill: createdSkill,
    competency: createdCompetency,
    entitySource: "admin_test" as const,
  };
}

async function publishFixtureProject(
  persistence: PersistenceClient,
  goalId: string,
): Promise<AdminTestProjectResult> {
  const goal = await persistence.learningGoal.findUnique({
    where: { id: goalId },
    select: { id: true },
  });
  if (!goal) {
    throw new ProjectValidationError("not_found", "goal not found");
  }

  const { skill, competency, entitySource } = await resolveFixtureEntities(
    persistence,
    goalId,
  );
  const blueprint = buildAdminTestBlueprint(goalId, skill, competency);
  const published = await ensureProjectBlueprint(persistence, blueprint);
  return {
    status: "published",
    mode: "fixture",
    goalId,
    rootTaskId: published.root.id,
    milestoneTaskIds: published.milestones.map((milestone) => milestone.id),
    blueprintHash: published.blueprintHash,
    title: published.root.title,
    entitySource,
  };
}

async function publishFromModel(
  persistence: PersistenceClient,
  goalId: string,
): Promise<AdminTestProjectResult> {
  const goal = await persistence.learningGoal.findUnique({
    where: { id: goalId },
    select: { id: true },
  });
  if (!goal) {
    throw new ProjectValidationError("not_found", "goal not found");
  }

  const result = await ensureGoalCapstoneProject(persistence, goalId);
  if (result.status === "published") {
    const root = await persistence.learningTask.findUnique({
      where: { id: result.rootTaskId },
      select: { title: true },
    });
    return {
      status: "published",
      mode: "from_model",
      goalId,
      rootTaskId: result.rootTaskId,
      milestoneTaskIds: result.milestoneTaskIds,
      blueprintHash: result.blueprintHash,
      title: root?.title ?? "Goal capstone project",
      entitySource: "existing",
    };
  }
  if (result.status === "not_applicable") {
    return {
      status: "not_applicable",
      mode: "from_model",
      goalId,
      reason: result.reason,
    };
  }
  return {
    status: "not_ready",
    mode: "from_model",
    goalId,
    reason: "cognitive model is not a complete published full snapshot",
  };
}

/**
 * Admin-only helper to create a learner-visible 项目实战 project for testing.
 * `fixture` always publishes a deterministic three-milestone blueprint.
 * `from_model` runs the production capstone projection and may return
 * not_ready / not_applicable without inventing a synthetic project.
 */
export async function createAdminTestProject(
  persistence: PersistenceClient,
  input: { goalId: string; mode?: AdminTestProjectMode },
): Promise<AdminTestProjectResult> {
  const goalId = input.goalId.trim();
  if (!goalId) {
    throw new ProjectValidationError("invalid_blueprint", "goalId is required");
  }
  const mode = input.mode ?? "fixture";
  if (mode === "from_model") {
    return publishFromModel(persistence, goalId);
  }
  if (mode !== "fixture") {
    throw new ProjectValidationError(
      "invalid_blueprint",
      'mode must be "fixture" or "from_model"',
    );
  }
  return publishFixtureProject(persistence, goalId);
}
