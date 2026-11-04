import { translateCurrent } from "@xue-learn/core/i18n";
import {
  LearningBranchCard,
  LearningReturnSuggestion,
} from "@/features/learning-trajectory/branch-card";
("use client");

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCheck,
  CircleCheck,
  CircleX,
  FolderPlus,
  Sparkles,
} from "lucide-react";
import type { AgentClientAction } from "@/shared/agent/client-actions";
import {
  type AgentClientActionButton,
  resolveClientAction,
} from "@/shared/agent/client-actions";
import type { PendingToolUi } from "@/shared/agent/types";
import {
  isActionButtonSelected,
  textInputAnswerFromSubmitted,
} from "@/shared/agent/tool-ui-submitted";
import type { GoalMapPlan } from "@/shared/api";
import { cn } from "@xue-learn/core/utils";
import { CollectFormCard } from "./collect-form-card.tsx";
import { ConfirmationCard } from "./confirmation-card.tsx";
import { DiscoveryQuestionsCard } from "./discovery-questions-card.tsx";
import { PlanEditorCard } from "./plan-editor-card.tsx";
import { GoalScopeRoadmapPreviewCard } from "./goal-scope-roadmap-preview-card.tsx";
import type { KnowledgeActivity } from "@xue-learn/core/domain";
import { KnowledgeActivityCard } from "./knowledge-activity-card.tsx";
import { useT } from "@xue-learn/core/i18n";
import { useLearningSpaces } from "@/hooks/api/use-learning-spaces";
import { useGoals } from "@/hooks/api/use-goals";
import { MathSceneView } from "@/components/math/math-scene";
import type { MathScene } from "@xue-learn/core/domain";
import { SvgDiagramBlock } from "@/components/wizard/interactive-material/blocks/svg-diagram";
import { InteractiveHtmlBlock } from "@/components/wizard/interactive-material/blocks/interactive-html-block";
import type { InteractiveBlock } from "@xue-learn/core/schemas";

type ToolQuestion = {
  id: string;
  text: string;
  hint?: string;
  answerKind: "text" | "single_choice" | "multi_choice";
  choices?: string[];
};

