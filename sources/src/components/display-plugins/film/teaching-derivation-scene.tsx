import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {DerivationSceneInput as LessonPerformanceSceneV2} from "./derivation-types.js";
import {
  resolveTeachingDerivationDerived,
  teachingBoardTransition,
  teachingBlockFrame,
  teachingExplanationFrame,
  type TeachingDerivationDerivedV1,
  type TeachingDerivationDocumentV1,
  type TeachingBoardTrack,
} from "../../../../libs/teaching-derivation/src/index.js";
import { TeachingFormulaRenderer } from "../../../features/teaching-derivation/teaching-formula-renderer.js";
import { useT } from "../../../shared/i18n/index.js";
import { BoardText } from "../../../features/teaching-derivation/board-text.js";
import "./teaching-derivation-scene.css";
import { teachingCardLayout } from "./teaching-card-layout.js";
import { TeachingCompanion } from "../../../features/teaching-derivation/teaching-companion.js";
import type { MaterialTeachingCueInterval } from "../../../../libs/domain/src/index.js";

/** Fit the complete explanation before paint, independently of spoken cue count. */
function TeachingCopy({
  children,
  identity,
  opacity = 1,
  className = "",
  size = 24,
}: {
  children: ReactNode;
  identity: string;
  opacity?: number;
  className?: string;
  size?: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = viewport.current,
      content = body.current;
    if (!host || !content) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled || !host.clientWidth || !host.clientHeight) return;
      // Measure in design pixels so preview zoom and export use identical fitting.
      const fits = (value: number) => {
        content.style.fontSize = `${value}px`;
        return (
          content.scrollHeight <= host.clientHeight &&
          content.scrollWidth <= host.clientWidth
        );
      };
      if (fits(size)) return;
      let low = 1,
        high = size;
      for (let i = 0; i < 10; i++) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle;
        else high = middle;
      }
      fits(low);
    };
    measure();
    void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [identity, size]);
  return (
    <div ref={viewport} className={`lp-teaching-copy-window ${className}`}>
      <div ref={body} className="lp-teaching-copy" style={{ opacity }}>
        {children}
      </div>
    </div>
  );
}

function FormulaSlot({
  track,
  progress,
  emphasis,
}: {
  track: TeachingBoardTrack;
  progress: number;
  emphasis?: readonly import("../../../../libs/teaching-derivation/src/index.js").ResolvedTeachingTarget[];
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scales, setScales] = useState({ before: 1, after: 1 });
  useLayoutEffect(() => {
    const host = viewport.current;
    const body = content.current;
    if (!host || !body) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      // offset sizes remain in design pixels even under the stage's CSS zoom.
      const layers = [
        ...body.querySelectorAll<HTMLElement>(".teaching-formula-measure"),
      ];
      const fit = (layer: HTMLElement | undefined) => {
        const math =
          layer?.querySelector<HTMLElement>(".katex-display > .katex") ??
          layer?.querySelector<HTMLElement>(".katex");
        const html = layer?.querySelector<HTMLElement>(".katex-html");
        const measured = Math.max(
          math?.scrollWidth ?? 0,
          html?.scrollWidth ?? 0,
          ...(html
            ? [...html.querySelectorAll<HTMLElement>(".base")].map(
                (node) => node.scrollWidth,
              )
            : []),
        );
        // scrollWidth is layout pixels and ignores the fit scale. Do not divide
        // by getBoundingClientRect, which already includes that transform.
        const width = Math.max(1, measured || html?.offsetWidth || 1);
        const height = Math.max(
          1,
          layer?.scrollHeight || layer?.offsetHeight || 1,
        );
        return Math.max(
          0.05,
          Math.min(
            1,
            (host.clientWidth - 20) / width,
            (host.clientHeight - 8) / height,
          ),
        );
      };
      const after = fit(layers[0]);
      const before = layers[1] ? fit(layers[1]) : after;
      setScales((current) =>
        Math.abs(current.before - before) < 0.001 &&
        Math.abs(current.after - after) < 0.001
          ? current
          : { before, after },
      );
    };
    measure();
    void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(body);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [track.after, track.before]);
  // New limit notation can be wider: resize continuously instead of shrinking
  // the source formula on the first frame of the next scene.
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  const scale = scales.before + (scales.after - scales.before) * eased;
  return (
    <div ref={viewport} className="lp-teaching-formula-slot">
      <div
        ref={content}
        className="lp-teaching-formula-content"
        style={{ transform: `scale(${scale})` }}
      >
        <TeachingFormulaRenderer
          after={track.after}
          before={track.before}
          transition={track.transition}
          cancelledNodeIds={track.cancelledNodeIds}
          progress={progress}
          emphasis={emphasis}
        />
      </div>
    </div>
  );
}

