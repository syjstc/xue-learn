import type { GlobalGenerationSettingsRepository } from "../../../domain/src/index.js";
import { requireGlobalGenerationSettingsPersistence } from "../generation/global-generation-settings-persistence.js";
import {
  generatableMaterialComponentTypes,
  type GeneratableMaterialComponentType,
} from "./component-dsl-registry.js";

const CACHE_TTL_MS = 5_000;

const COMPONENT_METADATA: Record<
  GeneratableMaterialComponentType,
  { label: string; category: string; description: string }
> = {
  chart: {
    label: "Chart",
    category: "Visualization",
    description:
      "Inspect real numeric trends, comparisons, composition, or correlation.",
  },
  math_scene: {
    label: "Math scene",
    category: "Visualization",
    description: "Inspect functions, vectors, geometry, curves, or surfaces.",
  },
  mechanics_sandbox: {
    label: "Physics lab",
    category: "Interactive labs",
    description:
      "Interactive physics (物理) collisions, momentum, and kinematics simulation.",
  },
  circuit_sandbox: {
    label: "Circuit lab",
    category: "Interactive labs",
    description:
      "Interactive DC circuit simulation with switches, meters, and bulbs.",
  },
  chemistry_lab: {
    label: "Chemistry lab",
    category: "Interactive labs",
    description:
      "Certified virtual chemistry experiments for indicators, titration, precipitation, and mass conservation.",
  },
};

let cache:
  | { expiresAt: number; disabledTypes: GeneratableMaterialComponentType[] }
  | undefined;

function normalizeDisabledTypes(values: readonly string[]) {
  const valid = new Set<string>(generatableMaterialComponentTypes);
  return Array.from(new Set(values)).filter(
    (value): value is GeneratableMaterialComponentType => valid.has(value),
  );
}

export function invalidateMaterialComponentSettingsCache() {
  cache = undefined;
}

export async function getMaterialComponentSettings(
  store: GlobalGenerationSettingsRepository = requireGlobalGenerationSettingsPersistence(),
) {
  const row = await store.get();
  const disabledTypes = normalizeDisabledTypes(
    row.disabledMaterialComponentTypes,
  );
  return {
    disabledTypes,
    components: generatableMaterialComponentTypes.map((id) => ({
      id,
      ...COMPONENT_METADATA[id],
      enabled: !disabledTypes.includes(id),
    })),
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

export async function getDisabledMaterialComponentTypes() {
  if (cache && cache.expiresAt > Date.now()) return cache.disabledTypes;
  const settings = await getMaterialComponentSettings();
  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    disabledTypes: settings.disabledTypes,
  };
  return settings.disabledTypes;
}

export async function updateMaterialComponentSettings(
  store: GlobalGenerationSettingsRepository,
  disabledTypes: readonly string[],
  updatedByUserId: string,
) {
  const normalized = normalizeDisabledTypes(disabledTypes);
  if (normalized.length !== new Set(disabledTypes).size) {
    throw new RangeError(
      "disabledMaterialComponentTypes contains an invalid component type",
    );
  }
  await store.update({
    disabledMaterialComponentTypes: normalized,
    updatedByUserId,
  });
  invalidateMaterialComponentSettingsCache();
  return getMaterialComponentSettings(store);
}
