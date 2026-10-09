"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { consumeSsePost } from "@/shared/client/consume-sse";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { supportsMaterialComponentRegeneration } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { IllustrationRegenHandlers } from "../types.ts";

export function ComplexComponentRetry({
  blockIndex,
  regeneration,
  children,
}: {
  blockIndex: number;
  regeneration?: IllustrationRegenHandlers;
  children: ReactNode;
}) {
  const t = useT();
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRegenerate = Boolean(
    supportsMaterialComponentRegeneration() && regeneration?.unitId,
  );

  async function handleRegenerate() {
    if (!canRegenerate || regenerating || !regeneration) return;
    setRegenerating(true);
    setError(null);
    try {
      const done = await consumeSsePost(
        `/api/units/${regeneration.unitId}/components/${
          blockIndex + (regeneration.blockOffset ?? 0)
        }/regenerate/stream`,
        {},
        (event) => {
          if (event.type !== "component_partial") return;
          const component = (event as { component?: InteractiveBlock })
            .component;
          if (component) {
            regeneration.onBlockRegenerated?.(blockIndex, component);
          }
        },
      );
      const response = done as { component?: InteractiveBlock } | null;
      if (!response?.component) {
        throw new Error(t("wizard.material.regenerateFailed"));
      }
      regeneration.onBlockRegenerated?.(blockIndex, response.component);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("wizard.material.regenerateFailed"),
      );
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="space-y-2">
      {canRegenerate ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-[var(--course-content-muted)]"
            disabled={regenerating}
            onClick={() => void handleRegenerate()}
          >
            {regenerating ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className={cn("mr-1.5 size-3.5")} />
            )}
            {regenerating
              ? t("wizard.material.placeholder.generating")
              : t("wizard.material.regenerate")}
          </Button>
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-destructive">
          {t("wizard.material.placeholder.unavailable", { error })}
        </p>
      ) : null}
    </div>
  );
}
