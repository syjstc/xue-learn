import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";

const UNIT_MATERIAL_COMMITTED_EVENT = "xuelearn:unit-material-committed";

type UnitMaterialCommittedDetail = {
  unitId: string;
  material: LearningMaterialContent;
};

export function publishUnitMaterialCommitted(
  detail: UnitMaterialCommittedDetail,
) {
  window.dispatchEvent(
    new CustomEvent<UnitMaterialCommittedDetail>(
      UNIT_MATERIAL_COMMITTED_EVENT,
      { detail },
    ),
  );
}

export function subscribeToUnitMaterialCommitted(
  listener: (detail: UnitMaterialCommittedDetail) => void,
) {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<UnitMaterialCommittedDetail>).detail);
  };
  window.addEventListener(UNIT_MATERIAL_COMMITTED_EVENT, handleEvent);
  return () =>
    window.removeEventListener(UNIT_MATERIAL_COMMITTED_EVENT, handleEvent);
}
