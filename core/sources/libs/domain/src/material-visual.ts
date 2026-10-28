/** Small semantic vocabulary. No assets, drawing code, positions or timing. */
export const MATERIAL_VISUAL_KINDS = [
  "process",
  "cycle",
  "layers",
  "bars",
] as const;
export type MaterialVisualKind = (typeof MATERIAL_VISUAL_KINDS)[number];
export type MaterialVisual = {
  type: "visual";
  id?: string;
  kind: MaterialVisualKind;
  title: string;
  unit?: string;
  items: Array<{ id: string; label: string; detail?: string; value?: number }>;
};

/** Used after shape validation, and defensively before drawing persisted data. */
export function materialVisualIssues(value: MaterialVisual): string[] {
  const issues: string[] = [];
  const ids = value.items.map((item) => item.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => [value.id, "whole", "display"].includes(id))
  )
    issues.push(
      "visual item ids must be unique and distinct from the display id, whole and display",
    );
  if (value.kind === "bars") {
    if (
      value.items.some(
        (item) =>
          typeof item.value !== "number" ||
          !Number.isFinite(item.value) ||
          item.value < 0,
      )
    )
      issues.push(
        "bars require a finite non-negative value for every item; never invent missing data",
      );
  } else if (
    value.items.some((item) => item.value !== undefined) ||
    value.unit !== undefined
  ) {
    issues.push("only bars accept value and unit");
  }
  return issues;
}

export function readMaterialVisual(value: unknown): MaterialVisual | null {
  if (!value || typeof value !== "object") return null;
  const v = value as MaterialVisual;
  if (
    v.type !== "visual" ||
    !MATERIAL_VISUAL_KINDS.includes(v.kind) ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.length > 60 ||
    !Array.isArray(v.items) ||
    v.items.length < 2 ||
    v.items.length > 5 ||
    v.items.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        typeof item.label !== "string" ||
        !item.label.trim() ||
        item.label.length > 24 ||
        (item.detail !== undefined &&
          (typeof item.detail !== "string" || item.detail.length > 60)),
    ) ||
    (v.unit !== undefined && (typeof v.unit !== "string" || v.unit.length > 12))
  )
    return null;
  return materialVisualIssues(v).length ? null : v;
}

/** Targets are scoped even when two boards reuse common item labels. */
export const materialVisualTarget = (
  figureId: string | undefined,
  itemId: string,
) => `visual:${figureId || "display"}:${itemId}`;

/** The author addresses objects by id, so a composed board cannot reuse ids. */
export function materialVisualTreeIssues(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const block = value as { type?: string; id?: string; figures?: unknown[] };
  if (block.type === "visual")
    return materialVisualIssues(value as MaterialVisual);
  if (block.type !== "stage" || !Array.isArray(block.figures)) return [];
  const visuals = block.figures.filter(
    (f): f is MaterialVisual =>
      !!f && typeof f === "object" && (f as MaterialVisual).type === "visual",
  );
  if (!visuals.length) return [];
  const ids = [
    block.id,
    ...block.figures.map((f) => (f as { id?: string }).id),
    ...visuals.flatMap((v) => v.items.map((item) => item.id)),
  ].filter(Boolean);
  return [
    ...visuals.flatMap(materialVisualIssues),
    ...(visuals.length > 1 || block.figures.length > 2
      ? [
          "use one visual with at most one brief helper; split additional visuals into topics",
        ]
      : []),
    ...(new Set(ids).size !== ids.length
      ? ["visual and figure ids must be unique across the board"]
      : []),
  ];
}

/** Shared zero baseline; all-zero data intentionally produces zero-length bars. */
export function materialVisualBarFractions(
  items: MaterialVisual["items"],
): number[] {
  const max = Math.max(0, ...items.map((item) => item.value ?? 0));
  return items.map((item) => (max > 0 ? (item.value ?? 0) / max : 0));
}