export function TeachingDerivationScene(props: {
  focused?: boolean;
  scene: LessonPerformanceSceneV2;
  cueId?: string;
  document?: unknown;
  derived?: unknown;
  progress: number;
  layoutProgress?: number;
  visualProgress?: number;
  contextProgress?: number;
  visualTimeline?: { intervals: readonly MaterialTeachingCueInterval[]; tick: number };
}) {
  const t = useT();
  const document = props.document as TeachingDerivationDocumentV1 | undefined;
  const stored = props.derived as TeachingDerivationDerivedV1 | undefined;
  const toStep = Math.max(1, props.scene.derivation?.toStep ?? 1);
  const fromStep = props.scene.derivation?.fromStep ?? 0;
  const derived = useMemo(
    () =>
      document?.steps?.length
        ? resolveTeachingDerivationDerived(document, stored)
        : null,
    [document, stored],
  );
  const tracks = useMemo(
    () =>
      document && derived
        ? teachingBoardTransition(document, derived, fromStep, toStep)
        : [],
    [document, derived, fromStep, toStep],
  );
  const step = document?.steps[toStep - 1];
  if (!step || !document || !derived)
    return (
      <div className="lp-derivation-scene">
        <p>{props.scene.slots.caption}</p>
      </div>
    );
  const p = Math.max(0, Math.min(1, props.progress));
  const previous = document.steps[fromStep - 1];
  const focused = props.focused ?? Boolean(step.visual || step.givenIndexes !== undefined || step.cues?.some(cue => cue.onScreenText !== undefined || cue.givenIndexes !== undefined));
  const selected = teachingExplanationFrame(document, step, props.cueId);
  const explanation = focused ? selected : {...selected, text: step.justification, givens: document.givens};
  // Reserve support geometry for this complete source object. Selecting a
  // different premise must not move the formula or resize the companion.
  const reserveGivens = document.steps.some(item => item.givenIndexes?.length || item.cues?.some(cue => cue.givenIndexes?.length));
  // Stable for the whole document: speech cues never shuffle the reading area.
  const dense = document.givens.join("").length > 240;
  const hasReferences = tracks.some(
    (track) =>
      track.formula.role === "reference" && (track.state !== "exit" || p < 1),
  );
  const reason = step.conditions
    ? `${t("teachingDerivation.condition")}${step.conditions}\n${explanation.text}`
    : explanation.text;
  const premises = (
    <aside className="lp-teaching-premises" aria-hidden={focused && !explanation.givens.length || undefined} style={{visibility: focused && !explanation.givens.length ? "hidden" : undefined}}>
      <h3>{t("teachingDerivation.premises")}</h3>
      <TeachingCopy
        identity={explanation.givens.join("\n")}
        className="lp-teaching-givens"
        size={22}
      >
        {explanation.givens.length ? (
          explanation.givens.map((given, index) => (
            <p key={index}>
              <BoardText text={given} />
            </p>
          ))
        ) : (
          <p>{t("teachingDerivation.noPremises")}</p>
        )}
      </TeachingCopy>
    </aside>
  );
  const lane = (role: "primary" | "reference") => {
    const laneProgress = focused && role === "reference" ? props.contextProgress ?? 1 : p;
    const roleTracks = tracks.filter((track) => track.formula.role === role);
    // Two tall distributions need the full height of the board. Side-by-side
    // cards use the same shared boundaries, including their enter/exit phase.
    const horizontal =
      dense &&
      !step.visual &&
      role === "primary" &&
      Math.max(
        step.board.filter((f) => f.role === role).length,
        previous?.board.filter((f) => f.role === role).length ?? 0,
      ) === 2;
    const rows = teachingCardLayout(
      roleTracks,
      previous,
      fromStep,
      laneProgress,
      focused && role === "reference" ? laneProgress : props.layoutProgress ?? (p >= 1 ? 1 : 0),
    );
    return (
      <div
        className={`lp-teaching-cards is-${role}${horizontal ? " is-horizontal" : ""}`}
      >
        {roleTracks.map((track) => {
          const frame = teachingBlockFrame(track, laneProgress);
          if (track.state === "exit" && laneProgress >= 1) return null;
          const { top, height } = rows.get(track.id)!;
          return (
            <article
              key={track.id}
              data-teaching-card={track.id}
              data-card-motion={track.state}
              data-card-slot={frame.slot}
              className="lp-teaching-card"
              style={{
                ...(horizontal
                  ? {
                      top: 0,
                      left: `${top}%`,
                      right: "auto",
                      width: `max(0px, calc(${height}% - 14px))`,
                      height: "calc(100% - 14px)",
                    }
                  : {
                      top: `${top}%`,
                      height: `max(0px, calc(${height}% - 14px))`,
                    }),
                opacity: frame.opacity,
                transform: `translateY(${frame.offsetY}px)`,
              }}
            >
              <header>
                <span className="min-w-0">
                  <BoardText text={track.formula.title} />
                </span>
                <small>
                  {track.source
                    ? t(
                        role === "primary"
                          ? "teachingDerivation.fromStep"
                          : "teachingDerivation.referenceStep",
                        { step: track.source.stepIndex },
                      )
                    : t(
                        role === "reference"
                          ? "teachingDerivation.referenceFormula"
                          : toStep === 1
                            ? "teachingDerivation.start"
                            : "teachingDerivation.introduced",
                      )}
                </small>
              </header>
              <FormulaSlot
                track={track}
                progress={focused && role === "reference" ? 1 : p}
                emphasis={derived.steps[
                  toStep - 1
                ]?.presentation?.targets.filter(
                  (target) =>
                    target.formulaKey === track.formula.key &&
                    (step.cues
                      ?.find((cue) => cue.id === props.cueId)
                      ?.targetIds.includes(target.id) ??
                      false),
                )}
              />
            </article>
          );
        })}
      </div>
    );
  };
  return (
    <div
      className={`lp-derivation-scene lp-teaching-scene${focused ? " is-focused" : ""}${dense ? " is-dense" : ""}`}
      data-teaching-step={toStep}
    >
      <header className="lp-teaching-heading">
        <div>
          <span>{t("teachingDerivation.steps")}</span>
          <h2>{document.title}</h2>
        </div>
        <strong>
          {toStep}
          <small> / {document.steps.length}</small>
        </strong>
      </header>
      <div
        className={`lp-teaching-lanes${step.visual ? " is-visual" : (focused || dense) && !hasReferences ? " is-full" : ""}`}
      >
        {step.visual ? <aside className="lp-teaching-visual">
          <TeachingCompanion document={document} visual={step.visual} targetIds={explanation.visualTargetIds}
            previousTargetIds={explanation.previousVisualTargetIds} progress={props.visualProgress ?? 1} timeline={props.visualTimeline} />
        </aside> : (!focused && !dense) || hasReferences ? (
          <aside className="lp-teaching-context">
            {!focused && !dense ? premises : null}
            {hasReferences ? (
              <div className="lp-teaching-references">
                <h4>{t("teachingDerivation.references")}</h4>
                {lane("reference")}
              </div>
            ) : null}
          </aside>
        ) : null}
        <section className="lp-teaching-current">
          <div className="lp-teaching-current-heading">
            <h3>{t("teachingDerivation.current")}</h3>
            <span>
              {t(
                step.relation === "introduce" && toStep > 1
                  ? "teachingDerivation.introduced"
                  : `teachingDerivation.relation.${step.relation}`,
              )}
            </span>
          </div>
          {lane("primary")}
          {step.visual && hasReferences ? <div className="lp-teaching-visual-references">
            <h4>{t("teachingDerivation.references")}</h4>{lane("reference")}
          </div> : null}
        </section>
      </div>
      <div className={`lp-teaching-support${focused && reserveGivens ? " has-givens" : ""}`}>
        {focused ? reserveGivens ? premises : null : dense ? premises : null}
        <footer className="lp-teaching-reason">
          <span>{t(focused ? "teachingDerivation.currentExplanation" : "teachingDerivation.reason")}</span>
          <TeachingCopy
            identity={reason}
            opacity={focused || previous?.justification === step.justification && previous?.conditions === step.conditions
              ? 1 : teachingBlockFrame({state: "enter", fromSlot: 0, toSlot: 0}, p).opacity}
          >
            <p>
              <BoardText text={reason} />
            </p>
          </TeachingCopy>
        </footer>
      </div>
    </div>
  );
}
