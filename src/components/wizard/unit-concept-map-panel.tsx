"use client";

import { BrainCircuit, ChevronDown, CircleDot, Route } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  LlmMarkdown,
  LlmMarkdownInline,
} from "@/components/markdown/llm-markdown";
import { useUnitConceptMap } from "@/hooks/api";
import {
  conceptMapNodeById,
  connectedConceptNodeIds,
  layoutUnitConceptMap,
  unitConceptMapRelations,
} from "@/shared/domain/unit-concept-map";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

const KIND_KEYS: Record<string, TranslationKey> = {
  atom: "wizard.reference.map.kind.atom", concept: "wizard.reference.map.kind.concept", skill: "wizard.reference.map.kind.skill", competency: "wizard.reference.map.kind.competency",
} as const;

const RELATION_PERSPECTIVE_KEYS = {
  prerequisite: {
    outgoing: "wizard.reference.map.relation.prerequisiteOutgoing", incoming: "wizard.reference.map.relation.prerequisiteIncoming",
  },
  part_of: {
    outgoing: "wizard.reference.map.relation.partOfOutgoing", incoming: "wizard.reference.map.relation.partOfIncoming",
  },
  causes: {
    outgoing: "wizard.reference.map.relation.causesOutgoing", incoming: "wizard.reference.map.relation.causesIncoming",
  },
  contrasts: {
    outgoing: "wizard.reference.map.relation.contrasts", incoming: "wizard.reference.map.relation.contrasts",
  },
  constrains: {
    outgoing: "wizard.reference.map.relation.constrainsOutgoing", incoming: "wizard.reference.map.relation.constrainsIncoming",
  },
  supports: {
    outgoing: "wizard.reference.map.relation.supportsOutgoing", incoming: "wizard.reference.map.relation.supportsIncoming",
  },
  enables: {
    outgoing: "wizard.reference.map.relation.enablesOutgoing", incoming: "wizard.reference.map.relation.enablesIncoming",
  },
} as const;