function GoalSpaceSuggestionCard({
  args,
  submitted,
  disabled,
  onSubmit,
}: {
  args: Record<string, unknown>;
  submitted?: Record<string, unknown>;
  disabled?: boolean;
  onSubmit: (result: unknown) => void;
}) {
  const t = useT();
  const name = String(args.name ?? "").trim();
  const accepted = submitted?.action === "create";
  const skipped = submitted?.action === "skip";

  if (accepted || skipped) {
    return (
      <section
        className={cn(
          "flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm shadow-sm",
          accepted
            ? "border-primary/25 bg-primary/[0.06]"
            : "border-border bg-card",
        )}
        role="status"
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            accepted
              ? "bg-primary/12 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {accepted ? (
            <CircleCheck className="size-5" aria-hidden />
          ) : (
            <CircleX className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="font-semibold leading-5 text-foreground">
            {accepted
              ? t("spaces.goalSuggestion.created", { name })
              : t("spaces.goalSuggestion.skipped")}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("spaces.goalSuggestion.continuing")}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card text-sm shadow-sm">
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderPlus className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-6 text-foreground">
            {t("spaces.goalSuggestion.title")}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {String(args.reason ?? t("spaces.goalSuggestion.description"))}
          </p>
        </div>
      </div>
      <div className="mx-4 rounded-xl border border-border bg-muted/35 px-3.5 py-3">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <FolderPlus className="size-4 text-primary" aria-hidden />
          <span>{name}</span>
        </div>
        {args.purpose ? (
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {String(args.purpose)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-4">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ action: "create" })}
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
        >
          {t("spaces.goalSuggestion.create")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ action: "skip" })}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-card px-4 font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {t("spaces.goalSuggestion.skip")}
        </button>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {t("spaces.goalSuggestion.optional")}
        </span>
      </div>
    </section>
  );
}

function SpaceOrganizationPreviewCard({
  args,
  disabled,
  onSubmit,
}: {
  args: Record<string, unknown>;
  disabled?: boolean;
  onSubmit: (result: unknown) => void;
}) {
  const t = useT();
  const portfolio = useLearningSpaces();
  const goals = useGoals();
  const operations = useMemo(
    () =>
      [
        ...(Array.isArray(args.createSpaces)
          ? args.createSpaces.map((value) => ({
              kind: "create_space" as const,
              value,
            }))
          : []),
        ...(Array.isArray(args.updateSpaces)
          ? args.updateSpaces.map((value) => ({
              kind: "update_space" as const,
              value,
            }))
          : []),
        ...(Array.isArray(args.moveGoals)
          ? args.moveGoals.map((value) => ({
              kind: "move_goal" as const,
              value,
            }))
          : []),
        ...(Array.isArray(args.reorderItems)
          ? args.reorderItems.map((value) => ({
              kind: "reorder" as const,
              value,
            }))
          : []),
        ...(Array.isArray(args.plannedGoals)
          ? args.plannedGoals.map((value) => ({
              kind: "planned_goal" as const,
              value,
            }))
          : []),
        ...(Array.isArray(args.relations)
          ? args.relations.map((value) => ({
              kind: "relation" as const,
              value,
            }))
          : []),
      ].filter(
        (
          entry,
        ): entry is {
          kind:
            | "create_space"
            | "update_space"
            | "move_goal"
            | "reorder"
            | "planned_goal"
            | "relation";
          value: Record<string, unknown>;
        } => Boolean(entry.value && typeof entry.value === "object"),
      ),
    [args],
  );
  const ids = operations.flatMap((operation) =>
    typeof operation.value.operationId === "string"
      ? [operation.value.operationId]
      : [],
  );
  const [selected, setSelected] = useState(() => new Set(ids));
  const labels = useMemo(() => {
    const spaces = portfolio.data?.spaces ?? [];
    const spaceNames = new Map(spaces.map((space) => [space.id, space.name]));
    const goalNames = new Map([
      ...(goals.data ?? []).map((goal) => [goal.id, goal.title] as const),
      ...spaces.flatMap((space) =>
        space.items.flatMap((item) =>
          item.goal ? [[item.goal.id, item.goal.title] as const] : [],
        ),
      ),
      ...(portfolio.data?.unorganizedGoals ?? []).map(
        (goal) => [goal.id, goal.title] as const,
      ),
    ]);
    const itemNames = new Map(
      spaces.flatMap((space) =>
        space.items.map(
          (item) => [item.id, item.goal?.title || item.plannedTitle] as const,
        ),
      ),
    );
    const createdSpaceNames = new Map(
      operations.flatMap(({ kind, value }) =>
        kind === "create_space" &&
        typeof value.ref === "string" &&
        typeof value.name === "string"
          ? [[value.ref, value.name] as const]
          : [],
      ),
    );
    const plannedGoalNames = new Map(
      operations.flatMap(({ kind, value }) =>
        kind === "planned_goal" &&
        typeof value.ref === "string" &&
        typeof value.title === "string"
          ? [[value.ref, value.title] as const]
          : [],
      ),
    );

    const targetName = (value: unknown) => {
      if (!value || typeof value !== "object")
        return t("spaces.preview.unknownSpace");
      const target = value as Record<string, unknown>;
      if (typeof target.spaceId === "string") {
        return (
          spaceNames.get(target.spaceId) ?? t("spaces.preview.unknownSpace")
        );
      }
      if (typeof target.spaceRef === "string") {
        return (
          createdSpaceNames.get(target.spaceRef) ?? t("spaces.preview.newSpace")
        );
      }
      return t("spaces.preview.unknownSpace");
    };
    const itemName = (value: unknown) => {
      if (!value || typeof value !== "object")
        return t("spaces.preview.unknownGoal");
      const item = value as Record<string, unknown>;
      if (typeof item.goalId === "string") {
        return (
          goalNames.get(item.goalId) ??
          itemNames.get(item.goalId) ??
          t("spaces.preview.unknownGoal")
        );
      }
      if (typeof item.itemId === "string") {
        return (
          itemNames.get(item.itemId) ??
          goalNames.get(item.itemId) ??
          t("spaces.preview.unknownGoal")
        );
      }
      if (typeof item.itemRef === "string") {
        return (
          plannedGoalNames.get(item.itemRef) ??
          goalNames.get(item.itemRef) ??
          itemNames.get(item.itemRef) ??
          t("spaces.preview.plannedGoal")
        );
      }
      return t("spaces.preview.unknownGoal");
    };

    return new Map(
      operations.map(({ kind, value }) => {
        const id = String(value.operationId ?? "");
        const reason = String(value.reason ?? value.rationale ?? "").trim();
        if (kind === "create_space") {
          return [
            id,
            {
              kind: t("spaces.preview.createSpaceKind"),
              label: String(value.name ?? t("spaces.preview.newSpace")),
              detail: String(value.purpose ?? "").trim(),
            },
          ] as const;
        }
        if (kind === "update_space") {
          const space =
            typeof value.spaceId === "string"
              ? (spaceNames.get(value.spaceId) ??
                t("spaces.preview.unknownSpace"))
              : t("spaces.preview.unknownSpace");
          const changes = [
            typeof value.name === "string"
              ? t("spaces.preview.renameTo", { name: value.name })
              : "",
            typeof value.purpose === "string"
              ? t("spaces.preview.updatePurpose")
              : "",
            reason,
          ].filter(Boolean);
          return [
            id,
            {
              kind: t("spaces.preview.updateSpaceKind"),
              label: space,
              detail: changes.join(" · "),
            },
          ] as const;
        }
        if (kind === "move_goal") {
          const goal =
            typeof value.goalId === "string"
              ? (goalNames.get(value.goalId) ??
                itemNames.get(value.goalId) ??
                t("spaces.preview.unknownGoal"))
              : t("spaces.preview.unknownGoal");
          const destination = targetName(value.target);
          return [
            id,
            {
              kind: t("spaces.preview.moveGoalKind"),
              label: goal,
              detail: [
                t("spaces.preview.moveTo", { space: destination }),
                reason,
              ]
                .filter(Boolean)
                .join(" · "),
            },
          ] as const;
        }
        if (kind === "reorder") {
          const space =
            typeof value.spaceId === "string"
              ? (spaceNames.get(value.spaceId) ??
                createdSpaceNames.get(value.spaceId) ??
                t("spaces.preview.unknownSpace"))
              : t("spaces.preview.unknownSpace");
          return [
            id,
            {
              kind: t("spaces.preview.reorderKind"),
              label: t("spaces.preview.reorderSpace", { space }),
              detail: reason,
            },
          ] as const;
        }
        if (kind === "planned_goal") {
          return [
            id,
            {
              kind: t("spaces.preview.plannedGoalKind"),
              label: String(value.title ?? t("spaces.preview.plannedGoal")),
              detail: [
                t("spaces.preview.addTo", { space: targetName(value.target) }),
                reason,
              ]
                .filter(Boolean)
                .join(" · "),
            },
          ] as const;
        }
        const from = itemName(value.from);
        const to = itemName(value.to);
        const relationType = String(value.relationType ?? "related");
        const relationLabel =
          relationType === "prerequisite"
            ? t("spaces.preview.prerequisite", { from, to })
            : relationType === "supports"
              ? t("spaces.preview.supports", { from, to })
              : relationType === "follow_up"
                ? t("spaces.preview.followUp", { from, to })
                : t("spaces.preview.related", { from, to });
        return [
          id,
          {
            kind:
              relationType === "related"
                ? t("spaces.preview.relatedKind")
                : t("spaces.preview.learningOrderKind"),
            label: relationLabel,
            detail: "",
          },
        ] as const;
      }),
    );
  }, [goals.data, operations, portfolio.data, t]);
  const allSelected = ids.length > 0 && selected.size === ids.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-sm">
      <div className="border-b border-border/70 px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-6 text-foreground">
              {String(args.title ?? t("spaces.preview.title"))}
            </p>
            {args.summary ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {String(args.summary)}
              </p>
            ) : null}
            <p className="mt-2 text-xs font-medium leading-5 text-foreground/75">
              {t("spaces.preview.breakdown", {
                spaces: operations.filter(
                  (operation) =>
                    operation.kind === "create_space" ||
                    operation.kind === "update_space",
                ).length,
                moves: operations.filter(
                  (operation) => operation.kind === "move_goal",
                ).length,
                planned: operations.filter(
                  (operation) => operation.kind === "planned_goal",
                ).length,
                routes: operations.filter(
                  (operation) =>
                    operation.kind === "reorder" ||
                    operation.kind === "relation",
                ).length,
              })}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/30 px-4 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("spaces.preview.changeCount", { count: operations.length })}
        </span>
        <button
          type="button"
          disabled={disabled || ids.length === 0}
          onClick={() => setSelected(allSelected ? new Set() : new Set(ids))}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
        >
          <CheckCheck className="size-3.5" aria-hidden />
          {allSelected
            ? t("spaces.preview.clearAll")
            : t("spaces.preview.selectAll")}
        </button>
      </div>
      <div className="max-h-[min(22rem,48vh)] divide-y divide-border/70 overflow-y-auto overscroll-contain">
        {operations.map(({ value }) => {
          const id = String(value.operationId ?? "");
          const copy = labels.get(id);
          return (
            <label
              key={id}
              className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/45"
            >
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-[var(--brand-600)]"
                checked={selected.has(id)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(id);
                  else next.delete(id);
                  setSelected(next);
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {copy?.kind}
                </span>
                <span className="mt-0.5 block font-medium leading-5 text-foreground">
                  {copy?.label}
                </span>
                {copy?.detail ? (
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {copy.detail}
                  </span>
                ) : null}
              </span>
              <ArrowRight
                className="mt-3 size-3.5 shrink-0 text-muted-foreground/50"
                aria-hidden
              />
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-3">
        <button
          type="button"
          disabled={disabled || selected.size === 0}
          onClick={() =>
            onSubmit({ action: "apply", selectedOperationIds: [...selected] })
          }
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
        >
          {t("spaces.applySelected")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onSubmit({ action: "cancel", selectedOperationIds: [] })
          }
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-card px-4 font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {t("spaces.cancel")}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {t("spaces.preview.selectedCount", { count: selected.size })}
        </span>
      </div>
    </section>
  );
}

function SpaceOrganizationReceipt({
  submitted,
}: {
  submitted: Record<string, unknown>;
}) {
  const t = useT();
  const cancelled =
    submitted.cancelled === true || submitted.action === "cancel";
  const selectedCount = Array.isArray(submitted.selectedOperationIds)
    ? submitted.selectedOperationIds.length
    : typeof submitted.appliedOperations === "number"
      ? submitted.appliedOperations
      : 0;

  return (
    <section
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm shadow-sm",
        cancelled
          ? "border-border bg-card"
          : "border-primary/25 bg-primary/[0.06]",
      )}
      role="status"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          cancelled
            ? "bg-muted text-muted-foreground"
            : "bg-primary/12 text-primary",
        )}
      >
        {cancelled ? (
          <CircleX className="size-5" aria-hidden />
        ) : (
          <CircleCheck className="size-5" aria-hidden />
        )}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="font-semibold leading-5 text-foreground">
          {cancelled
            ? t("spaces.preview.cancelledTitle")
            : t("spaces.preview.confirmedTitle")}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {cancelled
            ? t("spaces.preview.cancelledDescription")
            : t("spaces.preview.confirmedDescription", {
                count: selectedCount,
              })}
        </p>
      </div>
    </section>
  );
}

