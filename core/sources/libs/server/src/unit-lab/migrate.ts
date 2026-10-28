import { manifestFromLegacyLabBlock } from "./manifest.js";

export type UnitLabMigrationResult = {
  original: Record<string, unknown>;
  migrated: Record<string, unknown>;
};

/** Pure, idempotent Unit Lab v1 → v2 converter used by both SQL adapters. */
export function migrateUnitLabDefinition(value: unknown): UnitLabMigrationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== "unit_lab" || raw.schemaVersion === 2) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const item = candidate as Record<string, unknown>;
        const manifest =
          item.componentType === "physics_lab" || item.componentType === "chemistry_lab"
            ? manifestFromLegacyLabBlock((item.block ?? {}) as Record<string, unknown>)
            : null;
        if (manifest) {
          const { block: _legacyBlock, ...rest } = item;
          return [{ ...rest, kind: "embedded_lab", manifest }];
        }
        if (item.componentType === "physics_lab" || item.componentType === "chemistry_lab") {
          return [{
            ...item,
            status: "failed",
            kind: "failed",
            error: "实验定义无法转换为独立实验室清单",
            fallbackBody: item.fallbackBody ?? item.title ?? "请重新生成实验",
          }];
        }
        return [{ ...item, kind: item.status === "failed" ? "failed" : "inline_component" }];
      })
    : [];
  return {
    original: raw,
    migrated: { ...raw, schemaVersion: 2, items },
  };
}
