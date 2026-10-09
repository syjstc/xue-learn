"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderTeachingFormulaMarkup } from "../../../libs/teaching-derivation/src/index.js";
import {
  annotateLatex,
  walkFormulaNodes,
  wrapNodeId,
  type FormulaAnalysis,
  type FormulaTransition,
} from "../../../libs/formula-analysis/src/index.js";
import { KATEX_MACROS } from "../../shared/markdown/katex-macros.js";
import { sanitizeLatexMathBody } from "../../shared/markdown/normalize-latex-math.js";
import { cn } from "../../shared/utils.js";

type Box = { x: number; y: number; width: number; height: number };
type FormulaMarkup = { after: string; before: string };
type FormulaGeometry = {
  markup: FormulaMarkup;
  regions: MovingRegion[];
  beforeHeight: number;
  afterHeight: number;
};
type MovingRegion = {
  id: string;
  from: Box;
  to: Box;
  html: string;
  fontSize: string;
  beforeId?: string;
  afterId?: string;
  relationIndex?: number;
  afterRelationIndex?: number;
};

function sameMarkup(left: FormulaMarkup, right: FormulaMarkup) {
  return left.after === right.after && left.before === right.before;
}

function nearly(left: number, right: number) {
  return Math.abs(left - right) < 0.5;
}

function sameBox(left: Box, right: Box) {
  return (
    nearly(left.x, right.x) &&
    nearly(left.y, right.y) &&
    nearly(left.width, right.width) &&
    nearly(left.height, right.height)
  );
}

function sameGeometry(left: FormulaGeometry, right: FormulaGeometry) {
  return (
    // Parents may rebuild an equivalent transition on every render. That also
    // rebuilds the memoized markup wrapper, so reference equality here made the
    // layout effect commit identical geometry forever. Compare the rendered
    // KaTeX payload instead; it is the actual input the boxes were measured for.
    sameMarkup(left.markup, right.markup) &&
    nearly(left.beforeHeight, right.beforeHeight) &&
    nearly(left.afterHeight, right.afterHeight) &&
    left.regions.length === right.regions.length &&
    left.regions.every((region, index) => {
      const other = right.regions[index];
      return (
        other != null &&
        region.id === other.id &&
        region.html === other.html &&
        sameBox(region.from, other.from) &&
        sameBox(region.to, other.to)
      );
    })
  );
}

function renderTrusted(latex: string, original: string, display: boolean): string {
  return renderTeachingFormulaMarkup(sanitizeLatexMathBody(latex.trim()), sanitizeLatexMathBody(original.trim()), {
    strict: "ignore",
    displayMode: display,
    macros: KATEX_MACROS,
  });
}

/** Preserve KaTeX's complete layers (including unannotated rules and delimiters).
 * Only confidently matched regions are lifted out and translated; the remaining
 * notation dissolves between the two intact layouts. Progress is clock-owned.
 */
