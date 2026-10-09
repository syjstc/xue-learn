import {
  learningContentIdentity,
  resolveLearningBlock,
  type LearningPosition,
  type LearningTrajectoryContext,
} from "../../../domain/src/index.js";
export function resolveLearningPositionInContext(
  context: LearningTrajectoryContext,
  position: LearningPosition,
) {
  const legacyProjection = position.sectionId === "legacy-material";
  let section = context.sections.find((s) => s.id === position.sectionId);
  if (!section && !legacyProjection) {
    const candidates = context.sections.filter(
      (s) => resolveLearningBlock(s.blocks, position).blockIndex != null,
    );
    if (candidates.length === 1) section = candidates[0];
  }
  const blocks =
    section?.blocks ??
    context.legacy?.blocks ??
    (legacyProjection
      ? context.sections
          .filter((s) => s.courseRole === "main")
          .flatMap((s) => s.blocks)
      : []);
  const found = resolveLearningBlock(blocks, position);
  const index = found.blockIndex;
  const resolved: LearningPosition = {
    ...position,
    contentRevision: section?.revision ?? context.contentRevision,
    sectionId: legacyProjection ? "legacy-material" : section?.id,
    blockIndex: index ?? undefined,
    blockIdentity:
      index != null && found.exact
        ? learningContentIdentity(blocks[index])
        : undefined,
  };
  if (index != null) {
    const b = blocks[index] as { text?: string; body?: string };
    resolved.anchorText = (b.text ?? b.body ?? position.anchorText ?? "").slice(
      0,
      2000,
    );
  }
  return { position: resolved, exact: found.exact, context };
}
