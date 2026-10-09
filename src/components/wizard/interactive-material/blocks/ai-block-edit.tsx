"use client";

import { useState, type ReactNode } from "react";
import { PencilLine, Sparkles, Trash2 } from "lucide-react";
import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { apiDelete } from "@/shared/api";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { isDev } from "@xue-learn/core/source/src/shared/dev.ts";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import { consumeSsePost } from "@/shared/client/consume-sse";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

/**
 * Block types the desktop-dev per-block AI edit may target. Must stay in
 * sync with `isAiEditableBlockType` in
 * `libs/server/src/llm/course-material-block-edit.ts`; server-owned checks,
 * image illustrations, placeholders, and sandbox engines are excluded.
 */
const AI_EDITABLE_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "code",
  "conversation",
  "callout",
  "accordion",
  "svg",
  "chart",
  "math_scene",
  "graph",
  "step_sort",
  "interactive_html",
  "illustration",
] as const;

export function isAiEditableBlockType(type: string): boolean {
  return (AI_EDITABLE_BLOCK_TYPES as readonly string[]).includes(type);
}

/**
 * Desktop-development-only shell around one course-material block: a hover
 * edit control opens an instruction input, then the streamed AI replacement
 * is swapped in locally (the sidecar persists it against the authoritative
 * section/legacy material).
 */
