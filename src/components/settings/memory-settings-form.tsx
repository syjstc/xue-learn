"use client";

import { useState, type KeyboardEvent } from "react";
import { Archive, BrainCircuit, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  type MemoryItem,
  type MemoryKind,
  useArchiveMemory,
  useCorrectMemory,
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useMemoryCandidates,
  useMemorySettings,
  useResolveMemoryCandidate,
  useSaveMemorySettings,
} from "@/hooks/api/use-memories";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@xue-learn/core/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

const EDITABLE_KINDS: Array<Exclude<MemoryKind, "episode">> = [
  "personal_fact",
  "preference",
  "constraint",
];

function kindKey(kind: MemoryKind): TranslationKey {
  return `settings.memory.kind.${kind}` as TranslationKey;
}

function sourceKey(item: MemoryItem): TranslationKey {
  return `settings.memory.source.${item.authority}` as TranslationKey;
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  stretch = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  stretch?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "rounded-lg bg-muted p-0.5",
        stretch ? "grid grid-cols-3" : "inline-flex",
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
              stretch && "w-full",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MemoryRow({ item }: { item: MemoryItem }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(item.summary);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const correct = useCorrectMemory();
  const archive = useArchiveMemory();
  const remove = useDeleteMemory();

  return (
    <article className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{t(kindKey(item.kind))}</Badge>
            <Badge variant="outline">{t(sourceKey(item))}</Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(item.updatedAt).toLocaleDateString()}
            </span>
          </div>
          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={2_000}
                rows={3}
                className="resize-none"
                aria-label={t("settings.memory.edit")}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!summary.trim() || correct.isPending}
                  onClick={() =>
                    correct.mutate(
                      { id: item.id, summary: summary.trim() },
                      { onSuccess: () => setEditing(false) },
                    )
                  }
                >
                  <Check /> {t("common.save")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSummary(item.summary);
                    setEditing(false);
                  }}
                >
                  <X /> {t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-foreground">{item.summary}</p>
          )}
          {item.evidence.length > 0 ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">
                {t("settings.memory.evidence")}
              </summary>
              <ul className="mt-2 space-y-2 border-l border-border pl-3">
                {item.evidence.map((evidence) => (
                  <li key={evidence.id} className="leading-5">
                    “{evidence.excerpt}”
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-0.5">
          {item.status === "active" && item.kind !== "episode" ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={t("settings.memory.edit")}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          ) : null}
          {item.status === "active" ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={t("settings.memory.archive")}
              disabled={archive.isPending}
              onClick={() => archive.mutate(item.id)}
            >
              <Archive />
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={t("settings.memory.delete")}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("settings.memory.deleteTitle")}
        description={t("settings.memory.deleteDescription")}
        confirmLabel={t("settings.memory.deleteForever")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(item.id, { onSuccess: () => setConfirmDelete(false) })
        }
      />
    </article>
  );
}

export function MemorySettingsForm() {
  const t = useT();
  const settings = useMemorySettings();
  const saveSettings = useSaveMemorySettings();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const memories = useMemories(status);
  const candidates = useMemoryCandidates();
  const create = useCreateMemory();
  const resolve = useResolveMemoryCandidate();
  const [kind, setKind] =
    useState<Exclude<MemoryKind, "episode">>("personal_fact");
  const [summary, setSummary] = useState("");

  function submitMemory() {
    const next = summary.trim();
    if (!next || create.isPending) return;
    create.mutate({ kind, summary: next }, { onSuccess: () => setSummary("") });
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitMemory();
    }
  }

  if (settings.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
        <div className="h-36 animate-pulse rounded-xl bg-muted" />
        <p className="sr-only">{t("settings.memory.loading")}</p>
      </div>
    );
  }
  if (settings.error) {
    return (
      <ApiErrorNotice
        error={settings.error}
        fallback={t("settings.experience.unavailable")}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="personal-memory-enabled">
            {t("settings.memory.optIn")}
          </Label>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            {t("settings.memory.privacy")}
          </p>
        </div>
        <Switch
          id="personal-memory-enabled"
          className="mt-0.5 shrink-0"
          checked={settings.data?.enabled ?? false}
          disabled={saveSettings.isPending}
          onCheckedChange={(enabled) => saveSettings.mutate(enabled)}
        />
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("settings.memory.addTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.memory.addHint")}
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="border-b border-border/70 px-3 py-2">
            <SegmentedControl
              stretch
              value={kind}
              onChange={setKind}
              ariaLabel={t("settings.memory.kindLabel")}
              options={EDITABLE_KINDS.map((value) => ({
                value,
                label: t(kindKey(value)),
              }))}
            />
          </div>
          <Textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={t("settings.memory.addPlaceholder")}
            rows={3}
            maxLength={2_000}
            className="min-h-24 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-end border-t border-border/70 bg-muted/30 px-3 py-2">
            <Button
              size="sm"
              disabled={!summary.trim() || create.isPending}
              onClick={submitMemory}
            >
              <Plus /> {t("settings.memory.add")}
            </Button>
          </div>
        </div>
      </section>

      {(candidates.data?.length ?? 0) > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">
            {t("settings.memory.reviewTitle")}
          </h3>
          <div className="space-y-2">
            {candidates.data?.map((candidate) => (
              <div
                key={candidate.id}
                className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <Badge variant="outline">{t(kindKey(candidate.kind))}</Badge>
                  <p className="mt-2 text-sm leading-6">{candidate.summary}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={resolve.isPending}
                    onClick={() =>
                      resolve.mutate({ id: candidate.id, decision: "accept" })
                    }
                  >
                    {t("settings.memory.accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolve.isPending}
                    onClick={() =>
                      resolve.mutate({ id: candidate.id, decision: "reject" })
                    }
                  >
                    {t("settings.memory.reject")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">
            {t("settings.memory.listTitle")}
          </h3>
          <SegmentedControl
            value={status}
            onChange={setStatus}
            ariaLabel={t("settings.memory.listTitle")}
            options={[
              {
                value: "active" as const,
                label: t("settings.memory.status.active"),
              },
              {
                value: "archived" as const,
                label: t("settings.memory.status.archived"),
              },
            ]}
          />
        </div>
        {memories.error ? (
          <ApiErrorNotice
            error={memories.error}
            fallback={t("settings.experience.unavailable")}
            onRetry={() => void memories.refetch()}
          />
        ) : memories.isLoading ? (
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
        ) : memories.data?.items.length ? (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {memories.data.items.map((item) => (
              <MemoryRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl bg-muted/40 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
              <BrainCircuit className="size-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("settings.memory.emptyTitle")}
            </p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              {t("settings.memory.empty")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
