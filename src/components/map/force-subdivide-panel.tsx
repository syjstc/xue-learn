"use client";

import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, MessageSquare, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { useAssistant } from "@/components/agent/assistant-provider";
import { InlineGenStream } from "@/components/ai/inline-gen-stream";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import type { SseEvent } from "@/shared/llm/sse";
import { useAiGeneration } from "@/hooks/use-ai-generation";
import { useInvalidateGoal, useRemoveSubMap } from "@/hooks/api";
import { useConfirm } from "@/hooks/use-confirm";
import {
  FEATURE_MICRO_EXPAND,
  FEATURE_SUBDIVIDE_UNIT,
} from "@xue-learn/core/features";
import { useT } from "@xue-learn/core/i18n";

export function ForceSubdividePanel({
  goalId,
  goalTitle,
  unitId,
  unitTitle,
  variant = "card",
  mode = "subdivide",
  onDone,
}: {
  goalId?: string;
  goalTitle?: string;
  unitId: string;
  unitTitle: string;
  variant?: "card" | "inline" | "button";
  mode?: "subdivide" | "regenerate" | "convert";
  onDone?: () => void;
}) {
  if (mode === "subdivide" && !FEATURE_SUBDIVIDE_UNIT) {
    return null;
  }
  if (mode === "convert" && !FEATURE_MICRO_EXPAND) {
    return null;
  }

  return (
    <ForceSubdividePanelInner
      goalId={goalId}
      goalTitle={goalTitle}
      unitId={unitId}
      unitTitle={unitTitle}
      variant={variant}
      mode={mode}
      onDone={onDone}
    />
  );
}

