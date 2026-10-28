import { z } from "zod";
import { labManifestSchema, validateLabManifest } from "../../../lab-protocol/src/index.js";
import {
  normalizePhysicsLabDefinition,
  type PhysicsExperimentId,
  type PhysicsStage,
} from "../../../domain/src/index.js";
import {
  normalizeChemistryLabDefinition,
  type ChemistryExperimentId,
  type ChemistryStage,
} from "../../../domain/src/index.js";
import { validateCertifiedLabManifest } from "./manifest.js";

export const unitLabItemSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["ready", "failed"]),
  title: z.string().trim().min(1).max(120),
  componentType: z.string().trim().min(1),
  kind: z.enum(["embedded_lab", "inline_component", "failed"]).optional(),
  manifest: labManifestSchema.optional(),
  block: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  fallbackBody: z.string().optional(),
});

export const unitLabDefinitionSchema = z.object({
  type: z.literal("unit_lab"),
  schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  items: z.array(unitLabItemSchema).max(8),
});

export type UnitLabItem = z.infer<typeof unitLabItemSchema>;
export type UnitLabDefinition = z.infer<typeof unitLabDefinitionSchema>;

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function coerceItem(value: unknown): UnitLabItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const status = raw.status === "failed" ? "failed" : "ready";
  const id = String(raw.id ?? "").trim();
  const title = String(raw.title ?? "")
    .trim()
    .slice(0, 120);
  const componentType = String(raw.componentType ?? "").trim();
  if (!id || !title || !componentType) return null;
  const item: UnitLabItem = {
    id,
    status,
    title,
    componentType,
  };
  if (raw.kind === "embedded_lab" || raw.kind === "inline_component" || raw.kind === "failed") item.kind = raw.kind;
  if (raw.manifest && typeof raw.manifest === "object") {
    const manifest = validateLabManifest(raw.manifest);
    if (manifest.success && validateCertifiedLabManifest(manifest.data).length === 0) {
      item.manifest = manifest.data;
      item.kind ??= "embedded_lab";
    }
    else if (item.status === "ready") {
      item.status = "failed";
      item.error = "实验清单未通过校验";
      item.fallbackBody = item.fallbackBody ?? "请重新生成实验";
    }
  }
  if (raw.block && typeof raw.block === "object" && !Array.isArray(raw.block)) {
    const rawBlock = raw.block as Record<string, unknown>;
    if (
      componentType === "physics_lab" &&
      typeof rawBlock.experimentId === "string"
    ) {
      const normalized = normalizePhysicsLabDefinition({
        experimentId: rawBlock.experimentId as PhysicsExperimentId,
        experimentVersion: 2,
        title: typeof rawBlock.title === "string" ? rawBlock.title : undefined,
        summary:
          typeof rawBlock.summary === "string" ? rawBlock.summary : undefined,
        stage:
          typeof rawBlock.stage === "string"
            ? (rawBlock.stage as PhysicsStage)
            : undefined,
        targetObservation:
          typeof rawBlock.targetObservation === "string"
            ? rawBlock.targetObservation
            : undefined,
        parameters:
          rawBlock.parameters &&
          typeof rawBlock.parameters === "object" &&
          !Array.isArray(rawBlock.parameters)
            ? (rawBlock.parameters as Record<string, number>)
            : undefined,
      });
      if (!normalized) return null;
      item.block = normalized as unknown as Record<string, unknown>;
    } else if (
      componentType === "chemistry_lab" &&
      typeof rawBlock.experimentId === "string"
    ) {
      const normalized = normalizeChemistryLabDefinition({
        experimentId: rawBlock.experimentId as ChemistryExperimentId,
        experimentVersion:
          typeof rawBlock.experimentVersion === "number"
            ? rawBlock.experimentVersion
            : 1,
        title: typeof rawBlock.title === "string" ? rawBlock.title : undefined,
        summary:
          typeof rawBlock.summary === "string" ? rawBlock.summary : undefined,
        stage:
          typeof rawBlock.stage === "string"
            ? (rawBlock.stage as ChemistryStage)
            : undefined,
        targetObservation:
          typeof rawBlock.targetObservation === "string"
            ? rawBlock.targetObservation
            : undefined,
        parameters:
          rawBlock.parameters &&
          typeof rawBlock.parameters === "object" &&
          !Array.isArray(rawBlock.parameters)
            ? (rawBlock.parameters as Record<string, number>)
            : undefined,
        strictParameters: true,
      });
      if (!normalized) return null;
      item.block = normalized as unknown as Record<string, unknown>;
    } else {
      item.block = rawBlock;
    }
  }
  if (typeof raw.error === "string") item.error = raw.error;
  if (typeof raw.fallbackBody === "string")
    item.fallbackBody = raw.fallbackBody;
  if (item.status === "failed") item.kind = "failed";
  if (!item.kind) {
    item.kind = item.status === "failed"
      ? "failed"
      : item.manifest
        ? "embedded_lab"
        : "inline_component";
  }
  return item;
}

export function parseUnitLabDefinition(
  value: unknown,
): UnitLabDefinition | null {
  const candidate = decodeJson(value);
  const parsed = unitLabDefinitionSchema.safeParse(candidate);
  if (parsed.success) {
    return {
      ...parsed.data,
      schemaVersion: parsed.data.schemaVersion ?? 1,
      items: parsed.data.items
        .map((item) => coerceItem(item))
        .filter((item): item is UnitLabItem => item !== null)
        .slice(0, 8),
    };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const raw = candidate as Record<string, unknown>;
  if (raw.type !== "unit_lab") return null;
  const items = Array.isArray(raw.items)
    ? raw.items
        .map(coerceItem)
        .filter((item): item is UnitLabItem => item !== null)
        .slice(0, 8)
    : [];
  const repaired = {
    type: "unit_lab" as const,
    schemaVersion: 1 as const,
    title:
      String(raw.title ?? "会学实验室")
        .trim()
        .slice(0, 120) || "会学实验室",
    summary:
      String(raw.summary ?? "互动实验")
        .trim()
        .slice(0, 500) || "互动实验",
    items,
  };
  const coerced = unitLabDefinitionSchema.safeParse(repaired);
  return coerced.success ? coerced.data : null;
}
