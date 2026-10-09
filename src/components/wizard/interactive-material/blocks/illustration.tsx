import { CourseBoardImage } from "@xue-learn/core/source/src/components/course-display/course-board-media.tsx";
("use client");

import { ImageIcon, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { TextHighlightSpan } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import { apiGet } from "@/shared/api";
import { consumeSsePost } from "@/shared/client/consume-sse";
import { isImageGenerationFeatureEnabled } from "@xue-learn/core/source/src/shared/features.ts";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useImageSettings } from "@/hooks/api";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";
import { Selectable } from "../selectable.tsx";
import type { IllustrationRegenHandlers } from "../types.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import {
  isDesktopLocalRuntime,
  supportsMaterialIllustrationRegeneration,
} from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

export function IllustrationBlock({
  block,
  blockIndex,
  blockKey,
  compact,
  highlights,
  sources,
  followUp,
  illustrationRegen,
}: {
  block: Extract<InteractiveBlock, { type: "illustration" }>;
  blockIndex: number;
  blockKey: string;
  compact?: boolean;
  highlights: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  followUp?: MaterialFollowUpHandlers;
  illustrationRegen?: IllustrationRegenHandlers;
}) {
  const t = useT();
  const materialBlockIndex = illustrationRegen?.parentBlockIndex ?? blockIndex;
  const imageFeatureEnabled = isImageGenerationFeatureEnabled(
    isDesktopLocalRuntime(),
  );
  const imageSettingsQuery = useImageSettings(imageFeatureEnabled);
  const illustrationRegenerationEnabled =
    supportsMaterialIllustrationRegeneration();
  const imageGenerationEnabled = Boolean(
    imageFeatureEnabled &&
    imageSettingsQuery.data?.config.enabled &&
    imageSettingsQuery.data?.config.provider !== "none",
  );
  const imageProviderConfigured = Boolean(
    imageSettingsQuery.data?.providers.find(
      (provider) => provider.id === imageSettingsQuery.data?.config.provider,
    )?.configured,
  );
  const [imageUrl, setImageUrl] = useState(block.imageUrl);
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState("");
  const [regenError, setRegenError] = useState<string | null>(null);

  useEffect(() => {
    setImageUrl(block.imageUrl);
  }, [block.imageUrl]);

  useEffect(() => {
    const unitId = illustrationRegen?.unitId;
    if (
      imageUrl ||
      !unitId ||
      !imageGenerationEnabled ||
      !imageProviderConfigured
    ) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const content = await apiGet<{
          material?: { blocks?: InteractiveBlock[] };
        }>(`/api/units/${unitId}/content`);
        const globalIndex =
          materialBlockIndex + (illustrationRegen?.blockOffset ?? 0);
        const parent = content.material?.blocks?.[globalIndex];
        const current =
          illustrationRegen?.figureIndex != null && parent?.type === "stage"
            ? parent.figures[illustrationRegen.figureIndex]
            : parent;
        if (
          !cancelled &&
          current?.type === "illustration" &&
          current.imageUrl &&
          current.imageId
        ) {
          setImageUrl(current.imageUrl);
          return;
        }
      } catch {
        // Background enrichment is best-effort; keep the manual retry control.
      }
      if (!cancelled && attempts < 30) {
        window.setTimeout(() => void poll(), 2_000);
      }
    };
    const timer = window.setTimeout(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    materialBlockIndex,
    illustrationRegen?.unitId,
    illustrationRegen?.blockOffset,
    illustrationRegen?.figureIndex,
    imageGenerationEnabled,
    imageProviderConfigured,
    imageUrl,
  ]);

  const frameClass = compact
    ? "overflow-hidden rounded border border-[var(--course-content-border)] bg-[var(--course-content-surface)]"
    : "overflow-hidden rounded-lg border border-[var(--course-content-border)] bg-[var(--course-content-surface)] shadow-sm";

  async function handleRegenerate() {
    if (
      !illustrationRegenerationEnabled ||
      !illustrationRegen?.unitId ||
      regenerating
    )
      return;
    const previousImageUrl = imageUrl;
    setRegenerating(true);
    setRegenProgress(t("wizard.material.illustration.submitting"));
    setRegenError(null);
    try {
      const done = await consumeSsePost(
        `/api/units/${illustrationRegen.unitId}/illustrations/${
          materialBlockIndex + (illustrationRegen.blockOffset ?? 0)
        }/regenerate/stream`,
        { figureIndex: illustrationRegen.figureIndex },
        (event) => {
          if (event.type !== "image_generation_progress") return;
          setRegenProgress(event.message);
          if (event.previewUrl) setImageUrl(event.previewUrl);
        },
      );
      const data = done as { imageUrl?: string; imageId?: string } | null;
      if (!data?.imageUrl || !data.imageId) {
        throw new Error(t("wizard.material.illustration.missingImageUrl"));
      }
      setImageUrl(data.imageUrl);
      illustrationRegen.onIllustrationRegenerated?.(
        materialBlockIndex,
        {
          imageUrl: data.imageUrl,
          imageId: data.imageId,
        },
        illustrationRegen.figureIndex,
      );
    } catch (err) {
      setImageUrl(previousImageUrl);
      setRegenError(
        err instanceof Error
          ? err.message
          : t("wizard.material.illustration.regenerateFailed"),
      );
    } finally {
      setRegenerating(false);
      setRegenProgress("");
    }
  }

  return (
    <figure className={frameClass}>
      <div className="relative">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <CourseBoardImage
            src={imageUrl}
            alt={block.caption}
            className={cn(
              "w-full object-contain",
              block.guidedImage
                ? "guided-image-matte"
                : "bg-[var(--course-content-surface-muted)]",
            )}
            loading="lazy"
          />
        ) : (
          <div
            className={`flex flex-col items-center justify-center bg-[var(--course-content-surface-muted)] text-[var(--course-content-muted)] ${compact ? "h-28" : "h-40"}`}
            aria-hidden
          >
            <ImageIcon className="mb-1.5 size-8 opacity-35" />
            <span className="text-xs">
              {regenerating
                ? regenProgress || t("wizard.material.illustration.generating")
                : imageGenerationEnabled
                  ? imageProviderConfigured
                    ? t("wizard.material.illustration.preparing")
                    : t("wizard.material.illustration.apiKeyMissing")
                  : t("wizard.material.illustration.disabled")}
            </span>
          </div>
        )}
        {illustrationRegen?.unitId &&
          illustrationRegenerationEnabled &&
          imageGenerationEnabled &&
          imageProviderConfigured && (
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={regenerating}
              title={t("wizard.material.illustration.regenerateImage")}
              aria-label={t("wizard.material.illustration.regenerateImage")}
              className={cn(
                "absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-[var(--course-content-border)] bg-[var(--course-content-surface)]/95 px-2 py-1 text-xs font-medium text-[var(--course-content)] shadow-sm backdrop-blur transition hover:bg-[var(--course-content-surface-accent)] disabled:cursor-not-allowed disabled:opacity-60",
                compact && "top-1 right-1 px-1.5 py-0.5",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", regenerating && "animate-spin")}
                aria-hidden
              />
              {!compact &&
                (regenerating
                  ? t("wizard.material.illustration.regenerating")
                  : t("wizard.material.regenerate"))}
            </button>
          )}
        {regenerating && imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-xs text-[var(--course-content-muted)]">
            {regenProgress || t("wizard.material.illustration.generatingNew")}
          </div>
        )}
      </div>
      {regenError && (
        <p className="border-t border-[var(--course-content-error-border)] bg-[var(--course-content-error-bg)] px-3 py-1.5 text-xs text-[var(--course-content)]">
          {regenError}
        </p>
      )}
      <figcaption
        className={
          compact
            ? "border-t border-[var(--course-content-border)] px-2 py-1.5 text-xs text-[var(--course-content-muted)]"
            : "border-t border-[var(--course-content-border)] px-3 py-2 text-sm text-[var(--course-content-muted)]"
        }
      >
        <Selectable
          contentKey={blockKey}
          text={block.caption}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
          markdownVariant="inline"
        />
      </figcaption>
    </figure>
  );
}