export function TeachingFormulaRenderer({
  after,
  before,
  transition,
  progress,
  jump = false,
  display = true,
  className,
  emphasis,
  cancelledNodeIds,
}: {
  after: FormulaAnalysis;
  before?: FormulaAnalysis | null;
  transition?: FormulaTransition | null;
  progress: number;
  jump?: boolean;
  display?: boolean;
  className?: string;
  cancelledNodeIds?: readonly string[];
  emphasis?: readonly { state: "before" | "after"; nodeId: string; sourceHash: string }[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const afterHost = useRef<HTMLDivElement>(null);
  const beforeHost = useRef<HTMLDivElement>(null);
  const t = jump ? 1 : Math.max(0, Math.min(1, progress));
  const smooth = (value: number) => {
    const p = Math.max(0, Math.min(1, value));
    return p * p * (3 - 2 * p);
  };
  const eased = smooth(t);
  const enterOpacity = smooth((t - 0.2) / 0.8);
  // Verified cancellation needs a readable strike phase before the factor exits.
  const exitOpacity = cancelledNodeIds?.length
    ? 1 - smooth((t - 0.4) / 0.6)
    : 1 - smooth(t / 0.6);
  const active = !!before && !!transition && t < 1;
  const emphasisKey = JSON.stringify(emphasis ?? []);
  const transitionKey = JSON.stringify(transition ?? null);
  const markup = useMemo(() => {
    const wrap = (
      analysis: FormulaAnalysis,
      side: "beforeNodeId" | "afterNodeId",
    ) =>
      annotateLatex(
        analysis.source,
        walkFormulaNodes(analysis.root).filter((node) =>
          transition?.regions.some((region) => region[side] === node.nodeId) ||
          (side === "beforeNodeId" && cancelledNodeIds?.includes(node.nodeId)) ||
          emphasis?.some(target => target.nodeId === node.nodeId && target.sourceHash === analysis.sourceHash),
        ),
        true,
      ).latex;
    return {
      after: renderTrusted(wrap(after, "afterNodeId"), after.source, display),
      before: before
        ? renderTrusted(wrap(before, "beforeNodeId"), before.source, display)
        : "",
    };
  }, [after, before, transition, display, emphasisKey, cancelledNodeIds]);
  const afterMarkup = markup.after;
  const beforeMarkup = markup.before;
  const [geometry, setGeometry] = useState<FormulaGeometry | null>(null);
  const geometryRef = useRef<FormulaGeometry | null>(null);

  useLayoutEffect(() => {
    const measuredTransition = JSON.parse(transitionKey) as FormulaTransition | null;
    const container = host.current;
    const oldLayer = beforeHost.current;
    const newLayer = afterHost.current;
    if (!container || !newLayer) return;
    let cancelled = false;
    let frame = 0;
    const measure = () => {
      if (cancelled) return;
      const root = container.getBoundingClientRect();
      // getBoundingClientRect is in screen pixels; positions are local CSS pixels
      // even when the classroom's 1920x1080 design is scaled for preview/export.
      const scale = container.offsetWidth
        ? root.width / container.offsetWidth
        : 1;
      const box = (node: HTMLElement): Box => {
        const rect = node.getBoundingClientRect();
        return {
          x: (rect.left - root.left) / scale + container.scrollLeft,
          y: (rect.top - root.top) / scale + container.scrollTop,
          width: rect.width / scale,
          height: rect.height / scale,
        };
      };
      const regions: MovingRegion[] = [];
      const occupiedBefore: HTMLElement[] = [];
      const occupiedAfter: HTMLElement[] = [];
      for (const region of measuredTransition?.regions ?? []) {
        if (
          (region.op !== "hold" && region.op !== "move") ||
          !region.beforeNodeId ||
          !region.afterNodeId
        )
          continue;
        const from = oldLayer?.querySelector<HTMLElement>(
          `#${CSS.escape(wrapNodeId(region.beforeNodeId))}`,
        );
        const to = newLayer.querySelector<HTMLElement>(
          `#${CSS.escape(wrapNodeId(region.afterNodeId))}`,
        );
        if (
          !from ||
          !to ||
          occupiedBefore.some(
            (node) => node !== from && (node.contains(from) || from.contains(node)),
          ) ||
          occupiedAfter.some((node) => node !== to && (node.contains(to) || to.contains(node)))
        )
          continue;
        occupiedBefore.push(from);
        occupiedAfter.push(to);
        const clone = from.cloneNode(true) as HTMLElement;
        clone.removeAttribute("id");
        clone.style.visibility = "visible";
        clone
          .querySelectorAll("[id]")
          .forEach((node) => node.removeAttribute("id"));
        regions.push({
          id: region.correspondenceId ?? region.beforeNodeId,
          beforeId: region.beforeNodeId,
          afterId: region.afterNodeId,
          from: box(from),
          to: box(to),
          html: clone.outerHTML,
          fontSize: getComputedStyle(from).fontSize,
        });
      }
      // Equality/inequality signs are layout tokens rather than operand nodes.
      // Match only a unique unchanged relation outside the lifted subtrees.
      const oldSigns = [
        ...(oldLayer?.querySelectorAll<HTMLElement>(".katex-html .mrel") ?? []),
      ];
      const newSigns = [
        ...newLayer.querySelectorAll<HTMLElement>(".katex-html .mrel"),
      ];
      oldSigns.forEach((from, index) => {
        const matches = newSigns.filter(
          (to) => to.textContent === from.textContent,
        );
        if (
          matches.length !== 1 ||
          oldSigns.filter((node) => node.textContent === from.textContent)
            .length !== 1
        )
          return;
        const to = matches[0]!;
        if (
          occupiedBefore.some((node) => node.contains(from)) ||
          occupiedAfter.some((node) => node.contains(to))
        )
          return;
        const clone = from.cloneNode(true) as HTMLElement;
        clone.style.visibility = "visible";
        regions.push({
          id: `relation-${index}`,
          from: box(from),
          to: box(to),
          html: clone.outerHTML,
          fontSize: getComputedStyle(from).fontSize,
          relationIndex: index,
          afterRelationIndex: newSigns.indexOf(to),
        });
      });
      const next = {
        markup: { after: afterMarkup, before: beforeMarkup },
        regions,
        beforeHeight: oldLayer?.offsetHeight ?? newLayer.offsetHeight,
        afterHeight: newLayer.offsetHeight,
      };
      // ResizeObserver and document.fonts.ready can both re-enter measurement
      // before React has committed the preceding layout-effect update. Compare
      // against a synchronously updated ref so identical measurements never
      // enqueue another render in that window.
      if (geometryRef.current && sameGeometry(geometryRef.current, next))
        return;
      geometryRef.current = next;
      setGeometry(next);
    };
    measure();
    void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    });
    // The host height tweens during motion. Observing it retriggers measure
    // every tick and can freeze the classroom window.
    observer.observe(newLayer);
    if (oldLayer) observer.observe(oldLayer);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [afterMarkup, beforeMarkup, transitionKey, className]);

  const measured =
    geometry && sameMarkup(geometry.markup, markup) ? geometry : null;
  // Hide matched glyphs in the complete layers only after their moving copies
  // have been measured. Unmatched signs, brackets, fraction rules stay present.
  useLayoutEffect(() => {
    if (!active || !measured) return;
    const hidden: { node: HTMLElement; visibility: string }[] = [];
    for (const region of measured.regions) {
      const from = region.beforeId
        ? beforeHost.current?.querySelector<HTMLElement>(
            `#${CSS.escape(wrapNodeId(region.beforeId))}`,
          )
        : beforeHost.current?.querySelectorAll<HTMLElement>(
            ".katex-html .mrel",
          )[region.relationIndex!];
      const to = region.afterId
        ? afterHost.current?.querySelector<HTMLElement>(
            `#${CSS.escape(wrapNodeId(region.afterId))}`,
          )
        : afterHost.current?.querySelectorAll<HTMLElement>(".katex-html .mrel")[
            region.afterRelationIndex!
          ];
      for (const node of [from, to]) {
        if (node && !hidden.some(item => item.node === node)) {
          hidden.push({ node, visibility: node.style.visibility });
          node.style.visibility = "hidden";
        }
      }
    }
    return () =>
      hidden.forEach(({ node, visibility }) => {
        node.style.visibility = visibility;
      });
  });

  useLayoutEffect(() => {
    const restored: { node: HTMLElement; color: string }[] = [];
    for (const target of emphasis ?? []) {
      const layer = target.state === "before" ? beforeHost.current : afterHost.current;
      const source = target.state === "before" ? before : after;
      if (source?.sourceHash !== target.sourceHash) continue;
      const element = layer?.querySelector<HTMLElement>(`#${CSS.escape(wrapNodeId(target.nodeId))}`);
      if (element) {
        for (const node of [element, ...element.querySelectorAll<HTMLElement>("*")]) {
          restored.push({ node, color: node.style.color });
          node.style.color = "var(--teaching-formula-emphasis, #167052)";
        }
      }
    }
    const cancelled: { node: HTMLElement; decoration: string }[] = [];
    if (active && t > 0.12) for (const id of cancelledNodeIds ?? []) {
      const node = beforeHost.current?.querySelector<HTMLElement>(`#${CSS.escape(wrapNodeId(id))}`);
      if (node) { cancelled.push({ node, decoration: node.style.textDecoration }); node.style.textDecoration = "line-through var(--teaching-formula-cancellation, #ad6635) 2px"; }
    }
    return () => { restored.forEach(({ node, color }) => { node.style.color = color; }); cancelled.forEach(({ node, decoration }) => { node.style.textDecoration = decoration; }); };
  });
  const emphasizedRegion = (region: MovingRegion) => (emphasis ?? []).some(target => {
    const analysis = target.state === "before" ? before : after;
    const movingId = target.state === "before" ? region.beforeId : region.afterId;
    if (!analysis || analysis.sourceHash !== target.sourceHash || !movingId) return false;
    const targetNode = walkFormulaNodes(analysis.root).find(node => node.nodeId === target.nodeId);
    return targetNode && walkFormulaNodes(targetNode).some(node => node.nodeId === movingId);
  });

  return (
    <div
      ref={host}
      className={cn(
        // overflow-x:auto otherwise computes overflow-y:auto. While the host
        // height is tweened, a vertical scrollbar can resize the observed
        // formula layers and feed their measurement back into React forever.
        "relative min-h-[4rem] overflow-x-auto overflow-y-hidden",
        className,
      )}
      data-teaching-motion={active ? "running" : "rest"}
      data-motion-progress={t}
      style={
        active && measured
          ? {
              height:
                measured.beforeHeight +
                (measured.afterHeight - measured.beforeHeight) * eased,
            }
          : undefined
      }
    >
      <div
        ref={afterHost}
        className="teaching-formula-measure flow-root"
        style={{ opacity: active ? enterOpacity : 1 }}
        dangerouslySetInnerHTML={{ __html: markup.after }}
      />
      {before ? (
        <div
          ref={beforeHost}
          className="pointer-events-none absolute inset-x-0 top-0 teaching-formula-measure flow-root"
          style={{ opacity: active ? exitOpacity : 0 }}
          aria-hidden
          dangerouslySetInnerHTML={{ __html: markup.before }}
        />
      ) : null}
      {active
        ? measured?.regions.map((region) => (
            <span
              key={region.id}
              className="katex pointer-events-none absolute"
              aria-hidden
              data-moving-region={region.id}
              style={{
                position: "absolute",
                display: "block",
                left: 0,
                top: 0,
                color: emphasizedRegion(region) ? "var(--teaching-formula-emphasis, #167052)" : undefined,
                fontSize: region.fontSize,
                lineHeight: `${region.from.height}px`,
                transformOrigin: "top left",
                transform: `translate(${region.from.x + (region.to.x - region.from.x) * eased}px, ${region.from.y + (region.to.y - region.from.y) * eased + (region.relationIndex === undefined && Math.abs(region.to.x - region.from.x) > region.from.width * 1.5 && Math.abs(region.to.y - region.from.y) < 4 ? Math.sign(region.to.x - region.from.x) * Math.min(18, region.from.height * 0.45) * Math.sin(Math.PI * eased) : 0)}px)`,
                whiteSpace: "nowrap",
              }}
              dangerouslySetInnerHTML={{ __html: region.html }}
            />
          ))
        : null}
    </div>
  );
}
