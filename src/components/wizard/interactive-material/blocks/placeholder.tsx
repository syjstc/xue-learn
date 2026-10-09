"use client";

import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { apiPost } from "@/shared/api";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import type { IllustrationRegenHandlers } from "../types.ts";
import { supportsMaterialComponentRegeneration } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

export function MaterialPlaceholderBlock({
  block,
  blockIndex,
  compact,
  regeneration,
}: {
  block: Extract<InteractiveBlock, { type: "placeholder" }>;
  blockIndex: number;
  compact?: boolean;
  regeneration?: IllustrationRegenHandlers;
}) {
  const t = useT();
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(
    null,
  );
  const metadata = block as typeof block & {
    componentType?: string;
    description?: string;
    fallbackBody?: string;
  };
  const isFailedComponent = Boolean(
    metadata.fallbackBody || /failed/i.test(block.reason ?? ""),
  );
  const canRegenerate = Boolean(
    supportsMaterialComponentRegeneration() &&
      regeneration?.unitId &&
      metadata.componentType &&
      isFailedComponent,
  );
  const isVisualLoading =
    !isFailedComponent &&
    (metadata.componentType === "svg" ||
      metadata.componentType === "math_scene" ||
      metadata.componentType === "chart" ||
      metadata.componentType === "graph" ||
      /svg diagram is being prepared/i.test(block.reason ?? ""));

  async function handleRegenerate() {
    if (!canRegenerate || regenerating || !regeneration) return;
    setRegenerating(true);
    setRegenerationError(null);
    try {
      const response = await apiPost<{ component: InteractiveBlock }>(
        `/api/units/${regeneration.unitId}/components/${
          blockIndex + (regeneration.blockOffset ?? 0)
        }/regenerate`,
        { placeholderComponentType: metadata.componentType },
      );
      regeneration.onBlockRegenerated?.(blockIndex, response.component);
    } catch (error) {
      setRegenerationError(
        error instanceof Error
          ? error.message
          : t("wizard.material.placeholder.retryFailed"),
      );
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] text-[var(--course-content)]",
        compact ? "p-2" : "p-3",
      )}
      aria-busy={!isFailedComponent}
      aria-label={
        canRegenerate
          ? t("wizard.material.placeholder.notGenerated")
          : t("generation.placeholder.refining")
      }
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        {isFailedComponent ? (
          <TriangleAlert className="size-3.5 shrink-0 opacity-80" aria-hidden />
        ) : (
          <Loader2
            className="size-3.5 shrink-0 animate-spin opacity-80"
            aria-hidden
          />
        )}
        {isFailedComponent
          ? t("wizard.material.placeholder.notGenerated")
          : t("generation.placeholder.refining")}
      </div>
      {isFailedComponent && (
        <div className="mt-3 rounded-md border border-[var(--course-content-border)] bg-[var(--course-content-surface)] p-3">
          <p className="text-xs font-medium text-[var(--course-content-muted)]">
            {t("wizard.material.placeholder.example")}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {metadata.fallbackBody}
          </p>
        </div>
      )}
      {!isFailedComponent && (
        <div className="mt-2 space-y-2" aria-hidden>
          {isVisualLoading ? (
            <div className="h-36 w-full animate-pulse rounded-md bg-[var(--course-content-surface-muted)]" />
          ) : null}
          <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--course-content-highlight-bg)]" />
          <div className="h-3 w-full animate-pulse rounded bg-[var(--course-content-surface-muted)]" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--course-content-surface-muted)]" />
        </div>
      )}
      {canRegenerate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={regenerating}
          onClick={() => void handleRegenerate()}
        >
          <RefreshCw
            className={cn("mr-1.5 size-3.5", regenerating && "animate-spin")}
          />
          {regenerating
            ? t("wizard.material.placeholder.generating")
            : t("wizard.material.placeholder.regenerate")}
        </Button>
      )}
      {regenerationError && (
        <p className="mt-2 text-xs text-destructive">
          {t("wizard.material.placeholder.unavailable", {
            error: regenerationError,
          })}
        </p>
      )}
    </div>
  );
}
