import type {
  MaterializedDerivationStateV1,
  DerivationStepV1,
} from "../../../../libs/formal-derivation/src/index.js";
import {
  layoutFormalMotion,
  emphasisBoxForSubject,
  MAX_MOTION_EM,
} from "../../../../libs/formal-expression-motion/src/index.js";
import { currentStepFormulaIds } from "./formal-derivation-view.js";
import {
  classroomDisplayedFormulaIds,
  classroomFormulaEmphasis,
} from "./classroom-formula.js";

/** Design-pixel geometry, independent of playback history and capture resolution. */
export function formulaBoardLayout(
  state: MaterializedDerivationStateV1,
  step: DerivationStepV1 | undefined,
  width: number,
  height: number,
  options: { ids?: string[]; maxEm?: number } = {},
) {
  const ids = (options.ids ?? classroomDisplayedFormulaIds(state, step)).filter(
    (id) => state.formulas[id],
  );
  const maxEm = options.maxEm ?? MAX_MOTION_EM;
  const active = new Set(currentStepFormulaIds(state, step));
  const designs = ids.map((id) =>
    layoutFormalMotion(state.formulas[id].document, { em: maxEm }),
  );
  const em =
    maxEm *
    Math.min(1, width / Math.max(1, ...designs.map((item) => item.width)));
  let cursor = 0;
  const rows = ids.map((id) => {
    const formula = state.formulas[id];
    const scene = layoutFormalMotion(formula.document, { em });
    const labelHeight = formula.display?.caption ? 32 : 0;
    const row = {
      id,
      top: cursor,
      height: scene.height + labelHeight,
      width: scene.width,
      labelHeight,
      active: active.has(id),
      scene,
    };
    cursor += row.height + 32;
    return row;
  });
  const totalHeight = Math.max(0, cursor - 32);
  // Prefer explicitly taught subexpressions even inside a very tall formula.
  const focus = rows
    .filter((row) => row.active)
    .flatMap((row) => {
      const emphasis = classroomFormulaEmphasis(state, row.id);
      const boxes = [
        ...emphasis.selected,
        ...emphasis.highlights.map((item) => item.subject),
      ]
        .map((subject) =>
          emphasisBoxForSubject(
            state.formulas[row.id].document,
            row.scene.primitives,
            subject,
          ),
        )
        .filter((box) => box != null);
      return boxes.length
        ? boxes.map((box) => ({
            top: row.top + row.labelHeight + box.y,
            bottom: row.top + row.labelHeight + box.y + box.height,
          }))
        : [{ top: row.top, bottom: row.top + row.height }];
    });
  const focusTop = Math.min(...focus.map((box) => box.top));
  const focusBottom = Math.max(...focus.map((box) => box.bottom));
  // Trailing breathing room lets the last taught line sit in the middle too.
  const scrollHeight =
    totalHeight > height ? totalHeight + height / 2 : totalHeight;
  const maxScroll = Math.max(0, scrollHeight - height);
  // An over-height teaching range starts at its beginning; never shrink an entire
  // long board to illegible text merely to fit all its historical context.
  const target =
    focusBottom - focusTop > height
      ? focusTop
      : (focusTop + focusBottom - height) / 2;
  const scroll = focus.length ? Math.min(maxScroll, Math.max(0, target)) : 0;
  return {
    rows,
    em,
    totalHeight,
    scrollHeight,
    width: Math.max(0, ...rows.map((row) => row.width)),
    offset: totalHeight <= height ? (height - totalHeight) / 2 : -scroll,
    maxScroll,
  };
}
