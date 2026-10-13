import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DerivationDocumentV1 } from "../../../../libs/formal-derivation/src/index.js";
import type {DerivationSceneInput as LessonPerformanceSceneV2} from "./derivation-types.js";
import { FormalMotionClockedRenderer } from "../../../../libs/formal-expression-motion/src/index.js";
import {
  classroomDerivationFrame,
  classroomDisplayedFormulaIds,
  classroomFormulaEmphasis,
} from "./classroom-formula.js";
import { currentStepFormulaIds } from "./formal-derivation-view.js";
import { formulaBoardLayout } from "./formula-board-layout.js";

export function DerivationScene(props: {
  scene: LessonPerformanceSceneV2;
  document?: DerivationDocumentV1;
  progress: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 620 });
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const frames = useMemo(() => {
    if (!props.document) return null;
    const current = classroomDerivationFrame(
      props.document,
      props.scene.derivation?.toStep ?? 0,
    );
    const previous = classroomDerivationFrame(
      props.document,
      props.scene.derivation?.fromStep ?? 0,
    );
    const activeIds = currentStepFormulaIds(current.state, current.step);
    const refs = classroomDisplayedFormulaIds(
      current.state,
      current.step,
    ).filter((id) => !activeIds.includes(id));
    const lanes = [
      ...(refs.length
        ? [{ key: "reference", ids: refs, width: size.width * 0.28, maxEm: 30 }]
        : []),
      {
        key: "current",
        ids: activeIds,
        width: refs.length ? size.width * 0.66 : size.width,
        maxEm: 40,
      },
    ].map((lane) => ({
      ...lane,
      layout: formulaBoardLayout(
        current.state,
        current.step,
        lane.width - (lane.key === "reference" ? 20 : 0),
        size.height,
        lane,
      ),
      before: formulaBoardLayout(
        previous.state,
        previous.step,
        lane.width - (lane.key === "reference" ? 20 : 0),
        size.height,
        lane,
      ),
    }));
    return { current, previous, lanes };
  }, [props.document, props.scene.derivation, size]);
  const t = Math.min(1, Math.max(0, props.progress));
  const ease = t * t * (3 - 2 * t);
  return (
    <div className="lp-derivation-scene">
      <div className="lp-stage-formula">
        <div className="lp-formula-viewport" ref={viewportRef}>
          {frames?.lanes.some((lane) => lane.layout.rows.length) ? (
            frames.lanes.map((lane) => {
              const { layout, before: previousLayout } = lane;
              const offset = previousLayout.rows.length
                ? previousLayout.offset +
                  (layout.offset - previousLayout.offset) * ease
                : layout.offset;
              return (
                <div
                  className={`lp-formula-lane lp-formula-lane--${lane.key}`}
                  key={lane.key}
                  style={{ width: lane.width }}
                >
                  <div
                    className="lp-formula-sheet"
                    style={{
                      width: layout.width,
                      height: layout.totalHeight,
                      transform: `translateY(${offset}px)`,
                    }}
                  >
                    {layout.rows.map((row) => {
                      const formula = frames.current.state.formulas[row.id];
                      const emphasis = classroomFormulaEmphasis(
                        frames.current.state,
                        row.id,
                      );
                      const before = previousLayout.rows.find(
                        (item) => item.id === row.id,
                      );
                      const top = before
                        ? before.top + (row.top - before.top) * ease
                        : row.top;
                      return (
                        <div
                          key={row.id}
                          className="lp-stage-formula-row"
                          data-formula-id={row.id}
                          data-active={row.active}
                          style={{ top, height: row.height }}
                        >
                          {formula.display?.caption ? (
                            <p className="lp-stage-formula-label">
                              {formula.display.caption}
                            </p>
                          ) : null}
                          <FormalMotionClockedRenderer
                            snapshot={formula.document}
                            previousSnapshot={
                              frames.previous.state.formulas[row.id]?.document
                            }
                            progress={props.progress}
                            selected={emphasis.selected}
                            highlights={emphasis.highlights}
                            dimOthers={false}
                            em={layout.em}
                            fit={false}
                            align="start"
                          />
                        </div>
                      );
                    })}
                  </div>
                  {layout.maxScroll > 0 ? (
                    <div className="lp-formula-position" aria-hidden="true">
                      <i
                        style={{
                          height: `${Math.min(100, (size.height / layout.scrollHeight) * 100)}%`,
                          top: `${(Math.max(0, -offset) / layout.scrollHeight) * 100}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="lp-formula-statement">
              {props.scene.slots.caption || props.scene.title}
            </p>
          )}
        </div>
        <div className="lp-formula-tray" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

import "./formal-derivation.css";
