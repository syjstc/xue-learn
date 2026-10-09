"use client";

import { FlaskConical, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { MaterialBlockRenderer } from "@/components/wizard/interactive-material/material-block-renderer";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import { useT } from "@xue-learn/core/i18n";
import { Button } from "@xue-learn/core/ui/button";
import type { UnitLabContent } from "@xue-learn/core/shared/domain/unit-lab";
import { PhysicsLabBlock } from "@/components/lab/physics-lab";
import { ChemistryLabBlock } from "@/components/lab/chemistry-lab";
import { LabFrameHost } from "@/components/lab/lab-frame-host";
import { labManifestFromLegacyBlock } from "@/shared/domain/lab-manifest";
import type { LabEvent } from "@xue-learn/core/lab-protocol";

export type { UnitLabContent } from "@xue-learn/core/shared/domain/unit-lab";

export function UnitLabCard({
  content,
  generating = false,
  onPrepare,
  onComplete,
  onRegenerateItem,
}: {
  content: UnitLabContent | null;
  generating?: boolean;
  onPrepare?: () => void;
  onComplete?: () => void;
  onRegenerateItem?: (itemIndex: number) => Promise<unknown>;
}) {
  const t = useT();
  const definition = content?.definition;
  const preparing =
    generating ||
    content?.status === "preparing" ||
    content?.status === "pending";
  const failed = content?.status === "failed" && !preparing;
  const ready = Boolean(definition?.items?.length);

  return (
    <section className="flex h-full min-h-0 flex-col gap-7 overflow-y-auto px-1 py-2 sm:px-2">
      <header className="flex items-start gap-3 px-1">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FlaskConical className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {t("learningJourney.lab")}
          </p>
          <h2 className="text-lg font-semibold">
            {definition?.title ?? t("learningJourney.lab")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {definition?.summary ??
              content?.recommendation ??
              t("learningJourney.labIdleBody")}
          </p>
        </div>
      </header>

      {!ready && onPrepare ? (
        <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          {failed
            ? content?.generationError || t("learningJourney.labFailed")
            : t("learningJourney.labIdleBody")}
          <Button
            className="mt-3 gap-2"
            type="button"
            variant={failed ? "outline" : "default"}
            disabled={preparing}
            onClick={onPrepare}
          >
            {preparing ? (
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {preparing
              ? t("learningJourney.labPreparing")
              : failed
                ? t("learningJourney.labRetry")
                : t("learningJourney.labGenerate")}
          </Button>
        </div>
      ) : null}

      {ready ? (
        <div className="flex flex-col gap-8">
          {(definition?.items ?? []).map((item, index) => (
            <UnitLabItemCard
              key={item.id}
              item={item}
              itemIndex={index}
              onRegenerate={onRegenerateItem}
              onFinish={onComplete}
            />
          ))}
        </div>
      ) : null}

      {ready && onComplete ? (
        <div className="pt-2">
          <Button type="button" variant="outline" onClick={onComplete}>
            {t("learningJourney.labDone")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function UnitLabItemCard({
  item,
  itemIndex,
  onRegenerate,
  onFinish,
}: {
  item: NonNullable<UnitLabContent["definition"]>["items"][number];
  itemIndex: number;
  onRegenerate?: (itemIndex: number) => Promise<unknown>;
  onFinish?: () => void;
}) {
  const t = useT();
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const embeddedManifest = item.manifest ?? (item.block ? labManifestFromLegacyBlock(item.block) : null);

  async function regenerate() {
    if (!onRegenerate || regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      await onRegenerate(itemIndex);
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
    <div className="space-y-3">
      {onRegenerate ? (
        <div className="flex justify-end px-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            disabled={regenerating}
            onClick={() => void regenerate()}
          >
            {regenerating ? (
              <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {regenerating
              ? t("wizard.material.placeholder.generating")
              : t("wizard.material.regenerate")}
          </Button>
        </div>
      ) : null}
      {item.status === "ready" && (item.block || embeddedManifest) ? (
        (item.componentType === "physics_lab" || item.componentType === "chemistry_lab") &&
        embeddedManifest ? (
          <EmbeddedLabItem
            manifest={embeddedManifest}
            onFinish={onFinish}
          />
        ) : item.componentType === "physics_lab" && item.block ? (
          <PhysicsLabBlock
            block={
              item.block as unknown as import("@xue-learn/core/domain").PhysicsLabDefinition
            }
          />
        ) : item.componentType === "chemistry_lab" && item.block ? (
          <ChemistryLabBlock
            block={
              item.block as unknown as import("@xue-learn/core/domain").ChemistryLabDefinition
            }
          />
        ) : item.block ? (
          <MaterialBlockRenderer
            block={item.block as unknown as InteractiveBlock}
            blockIndex={itemIndex}
            highlights={new Map()}
          />
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{item.title}</p>
            <p className="mt-1">{item.fallbackBody || "实验室运行时尚未启用。"}</p>
          </div>
        )
      ) : (
        <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{item.title}</p>
          <p className="mt-1">
            {item.fallbackBody ||
              item.error ||
              t("learningJourney.labItemFailed")}
          </p>
        </div>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function EmbeddedLabItem({
  manifest,
  onFinish,
}: {
  manifest: import("@xue-learn/core/lab-protocol").LabManifestV1;
  onFinish?: () => void;
}) {
  function handleEvent(event: LabEvent) {
    if (event.type === "finish.requested") onFinish?.();
  }

  return (
    <div className="space-y-3">
      <LabFrameHost
        manifest={manifest}
        title={manifest.title}
        className="h-[520px] w-full rounded-xl border-0"
        onEvent={handleEvent}
        fallback={
          <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{manifest.title}</p>
            <p className="mt-1">{manifest.summary}</p>
            {manifest.targetObservation ? (
              <p className="mt-2">观察要点：{manifest.targetObservation}</p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
