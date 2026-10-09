import { z } from "zod";

export const LAB_PROTOCOL_VERSION = 1 as const;
export const LAB_MANIFEST_VERSION = 1 as const;

export const LAB_COMPONENT_TYPES = [
  "asset_model",
  "lab_bench",
  "lab_backdrop",
  "lab_tray",
  "reagent_bottle",
  "dropper",
  "burette_stand",
  "platform",
  "ramp",
  "rail",
  "reference_plane",
  "cart",
  "beaker",
  "test_tube",
  "burette",
  "balance",
  "sphere",
  "cylinder",
  "spring",
  "lens",
  "screen",
  "wave_source",
  "field_arrow",
  "potential_well",
  "charge",
  "double_slit",
  "coil",
  "magnet",
  "pendulum_bob",
  "trajectory_arc",
] as const;

/** Only bundled assets may be referenced by a generated scene. */
export const LAB_ASSET_IDS = ["kenney-lab-desk"] as const;

export type LabComponentType = (typeof LAB_COMPONENT_TYPES)[number];
export type LabDomain = "physics" | "chemistry";

const vector3Schema = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
  .readonly();

const interactionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    actionId: z.string().trim().min(1).max(80),
    mode: z.enum(["select", "activate", "drag", "target"]),
    allowedTargetIds: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const componentSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    type: z.string().trim().min(1).max(80),
    // Component props are intentionally scalar. This keeps provider schemas
    // bounded and prevents nested executable/data payloads from crossing the
    // Lab boundary; complex state remains domain-owned behind action IDs.
    props: z.record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
      z.union([z.string().trim().max(240), z.number().finite(), z.boolean()]),
    ).optional(),
    position: vector3Schema.optional(),
    rotation: vector3Schema.optional(),
    scale: vector3Schema.optional(),
    visible: z.boolean().optional(),
    interaction: interactionSchema.optional(),
  })
  .strict();

const lightSchema = z
  .object({
    kind: z.enum(["ambient", "directional", "point"]),
    position: vector3Schema.optional(),
    color: z.string().trim().min(1).max(32).optional(),
    intensity: z.number().finite().min(0).max(20).optional(),
    castShadow: z.boolean().optional(),
  })
  .strict();

export const labSceneSchema = z
  .object({
    version: z.literal(1),
    environment: z
      .object({
        background: z.string().trim().min(1).max(32).optional(),
        grid: z.boolean().optional(),
        ground: z.boolean().optional(),
        ambientIntensity: z.number().finite().min(0).max(10).optional(),
      })
      .strict()
      .optional(),
    camera: z
      .object({
        position: vector3Schema.optional(),
        target: vector3Schema.optional(),
        fov: z.number().finite().min(10).max(120).optional(),
        minDistance: z.number().finite().positive().max(100).optional(),
        maxDistance: z.number().finite().positive().max(200).optional(),
      })
      .strict()
      .optional(),
    lights: z.array(lightSchema).max(12).optional(),
    components: z.array(componentSchema).min(1).max(80),
    vectors: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            origin: vector3Schema,
            vector: vector3Schema,
            color: z.string().trim().min(1).max(32).optional(),
            label: z.string().trim().max(120).optional(),
            scale: z.number().finite().min(0).max(20).optional(),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    trails: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            points: z.array(vector3Schema).max(500),
            color: z.string().trim().min(1).max(32).optional(),
            width: z.number().finite().min(0).max(10).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    labels: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            text: z.string().trim().min(1).max(160),
            position: vector3Schema,
            color: z.string().trim().min(1).max(32).optional(),
            emphasis: z.boolean().optional(),
          })
          .strict(),
      )
      .max(80)
      .optional(),
  })
  .strict();

export type LabSceneManifest = z.infer<typeof labSceneSchema>;

export const labManifestSchema = z
  .object({
    type: z.literal("lab_manifest"),
    protocolVersion: z.literal(LAB_PROTOCOL_VERSION),
    manifestVersion: z.literal(LAB_MANIFEST_VERSION),
    domain: z.enum(["physics", "chemistry"]),
    experimentId: z.string().trim().min(1).max(120),
    experimentVersion: z.number().int().positive().max(100),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(500),
    learningIntent: z.string().trim().min(1).max(500),
    targetObservation: z.string().trim().max(500).optional(),
    parameters: z.record(z.string().trim().min(1).max(80), z.number().finite()).default({}),
    actionIds: z.array(z.string().trim().min(1).max(80)).max(40),
    scene: labSceneSchema,
  })
  .strict();

export type LabManifestV1 = z.infer<typeof labManifestSchema>;

