// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { PersistenceClient } from "../persistence/persistence-compat.js";
import type { ProjectBlueprintRepository } from "../../../domain/src/index.js";
import { validateCognitiveModelSnapshot } from "../cognitive-model/pure.js";
import type {
  CognitiveDimension,
  CognitiveModelSnapshot,
  SnapshotEntity,
  SnapshotLearningTarget,
  SnapshotTargetRequirement,
} from "../cognitive-model/types.js";
import type { TaskRequirementDeclaration } from "./persistence.js";
import {
  ensureProjectBlueprint,
  ProjectValidationError,
  type ProjectBlueprint,
  type ProjectCriterionDefinition,
  type ProjectMilestoneDefinition,
} from "./projects.js";

const CAPSTONE_BLUEPRINT_VERSION = 1 as const;
const MAX_DIRECT_CONSTRUCTS = 3;

type HighLevelCandidate = {
  entity: SnapshotEntity;
  target: SnapshotLearningTarget;
  targetRequirement: SnapshotTargetRequirement;
};

function localized(
  language: string,
  hans: string,
  hant: string,
  english: string,
): string {
  if (language.toLowerCase().startsWith("zh-hant")) return hant;
  if (language.toLowerCase().startsWith("zh")) return hans;
  return english;
}

function importanceRank(value: string): number {
  if (value === "core") return 0;
  if (value === "supporting") return 1;
  return 2;
}

function dimensionRank(value: CognitiveDimension): number {
  return [
    "transfer",
    "application",
    "independence",
    "understanding",
    "fluency",
    "memory",
    "stability",
  ].indexOf(value);
}

function directHighLevelCandidates(
  snapshot: CognitiveModelSnapshot,
): HighLevelCandidate[] {
  const entityById = new Map(
    snapshot.entities
      .filter(
        (entity) =>
          entity.status === "active" &&
          (entity.kind === "skill" || entity.kind === "competency"),
      )
      .map((entity) => [entity.id, entity]),
  );
  const candidates = snapshot.learningTargets.flatMap((target) =>
    target.requirements.flatMap((requirement) => {
      const entity = entityById.get(requirement.entityId);
      return entity ? [{ entity, target, targetRequirement: requirement }] : [];
    }),
  );
  return candidates.sort(
    (left, right) =>
      Number(right.targetRequirement.required) -
        Number(left.targetRequirement.required) ||
      Number(right.target.mappings.some((mapping) => mapping.isExit)) -
        Number(left.target.mappings.some((mapping) => mapping.isExit)) ||
      (left.entity.kind === right.entity.kind
        ? 0
        : left.entity.kind === "competency"
          ? -1
          : 1) ||
      importanceRank(left.target.importance) -
        importanceRank(right.target.importance) ||
      right.target.importanceWeight - left.target.importanceWeight ||
      dimensionRank(left.targetRequirement.dimension) -
        dimensionRank(right.targetRequirement.dimension) ||
      left.entity.stableKey.localeCompare(right.entity.stableKey) ||
      left.target.stableKey.localeCompare(right.target.stableKey),
  );
}

function selectedCandidates(
  snapshot: CognitiveModelSnapshot,
): HighLevelCandidate[] {
  const selected: HighLevelCandidate[] = [];
  const seenEntities = new Set<string>();
  for (const candidate of directHighLevelCandidates(snapshot)) {
    if (seenEntities.has(candidate.entity.id)) continue;
    selected.push(candidate);
    seenEntities.add(candidate.entity.id);
    if (selected.length >= MAX_DIRECT_CONSTRUCTS) break;
  }
  if (selected.length === 0) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      "a complete cognitive model needs a LearningTarget with a direct skill or competency requirement before publishing a capstone",
    );
  }
  return selected;
}

function candidateForDimension(
  all: readonly HighLevelCandidate[],
  selected: readonly HighLevelCandidate[],
  dimension: CognitiveDimension,
  fallbackIndex = 0,
): HighLevelCandidate {
  return (
    all.find(
      (candidate) => candidate.targetRequirement.dimension === dimension,
    ) ?? selected[Math.min(fallbackIndex, selected.length - 1)]!
  );
}