function coerceChoice(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value && typeof value === "object") {
    const choice = value as Record<string, unknown>;
    for (const key of ["label", "text", "value", "title", "choice"]) {
      if (typeof choice[key] === "string") {
        const trimmed = choice[key].trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return undefined;
}

function coerceChoices(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，、\n]/)
      : [];
  return raw
    .map(coerceChoice)
    .filter((choice): choice is string => Boolean(choice))
    .filter((choice, index, all) => all.indexOf(choice) === index);
}

function normalizeToolQuestion(
  value: unknown,
  index: number,
): ToolQuestion | null {
  if (!value || typeof value !== "object") return null;
  const question = value as Record<string, unknown>;
  const text = String(
    question.text ?? question.question ?? question.title ?? "",
  ).trim();
  if (!text) return null;
  const choices = coerceChoices(question.choices);
  const answerKind =
    question.answerKind === "multi_choice"
      ? "multi_choice"
      : question.answerKind === "text" && choices.length === 0
        ? "text"
        : "single_choice";
  return {
    id:
      typeof question.id === "string" && question.id.trim()
        ? question.id.trim()
        : `question_${index + 1}`,
    text,
    hint: typeof question.hint === "string" ? question.hint : undefined,
    answerKind,
    choices: choices.length > 0 ? choices : undefined,
  };
}