function useElementWidth() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(720);
  const ref = useCallback((node: HTMLElement | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (!element) return;
    const update = () => setWidth(Math.max(280, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, width };
}

function edgePath(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
) {
  const sourceCenterX = from.x + from.width / 2;
  const sourceCenterY = from.y + from.height / 2;
  const targetCenterX = to.x + to.width / 2;
  const targetCenterY = to.y + to.height / 2;
  const verticalDistance = targetCenterY - sourceCenterY;

  if (Math.abs(verticalDistance) > from.height * 0.65) {
    const downward = verticalDistance > 0;
    const startY = downward ? from.y + from.height : from.y;
    const endY = downward ? to.y : to.y + to.height;
    const bendY = startY + (endY - startY) / 2;
    return `M ${sourceCenterX} ${startY} C ${sourceCenterX} ${bendY}, ${targetCenterX} ${bendY}, ${targetCenterX} ${endY}`;
  }

  const rightward = targetCenterX > sourceCenterX;
  const startX = rightward ? from.x + from.width : from.x;
  const endX = rightward ? to.x : to.x + to.width;
  const bendX = startX + (endX - startX) / 2;
  return `M ${startX} ${sourceCenterY} C ${bendX} ${sourceCenterY}, ${bendX} ${targetCenterY}, ${endX} ${targetCenterY}`;
}

export function UnitConceptMapPanel({ unitId }: { unitId: string }) {
  const t = useT();
  const mapQuery = useUnitConceptMap(unitId);
  const map = mapQuery.data;
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { ref: canvasRef, width: canvasWidth } = useElementWidth();
  const arrowId = useId().replace(/:/g, "");
  const mutedArrowId = `${arrowId}-muted`;

  useEffect(() => {
    if (!map?.nodes.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current && map.nodes.some((node) => node.id === current) ? current : null,
    );
  }, [map]);

  const layout = useMemo(
    () => (map ? layoutUnitConceptMap(map, canvasWidth) : null),
    [canvasWidth, map],
  );

  if (mapQuery.isLoading) {
    return (
      <div className="animate-pulse rounded-2xl border border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)] p-4 md:p-6">
        <div className="h-5 w-36 rounded bg-[var(--course-content-border)]" />
        <div className="mt-3 h-3 w-64 max-w-full rounded bg-[var(--course-content-border)]" />
        <div className="mt-5 h-40 rounded-xl bg-[var(--course-content-border)]/60" />
      </div>
    );
  }

  if (!map || map.status !== "ready" || map.nodes.length < 2 || !layout) {
    const message = mapQuery.isError
      ? t("wizard.reference.map.loadError")
      : map?.status === "building"
        ? t("wizard.reference.map.building")
        : t("wizard.reference.map.notNeeded");
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)] p-4 md:p-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-100)] text-[var(--brand-700)]">
          <BrainCircuit className="size-4.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span
            className="block font-semibold text-[var(--course-content)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("wizard.reference.map.title")}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-[var(--course-content-muted)]">
            {message}
          </span>
        </span>
      </section>
    );
  }

  const nodesById = conceptMapNodeById(map);
  const selectedNode = selectedId ? nodesById.get(selectedId) : undefined;
  const selectedRelations = selectedId
    ? unitConceptMapRelations(map, selectedId)
    : [];
  const connectedIds = connectedConceptNodeIds(map, selectedId);
  const layoutNodesById = new Map(layout.nodes.map((node) => [node.id, node]));

  return (
    <section className="@container/concept-map overflow-hidden rounded-2xl border border-[var(--brand-200)] bg-[var(--brand-50)]/45">
      <button
        type="button"
        className="flex w-full items-start gap-3 p-4 text-left @[32rem]/concept-map:p-6"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-100)] text-[var(--brand-700)]">
          <BrainCircuit className="size-4.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-semibold text-[var(--course-content)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("wizard.reference.map.title")}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-[var(--course-content-muted)]">
            {t("wizard.reference.map.description")}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-[var(--course-content-muted)] transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-t border-[var(--brand-200)] p-3 @[32rem]/concept-map:p-5">
          <div className="mb-2 flex items-center justify-between gap-3 px-1 text-[11px] text-[var(--course-content-muted)] @[52rem]/concept-map:hidden">
            <span>{t("wizard.reference.map.readTopDown")}</span>
            <span>{t("wizard.reference.map.arrowDirection")}</span>
          </div>
          <div className="grid min-w-0 gap-4 @[52rem]/concept-map:grid-cols-[minmax(0,1fr)_20rem]">
            <div
              ref={canvasRef}
              className="relative min-w-0 overflow-hidden rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)]"
              style={{ height: layout.height }}
            >
              <svg
                className="pointer-events-none absolute inset-0 size-full"
                aria-hidden
                viewBox={`0 0 ${layout.width} ${layout.height}`}
              >
                <defs>
                  <marker
                    id={arrowId}
                    markerWidth="10"
                    markerHeight="10"
                    refX="9.5"
                    refY="5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0,0 L10,5 L0,10 Z" fill="var(--brand-600)" />
                  </marker>
                  <marker
                    id={mutedArrowId}
                    markerWidth="10"
                    markerHeight="10"
                    refX="9.5"
                    refY="5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path
                      d="M0,0 L10,5 L0,10 Z"
                      fill="var(--course-content-muted)"
                    />
                  </marker>
                </defs>
                {map.edges.map((edge) => {
                  const from = layoutNodesById.get(edge.fromNodeId);
                  const to = layoutNodesById.get(edge.toNodeId);
                  if (!from || !to) return null;
                  const active =
                    !selectedId ||
                    edge.fromNodeId === selectedId ||
                    edge.toNodeId === selectedId;
                  return (
                    <path
                      key={edge.id}
                      d={edgePath(from, to)}
                      fill="none"
                      stroke={
                        active
                          ? "var(--brand-600)"
                          : "var(--course-content-muted)"
                      }
                      strokeLinecap="round"
                      strokeWidth={active ? 2.5 : 1.5}
                      opacity={active ? 0.88 : 0.24}
                      markerEnd={`url(#${active ? arrowId : mutedArrowId})`}
                    />
                  );
                })}
              </svg>

              {layout.nodes.map((node) => {
                const selected = node.id === selectedId;
                const dimmed = Boolean(
                  selectedId && !connectedIds.has(node.id),
                );
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={cn(
                      "absolute flex flex-col items-start justify-center rounded-xl border px-3 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)]",
                      selected
                        ? "border-[var(--brand-500)] bg-[var(--brand-50)] ring-2 ring-[var(--brand-100)]"
                        : "border-[var(--course-content-border)] bg-[var(--course-content-surface)] hover:border-[var(--brand-300)]",
                      dimmed && "opacity-45",
                    )}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      height: node.height,
                    }}
                    aria-pressed={selected}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <span className="text-[10px] font-semibold text-[var(--brand-600)]">
                      {t(KIND_KEYS[node.kind]!)}
                      {!node.isDirect ? t("wizard.reference.map.relatedSuffix") : ""}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs font-semibold leading-4 text-[var(--course-content)] @[30rem]/concept-map:text-sm [&_.katex]:text-[0.95em]">
                      <LlmMarkdownInline content={node.title} />
                    </span>
                  </button>
                );
              })}
            </div>

            <aside className="min-w-0 rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)] p-4">
              {selectedNode ? (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-600)]">
                    {t(KIND_KEYS[selectedNode.kind]!)}
                    {!selectedNode.isDirect ? t("wizard.reference.map.relatedKnowledgeSuffix") : t("wizard.reference.map.focusSuffix")}
                  </p>
                  <h4 className="mt-1 font-semibold leading-6 text-[var(--course-content)] [&_.katex]:text-[1em]">
                    <LlmMarkdownInline content={selectedNode.title} />
                  </h4>
                  {selectedNode.description ? (
                    <div className="mt-2 [&_.katex]:text-[1em]">
                      <LlmMarkdown
                        content={selectedNode.description}
                        variant="compact"
                        className="text-[var(--course-content-muted)]"
                      />
                    </div>
                  ) : null}
                  <div className="mt-4 border-t border-[var(--course-content-border)] pt-3">
                    <p className="text-xs font-semibold text-[var(--course-content)]">
                      {t("wizard.reference.map.directRelations")}
                    </p>
                    {selectedRelations.length ? (
                      <ul className="mt-2 space-y-2">
                        {selectedRelations.map((edge) => {
                          const outgoing = edge.fromNodeId === selectedNode.id;
                          const other = nodesById.get(
                            outgoing ? edge.toNodeId : edge.fromNodeId,
                          );
                          const relationLabel =
                            RELATION_PERSPECTIVE_KEYS[edge.relationType][
                              outgoing ? "outgoing" : "incoming"
                            ];
                          return (
                            <li
                              key={edge.id}
                              className="rounded-lg bg-[var(--course-content-surface-muted)] px-3 py-2"
                            >
                              <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--course-content)] [&_.katex]:text-[0.95em]">
                                <Route
                                  className="mt-0.5 size-3.5 shrink-0 text-[var(--brand-600)]"
                                  aria-hidden
                                />
                                <span>
                                  {t(relationLabel)}
                                  {other ? (
                                    <>
                                      {" · "}
                                      <LlmMarkdownInline content={other.title} />
                                    </>
                                  ) : null}
                                </span>
                              </p>
                              {edge.rationale ? (
                                <div className="mt-1 [&_.katex]:text-[0.95em]">
                                  <LlmMarkdown
                                    content={edge.rationale}
                                    variant="compact"
                                    className="text-xs text-[var(--course-content-muted)]"
                                  />
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-2 flex items-center gap-2 text-xs text-[var(--course-content-muted)]">
                        <CircleDot className="size-3.5" aria-hidden />
                        {t("wizard.reference.map.independentCore")}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex min-h-36 flex-col items-center justify-center text-center">
                  <Route
                    className="size-6 text-[var(--brand-500)]"
                    aria-hidden
                  />
                  <p className="mt-3 text-sm font-semibold text-[var(--course-content)]">
                    {t("wizard.reference.map.selectNode")}
                  </p>
                  <p className="mt-1 max-w-64 text-xs leading-5 text-[var(--course-content-muted)]">
                    {t("wizard.reference.map.selectNodeDescription")}
                  </p>
                </div>
              )}
            </aside>
          </div>
          <p className="mt-3 text-xs text-[var(--course-content-muted)]">
            {t("wizard.reference.map.footer")}
            {map.isStale ? t("wizard.reference.map.stale") : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