function taskRequirement(
  candidate: HighLevelCandidate,
  dimension: CognitiveDimension,
  criterionRef: string,
  orderIndex: number,
  options: {
    role?: "primary" | "supporting";
    weight?: number;
    required?: boolean;
  } = {},
): TaskRequirementDeclaration {
  const targetDeclaresDimension =
    candidate.targetRequirement.entityId === candidate.entity.id &&
    candidate.targetRequirement.dimension === dimension;
  return {
    cognitiveEntityId: candidate.entity.id,
    ...(targetDeclaresDimension
      ? { learningTargetId: candidate.target.id }
      : {}),
    dimension,
    criterionRef,
    definitionVersion: candidate.entity.definitionVersion,
    role: options.role ?? "primary",
    required: options.required ?? true,
    weight: options.weight ?? 1,
    orderIndex,
  };
}

function deterministicCriterion(
  ref: string,
  description: string,
  deterministicRule: NonNullable<
    ProjectCriterionDefinition["deterministicRule"]
  >,
): ProjectCriterionDefinition {
  return {
    ref,
    description,
    evaluators: ["deterministic"],
    deterministicRule,
  };
}

function judgmentCriterion(
  ref: string,
  description: string,
): ProjectCriterionDefinition {
  return {
    ref,
    description,
    evaluators: ["human", "llm"],
  };
}

/**
 * Pure, deterministic projection from one complete objective snapshot to a
 * versioned capstone blueprint. It never consults learner state or invents a
 * global atom identity.
 */