export function ToolUiRenderer({
  toolUi,
  disabled,
  onResume,
  onCancelPlan,
  onClientAction,
  onNavigate,
}: {
  toolUi: PendingToolUi;
  disabled?: boolean;
  onResume: (toolCallId: string, result: unknown, files?: File[]) => void;
  onCancelPlan?: () => void;
  onClientAction?: (action: AgentClientAction) => void;
  onNavigate?: () => void;
}) {
  const t = useT();
  const { toolCallId, uiKind, args, submitted } = toolUi;
  const locked = Boolean(submitted && Object.keys(submitted).length > 0);
  const readOnly = disabled || locked;

  if (uiKind === "learning_branch" && typeof args.branchId === "string")
    return <LearningBranchCard branchId={args.branchId} />;
  if (uiKind === "learning_return_suggestion")
    return (
      <LearningReturnSuggestion
        unitId={String(args.unitId ?? "")}
        reason={String(args.reason ?? "")}
      />
    );
  if (uiKind === "math_scene") {
    const scene = args.scene as MathScene | undefined;
    return scene?.type === "math_scene" ? (
      <MathSceneView scene={scene} compact />
    ) : null;
  }

  if (uiKind === "svg_diagram") {
    const block =
      args.block && typeof args.block === "object"
        ? (args.block as Partial<InteractiveBlock>)
        : null;
    if (block?.type === "interactive_html") {
      return (
        <InteractiveHtmlBlock
          block={
            block as Extract<InteractiveBlock, { type: "interactive_html" }>
          }
          compact
        />
      );
    }
    return block?.type === "svg" &&
      typeof block.svg === "string" &&
      typeof block.caption === "string" &&
      typeof block.alt === "string" ? (
      <SvgDiagramBlock
        block={block as Extract<InteractiveBlock, { type: "svg" }>}
        compact
      />
    ) : null;
  }

  if (uiKind === "knowledge_activity") {
    const activity = args.activity as KnowledgeActivity | undefined;
    return activity ? <KnowledgeActivityCard activity={activity} /> : null;
  }

  if (uiKind === "space_organization_preview") {
    if (submitted && Object.keys(submitted).length > 0) {
      return <SpaceOrganizationReceipt submitted={submitted} />;
    }
    return (
      <SpaceOrganizationPreviewCard
        args={args}
        disabled={readOnly}
        onSubmit={(result) => onResume(toolCallId, result)}
      />
    );
  }

  if (uiKind === "goal_scope_roadmap_preview") {
    return (
      <GoalScopeRoadmapPreviewCard
        args={args}
        submitted={submitted}
        disabled={readOnly}
        onSubmit={(result) => onResume(toolCallId, result)}
        onNavigate={onNavigate}
      />
    );
  }

  if (uiKind === "goal_space_suggestion") {
    return (
      <GoalSpaceSuggestionCard
        args={args}
        submitted={submitted}
        disabled={readOnly}
        onSubmit={(result) => onResume(toolCallId, result)}
      />
    );
  }

  if (uiKind === "text_input") {
    const savedAnswer = textInputAnswerFromSubmitted(submitted);
    return (
      <div className="rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3 text-sm text-muted-foreground">
        <p>
          {String(
            args.question ?? t("desktop.ui.toolUiRenderer.pleaseAddMoreDetail"),
          )}
        </p>
        {savedAnswer ? (
          <p className="mt-2 rounded-lg border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] px-2.5 py-1.5 text-sm text-foreground">
            {savedAnswer}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("desktop.ui.toolUiRenderer.youCanAlsoReplyInTheMessage")}
          </p>
        )}
      </div>
    );
  }

  if (uiKind === "action_buttons") {
    const actions = Array.isArray(args.actions)
      ? (args.actions as AgentClientActionButton[])
      : [];
    if (actions.length === 0) return null;

    return (
      <div className="rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3 text-sm shadow-sm">
        {args.title ? (
          <p className="mb-2 font-semibold text-foreground">
            {String(args.title)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {actions.map((action, index) => {
            const label = action.label ?? translateCurrent("desktop.copy.open");
            const selected = isActionButtonSelected(action, submitted);
            const className = cn(
              "inline-flex min-h-9 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition",
              selected
                ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30"
                : action.variant === "secondary"
                  ? "border border-border bg-card text-foreground hover:bg-muted"
                  : "bg-primary text-primary-foreground shadow-sm hover:brightness-95",
              readOnly && "pointer-events-none",
              readOnly && !selected && "opacity-50",
            );
            const clientAction = resolveClientAction(action);

            if (clientAction) {
              return (
                <button
                  key={`client-${clientAction}-${index}`}
                  type="button"
                  className={className}
                  disabled={readOnly}
                  onClick={() => onClientAction?.(clientAction)}
                >
                  {label}
                </button>
              );
            }

            if (action.kind !== "button" && action.href) {
              return (
                <Link
                  key={`${action.href}-${index}`}
                  to={action.href}
                  className={className}
                  onClick={() => onNavigate?.()}
                >
                  {label}
                </Link>
              );
            }

            return (
              <button
                key={`${label}-${index}`}
                type="button"
                className={className}
                disabled={readOnly}
                onClick={() =>
                  onResume(toolCallId, action.value ?? { action: label })
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (uiKind === "discovery_questions") {
    const clarificationChoices = coerceChoices(args.choices);
    const rawQuestions = Array.isArray(args.questions)
      ? args.questions
      : args.question
        ? [
            {
              id: "clarification",
              text: String(args.question),
              answerKind: "single_choice",
              choices: clarificationChoices.length
                ? clarificationChoices
                : [
                    translateCurrent("assistant.discovery.unsure"),
                    translateCurrent("assistant.discovery.decideForMe"),
                  ],
            },
          ]
        : [];
    const questions = rawQuestions
      .map((question, index) => normalizeToolQuestion(question, index))
      .filter((question): question is ToolQuestion => Boolean(question));
    return (
      <DiscoveryQuestionsCard
        questions={questions}
        disabled={disabled}
        submitted={submitted}
        onSkip={
          toolUi.toolName === "ask_discovery_questions"
            ? () => onResume(toolCallId, { answers: [], skipped: true })
            : undefined
        }
        onSubmit={(answers) => {
          const submittedAnswers = Array.isArray(answers) ? answers : [];
          onResume(toolCallId, {
            answers: submittedAnswers.map((entry) => {
              const question = questions.find((q) => q.id === entry.questionId);
              return {
                questionId: entry.questionId,
                question: question?.text,
                answer: entry.answer,
              };
            }),
          });
        }}
      />
    );
  }

  if (uiKind === "form") {
    return (
      <CollectFormCard
        fields={
          (args.fields ?? []) as Array<
            | "level"
            | "contentLanguage"
            | "generationOptions"
            | "isSmallCourse"
            | "documents"
          >
        }
        defaults={args.defaults as Record<string, unknown> | undefined}
        labels={args.labels as Record<string, string> | undefined}
        disabled={disabled}
        submitted={submitted}
        onSubmit={(values, files) => onResume(toolCallId, values, files)}
      />
    );
  }

  if (uiKind === "confirmation_card") {
    const state =
      typeof args.state === "object" && args.state
        ? (args.state as Record<string, unknown>)
        : (args as Record<string, unknown>);
    return (
      <ConfirmationCard
        state={state}
        contract={
          typeof args.contract === "object" && args.contract
            ? (args.contract as Record<string, unknown>)
            : null
        }
        disabled={disabled}
        submitted={submitted}
        onSubmit={(result) => onResume(toolCallId, result)}
      />
    );
  }

  if (uiKind === "plan_editor") {
    return (
      <PlanEditorCard
        plan={(args.plan as GoalMapPlan | null) ?? null}
        isMicroCourse={args.isMicroCourse === true}
        disabled={readOnly}
        onSubmit={(result) => onResume(toolCallId, result)}
        onCancel={onCancelPlan}
      />
    );
  }

  if (uiKind === "plan_stream" || uiKind === "decompose_stream") {
    return (
      <div className="rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
        {t("generation.preparing")}
      </div>
    );
  }

  if (uiKind === "micro_course_created") {
    const title = String(
      args.title ?? translateCurrent("sharedGoal.microCourse"),
    );
    const href = typeof args.href === "string" ? args.href : "";
    return (
      <div className="rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3 text-sm shadow-sm">
        <p className="font-semibold text-foreground">
          {t("desktop.ui.toolUiRenderer.shortCourseCreated")}
        </p>
        <p className="mt-1 text-muted-foreground">「{title}」</p>
        {href ? (
          <Link
            to={href}
            className="mt-2 inline-flex min-h-9 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95"
            onClick={() => onNavigate?.()}
          >
            {t("desktop.ui.toolUiRenderer.openShortCourse")}
          </Link>
        ) : null}
      </div>
    );
  }

  return null;
}
