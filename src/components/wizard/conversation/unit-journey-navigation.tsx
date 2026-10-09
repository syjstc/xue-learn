"use client";

import { useState } from "react";
import {
  BookOpenText,
  Check,
  ChevronRight,
  Circle,
  Drama,
  FlaskConical,
  ListTree,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { DesktopTitlebarPortal } from "@/components/layout/desktop-titlebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/ui/sheet";
import { cn } from "@xue-learn/core/utils";
import type {
  UnitJourneyActivity,
  UnitJourneyNode,
  UnitJourneyReference,
} from "./unit-journey.ts";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";

function StatusIcon({ node }: { node: UnitJourneyNode }) {
  if (node.status === "completed") return <Check aria-hidden />;
  if (node.status === "locked") return <LockKeyhole aria-hidden />;
  if (node.status === "current") return <ChevronRight aria-hidden />;
  return <Circle aria-hidden />;
}

const NODE_LABEL_KEYS: Record<
  Exclude<UnitJourneyNode["kind"], "section">,
  TranslationKey
> = {
  preview: "learningJourney.preview",
  questions: "learningJourney.questions",
  recall: "learningJourney.recall",
  correction: "learningJourney.correction",
  complete: "learningJourney.complete",
};

const REFERENCE_LABEL_KEYS: Record<UnitJourneyReference["id"], TranslationKey> =
  {
    map: "learningJourney.map",
    notes: "learningJourney.notes",
  };

export function UnitJourneyNavigation({
  nodes,
  references,
  activities = [],
  currentId,
  desktopExpanded,
  onDesktopExpandedChange,
  onSelectNode,
  onSelectReference,
  onSelectActivity,
  immersive = false,
  immersiveOpen,
  onImmersiveOpenChange,
}: {
  nodes: UnitJourneyNode[];
  references: UnitJourneyReference[];
  activities?: UnitJourneyActivity[];
  currentId: string;
  desktopExpanded: boolean;
  onDesktopExpandedChange: (expanded: boolean) => void;
  onSelectNode: (node: UnitJourneyNode) => void;
  onSelectReference: (reference: UnitJourneyReference) => void;
  onSelectActivity?: (activity: UnitJourneyActivity) => void;
  immersive?: boolean;
  immersiveOpen?: boolean;
  onImmersiveOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [localOpen, setLocalOpen] = useState(false);
  const open = immersive ? Boolean(immersiveOpen) : localOpen;
  const setOpen = (next: boolean) => {
    if (immersive) onImmersiveOpenChange?.(next);
    else setLocalOpen(next);
  };
  const current = nodes.find((node) => node.id === currentId) ?? nodes[0];
  const nodeLabel = (node: UnitJourneyNode) =>
    node.label ??
    (node.kind === "section"
      ? t("learningJourney.section")
      : t(NODE_LABEL_KEYS[node.kind]));

  const journeyContent = (
    <>
      <ol className="space-y-1">
        {nodes.map((node) => {
          const disabled = node.status === "locked";
          return (
            <li key={node.id}>
              <button
                type="button"
                disabled={disabled}
                aria-current={node.id === currentId ? "step" : undefined}
                title={
                  disabled
                    ? `${nodeLabel(node)} · ${t("learningJourney.lockedHint")}`
                    : nodeLabel(node)
                }
                onClick={() => {
                  onSelectNode(node);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                  node.id === currentId
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-muted",
                  disabled &&
                    "cursor-not-allowed text-muted-foreground opacity-65",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border [&_svg]:size-3.5",
                    node.status === "completed" &&
                      "border-[var(--success-500)] bg-[var(--success-50)] text-[var(--success-600)]",
                    node.status === "current" &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  <StatusIcon node={node} />
                </span>
                <span className="min-w-0 flex-1 line-clamp-2 leading-5">
                  {nodeLabel(node)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {activities.length ? (
        <>
          <div className="my-4 border-t" />
          <p className="mb-2 px-2.5 text-xs font-semibold text-muted-foreground">
            {t("learningJourney.practice")}
          </p>
          <ul className="space-y-1">
            {activities.map((activity) => (
              <li key={activity.id}>
                <button
                  type="button"
                  disabled={!activity.available}
                  aria-current={
                    currentId === `activity:${activity.id}` ? "page" : undefined
                  }
                  onClick={() => {
                    onSelectActivity?.(activity);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-65",
                    currentId === `activity:${activity.id}` &&
                      "bg-primary/10 font-semibold text-primary",
                  )}
                >
                  {activity.id === "lab" ? (
                    <FlaskConical aria-hidden className="size-4" />
                  ) : (
                    <Drama aria-hidden className="size-4" />
                  )}
                  {t(
                    activity.id === "lab"
                      ? "learningJourney.lab"
                      : "learningJourney.theater",
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="my-4 border-t" />
      <p className="mb-2 px-2.5 text-xs font-semibold text-muted-foreground">
        {t("learningJourney.references")}
      </p>
      <ul className="space-y-1">
        {references.map((reference) => (
          <li key={reference.id}>
            <button
              type="button"
              disabled={!reference.available}
              onClick={() => {
                onSelectReference(reference);
                setOpen(false);
              }}
              className="flex min-h-10 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-65"
            >
              <BookOpenText aria-hidden className="size-4" />
              {t(REFERENCE_LABEL_KEYS[reference.id])}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <>
      {immersive ? (
        <DesktopTitlebarPortal>
          <div
            data-desktop-immersive-journey
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1.5 rounded-md px-2"
              onClick={() => setOpen(true)}
              aria-label={t("learningJourney.expand")}
              title={t("learningJourney.expand")}
            >
              <ListTree aria-hidden className="size-3.5" />
              <span className="text-xs">{t("learningJourney.outline")}</span>
            </Button>
            <span
              className="h-4 w-px shrink-0 bg-[var(--border-200)]"
              aria-hidden
            />
            <h2 className="min-w-0 truncate text-xs font-semibold text-[var(--text-700)]">
              {current ? nodeLabel(current) : t("learningJourney.content")}
            </h2>
          </div>
        </DesktopTitlebarPortal>
      ) : null}
      <header
        className={cn(
          "sticky top-12 z-30 -mx-4 min-w-0 overflow-hidden bg-linear-to-b from-background via-background/95 to-transparent px-4 py-2 sm:top-14",
          immersive
            ? "immersive-journey-bar fixed top-0 right-0 left-0 z-[calc(var(--z-fullscreen)+1)] mx-0 flex h-16 items-center border-b border-[var(--course-content-border)] bg-background/96 px-4 py-0 backdrop-blur sm:top-0 lg:flex"
            : "lg:hidden",
        )}
      >
        <div
          className={cn(
            "mx-auto flex min-w-0 w-full max-w-[48rem] items-center gap-2",
            immersive && "mx-0 max-w-none pr-14",
          )}
        >
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground/90">
              {current ? nodeLabel(current) : t("learningJourney.content")}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("shrink-0 gap-1.5 px-2", immersive && "order-first")}
            onClick={() => setOpen(true)}
            aria-label={t("learningJourney.expand")}
            title={t("learningJourney.expand")}
          >
            <ListTree aria-hidden />
            <span className="text-xs">{t("learningJourney.outline")}</span>
          </Button>
        </div>
      </header>

      <aside
        className={cn(
          "sticky top-[4.75rem] hidden max-h-[calc(100vh-6rem)] min-h-0 self-start lg:flex lg:flex-col",
          immersive && "lg:hidden",
          desktopExpanded
            ? "w-80 border-r border-[var(--course-content-border)] pr-4"
            : "w-11 items-center",
        )}
        aria-label={t("learningJourney.title")}
      >
        {desktopExpanded ? (
          <>
            <div className="mb-3 flex items-center gap-2 px-2.5">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {t("learningJourney.title")}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onDesktopExpandedChange(false)}
                aria-label={t("learningJourney.collapse")}
                title={t("learningJourney.collapse")}
              >
                <PanelLeftClose aria-hidden />
              </Button>
            </div>
            <nav className="min-h-0 overflow-y-auto pb-3">{journeyContent}</nav>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="sticky top-[4.75rem]"
            onClick={() => onDesktopExpandedChange(true)}
            aria-label={t("learningJourney.expand")}
            title={t("learningJourney.expand")}
          >
            <PanelLeftOpen aria-hidden />
          </Button>
        )}
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          data-immersive-journey-sheet={immersive ? "true" : undefined}
          className="w-[min(92vw,25rem)] gap-0 p-0"
        >
          <SheetHeader className="border-b">
            <SheetTitle>{t("learningJourney.title")}</SheetTitle>
            <SheetDescription>
              {t("learningJourney.description")}
            </SheetDescription>
          </SheetHeader>
          <nav
            className="min-h-0 flex-1 overflow-y-auto p-3"
            aria-label={t("learningJourney.title")}
          >
            {journeyContent}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
