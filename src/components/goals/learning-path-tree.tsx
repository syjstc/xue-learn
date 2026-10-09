"use client";

import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { UnitContentGenBadges } from "@/components/goals/unit-content-gen-badges";
import { statusLabel } from "@/shared/domain/unit-status";
import type { UnitTreeNode } from "@/shared/domain/unit-tree-build";
import {
  collectBranchIdsThroughDepth,
  formatCompactTreeIndex,
  formatTreeIndex,
} from "@/shared/domain/unit-tree-build";
import type { UnitStatus } from "@/shared/domain/types";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

const OVERVIEW_BRANCH_DEPTH = 0;
const MAX_VISUAL_INDENT_DEPTH = 4;

function PathRow({
  node,
  goalId,
  indices,
  expanded,
  onToggle,
}: {
  node: UnitTreeNode;
  goalId: string;
  indices: number[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const t = useT();
  const fullIndexLabel = formatTreeIndex(indices);
  const indexLabel = formatCompactTreeIndex(indices);
  const visualDepth = Math.min(node.depth, MAX_VISUAL_INDENT_DEPTH);
  const isModule = node.unitKind === "module";
  const hasChildren = node.children.length > 0;
  const isOpen = !hasChildren || expanded.has(node.id);
  const href =
    isModule && hasChildren
      ? `/goals/${goalId}/modules/${node.moduleId ?? node.id}`
      : `/goals/${goalId}/units/${node.id}`;

  return (
    <>
      <li
        className={cn(
          "flex items-start gap-1",
          node.depth > 0 && "border-l-2 border-[var(--brand-200)]",
        )}
        style={{
          marginLeft: visualDepth * 20,
          paddingLeft: visualDepth > 0 ? 12 : 0,
        }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className={cn(
            "mt-2.5 shrink-0 rounded p-0.5 text-[var(--text-400)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
            !hasChildren && "pointer-events-none invisible",
          )}
          aria-label={
            isOpen
              ? t("goalDetail.path.collapseChildren")
              : t("goalDetail.path.expandChildren")
          }
          aria-expanded={hasChildren ? isOpen : undefined}
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <Link
          to={href}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-2.5 text-sm transition-colors hover:bg-[var(--bg-100)]"
        >
          <span className="min-w-0">
            <span className="mr-2 inline-flex flex-wrap items-center gap-1.5">
              <span className="shrink-0 rounded bg-[var(--bg-200)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-400)]">
                L{node.depth + 1}
              </span>
              <span
                className="shrink-0 text-xs tabular-nums text-[var(--text-400)]"
                title={
                  indexLabel === fullIndexLabel ? undefined : fullIndexLabel
                }
              >
                {indexLabel}
              </span>
            </span>
            <span className="text-[var(--text-800)]">{node.title}</span>
            {isModule && (
              <span className="ml-2 text-xs text-[var(--brand-600)]">
                {t("goalDetail.path.module")}
              </span>
            )}
            {hasChildren && !isOpen && (
              <span className="ml-2 text-xs text-[var(--text-400)]">
                {t("goalDetail.path.childCount", {
                  count: node.children.length,
                })}
              </span>
            )}
            {node.contentGen && (
              <span className="mt-1 block">
                <UnitContentGenBadges status={node.contentGen} />
              </span>
            )}
          </span>
          <span className="shrink-0 text-[var(--brand-600)]">
            {node.completionMethod === "test_out"
              ? t("goalDetail.path.testedOut")
              : statusLabel(node.status as UnitStatus)}
          </span>
        </Link>
        {!isModule &&
          node.status !== "completed" &&
          node.status !== "completed_needs_reinforcement" && (
            <Link
              to={`/goals/${goalId}/units/${node.id}/diagnostic`}
              className="mt-1 shrink-0 rounded-md border border-[var(--border-200)] px-2 py-1.5 text-xs text-[var(--brand-700)] hover:bg-[var(--brand-50)]"
            >
              {t("goalDetail.path.testedOutBadge")}
            </Link>
          )}
      </li>
      {isOpen &&
        node.children.map((child, i) => (
          <PathRow
            key={child.id}
            node={child}
            goalId={goalId}
            indices={[...indices, i + 1]}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

export function LearningPathTree({
  roots,
  goalId,
}: {
  roots: UnitTreeNode[];
  goalId: string;
}) {
  const t = useT();
  const branchIds = useMemo(
    () => collectBranchIdsThroughDepth(roots, Number.POSITIVE_INFINITY),
    [roots],
  );
  const overviewBranchIds = useMemo(
    () => collectBranchIdsThroughDepth(roots, OVERVIEW_BRANCH_DEPTH),
    [roots],
  );
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(overviewBranchIds),
  );

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandOverview = useCallback(() => {
    setExpanded(new Set(overviewBranchIds));
  }, [overviewBranchIds]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  if (roots.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--text-400)]">
        {t("goalDetail.path.empty")}
      </p>
    );
  }

  return (
    <div className="mt-2">
      {branchIds.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={expandOverview}
            className="rounded-lg border-[var(--border-200)]"
          >
            {t("goalDetail.path.expandTwoLevels")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={collapseAll}
            className="rounded-lg border-[var(--border-200)]"
          >
            {t("goalDetail.path.collapseAll")}
          </Button>
        </div>
      )}
      <ul className="divide-y divide-[var(--border-200)]">
        {roots.map((root, i) => (
          <PathRow
            key={root.id}
            node={root}
            goalId={goalId}
            indices={[i + 1]}
            expanded={expanded}
            onToggle={toggle}
          />
        ))}
      </ul>
    </div>
  );
}
