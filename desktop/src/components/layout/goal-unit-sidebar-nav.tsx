import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import type { UnitTreeNode } from "@/shared/domain/unit-tree-build";
import { formatTreeIndex } from "@/shared/domain/unit-tree-build";
import type { GoalModule } from "@/shared/api";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

function findAncestorIds(
  nodes: UnitTreeNode[],
  targetId: string,
  path: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return path;
    const found = findAncestorIds(node.children, targetId, [...path, node.id]);
    if (found) return found;
  }
  return null;
}

function findNode(
  nodes: UnitTreeNode[],
  targetId: string,
): UnitTreeNode | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    const found = findNode(node.children, targetId);
    if (found) return found;
  }
  return null;
}

function expandedIdsForUnit(
  roots: UnitTreeNode[],
  unitId: string,
): Set<string> {
  const ancestors = findAncestorIds(roots, unitId) ?? [];
  const ids = new Set(ancestors);
  const node = findNode(roots, unitId);
  if (node && node.children.length > 0) ids.add(unitId);
  return ids;
}

function collectBranchIds(nodes: UnitTreeNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.children.length > 0) {
      ids.push(n.id);
      ids.push(...collectBranchIds(n.children));
    }
  }
  return ids;
}

function UnitNavRow({
  node,
  goalId,
  indices,
  expanded,
  onToggle,
  highlightedUnitId,
  onExpandPath,
}: {
  node: UnitTreeNode;
  goalId: string;
  indices: number[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  highlightedUnitId?: string;
  onExpandPath: (id: string) => void;
}) {
  const t = useT();
  const indexLabel = formatTreeIndex(indices);
  const isModule = node.unitKind === "module";
  const hasChildren = node.children.length > 0;
  const isOpen = !hasChildren || expanded.has(node.id);
  const isActive = node.id === highlightedUnitId;
  const depth = node.depth;

  return (
    <li className="min-w-0">
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-md px-1 py-1",
          isActive && "bg-[var(--brand-50)]",
        )}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text-400)] hover:text-[var(--text-800)]",
            !hasChildren && "pointer-events-none invisible",
          )}
          aria-label={
            isOpen
              ? t("uiChrome.goalNav.collapseSubunit")
              : t("uiChrome.goalNav.expandSubunit")
          }
          aria-expanded={hasChildren ? isOpen : undefined}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <Link
          to={
            isModule && hasChildren
              ? `/goals/${goalId}/modules/${node.moduleId ?? node.id}`
              : `/goals/${goalId}/units/${node.id}`
          }
          onClick={(event) => {
            if (isModule && hasChildren) {
              event.preventDefault();
              onToggle(node.id);
            }
          }}
          className={cn(
            "min-w-0 flex-1 touch-manipulation rounded-md px-1 py-0.5 transition-colors",
            depth === 0 && "text-xs font-medium",
            depth === 1 && "text-[11px]",
            depth >= 2 && "text-[11px]",
            isActive
              ? "font-semibold text-[var(--brand-700)]"
              : "text-[var(--text-500)] hover:text-[var(--text-800)]",
          )}
          aria-current={isActive ? "page" : undefined}
        >
          <span className="flex items-center gap-1">
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-400)]">
              {indexLabel}
            </span>
            <span className="min-w-0 truncate leading-snug" title={node.title}>
              <LlmMarkdownInline
                content={node.title}
                className="inline min-w-0 [&_.katex]:text-[1em]"
              />
            </span>
          </span>
        </Link>
      </div>
      {isOpen && hasChildren && (
        <ul
          className={cn(
            "mt-0 space-y-0 border-l pl-2",
            depth === 0 && "ml-[7px] border-[var(--border-200)]",
            depth >= 1 && "ml-[7px] border-[var(--border-300)]",
          )}
          role="group"
        >
          {node.children.map((child, i) => (
            <UnitNavRow
              key={child.id}
              node={child}
              goalId={goalId}
              indices={[...indices, i + 1]}
              expanded={expanded}
              onToggle={onToggle}
              highlightedUnitId={highlightedUnitId}
              onExpandPath={onExpandPath}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function GoalUnitSidebarNav({
  roots,
  goalId,
  modules,
  activeUnitId,
  activeModuleId,
}: {
  roots: UnitTreeNode[];
  goalId: string;
  modules?: GoalModule[];
  activeUnitId?: string;
  activeModuleId?: string;
}) {
  const t = useT();
  const highlightedUnitId = activeUnitId;
  const branchIds = useMemo(() => collectBranchIds(roots), [roots]);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    highlightedUnitId
      ? expandedIdsForUnit(roots, highlightedUnitId)
      : new Set(),
  );

  const expandPath = useCallback(
    (id: string) => {
      const ids = expandedIdsForUnit(roots, id);
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const branchId of ids) next.add(branchId);
        return next;
      });
    },
    [roots],
  );

  const prevHighlightedUnitIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!highlightedUnitId) return;
    if (prevHighlightedUnitIdRef.current === highlightedUnitId) return;
    prevHighlightedUnitIdRef.current = highlightedUnitId;
    expandPath(highlightedUnitId);
  }, [expandPath, highlightedUnitId]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sortedModules = useMemo(
    () => [...(modules ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [modules],
  );
  const activeUnitModuleId = useMemo(
    () =>
      highlightedUnitId
        ? findNode(roots, highlightedUnitId)?.moduleId
        : undefined,
    [highlightedUnitId, roots],
  );
  const highlightedModuleId = activeModuleId ?? activeUnitModuleId;
  const [expandedModules, setExpandedModules] = useState<Set<string>>(
    () => new Set(highlightedModuleId ? [highlightedModuleId] : []),
  );

  const toggleModule = useCallback((moduleId: string) => {
    setExpandedModules((previous) => {
      const next = new Set(previous);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  const prevHighlightedModuleIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!highlightedModuleId) return;
    if (prevHighlightedModuleIdRef.current === highlightedModuleId) return;
    prevHighlightedModuleIdRef.current = highlightedModuleId;
    setExpandedModules((previous) => {
      const next = new Set(previous);
      next.add(highlightedModuleId);
      return next;
    });
  }, [highlightedModuleId]);

  if (roots.length === 0 && sortedModules.length === 0) return null;

  if (sortedModules.length > 0) {
    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between px-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-400)]">
            {t("uiChrome.goalNav.courseOutline")}
          </p>
          <div className="flex gap-0.5">
            <button
              type="button"
              onClick={() =>
                setExpandedModules(
                  new Set(sortedModules.map((module) => module.id)),
                )
              }
              className="rounded px-1 py-px text-[10px] text-[var(--text-400)] hover:text-[var(--text-800)]"
            >
              {t("uiChrome.goalNav.expand")}
            </button>
            <button
              type="button"
              onClick={() => setExpandedModules(new Set())}
              className="rounded px-1 py-px text-[10px] text-[var(--text-400)] hover:text-[var(--text-800)]"
            >
              {t("uiChrome.goalNav.collapse")}
            </button>
          </div>
        </div>
        <ul className="space-y-1">
          {sortedModules.map((module, moduleIndex) => {
            const moduleUnits = roots.filter(
              (root) => root.moduleId === module.id,
            );
            const isOpen = expandedModules.has(module.id);
            const isActive = highlightedModuleId === module.id;
            const isLocked = module.unlockStatus === "locked";
            return (
              <li key={module.id} className="min-w-0">
                <div
                  className={cn(
                    "rounded-md px-1 py-1",
                    isActive && "bg-[var(--brand-50)]",
                  )}
                >
                  {isLocked ? (
                    <button
                      type="button"
                      onClick={() => toggleModule(module.id)}
                      className="flex min-w-0 w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-left text-xs font-medium text-[var(--text-400)] transition-colors hover:text-[var(--text-600)]"
                      aria-label={
                        isOpen
                          ? t("uiChrome.goalNav.collapseModule")
                          : t("uiChrome.goalNav.expandModule")
                      }
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-400)]" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-400)]" />
                      )}
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="shrink-0 text-[10px] tabular-nums">
                          {moduleIndex + 1}
                        </span>
                        <span className="min-w-0 truncate" title={module.title}>
                          <LlmMarkdownInline content={module.title} />
                        </span>
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleModule(module.id)}
                      className={cn(
                        "flex min-w-0 w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-left text-xs font-medium transition-colors",
                        isActive
                          ? "text-[var(--brand-700)]"
                          : "text-[var(--text-600)] hover:text-[var(--text-800)]",
                      )}
                      aria-label={
                        isOpen
                          ? t("uiChrome.goalNav.collapseModule")
                          : t("uiChrome.goalNav.expandModule")
                      }
                      aria-expanded={isOpen}
                      aria-current={
                        activeModuleId === module.id ? "page" : undefined
                      }
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-400)]" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-400)]" />
                      )}
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-400)]">
                          {moduleIndex + 1}
                        </span>
                        <span className="min-w-0 truncate" title={module.title}>
                          <LlmMarkdownInline content={module.title} />
                        </span>
                      </span>
                    </button>
                  )}
                </div>
                {isOpen && (
                  <ul className="ml-[10px] mt-0 space-y-px border-l border-[var(--border-200)] pl-2">
                    {!isLocked && moduleUnits.length > 0 ? (
                      moduleUnits.map((unit, unitIndex) => (
                        <UnitNavRow
                          key={unit.id}
                          node={unit}
                          goalId={goalId}
                          indices={[moduleIndex + 1, unitIndex + 1]}
                          expanded={expanded}
                          onToggle={toggle}
                          highlightedUnitId={highlightedUnitId}
                          onExpandPath={expandPath}
                        />
                      ))
                    ) : (
                      <li className="px-2 py-1 text-[10px] text-[var(--text-400)]">
                        {isLocked
                          ? t("uiChrome.goalNav.unlockAfterPrevious")
                          : t("uiChrome.goalNav.unitPreparing")}
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-400)]">
          {t("uiChrome.goalNav.units")}
        </p>
        {branchIds.length > 0 && (
          <div className="flex gap-0.5">
            <button
              type="button"
              onClick={() => setExpanded(new Set(branchIds))}
              className="rounded px-1 py-px text-[10px] text-[var(--text-400)] hover:text-[var(--text-800)]"
            >
              {t("uiChrome.goalNav.expand")}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              className="rounded px-1 py-px text-[10px] text-[var(--text-400)] hover:text-[var(--text-800)]"
            >
              {t("uiChrome.goalNav.collapse")}
            </button>
          </div>
        )}
      </div>
      <ul className="space-y-px">
        {roots.map((root, i) => (
          <UnitNavRow
            key={root.id}
            node={root}
            goalId={goalId}
            indices={[i + 1]}
            expanded={expanded}
            onToggle={toggle}
            highlightedUnitId={highlightedUnitId}
            onExpandPath={expandPath}
          />
        ))}
      </ul>
    </div>
  );
}