function ForceSubdividePanelInner({
  goalId,
  goalTitle,
  unitId,
  unitTitle,
  variant = "card",
  mode = "subdivide",
  onDone,
}: {
  goalId?: string;
  goalTitle?: string;
  unitId: string;
  unitTitle: string;
  variant?: "card" | "inline" | "button";
  mode?: "subdivide" | "regenerate" | "convert";
  onDone?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { openMicroExpandAssistant } = useAssistant();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [mapPreview, setMapPreview] = useState<{
    units?: { title?: string; contentSummary?: string }[];
    placeholderUnitCount?: number;
  } | null>(null);
  const removeSubMap = useRemoveSubMap();
  const invalidateGoal = useInvalidateGoal();
  const { confirm } = useConfirm();
  const removing = removeSubMap.isPending;
  const isConvert = mode === "convert";
  const aiGen = useAiGeneration({
    scope: "unit",
    scopeId: unitId,
    onRestore: (run) => {
      if (run.statusMessage) setStatus(run.statusMessage);
    },
  });
  const loading = aiGen.loading || removing;

  const handleStreamEvent = useCallback(
    (event: SseEvent) => {
      if (event.type === "status") setStatus(event.message);
      if (event.type === "map_partial") {
        const baseMap = (event.map ?? {}) as {
          units?: {
            title?: string;
            contentSummary?: string;
          }[];
        };
        setMapPreview({
          ...baseMap,
          placeholderUnitCount: event.placeholderUnitCount ?? 0,
        });
        setStatus(
          event.unitCount > 0
            ? t("generation.map.progress", { count: event.unitCount })
            : isConvert
              ? t("goalDetail.plan.generatingMap")
              : t("goalDetail.plan.generatingSubmap"),
        );
      }
      if (event.type === "error") setError(event.message);
    },
    [isConvert, t],
  );

  const previewBox = useMemo(() => {
    if (mapPreview) {
      const units = mapPreview.units ?? [];
      const placeholderUnitCount = mapPreview.placeholderUnitCount ?? 0;
      const visibleUnits = units.slice(0, 8);
      const remainingSlots = Math.max(0, 8 - visibleUnits.length);
      const visiblePlaceholders = Math.min(
        placeholderUnitCount,
        remainingSlots,
      );
      if (visibleUnits.length === 0 && visiblePlaceholders === 0) {
        return (
          <p className="mt-3 text-xs text-[var(--text-400)]">
            {isConvert
              ? t("goalDetail.plan.generatingMap")
              : t("goalDetail.plan.generatingSubmap")}
          </p>
        );
      }
      return (
        <div className="mt-3 space-y-2 rounded-lg bg-[var(--bg-50)]/80 p-3">
          <p className="text-xs font-medium text-[var(--text-400)]">
            {t("generation.map.itemsProgress", {
              count: units.length,
              kind: t(
                isConvert
                  ? "goalDetail.plan.mapUnit"
                  : "goalDetail.plan.subunit",
              ),
            })}
            {placeholderUnitCount > 0
              ? ` · ${t("generation.map.refining", { count: placeholderUnitCount })}`
              : ""}
          </p>
          <ul className="space-y-2">
            {visibleUnits.map((unit, index) => (
              <li key={`${unit.title ?? "unit"}-${index}`} className="text-sm">
                <span className="font-medium text-[var(--text-800)]">
                  {index + 1}.{" "}
                  <LlmMarkdownInline content={unit.title ?? "未命名单元"} />
                </span>
                {unit.contentSummary && (
                  <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--text-400)]">
                    <LlmMarkdownInline content={unit.contentSummary} />
                  </span>
                )}
              </li>
            ))}
            {Array.from({ length: visiblePlaceholders }).map((_, index) => (
              <li
                key={`placeholder-${visibleUnits.length + index}`}
                className="text-sm"
                aria-label={t("generation.map.subunitRefiningAria")}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text-800)]">
                    {visibleUnits.length + index + 1}.
                  </span>
                  <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--bg-300)]" />
                </div>
                <div className="mt-1 h-3 w-4/5 animate-pulse rounded bg-[var(--bg-300)]" />
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (loading) {
      return (
        <p className="mt-3 text-xs text-[var(--text-400)]">
          {t("generation.preparing")}
        </p>
      );
    }
    return null;
  }, [isConvert, loading, mapPreview, t]);

  async function handleRemoveSubMap() {
    const ok = await confirm({
      title: "移除子地图",
      description:
        `将移除「${unitTitle}」尚未开始的结构子地图，或移除单元内的学习步骤。\n\n` +
        "只要任一子单元已有会话、内容、笔记、练习、证据或复习记录，系统就会拒绝移除，不会清除学习历史。\n\n" +
        "确定继续吗？",
    });
    if (!ok) return;

    setError("");
    setStatus("正在移除子地图…");

    try {
      await removeSubMap.mutateAsync(unitId);
      if (onDone) onDone();
      else if (goalId) navigate(`/goals/${goalId}/units/${unitId}`);
      else navigate(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除子地图失败");
    } finally {
      setStatus("");
    }
  }

  async function handleConvertViaAssistant() {
    if (!goalId) {
      setError("缺少目标 ID，无法扩展轻课");
      return;
    }
    setError("");
    openMicroExpandAssistant({
      goalId,
      goalTitle: goalTitle?.trim() || unitTitle,
      unitTitle,
    });
  }

  async function handleSubdivide() {
    const isRegenerate = mode === "regenerate";
    if (isConvert) {
      await handleConvertViaAssistant();
      return;
    }
    const ok = await confirm({
      confirmLabel: "确认",
      title: isRegenerate ? "重新生成子地图" : "拆分子单元",
      description: isRegenerate
        ? `将安全地重新规划「${unitTitle}」。\n\n尚未开始的结构子地图可以重生成；只要已有学习活动，系统就会保留课程结构与证据，改为生成可移除的学习步骤。\n\n确定继续吗？`
        : `系统会安全拆分「${unitTitle}」。\n\n完全未开始的单元可拆成同模块子单元；已有会话、内容、笔记、练习、证据、复习或完成状态时，只会在当前单元生成学习步骤，不改变课程结构，也不会清除历史。\n\n确定继续吗？`,
    });
    if (!ok) return;

    setError("");
    setMapPreview(null);
    setStatus(
      isRegenerate
        ? t("goalDetail.plan.generatingSubmap")
        : t("goalDetail.plan.generatingSubmap"),
    );

    try {
      const done = await aiGen.startPost(
        isRegenerate
          ? `/api/units/${unitId}/subdivide/regenerate`
          : `/api/units/${unitId}/subdivide`,
        {},
        handleStreamEvent,
        "unit.subdivide",
      );
      if (!done || done.type !== "done") return;
      await invalidateGoal(goalId);
      if (onDone) onDone();
      else if (done.mode === "steps" && goalId) {
        navigate(`/goals/${goalId}/units/${unitId}`);
      } else if (goalId) {
        navigate(`/goals/${goalId}`);
      } else navigate(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "拆分失败");
    } finally {
      setStatus("");
      setMapPreview(null);
    }
  }

  useEffect(() => {
    if (isConvert) return;
    void aiGen
      .reconnectActive(handleStreamEvent, (op) => op === "unit.subdivide")
      .then(async (results) => {
        const done = results.find((event) => event?.type === "done");
        if (done?.type === "done") {
          await invalidateGoal(goalId);
          if (onDone) onDone();
          else if (done.mode === "steps" && goalId) {
            navigate(`/goals/${goalId}/units/${unitId}`);
          } else if (goalId) {
            navigate(`/goals/${goalId}`);
          } else navigate(0);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect on mount
  }, [unitId, goalId, isConvert]);

  const wrapperClass =
    variant === "button"
      ? "flex flex-col items-end gap-1"
      : variant === "card"
        ? "flex items-center gap-2 text-sm"
        : "rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] px-3 py-2.5";

  const cardContent =
    mode === "regenerate"
      ? {
          icon: RefreshCw,
          hint: "只在没有学习活动时改课程结构；否则安全更新单元内学习步骤。",
        }
      : isConvert
        ? {
            icon: MessageSquare,
            hint: "AI 助手会先提问，再帮你扩展为完整目标。",
          }
        : {
            icon: Layers,
            hint: "未开始时拆成同模块子单元；开始后生成不影响进度与证据的学习步骤。",
          };

  const inlineDescription = cardContent.hint;

  const showStream = !isConvert && aiGen.loading;
  const CardIcon = cardContent.icon;

  return (
    <div className={wrapperClass}>
      {variant === "card" && (
        <>
          <CardIcon
            className="h-3.5 w-3.5 shrink-0 text-[var(--text-400)]"
            aria-hidden
          />
          <span className="text-[var(--text-400)]">{cardContent.hint}</span>
        </>
      )}
      {variant === "inline" && (
        <p className="text-sm text-muted-foreground">{inlineDescription}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div
        className={
          mode === "regenerate"
            ? variant === "button"
              ? "flex flex-wrap items-center justify-end gap-2"
              : "mt-3 flex flex-wrap items-center gap-2"
            : variant === "card"
              ? "ml-auto flex items-center gap-2"
              : variant === "inline"
                ? "mt-2 flex flex-wrap items-center gap-2"
                : undefined
        }
      >
        {mode === "regenerate" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRemoveSubMap}
            disabled={loading}
          >
            {removing ? status || "移除中…" : "移除子地图"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSubdivide}
          disabled={loading}
          className="text-[var(--text-400)]"
        >
          {aiGen.loading ? (
            isConvert ? (
              t("goalDetail.plan.generatingMap")
            ) : mode === "regenerate" ? (
              t("goalDetail.plan.generatingSubmap")
            ) : (
              t("goalDetail.plan.generatingSubmap")
            )
          ) : mode === "regenerate" ? (
            <>
              <RefreshCw className="mr-1 size-3.5" />
              重新生成
            </>
          ) : isConvert ? (
            <>
              <MessageSquare className="mr-1 size-3.5" />
              扩展目标
            </>
          ) : (
            <>
              <Sparkles className="mr-1 size-3.5" />
              拆分单元
            </>
          )}
        </Button>
      </div>
      {showStream && (
        <InlineGenStream
          status={status}
          canStop={aiGen.canStop()}
          onStop={() => void aiGen.stop()}
          className={
            variant === "button"
              ? "mt-1 w-full min-w-[16rem]"
              : mode === "regenerate"
                ? "mt-3"
                : "mt-2"
          }
        >
          {previewBox}
        </InlineGenStream>
      )}
    </div>
  );
}
