import { createHash } from "node:crypto";
import { isAdvancedHtmlDiagramsEnabled } from "../../../common/src/index.js";
import {
  getPhysicsExperiment,
  normalizePhysicsLabDefinition,
  type PhysicsExperimentId,
  type UnitLabRecord,
  type UnitLabRepository,
  getChemistryExperiment,
  normalizeChemistryLabDefinition,
  type ChemistryExperimentId,
} from "../../../domain/src/index.js";
import { compileComponentIntent } from "../llm/course-material-component-compiler.js";
import { generateCourseInteractiveHtml } from "../llm/course-material-html-generator.js";
import {
  LAB_ACTIVITY_COMPONENT_TYPES,
  type ComponentCategorySelection,
  type PlannedComponent,
} from "../llm/component-dsl-registry.js";
import { sqPreviewResponseSchema, type InteractiveBlock } from "../llm/schemas.js";
import { getAggregatedUnitMaterial } from "../sections/index.js";
import { runGenerationContextScope } from "../generation/kernel.js";
import { runWithUserId } from "../user-context.js";
import { parseUnitLabDefinition, type UnitLabItem } from "./schema.js";
import {
  manifestFromLegacyLabBlock,
  validateCertifiedLabManifest,
} from "./manifest.js";
import {
  LAB_COMPONENT_TYPES,
  labSceneSchema,
  validateLabManifest,
  type LabManifestV1,
} from "../../../lab-protocol/src/index.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { parseVerifiedLabBlock, verifyLabInteractiveBlock } from "./verify.js";

type Client = UnitLabRepository;
type LabItemPlan = {
  id: string;
  componentType:
    PlannedComponent["componentType"] | "interactive_html" | "physics_lab";
  description: string;
};

export const UNIT_LAB_PREPARE_EVENT = "unit.lab.prepare";