export function buildGoalCapstoneBlueprint(
  snapshot: CognitiveModelSnapshot,
  revisionVersion: number,
): ProjectBlueprint {
  validateCognitiveModelSnapshot(snapshot);
  if (
    snapshot.audit.complete !== true ||
    !Number.isInteger(revisionVersion) ||
    revisionVersion <= 0
  ) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      "goal capstone requires a complete published cognitive-model revision",
    );
  }
  const allCandidates = directHighLevelCandidates(snapshot);
  const selected = selectedCandidates(snapshot);
  const primary = selected[0]!;
  const application = candidateForDimension(
    allCandidates,
    selected,
    "application",
  );
  const transfer = candidateForDimension(allCandidates, selected, "transfer");
  const independence = candidateForDimension(
    allCandidates,
    selected,
    "independence",
    1,
  );
  const language = primary.entity.language;
  const entityNames = selected.map((item) => item.entity.title).join("、");
  const keyPrefix = `project:goal-capstone:v${revisionVersion}:${snapshot.inputHash.slice(0, 16)}`;
  const rubricPrefix = `goal_capstone_v${revisionVersion}_${snapshot.inputHash.slice(0, 12)}`;

  const rootArtifact = deterministicCriterion(
    "root_portfolio_present",
    localized(
      language,
      "提交了可版本追踪的综合作品集。",
      "提交了可版本追蹤的綜合作品集。",
      "A versioned capstone portfolio is present.",
    ),
    { type: "artifact_present", deliverableKey: "capstone_portfolio" },
  );
  const rootProcess = deterministicCriterion(
    "root_process_verification",
    localized(
      language,
      "过程记录包含对作品版本的明确验证。",
      "過程記錄包含對作品版本的明確驗證。",
      "The process log verifies a referenced artifact version.",
    ),
    {
      type: "process_verification",
      deliverableKey: "capstone_portfolio",
    },
  );
  const rootAssistance = deterministicCriterion(
    "root_assistance_ceiling",
    localized(
      language,
      "完成过程未超过引导式提示上限。",
      "完成過程未超過引導式提示上限。",
      "Assistance stays at or below the guided ceiling.",
    ),
    { type: "assistance_ceiling", maxLevel: "guided" },
  );
  const rootCoordination = judgmentCriterion(
    "root_coordination_quality",
    localized(
      language,
      `作品能协调运行 ${entityNames}，并解释关键取舍。`,
      `作品能協調運行 ${entityNames}，並解釋關鍵取捨。`,
      `The work coordinates ${entityNames} and explains material trade-offs.`,
    ),
  );
  const rootTransfer = judgmentCriterion(
    "root_far_transfer_quality",
    localized(
      language,
      "学习者能在远情境中选择、调整并验证方案，而非复刻熟悉答案。",
      "學習者能在遠情境中選擇、調整並驗證方案，而非複刻熟悉答案。",
      "The learner selects, adapts, and verifies a solution in a far context rather than copying a familiar answer.",
    ),
  );

  const milestoneOneArtifact = deterministicCriterion(
    "m1_artifact_present",
    localized(
      language,
      "存在一个可审阅的整合方案版本。",
      "存在一個可審閱的整合方案版本。",
      "A reviewable integrated solution version is present.",
    ),
    { type: "artifact_present", deliverableKey: "integrated_solution" },
  );
  const milestoneOneAssistance = deterministicCriterion(
    "m1_assistance_ceiling",
    localized(
      language,
      "整合阶段未超过引导式提示。",
      "整合階段未超過引導式提示。",
      "Integration stays at or below guided assistance.",
    ),
    { type: "assistance_ceiling", maxLevel: "guided" },
  );
  const milestoneOneQuality = judgmentCriterion(
    "m1_integration_quality",
    localized(
      language,
      "方案正确组织所选技能或能力，并满足已声明约束。",
      "方案正確組織所選技能或能力，並滿足已聲明約束。",
      "The solution coordinates the selected skills or competencies and respects declared constraints.",
    ),
  );

  const milestoneTwoArtifact = deterministicCriterion(
    "m2_artifact_present",
    localized(
      language,
      "存在一个版本化验证记录。",
      "存在一個版本化驗證記錄。",
      "A versioned verification record is present.",
    ),
    { type: "artifact_present", deliverableKey: "verification_record" },
  );
  const milestoneTwoProcess = deterministicCriterion(
    "m2_process_verification",
    localized(
      language,
      "至少一次验证步骤明确引用 artifactId@version。",
      "至少一次驗證步驟明確引用 artifactId@version。",
      "At least one verification step references artifactId@version.",
    ),
    {
      type: "process_verification",
      deliverableKey: "verification_record",
    },
  );
  const milestoneTwoQuality = judgmentCriterion(
    "m2_verification_quality",
    localized(
      language,
      "验证方法能发现问题、驱动修正，并解释剩余风险。",
      "驗證方法能發現問題、驅動修正，並解釋剩餘風險。",
      "Verification detects issues, drives revision, and explains residual risk.",
    ),
  );

  const milestoneThreeArtifact = deterministicCriterion(
    "m3_artifact_present",
    localized(
      language,
      "存在一个面向远情境的适配方案版本。",
      "存在一個面向遠情境的適配方案版本。",
      "A far-context adaptation artifact is present.",
    ),
    { type: "artifact_present", deliverableKey: "adapted_solution" },
  );
  const milestoneThreeProcess = deterministicCriterion(
    "m3_process_verification",
    localized(
      language,
      "过程记录验证了远情境适配后的作品版本。",
      "過程記錄驗證了遠情境適配後的作品版本。",
      "The process log verifies the far-context artifact version.",
    ),
    {
      type: "process_verification",
      deliverableKey: "adapted_solution",
    },
  );
  const milestoneThreeAssistance = deterministicCriterion(
    "m3_assistance_ceiling",
    localized(
      language,
      "迁移阶段未超过轻提示，以保留独立性证据。",
      "遷移階段未超過輕提示，以保留獨立性證據。",
      "Transfer stays at or below light hints so independence remains observable.",
    ),
    { type: "assistance_ceiling", maxLevel: "light_hint" },
  );
  const milestoneThreeQuality = judgmentCriterion(
    "m3_far_transfer_quality",
    localized(
      language,
      "适配方案回应了不同领域、约束或利益相关者，并说明哪些原则保持不变、哪些做法必须改变。",
      "適配方案回應了不同領域、約束或利益相關者，並說明哪些原則保持不變、哪些做法必須改變。",
      "The adaptation addresses a different domain, constraint set, or stakeholder group and distinguishes invariant principles from changed tactics.",
    ),
  );

  const milestones: ProjectMilestoneDefinition[] = [
    {
      orderIndex: 0,
      stableKey: `${keyPrefix}:integrate`,
      title: localized(
        language,
        "里程碑 1：整合方案",
        "里程碑 1：整合方案",
        "Milestone 1: Integrate a solution",
      ),
      instructions: localized(
        language,
        `在明确需求与约束后，协调使用 ${entityNames}，形成一个可审阅、可版本追踪的完整方案，并记录关键决策。`,
        `在明確需求與約束後，協調使用 ${entityNames}，形成一個可審閱、可版本追蹤的完整方案，並記錄關鍵決策。`,
        `After defining the need and constraints, coordinate ${entityNames} into a reviewable, versioned solution and record the material decisions.`,
      ),
      difficulty: "hard",
      constraints: [
        {
          key: "m1_assistance_limit",
          title: localized(
            language,
            "提示上限",
            "提示上限",
            "Assistance ceiling",
          ),
          description: milestoneOneAssistance.description,
          kind: "hard",
          verification: milestoneOneAssistance,
        },
      ],
      deliverables: [
        {
          key: "integrated_solution",
          title: localized(
            language,
            "整合方案",
            "整合方案",
            "Integrated solution",
          ),
          description: localized(
            language,
            "一个包含决策依据、主要产出与版本标识的可审阅作品。",
            "一個包含決策依據、主要產出與版本標識的可審閱作品。",
            "A reviewable artifact with decision rationale, the main output, and a version identity.",
          ),
          artifactType: "other",
          required: true,
          acceptanceCriteria: [milestoneOneArtifact, milestoneOneQuality],
        },
      ],
      evidencePolicy: {
        taskKind: "integration",
        contextDistance: "near",
        rubricId: `${rubricPrefix}_integrate`,
      },
      requirements: [
        taskRequirement(
          application,
          "application",
          "m1_integration_quality",
          0,
          {
            weight: 2,
          },
        ),
        taskRequirement(application, "application", "m1_artifact_present", 1, {
          role: "supporting",
          weight: 0.25,
          required: false,
        }),
        taskRequirement(
          independence,
          "independence",
          "m1_assistance_ceiling",
          2,
          { role: "supporting", weight: 0.5, required: false },
        ),
      ],
      rubric: {
        blueprintVersion: CAPSTONE_BLUEPRINT_VERSION,
        phase: "integrate",
      },
    },
    {
      orderIndex: 1,
      stableKey: `${keyPrefix}:verify`,
      title: localized(
        language,
        "里程碑 2：验证与修正",
        "里程碑 2：驗證與修正",
        "Milestone 2: Verify and revise",
      ),
      instructions: localized(
        language,
        "设计验证方法，明确引用被检查的 artifactId@version；根据反馈至少判断一次是否需要修正，并解释剩余风险与取舍。",
        "設計驗證方法，明確引用被檢查的 artifactId@version；根據反饋至少判斷一次是否需要修正，並解釋剩餘風險與取捨。",
        "Design verification, explicitly reference the artifactId@version being checked, decide whether revision is needed, and explain residual risk and trade-offs.",
      ),
      difficulty: "hard",
      constraints: [
        {
          key: "m2_verification_required",
          title: localized(
            language,
            "必须验证",
            "必須驗證",
            "Verification required",
          ),
          description: milestoneTwoProcess.description,
          kind: "hard",
          verification: milestoneTwoProcess,
        },
      ],
      deliverables: [
        {
          key: "verification_record",
          title: localized(
            language,
            "验证记录",
            "驗證記錄",
            "Verification record",
          ),
          description: localized(
            language,
            "记录验证方法、观察结果、版本引用、修正决定与剩余风险。",
            "記錄驗證方法、觀察結果、版本引用、修正決定與剩餘風險。",
            "A record of methods, observations, version references, revision decisions, and residual risk.",
          ),
          artifactType: "document",
          required: true,
          acceptanceCriteria: [milestoneTwoArtifact, milestoneTwoQuality],
        },
      ],
      evidencePolicy: {
        taskKind: "integration",
        contextDistance: "near",
        rubricId: `${rubricPrefix}_verify`,
      },
      requirements: [
        taskRequirement(
          application,
          "application",
          "m2_verification_quality",
          0,
          {
            weight: 2,
          },
        ),
        taskRequirement(
          application,
          "application",
          "m2_process_verification",
          1,
          {
            role: "supporting",
            weight: 0.5,
            required: false,
          },
        ),
        taskRequirement(application, "application", "m2_artifact_present", 2, {
          role: "supporting",
          weight: 0.25,
          required: false,
        }),
      ],
      rubric: { blueprintVersion: CAPSTONE_BLUEPRINT_VERSION, phase: "verify" },
    },
    {
      orderIndex: 2,
      stableKey: `${keyPrefix}:far-transfer`,
      title: localized(
        language,
        "里程碑 3：远情境迁移",
        "里程碑 3：遠情境遷移",
        "Milestone 3: Far-context transfer",
      ),
      instructions: localized(
        language,
        "选择一个与课程练习在领域、约束或利益相关者上有实质差异的新情境。独立判断哪些原则仍适用、哪些策略必须改变，产出适配方案并验证结果；禁止只替换表面名称。",
        "選擇一個與課程練習在領域、約束或利益相關者上有實質差異的新情境。獨立判斷哪些原則仍適用、哪些策略必須改變，產出適配方案並驗證結果；禁止只替換表面名稱。",
        "Choose a new context materially different in domain, constraints, or stakeholders. Independently decide which principles transfer and which tactics must change, produce an adaptation, and verify it; superficial renaming is not sufficient.",
      ),
      difficulty: "hard",
      constraints: [
        {
          key: "m3_far_context",
          title: localized(
            language,
            "远情境约束",
            "遠情境約束",
            "Far-context constraint",
          ),
          description: milestoneThreeQuality.description,
          kind: "hard",
          verification: milestoneThreeQuality,
        },
        {
          key: "m3_assistance_limit",
          title: localized(
            language,
            "独立完成",
            "獨立完成",
            "Independent execution",
          ),
          description: milestoneThreeAssistance.description,
          kind: "hard",
          verification: milestoneThreeAssistance,
        },
        {
          key: "m3_verification_required",
          title: localized(
            language,
            "验证适配",
            "驗證適配",
            "Verify the adaptation",
          ),
          description: milestoneThreeProcess.description,
          kind: "hard",
          verification: milestoneThreeProcess,
        },
      ],
      deliverables: [
        {
          key: "adapted_solution",
          title: localized(
            language,
            "远情境适配方案",
            "遠情境適配方案",
            "Far-context adaptation",
          ),
          description: localized(
            language,
            "包含情境差异、原则选择、策略调整、结果验证与版本标识的作品。",
            "包含情境差異、原則選擇、策略調整、結果驗證與版本標識的作品。",
            "An artifact covering context differences, principle selection, tactical adaptation, verification, and version identity.",
          ),
          artifactType: "other",
          required: true,
          acceptanceCriteria: [milestoneThreeArtifact],
        },
      ],
      evidencePolicy: {
        taskKind: "novel_application",
        contextDistance: "far",
        rubricId: `${rubricPrefix}_far_transfer`,
      },
      requirements: [
        taskRequirement(transfer, "transfer", "m3_far_transfer_quality", 0, {
          weight: 2,
        }),
        taskRequirement(
          application,
          "application",
          "m3_process_verification",
          1,
          {
            role: "supporting",
            weight: 0.5,
            required: false,
          },
        ),
        taskRequirement(application, "application", "m3_artifact_present", 2, {
          role: "supporting",
          weight: 0.25,
          required: false,
        }),
        taskRequirement(
          independence,
          "independence",
          "m3_assistance_ceiling",
          3,
          { role: "supporting", weight: 0.5, required: false },
        ),
      ],
      rubric: {
        blueprintVersion: CAPSTONE_BLUEPRINT_VERSION,
        phase: "far_transfer",
        novelty: "far",
        requiresMaterialContextDifference: true,
      },
    },
  ];

  return {
    goalId: snapshot.goalId,
    stableKey: keyPrefix,
    title: localized(
      language,
      "结课综合实战",
      "結課綜合實戰",
      "Goal capstone project",
    ),
    instructions: localized(
      language,
      `通过整合、验证和远情境迁移三个里程碑，直接展示 ${entityNames} 的协同运行。作品必须可版本追踪，过程必须引用 artifactId@version，并保留提示依赖记录。`,
      `通過整合、驗證和遠情境遷移三個里程碑，直接展示 ${entityNames} 的協同運行。作品必須可版本追蹤，過程必須引用 artifactId@version，並保留提示依賴記錄。`,
      `Directly demonstrate the coordinated operation of ${entityNames} through integration, verification, and far-context transfer. Artifacts must be versioned, process entries must reference artifactId@version, and assistance must remain traceable.`,
    ),
    difficulty: "hard",
    definitionVersion: revisionVersion,
    origin: "generated:goal-capstone",
    projectContext: {
      scenarioKey: `goal_capstone_v${revisionVersion}_${snapshot.inputHash.slice(0, 12)}`,
      title: localized(
        language,
        "真实约束下的综合交付",
        "真實約束下的綜合交付",
        "Integrated delivery under real constraints",
      ),
      description: localized(
        language,
        "学习者需要理解需求、协调知识结构、产出作品、处理反馈、验证结果并解释取舍。",
        "學習者需要理解需求、協調知識結構、產出作品、處理反饋、驗證結果並解釋取捨。",
        "The learner must interpret a need, coordinate cognitive structures, create an artifact, handle feedback, verify results, and explain trade-offs.",
      ),
      domain: selected.map((item) => item.entity.title).join(" / "),
      setting: "versioned-capstone-with-far-context-transfer",
      stakeholders: ["learner", "reviewer"],
    },
    constraints: [
      {
        key: "root_verification_required",
        title: localized(language, "验证链", "驗證鏈", "Verification trail"),
        description: rootProcess.description,
        kind: "hard",
        verification: rootProcess,
      },
      {
        key: "root_assistance_limit",
        title: localized(
          language,
          "提示上限",
          "提示上限",
          "Assistance ceiling",
        ),
        description: rootAssistance.description,
        kind: "hard",
        verification: rootAssistance,
      },
    ],
    deliverables: [
      {
        key: "capstone_portfolio",
        title: localized(
          language,
          "结课作品集",
          "結課作品集",
          "Capstone portfolio",
        ),
        description: localized(
          language,
          "汇总三个里程碑的版本化作品、过程记录、验证结果和取舍说明。",
          "彙總三個里程碑的版本化作品、過程記錄、驗證結果和取捨說明。",
          "A portfolio of versioned milestone artifacts, process records, verification results, and trade-off explanations.",
        ),
        artifactType: "other",
        required: true,
        acceptanceCriteria: [rootArtifact, rootCoordination, rootTransfer],
      },
    ],
    evidencePolicy: {
      taskKind: "project",
      contextDistance: "far",
      rubricId: `${rubricPrefix}_overall`,
    },
    requirements: [
      taskRequirement(primary, "application", "root_coordination_quality", 0, {
        weight: 2,
      }),
      taskRequirement(transfer, "transfer", "root_far_transfer_quality", 1, {
        weight: 2,
      }),
      taskRequirement(primary, "application", "root_portfolio_present", 2, {
        role: "supporting",
        weight: 0.25,
        required: false,
      }),
      taskRequirement(
        application,
        "application",
        "root_process_verification",
        3,
        {
          role: "supporting",
          weight: 0.5,
          required: false,
        },
      ),
      taskRequirement(
        independence,
        "independence",
        "root_assistance_ceiling",
        4,
        { role: "supporting", weight: 0.5, required: false },
      ),
    ],
    rubric: {
      blueprintVersion: CAPSTONE_BLUEPRINT_VERSION,
      cognitiveModelVersion: revisionVersion,
      inputHash: snapshot.inputHash,
      selectedEntityStableKeys: selected.map((item) => item.entity.stableKey),
      sourceLearningTargetStableKeys: [
        ...new Set(selected.map((item) => item.target.stableKey)),
      ],
    },
    milestones,
  };
}

