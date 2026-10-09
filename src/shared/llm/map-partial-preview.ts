export type MapPartialPreviewUnit = {
  title?: string;
  contentSummary?: string;
  parentTitle?: string | null;
};

/** Keep the currently streaming sub-map visible instead of hiding it behind roots. */
export function selectActiveMapPreviewUnits(
  units: MapPartialPreviewUnit[],
  limit = 8,
): MapPartialPreviewUnit[] {
  const children = units.filter((unit) => unit.parentTitle?.trim());
  if (children.length === 0) return units.slice(0, limit);

  const activeParentTitle = children.at(-1)?.parentTitle?.trim();
  const activeRoot = units.find(
    (unit) => !unit.parentTitle?.trim() && unit.title === activeParentTitle,
  );
  const activeChildren = children.filter(
    (unit) => unit.parentTitle?.trim() === activeParentTitle,
  );

  return [
    ...(activeRoot ? [activeRoot] : []),
    ...activeChildren.slice(-(limit - (activeRoot ? 1 : 0))),
  ];
}
