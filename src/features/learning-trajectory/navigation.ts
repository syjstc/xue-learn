import {
  learningContentIdentity,
  resolveLearningBlock,
  type LearningPosition,
} from "@xue-learn/core/domain";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import type { MaterialAnchor } from "@xue-learn/core/shared/domain/material-anchor";

let current: LearningPosition | undefined;
let capture: (() => LearningPosition | undefined) | undefined;
export function rememberLearningPosition(position: LearningPosition) {
  current = position;
  window.dispatchEvent(new CustomEvent("learning-position-changed", { detail: position }));
}
export function registerLearningPositionCapture(
  reader: () => LearningPosition | undefined,
) {
  capture = reader;
  return () => {
    if (capture === reader) capture = undefined;
  };
}
export function currentLearningPosition(fallback?: LearningPosition) {
  const candidate = capture?.() ?? current;
  return candidate && (!fallback || candidate.unitId === fallback.unitId)
    ? candidate
    : fallback;
}
export function learningSessionId() {
  const key = "xuelearn.learning-session.v1";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}
export function activeLearningVisitId() {
  return (
    new URLSearchParams(window.location.search).get("learningVisit") ??
    undefined
  );
}
export function learningReturnPath(goalId: string, position: LearningPosition) {
  const base = `/goals/${encodeURIComponent(goalId)}/units/${encodeURIComponent(position.unitId)}`;
  const params = new URLSearchParams({ learningReturn: "1" });
  if (position.sectionId) params.set("section", position.sectionId);
  return `${base}${position.mode === "classroom" ? "/lesson-performance" : ""}?${params}`;
}
export function queueLearningReturn(position: LearningPosition) {
  sessionStorage.setItem(
    `xuelearn.learning-return:${position.unitId}`,
    JSON.stringify(position),
  );
  rememberLearningPosition(position);
  window.dispatchEvent(new CustomEvent("learning-return-queued", {detail:position.unitId}));
}
export function pendingLearningReturn(unitId: string): LearningPosition | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(`xuelearn.learning-return:${unitId}`) ?? "null",
    );
  } catch {
    return null;
  }
}
export function clearLearningReturn(unitId: string) {
  sessionStorage.removeItem(`xuelearn.learning-return:${unitId}`);
}
export function captureReadingPosition(
  unitId: string,
  sectionId: string,
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): LearningPosition {
  const index = anchor.blockIndex ?? 0;
  let topicId: string | undefined, topicTitle: string | undefined;
  for (let i = 0; i <= index; i++) {
    const b = material.blocks[i];
    if (b?.type === "heading" && (b.level === 2 || b.topicId)) {
      topicId = b.topicId ?? learningContentIdentity(b);
      topicTitle = b.text;
    }
  }
  const root = document.querySelector<HTMLElement>(
    `[data-learning-section="${CSS.escape(sectionId)}"]`,
  );
  const element = root?.querySelector<HTMLElement>(
    `[data-block-index="${index}"]`,
  );
  return {
    version: 1,
    unitId,
    sectionId,
    mode: "reading",
    blockIndex: index,
    ...(material.blocks[index]
      ? { blockIdentity: learningContentIdentity(material.blocks[index]) }
      : {}),
    topicId,
    topicTitle,
    anchorText: anchor.selectedText,
    scrollOffset: element?.getBoundingClientRect().top ?? 0,
  };
}
export function restoreReadingPosition(
  root: HTMLElement,
  material: LearningMaterialContent,
  position: LearningPosition,
): { restored: boolean; exact: boolean } {
  const match = resolveLearningBlock(material.blocks, position);
  const el =
    match.blockIndex == null
      ? root
      : root.querySelector<HTMLElement>(
          `[data-block-index="${match.blockIndex}"]`,
        );
  if (!el) return { restored: false, exact: match.exact };
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    if (
      /auto|scroll/.test(getComputedStyle(parent).overflowY) &&
      parent.scrollHeight > parent.clientHeight
    )
      break;
    parent = parent.parentElement;
  }
  if (parent && parent !== document.body) {
    const top =
      match.exact && position.scrollOffset != null
        ? position.scrollOffset
        : parent.getBoundingClientRect().top;
    parent.scrollTop += el.getBoundingClientRect().top - top;
  } else el.scrollIntoView({ block: "center", behavior: "instant" });
  el.classList.add("ring-2", "ring-primary/40", "rounded-lg");
  window.setTimeout(
    () => el.classList.remove("ring-2", "ring-primary/40", "rounded-lg"),
    1500,
  );
  return { restored: true, exact: match.exact };
}