function parseSurvey(raw: string | null) {
  if (!raw) return null;
  try {
    return sqPreviewResponseSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function plannedLabComponents(
  planned: readonly PlannedComponent[] | undefined,
): PlannedComponent[] {
  return (planned ?? []).filter((component) =>
    LAB_ACTIVITY_COMPONENT_TYPES.has(component.componentType),
  );
}

/** Survey lab slots first; otherwise synthesize only a matching domain lab. */
export function labCompilePlanFromSurvey(
  selection: ComponentCategorySelection | undefined,
  unitTitle: string,
): LabItemPlan[] {
  const fromSurvey = plannedLabComponents(selection?.plannedComponents);
  if (fromSurvey.length > 0) {
    return fromSurvey.map((item) =>
      item.componentType === "mechanics_sandbox"
        ? { ...item, componentType: "physics_lab" as const }
        : item,
    );
  }
  const title = unitTitle.trim() || "本课";
  const enabled = new Set(selection?.enabledCategories ?? []);
  const chemistryIntent =
    /(?:化学|酸碱|指示剂|滴定|沉淀|质量守恒|chemical|titration|precipitation|indicator)/iu.test(
      title,
    );
  const family: LabItemPlan["componentType"] =
    selection?.mainCategory === "chemistry_lab" || chemistryIntent
      ? "chemistry_lab"
      : selection?.mainCategory === "circuit_lab" || enabled.has("circuit_lab")
        ? "circuit_sandbox"
        : enabled.has("chemistry_lab")
          ? "chemistry_lab"
          : selection?.mainCategory === "mechanics_lab" ||
              enabled.has("mechanics_lab")
            ? "physics_lab"
            : null;
  if (!family) return [];
  const description =
    family === "circuit_sandbox"
      ? `搭建并测量与「${title}」相关的直流电路实验。`
      : family === "chemistry_lab"
        ? `运行与「${title}」相关的认证化学实验，观察颜色、沉淀、滴定或质量变化。`
        : family === "physics_lab"
          ? `用物理沙箱实验「${title}」的核心运动或受力关系。`
          : "";
  return [{ id: "component_1", componentType: family, description }];
}

/** Desktop-local HTML playgrounds still compile when no domain lab matches. */
export function htmlLabCompileSources(
  labPlan: readonly LabItemPlan[],
  unitTitle: string,
): LabItemPlan[] {
  if (labPlan.length > 0) return labPlan.slice(0, 3);
  const title = unitTitle.trim() || "本课";
  return [
    {
      id: "component_1",
      componentType: "interactive_html",
      description: `围绕「${title}」做一个可操作的互动实验，帮助巩固刚学的内容。`,
    },
  ];
}

export async function recommendUnitLabFromSurvey(
  client: Client,
  unitId: string,
) {
  const source = await client.findContext({ unitId });
  const selection = source?.sq3rData
    ? parseSurvey(source.sq3rData)?.componentSelection
    : undefined;
  const labPlan = plannedLabComponents(selection?.plannedComponents);
  const recommended =
    selection?.mainCategory === "mechanics_lab" ||
    selection?.mainCategory === "circuit_lab" ||
    selection?.mainCategory === "chemistry_lab" ||
    labPlan.length > 0;
  if (!recommended) return null;
  const recommendation =
    labPlan[0]?.description ||
    selection?.rationale ||
    "这个单元适合用互动实验巩固刚学的内容。";
  return client.recommend({ unitId, recommendation });
}

export async function invalidateUnitLab(client: Client, unitId: string) {
  return client.invalidate(unitId);
}

export async function enqueueRecommendedUnitLab(params: {
  client: Client;
  userId: string;
  unitId: string;
}) {
  const lab = await params.client.findLab(params.unitId);
  if (
    !lab?.recommended ||
    lab.status === "ready" ||
    lab.status === "prepared"
  ) {
    return false;
  }
  return params.client.enqueue({
    type: UNIT_LAB_PREPARE_EVENT,
    payloadJson: JSON.stringify({
      userId: params.userId,
      unitId: params.unitId,
      recommendationUpdatedAt: lab.updatedAt.toISOString(),
    }),
  });
}

function materialExcerpt(source: Awaited<ReturnType<Client["findContext"]>>) {
  if (!source?.legacyMaterial) return "";
  return [
    source.legacyMaterial.introduction,
    source.legacyMaterial.sections,
    source.legacyMaterial.keyTakeaways,
  ]
    .join("\n")
    .slice(0, 8_000);
}

export async function prepareUnitLab(params: {
  client: Client;
  userId: string;
  unitId: string;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (phase: string, message: string) => void | Promise<void>;
}) {
  const { client, userId, unitId, signal, onProgress } = params;
  const source = await client.findContext({ userId, unitId });
  if (!source) throw new Error("单元不存在");
  const existing = await client.findLab(unitId);
  if (
    !params.force &&
    existing &&
    (existing.status === "ready" || existing.status === "prepared") &&
    parseUnitLabDefinition(existing.definitionJson)
  ) {
    return {
      lab: parseUnitLabDefinition(existing.definitionJson),
      revision: existing.revision,
      status: existing.status,
      contentRevision: source.unit.contentRevision,
    };
  }
  const selection = parseSurvey(source.sq3rData)?.componentSelection;
  const labPlan = labCompilePlanFromSurvey(selection, source.unit.title);
  const recommendation =
    existing?.recommendation ||
    labPlan[0]?.description ||
    selection?.rationale ||
    "互动实验";
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({
        unitId,
        revision: source.unit.contentRevision,
        plan: labPlan.map((item) => [
          item.id,
          item.componentType,
          item.description,
        ]),
      }),
    )
    .digest("hex");
  const preparing = await client.beginPreparation({
    unitId,
    revision: (existing?.revision ?? 0) + 1,
    source: existing?.recommended ? "recommended" : "manual",
    recommended: existing?.recommended ?? false,
    recommendation,
    inputHash,
  });
  const htmlEnabled = isAdvancedHtmlDiagramsEnabled(
    process.env.XUELEARN_DESKTOP_LOCAL === "1",
  );
  try {
    await onProgress?.("lab", "正在编译实验室互动组件…");
    const aggregated = await getAggregatedUnitMaterial(unitId).catch(() => null);
    const context = [
      source.unit.title,
      source.unit.contentSummary,
      materialExcerpt(source),
      aggregated ? JSON.stringify(aggregated).slice(0, 6_000) : "",
    ].join("\n");
    const items: UnitLabItem[] = [];
    for (const planned of labPlan) {
      items.push(
        await compileLabItem({
          planned,
          unitTitle: source.unit.title,
          language: "zh-Hans",
          context,
          signal,
        }),
      );
    }
    if (htmlEnabled) {
      for (const planned of htmlLabCompileSources(labPlan, source.unit.title)) {
        items.push(
          await compileHtmlLabItem({
            planned,
            unitTitle: source.unit.title,
            language: "zh-Hans",
            context,
            signal,
          }),
        );
      }
    }
    const publishedItems = items.slice(0, 8);
    const readyCount = publishedItems.filter(
      (item) => item.status === "ready",
    ).length;
    const definition = {
      type: "unit_lab" as const,
      schemaVersion: 2 as const,
      title: "会学实验室",
      summary: recommendation.slice(0, 500) || "互动实验",
      items: publishedItems,
    };
    if (readyCount === 0) {
      const error =
        items[0]?.error ||
        (labPlan.length === 0 && !htmlEnabled
          ? "本课没有可编译的实验类型"
          : "实验室组件编译失败");
      await client.markFailed({
        labId: preparing.id,
        error,
      });
      return {
        lab: definition,
        revision: preparing.revision,
        status: "failed" as const,
        contentRevision: source.unit.contentRevision,
        generationError: error,
      };
    }
    await client.publishPrepared({
      labId: preparing.id,
      definitionJson: definition,
    });
    const contentRevision = await client.bumpContentRevision(unitId);
    return {
      lab: definition,
      revision: preparing.revision,
      status: "ready" as const,
      contentRevision,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message =
      error instanceof Error ? error.message : "实验室组件编译失败";
    await client.markFailed({ labId: preparing.id, error: message });
    return {
      lab: null,
      revision: preparing.revision,
      status: "failed" as const,
      contentRevision: source.unit.contentRevision,
      generationError: message,
    };
  }
}

async function compileLabItem(params: {
  planned: LabItemPlan;
  unitTitle: string;
  language: string;
  context: string;
  signal?: AbortSignal;
}): Promise<UnitLabItem> {
  const id = params.planned.id.startsWith("lab_")
    ? params.planned.id
    : `lab_${params.planned.id}`;
  try {
    if (params.planned.componentType === "physics_lab") {
      return compilePhysicsLabItem(params);
    }
    if (params.planned.componentType === "chemistry_lab") {
      return compileChemistryLabItem(params);
    }
    const block = await compileComponentIntent({
      intent: {
        type: params.planned.componentType as PlannedComponent["componentType"],
        description: params.planned.description,
      },
      unitTitle: params.unitTitle,
      language: params.language,
      context: params.context,
      signal: params.signal,
      meta: { labItemId: id },
    });
    return toLabItem(id, params.planned, block);
  } catch (error) {
    if (params.signal?.aborted) throw error;
    return failedItem(id, params.planned, error);
  }
}

function physicsExperimentForText(text: string): PhysicsExperimentId {
  const value = text.toLowerCase();
  if (/碰撞|动量|冲量/.test(value)) return "collision_1d";
  if (/单摆|摆长|摆动/.test(value)) return "simple_pendulum";
  if (/弹簧|共振|阻尼|受迫/.test(value)) return "driven_damped_spring";
  if (/抛体|斜抛|平抛|弹道/.test(value)) return "projectile_motion";
  if (/波|干涉|驻波|拍频/.test(value)) return "wave_interference";
  if (/气体|热力|等温|绝热|pv/.test(value)) return "ideal_gas_process";
  if (/静电|电场|等势|库仑/.test(value)) return "electrostatic_field";
  if (/感应|磁通|法拉第|楞次/.test(value)) return "electromagnetic_induction";
  if (/透镜|成像|焦距/.test(value)) return "thin_lens_imaging";
  if (/双缝|杨氏|条纹/.test(value)) return "double_slit_interference";
  if (/量子|隧穿|势垒/.test(value)) return "quantum_tunneling_1d";
  return "inclined_plane_friction";
}

function chemistryExperimentForText(text: string): ChemistryExperimentId {
  if (/滴定|当量点|titration|endpoint/i.test(text))
    return "acid_base_titration";
  if (/沉淀|硝酸银|氯化钠|precipitation/i.test(text))
    return "precipitation_reaction";
  if (/质量守恒|称量|mass\s+conservation/i.test(text))
    return "mass_conservation";
  return "acid_base_indicator";
}

async function generateLabScene(params: {
  manifest: LabManifestV1;
  unitTitle: string;
  context: string;
  signal?: AbortSignal;
}): Promise<LabManifestV1["scene"] | null> {
  const actionIds = params.manifest.actionIds.join(", ");
  const prompt = [
    "You are authoring a safe declarative virtual-lab scene.",
    `Experiment: ${params.manifest.experimentId} (${params.manifest.domain})`,
    `Unit: ${params.unitTitle}`,
    `Learning intent: ${params.manifest.learningIntent}`,
    `Allowed action IDs: ${actionIds}`,
    `Registered component types: ${LAB_COMPONENT_TYPES.join(", ")}`,
    "Use only registered procedural component types and JSON-safe props.",
    "Do not emit equations, JavaScript, shaders, URLs, arbitrary assets, or new action IDs.",
    "Return only the scene object matching the supplied schema.",
    params.context.slice(0, 8_000),
  ].join("\n");
  try {
    const scene = await runValidatedStructuredGeneration(
      {
        mode: "object",
        schema: labSceneSchema,
        prompt,
        options: {
          operation: "unit.lab.manifest",
          bindingSchema: labSceneSchema,
          deepseekStrictOnly: true,
          meta: {
            unitTitle: params.unitTitle,
            experimentId: params.manifest.experimentId,
          },
        },
        contextSubject: {},
        contextQuery: `${params.unitTitle}: ${params.manifest.experimentId}`,
        contextInvocation: {
          domain: params.manifest.domain,
          experimentId: params.manifest.experimentId,
          actionIds: params.manifest.actionIds,
          componentTypes: LAB_COMPONENT_TYPES,
        },
      },
      { signal: params.signal },
    );
    const candidate = validateLabManifest({ ...params.manifest, scene });
    return candidate.success &&
      validateCertifiedLabManifest(candidate.data).length === 0
      ? candidate.data.scene
      : null;
  } catch {
    return null;
  }
}

async function compileChemistryLabItem(params: {
  planned: LabItemPlan;
  unitTitle: string;
  language: string;
  context: string;
  signal?: AbortSignal;
}): Promise<UnitLabItem> {
  if (params.signal?.aborted) throw new Error("aborted");
  const experimentId = chemistryExperimentForText(
    `${params.unitTitle}\n${params.planned.description}\n${params.context}`,
  );
  const experiment = getChemistryExperiment(experimentId);
  const block = normalizeChemistryLabDefinition({
    experimentId,
    title: experiment?.title ?? params.planned.description,
    summary: params.planned.description,
    targetObservation: params.planned.description,
  });
  if (!block) {
    return failedItem(
      `lab_${params.planned.id}`,
      params.planned,
      new Error("未知化学实验模板"),
    );
  }
  const manifest = manifestFromLegacyLabBlock(
    block as unknown as Record<string, unknown>,
  );
  if (!manifest)
    return failedItem(
      `lab_${params.planned.id}`,
      params.planned,
      new Error("化学实验定义无法转换"),
    );
  const authoredScene = await generateLabScene({
    manifest,
    unitTitle: params.unitTitle,
    context: params.context,
    signal: params.signal,
  });
  return {
    id: params.planned.id.startsWith("lab_")
      ? params.planned.id
      : `lab_${params.planned.id}`,
    status: "ready",
    title: block.title,
    componentType: "chemistry_lab",
    kind: "embedded_lab",
    manifest: authoredScene ? { ...manifest, scene: authoredScene } : manifest,
  };
}

async function compilePhysicsLabItem(params: {
  planned: LabItemPlan;
  unitTitle: string;
  language: string;
  context: string;
  signal?: AbortSignal;
}): Promise<UnitLabItem> {
  if (params.signal?.aborted) throw new Error("aborted");
  const experimentId = physicsExperimentForText(
    `${params.unitTitle}\n${params.planned.description}\n${params.context}`,
  );
  const experiment = getPhysicsExperiment(experimentId);
  const block = normalizePhysicsLabDefinition({
    experimentId,
    title: experiment?.title ?? params.planned.description,
    summary: params.planned.description,
    targetObservation: params.planned.description,
  });
  if (!block)
    return failedItem(
      `lab_${params.planned.id}`,
      params.planned,
      new Error("未知物理实验模板"),
    );
  const manifest = manifestFromLegacyLabBlock(
    block as unknown as Record<string, unknown>,
  );
  if (!manifest)
    return failedItem(
      `lab_${params.planned.id}`,
      params.planned,
      new Error("物理实验定义无法转换"),
    );
  const authoredScene = await generateLabScene({
    manifest,
    unitTitle: params.unitTitle,
    context: params.context,
    signal: params.signal,
  });
  return {
    id: params.planned.id.startsWith("lab_")
      ? params.planned.id
      : `lab_${params.planned.id}`,
    status: "ready",
    title: block.title,
    componentType: "physics_lab",
    kind: "embedded_lab",
    manifest: authoredScene ? { ...manifest, scene: authoredScene } : manifest,
  };
}

async function compileHtmlLabItem(params: {
  planned: LabItemPlan;
  unitTitle: string;
  language: string;
  context: string;
  signal?: AbortSignal;
}): Promise<UnitLabItem> {
  const id = params.planned.id.startsWith("lab_html_")
    ? params.planned.id
    : `lab_html_${params.planned.id}`;
  try {
    const block = await generateCourseInteractiveHtml({
      intent: {
        visualKind: "simple_structure",
        setup: params.planned.description,
        learningGoal: params.planned.description,
        expectedInsight: params.planned.description,
      },
      unitTitle: params.unitTitle,
      language: params.language,
      context: params.context,
      signal: params.signal,
      meta: { labItemId: id },
    });
    return toLabItem(
      id,
      { ...params.planned, componentType: "interactive_html" },
      block,
    );
  } catch (error) {
    if (params.signal?.aborted) throw error;
    return failedItem(
      id,
      { ...params.planned, componentType: "interactive_html" },
      error,
    );
  }
}

/** Regenerate one persisted lab component without rebuilding sibling activities. */
export async function regenerateUnitLabItem(params: {
  client: Client;
  userId: string;
  unitId: string;
  itemIndex: number;
  signal?: AbortSignal;
}) {
  const { client, userId, unitId, itemIndex, signal } = params;
  const [source, existing] = await Promise.all([
    client.findContext({ userId, unitId }),
    client.findLab(unitId),
  ]);
  if (!source) throw new Error("unit_not_found");
  const definition = parseUnitLabDefinition(existing?.definitionJson);
  const current = definition?.items[itemIndex];
  if (!existing || !definition || !current) {
    throw new Error("lab_item_missing");
  }
  if (
    current.componentType !== "interactive_html" &&
    current.componentType !== "physics_lab" &&
    !LAB_ACTIVITY_COMPONENT_TYPES.has(
      current.componentType as PlannedComponent["componentType"],
    )
  ) {
    throw new Error("lab_item_regeneration_forbidden");
  }

  const description = (current.fallbackBody || current.title).slice(0, 1_000);
  const planned: LabItemPlan = {
    id: current.id,
    componentType: current.componentType as LabItemPlan["componentType"],
    description,
  };
  const aggregated = await getAggregatedUnitMaterial(unitId).catch(() => null);
  const context = [
    source.unit.title,
    source.unit.contentSummary,
    materialExcerpt(source),
    aggregated ? JSON.stringify(aggregated).slice(0, 6_000) : "",
    current.manifest
      ? JSON.stringify(current.manifest).slice(0, 3_000)
      : current.block
        ? JSON.stringify(current.block).slice(0, 3_000)
        : "",
  ].join("\n");
  const regenerated = await runGenerationContextScope(
    {
      subject: { userId, goalId: source.unit.goalId, unitId },
      query: `${source.unit.title}: regenerate unit lab component`,
    },
    () =>
      runWithUserId(userId, () =>
        current.componentType === "interactive_html"
          ? compileHtmlLabItem({
              planned,
              unitTitle: source.unit.title,
              language: "zh-Hans",
              context,
              signal,
            })
          : compileLabItem({
              planned,
              unitTitle: source.unit.title,
              language: "zh-Hans",
              context,
              signal,
            }),
      ),
  );
  if (
    regenerated.status !== "ready" ||
    (regenerated.kind === "embedded_lab" && !regenerated.manifest) ||
    (regenerated.kind !== "embedded_lab" && !regenerated.block)
  ) {
    throw new Error("lab_item_regeneration_failed");
  }

  const updatedDefinition = {
    ...definition,
    items: definition.items.map((item, index) =>
      index === itemIndex ? regenerated : item,
    ),
  };
  const saved = await client.publishRegeneratedItemAndBumpContentRevision({
    labId: existing.id,
    unitId,
    expectedRevision: existing.revision,
    definitionJson: updatedDefinition,
  });
  if (!saved.applied) {
    // Another tab may have finished the same regeneration while this request
    // was compiling. Return the durable replacement instead of showing a
    // failure for a result the learner can already see after refreshing.
    const latest = await client.findLab(unitId);
    const latestDefinition = parseUnitLabDefinition(latest?.definitionJson);
    const latestItem = latestDefinition?.items[itemIndex];
    if (
      latest &&
      latest.revision > existing.revision &&
      latestItem?.status === "ready" &&
      (latestItem.block || latestItem.manifest)
    ) {
      const latestSource = await client.findContext({ userId, unitId });
      return {
        item: latestItem,
        component: (latestItem.manifest ??
          latestItem.block) as unknown as InteractiveBlock,
        revision: latest.revision,
        contentRevision:
          latestSource?.unit.contentRevision ?? source.unit.contentRevision,
      };
    }
    throw new Error("lab_item_regeneration_conflict");
  }
  return {
    item: regenerated,
    component: regenerated.manifest ?? regenerated.block,
    revision: existing.revision + 1,
    contentRevision: saved.contentRevision,
  };
}

function toLabItem(
  id: string,
  planned: LabItemPlan,
  block: InteractiveBlock | null,
): UnitLabItem {
  if (!block) {
    return failedItem(id, planned, new Error("编译结果为空"));
  }
  const verified = parseVerifiedLabBlock(block);
  if (!verified) {
    return failedItem(id, planned, new Error("编译结果未通过 schema"));
  }
  const issue = verifyLabInteractiveBlock(verified);
  if (issue) {
    return {
      id,
      status: "failed",
      title: planned.description.slice(0, 120),
      componentType: planned.componentType,
      kind: "failed",
      error: issue,
      fallbackBody: planned.description,
    };
  }
  return {
    id,
    status: "ready",
    title:
      "title" in verified && typeof verified.title === "string"
        ? verified.title.slice(0, 120)
        : planned.description.slice(0, 120),
    componentType: verified.type,
    kind: "inline_component",
    block: verified as unknown as Record<string, unknown>,
  };
}

function failedItem(
  id: string,
  planned: LabItemPlan,
  error: unknown,
): UnitLabItem {
  return {
    id,
    status: "failed",
    title: planned.description.slice(0, 120),
    componentType: planned.componentType,
    kind: "failed",
    error: error instanceof Error ? error.message : String(error),
    fallbackBody: planned.description,
  };
}

export async function processUnitLabPrepareEvent(params: {
  client: Client;
  payloadJson: string;
}) {
  const payload = JSON.parse(params.payloadJson) as {
    userId?: string;
    unitId?: string;
    recommendationUpdatedAt?: string;
  };
  if (!payload.userId || !payload.unitId) {
    throw new Error("unit lab prepare event is missing identifiers");
  }
  const lab = await params.client.findLab(payload.unitId);
  if (!lab?.recommended) {
    return { status: "ignored" as const, unitId: payload.unitId };
  }
  if (lab.status === "ready" || lab.status === "prepared") {
    return { status: "ignored" as const, unitId: payload.unitId };
  }
  if (
    payload.recommendationUpdatedAt &&
    lab.updatedAt.toISOString() !== payload.recommendationUpdatedAt &&
    lab.status !== "pending"
  ) {
    return { status: "stale" as const, unitId: payload.unitId };
  }
  await prepareUnitLab({
    client: params.client,
    userId: payload.userId,
    unitId: payload.unitId,
  });
  return { status: "prepared" as const, unitId: payload.unitId };
}

export function labRecordReady(lab: UnitLabRecord | null) {
  return Boolean(lab && (lab.status === "ready" || lab.status === "prepared"));
}
