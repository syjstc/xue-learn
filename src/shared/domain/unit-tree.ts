export function isLearnableUnitKind(unitKind: string): boolean {
  return unitKind === "lesson" || unitKind === "branch";
}

export function isOverviewUnitKind(unitKind?: string | null): boolean {
  return unitKind === "overview";
}

export function isModuleUnit(unit: { unitKind: string }): boolean {
  return unit.unitKind === "module";
}