export type LabManifestValidationOptions = {
  allowedComponentTypes?: ReadonlySet<string>;
  allowedActionIds?: ReadonlySet<string>;
  allowedAssetIds?: ReadonlySet<string>;
  maxComponents?: number;
};

export type LabManifestValidationResult =
  | { success: true; data: LabManifestV1 }
  | { success: false; errors: readonly string[] };

function duplicateIds(values: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function isJsonSafe(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Object.values(value as Record<string, unknown>).every(isJsonSafe);
  }
  return false;
}

const FORBIDDEN_PROP_KEYS = new Set(["url", "href", "src", "script", "shader", "javascript", "html", "code", "equation"]);

function validateSafeProps(value: unknown, path: string, errors: string[], depth = 0): void {
  if (depth > 4) {
    errors.push(`${path} is nested too deeply`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > 240) errors.push(`${path} string is too long`);
    if (/^(?:javascript:|data:|https?:\/\/)/i.test(value) || /<\/?script\b/i.test(value)) {
      errors.push(`${path} contains a forbidden value`);
    }
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return;
  if (Array.isArray(value)) {
    if (value.length > 64) errors.push(`${path} has too many entries`);
    value.forEach((item, index) => validateSafeProps(item, `${path}[${index}]`, errors, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_PROP_KEYS.has(key.toLowerCase())) errors.push(`${path}.${key} is not allowed`);
      validateSafeProps(child, `${path}.${key}`, errors, depth + 1);
    }
  }
}

export function validateLabManifest(
  input: unknown,
  options: LabManifestValidationOptions = {},
): LabManifestValidationResult {
  const parsed = labManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) =>
        `${issue.path.join(".") || "manifest"}: ${issue.message}`,
      ),
    };
  }

  const manifest = parsed.data;
  const errors: string[] = [];
  const componentTypes = options.allowedComponentTypes ?? new Set(LAB_COMPONENT_TYPES);
  const actionIds = options.allowedActionIds ?? new Set(manifest.actionIds);
  const assetIds = options.allowedAssetIds ?? new Set(LAB_ASSET_IDS);
  const maxComponents = options.maxComponents ?? 80;
  if (manifest.scene.components.length > maxComponents) {
    errors.push(`scene.components exceeds the maximum of ${maxComponents}`);
  }
  if (!isJsonSafe(manifest)) errors.push("manifest contains a non-JSON value");
  if (JSON.stringify(manifest).length > 120_000) errors.push("manifest exceeds the size budget");

  const componentIds = manifest.scene.components.map((component) => component.id);
  const duplicateComponentIds = duplicateIds(componentIds);
  if (duplicateComponentIds.length > 0) {
    errors.push(`duplicate component ids: ${duplicateComponentIds.join(", ")}`);
  }
  const actionList = new Set(manifest.actionIds);
  for (const actionId of manifest.actionIds) {
    if (!actionIds.has(actionId)) errors.push(`unknown action id: ${actionId}`);
  }
  for (const component of manifest.scene.components) {
    if (!componentTypes.has(component.type)) errors.push(`unknown component type: ${component.type}`);
    validateSafeProps(component.props, `component ${component.id}.props`, errors);
    if (component.type === "asset_model") {
      const assetId = component.props?.assetId;
      if (typeof assetId !== "string" || !assetIds.has(assetId)) errors.push(`unknown asset id: ${String(assetId)}`);
    }
    if (component.interaction && !actionList.has(component.interaction.actionId)) {
      errors.push(`interaction ${component.interaction.id} references undeclared action ${component.interaction.actionId}`);
    }
    for (const targetId of component.interaction?.allowedTargetIds ?? []) {
      if (!componentIds.includes(targetId)) errors.push(`interaction target does not exist: ${targetId}`);
    }
  }
  const duplicateInteractionIds = duplicateIds(
    manifest.scene.components.flatMap((component) =>
      component.interaction ? [component.interaction.id] : [],
    ),
  );
  if (duplicateInteractionIds.length > 0) {
    errors.push(`duplicate interaction ids: ${duplicateInteractionIds.join(", ")}`);
  }
  for (const [name, entries] of [
    ["vectors", manifest.scene.vectors ?? []],
    ["trails", manifest.scene.trails ?? []],
    ["labels", manifest.scene.labels ?? []],
  ] as const) {
    const duplicates = duplicateIds(entries.map((entry) => entry.id));
    if (duplicates.length > 0) errors.push(`duplicate ${name} ids: ${duplicates.join(", ")}`);
  }
  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: manifest };
}

export function assertLabManifest(
  input: unknown,
  options?: LabManifestValidationOptions,
): LabManifestV1 {
  const result = validateLabManifest(input, options);
  if (!result.success) throw new Error(`Invalid lab manifest: ${result.errors.join("; ")}`);
  return result.data;
}