export function AiBlockEditShell({
  block,
  blockIndex,
  unitId,
  blockOffset = 0,
  onBlockReplaced,
  onBlockDeleted,
  children,
}: {
  block: InteractiveBlock;
  blockIndex: number;
  unitId?: string;
  blockOffset?: number;
  onBlockReplaced?: (blockIndex: number, block: InteractiveBlock) => void;
  onBlockDeleted?: (blockIndex: number) => void;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = isAiEditableBlockType(block.type);
  // Assessment blocks own durable task/evidence state and are intentionally
  // excluded from this destructive development-only action.
  const canDelete = block.type !== "check";
  const canEditHere = canEdit && Boolean(onBlockReplaced);
  const canDeleteHere = canDelete && Boolean(onBlockDeleted);
  const enabled =
    isDesktopLocalRuntime() &&
    isDev() &&
    Boolean(unitId) &&
    (canEditHere || canDeleteHere);

  if (!enabled) return <>{children}</>;

  const applyEdit = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || editing || deleting || !canEdit) return;
    setEditing(true);
    setError(null);

    if (block.type === "illustration") {
      try {
        const done = await consumeSsePost(
          `/api/units/${unitId}/illustrations/${
            blockIndex + blockOffset
          }/regenerate/stream`,
          { prompt: trimmed },
          () => {
            // Regeneration progress events handled by SSE stream
          },
        );
        const response = done as {
          imageUrl?: string;
          imageId?: string;
          prompt?: string;
          component?: InteractiveBlock;
        } | null;
        const updatedComponent: InteractiveBlock | null =
          response?.component?.type === "illustration"
            ? response.component
            : response?.imageUrl && response.imageId
              ? {
                  ...block,
                  imageUrl: response.imageUrl,
                  imageId: response.imageId,
                  prompt: response.prompt ?? trimmed,
                }
              : null;
        if (!updatedComponent) {
          throw new Error(t("wizard.material.illustration.regenerateFailed"));
        }
        onBlockReplaced?.(blockIndex, updatedComponent);
        setOpen(false);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : t("wizard.material.illustration.regenerateFailed"),
        );
      } finally {
        setEditing(false);
      }
      return;
    }

    try {
      const done = await consumeSsePost(
        `/api/units/${unitId}/components/${
          blockIndex + blockOffset
        }/ai-edit/stream`,
        { instruction: trimmed },
        (event) => {
          if (event.type !== "component_partial") return;
          const partial = (event as { component?: InteractiveBlock }).component;
          if (partial && partial.type === block.type) {
            onBlockReplaced?.(blockIndex, partial);
          }
        },
      );
      const response = done as { component?: InteractiveBlock } | null;
      if (response?.component?.type !== block.type) {
        throw new Error(t("wizard.material.aiBlockEdit.failed"));
      }
      onBlockReplaced?.(blockIndex, response.component);
      setOpen(false);
      setInstruction("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("wizard.material.aiBlockEdit.failed"),
      );
    } finally {
      setEditing(false);
    }
  };

  const deleteBlock = async () => {
    if (!unitId || !onBlockDeleted || !canDelete || editing || deleting) return;
    if (!window.confirm(t("wizard.material.aiBlockEdit.deleteConfirm"))) return;
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(
        `/api/units/${unitId}/components/${blockIndex + blockOffset}`,
      );
      onBlockDeleted(blockIndex);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("wizard.material.aiBlockEdit.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const isIllustration = block.type === "illustration";

  return (
    <div className="group/ai-edit relative min-w-0">
      <div
        className={cn(
          "absolute -top-2.5 right-0 z-20 flex items-center gap-1",
          "opacity-0 focus-within:opacity-100 group-hover/ai-edit:opacity-100",
        )}
      >
        {canEdit && onBlockReplaced ? (
          <button
            type="button"
            onClick={() => {
              setOpen((current) => {
                const next = !current;
                if (next) {
                  setInstruction(
                    block.type === "illustration" ? (block.prompt ?? "") : "",
                  );
                  setError(null);
                }
                return next;
              });
            }}
            disabled={editing || deleting}
            title={t("wizard.material.aiBlockEdit.button")}
            aria-label={t("wizard.material.aiBlockEdit.button")}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-[var(--course-content-border)] bg-[var(--course-content-surface)] px-2 py-0.5 text-xs text-[var(--course-content-muted)] shadow-sm transition hover:text-[var(--course-content)] disabled:cursor-not-allowed disabled:opacity-60",
              open && "opacity-100",
            )}
          >
            <PencilLine className="size-3" aria-hidden />
            {t("wizard.material.aiBlockEdit.button")}
          </button>
        ) : null}
        {canDelete && onBlockDeleted ? (
          <button
            type="button"
            onClick={() => void deleteBlock()}
            disabled={editing || deleting}
            title={t("wizard.material.aiBlockEdit.delete")}
            aria-label={t("wizard.material.aiBlockEdit.delete")}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--course-content-border)] bg-[var(--course-content-surface)] px-2 py-0.5 text-xs text-[var(--course-content-muted)] shadow-sm transition hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2
              className={cn("size-3", deleting && "animate-pulse")}
              aria-hidden
            />
            {deleting
              ? t("wizard.material.aiBlockEdit.deleting")
              : t("wizard.material.aiBlockEdit.delete")}
          </button>
        ) : null}
      </div>
      {children}
      {open ? (
        <div className="mt-2 rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)]/90 p-2.5 shadow-sm">
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={
              isIllustration
                ? t("wizard.material.aiBlockEdit.illustrationPlaceholder")
                : t("wizard.material.aiBlockEdit.placeholder")
            }
            rows={isIllustration ? 5 : 2}
            disabled={editing}
            className="w-full resize-y rounded-lg border border-[var(--course-content-border)] bg-transparent p-2 text-sm text-[var(--course-content)] outline-none placeholder:text-[var(--course-content-muted)] focus-visible:ring-1 focus-visible:ring-[var(--course-content-border)]"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={editing}
              className="rounded-lg px-2.5 py-1 text-xs text-[var(--course-content-muted)] transition hover:text-[var(--course-content)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("wizard.material.aiBlockEdit.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void applyEdit()}
              disabled={editing || !instruction.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles
                className={cn("size-3", editing && "animate-pulse")}
                aria-hidden
              />
              {editing
                ? isIllustration
                  ? t("wizard.material.aiBlockEdit.illustrationEditing")
                  : t("wizard.material.aiBlockEdit.editing")
                : isIllustration
                  ? t("wizard.material.aiBlockEdit.illustrationApply")
                  : t("wizard.material.aiBlockEdit.apply")}
            </button>
          </div>
          {error ? (
            <p className="mt-1.5 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