function parseCompleteSnapshot(value: unknown): CognitiveModelSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as CognitiveModelSnapshot;
  try {
    validateCognitiveModelSnapshot(snapshot);
  } catch (error) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      error instanceof Error
        ? `published cognitive-model snapshot is invalid: ${error.message}`
        : "published cognitive-model snapshot is invalid",
    );
  }
  return snapshot.audit.complete === true ? snapshot : null;
}

async function deprecateStaleGoalCapstones(
  persistence: PersistenceClient,
  goalId: string,
  currentBlueprintHash?: string,
): Promise<number> {
  const result = await persistence.learningTask.updateMany({
    where: {
      goalId,
      taskType: "project",
      origin: "generated:goal-capstone",
      status: "active",
      ...(currentBlueprintHash
        ? { projectBlueprintHash: { not: currentBlueprintHash } }
        : {}),
    },
    data: { status: "deprecated" },
  });
  return result.count;
}

/**
 * Publishes exactly one immutable capstone for the current complete model
 * revision. Incomplete skeleton/incremental revisions are a safe no-op.
 */
export async function ensureGoalCapstoneProject(
  persistence: PersistenceClient | null,
  goalId: string,
  projectBlueprintRepository?: ProjectBlueprintRepository,
) {
  const portable = projectBlueprintRepository
    ? await projectBlueprintRepository.findCurrentPublication(goalId)
    : null;
  const goal = portable
    ? {
        id: goalId,
        cognitiveModelStatus: portable.goalStatus,
        cognitiveModelVersion: portable.goalVersion,
        cognitiveModelInputHash: portable.inputHash,
        cognitiveModelPublishedHash: portable.publishedHash,
      }
    : await persistence!.learningGoal.findUnique({
    where: { id: goalId },
    select: {
      id: true,
      cognitiveModelStatus: true,
      cognitiveModelVersion: true,
      cognitiveModelInputHash: true,
      cognitiveModelPublishedHash: true,
    },
  });
  if (!goal) {
    throw new ProjectValidationError("not_found", "goal not found");
  }
  if (
    goal.cognitiveModelStatus !== "ready" ||
    !goal.cognitiveModelPublishedHash ||
    goal.cognitiveModelPublishedHash !== goal.cognitiveModelInputHash
  ) {
    return { status: "not_ready" as const, goalId };
  }
  const revision = portable
    ? portable.revision
    : await persistence!.cognitiveModelRevision.findFirst({
    where: {
      goalId,
      version: goal.cognitiveModelVersion,
      status: "published",
      scope: "full",
      isFullSnapshot: true,
    },
    orderBy: { version: "desc" },
  });
  const snapshot = revision
    ? parseCompleteSnapshot(revision.snapshotJson)
    : null;
  if (
    !revision?.publishedAt ||
    !snapshot ||
    snapshot.goalId !== goalId ||
    snapshot.inputHash !== revision.inputHash ||
    revision.inputHash !== goal.cognitiveModelPublishedHash
  ) {
    return { status: "not_ready" as const, goalId };
  }
  const lessonUnits = snapshot.units.filter(
    (unit) => unit.unitKind === "lesson",
  );
  if (
    lessonUnits.length === 0 ||
    lessonUnits.some(
      (unit) =>
        unit.modelStatus !== "expanded" || unit.learningTargetIds.length === 0,
    )
  ) {
    return { status: "not_ready" as const, goalId };
  }
  if (directHighLevelCandidates(snapshot).length === 0) {
    if (projectBlueprintRepository) {
      await projectBlueprintRepository.deprecateStale({ goalId });
    } else {
      await deprecateStaleGoalCapstones(persistence!, goalId);
    }
    return {
      status: "not_applicable" as const,
      goalId,
      reason: "no_direct_skill_or_competency_learning_target" as const,
    };
  }

  const blueprint = buildGoalCapstoneBlueprint(snapshot, revision.version);
  const published = await ensureProjectBlueprint(
    persistence,
    blueprint,
    projectBlueprintRepository,
  );
  const deprecatedTaskCount =
    "deprecatedTaskCount" in published
      ? published.deprecatedTaskCount
      : await deprecateStaleGoalCapstones(
          persistence!,
          goalId,
          published.blueprintHash,
        );
  return {
    status: "published" as const,
    goalId,
    cognitiveModelVersion: revision.version,
    blueprintHash: published.blueprintHash,
    rootTaskId: published.root.id,
    milestoneTaskIds: published.milestones.map((milestone) => milestone.id),
    deprecatedTaskCount,
  };
}
