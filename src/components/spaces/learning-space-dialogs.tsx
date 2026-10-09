import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, FolderInput, Sparkles } from "lucide-react";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { Button } from "@xue-learn/core/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  LearningSpace,
  LearningSpaceItem,
  LearningSpaceRelation,
} from "@/hooks/api";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

const UNORGANIZED_SPACE_VALUE = "__unorganized__";

const selectTriggerClassName =
  "h-11 w-full rounded-xl border-[var(--border-200)] bg-[var(--bg-50)] px-3 data-[size=default]:h-11";

export const SPACE_ACCENT_STYLE = {
  soft: "bg-[var(--brand-50)]",
  text: "text-[var(--brand-700)]",
  line: "bg-[var(--brand-400)]",
} as const;

function DialogActions({
  pending,
  submitDisabled = false,
  submitLabel,
  onCancel,
}: {
  pending: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 sm:min-h-9"
        onClick={onCancel}
        disabled={pending}
      >
        {t("spaces.cancel")}
      </Button>
      <Button
        type="submit"
        className="min-h-11 sm:min-h-9"
        disabled={pending || submitDisabled}
      >
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

export function SpaceIdentityDialog({
  open,
  mode,
  initial,
  pending,
  error,
  onOpenChange,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial?: Pick<LearningSpace, "name" | "purpose">;
  pending: boolean;
  error?: unknown;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: { name: string; purpose: string }) => Promise<void>;
  onDelete?: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setPurpose(initial?.purpose ?? "");
  }, [initial?.name, initial?.purpose, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="gap-1.5 pr-8">
          <DialogTitle>
            {mode === "create"
              ? t("spaces.createTitle")
              : t("spaces.editTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? t("spaces.createDescription")
              : t("spaces.editDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void onSubmit({
              name: name.trim(),
              purpose: purpose.trim(),
            });
          }}
        >
          <div className="flex flex-col gap-5 pb-1">
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--text-700)]">
                <span>{t("spaces.name")}</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  placeholder={t("spaces.namePlaceholder")}
                  className="h-10"
                  autoFocus
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--text-700)]">
                <span>{t("spaces.purpose")}</span>
                <Textarea
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  maxLength={500}
                  placeholder={t("spaces.purposePlaceholder")}
                  className="min-h-24 resize-none"
                />
              </label>
            </div>
            {error ? <ApiErrorNotice error={error} /> : null}
            {mode === "edit" && onDelete ? (
              <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900/50 dark:bg-red-950/20">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">
                    {t("spaces.dangerZone")}
                  </p>
                  <p className="text-xs leading-relaxed text-red-600/80 dark:text-red-300/70">
                    {t("spaces.deleteHint")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="w-fit min-h-10"
                  onClick={onDelete}
                  disabled={pending}
                >
                  {t("spaces.delete")}
                </Button>
              </div>
            ) : null}
          </div>
          <DialogActions
            pending={pending}
            submitDisabled={!name.trim()}
            submitLabel={
              mode === "create" ? t("spaces.create") : t("spaces.save")
            }
            onCancel={() => onOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveGoalDialog({
  open,
  goalTitle,
  spaces,
  currentSpaceId,
  pending,
  error,
  onOpenChange,
  onMove,
}: {
  open: boolean;
  goalTitle: string;
  spaces: LearningSpace[];
  currentSpaceId: string | null;
  pending: boolean;
  error?: unknown;
  onOpenChange: (open: boolean) => void;
  onMove: (spaceId: string | null) => Promise<void>;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string>(currentSpaceId ?? "");

  useEffect(() => {
    if (open) setSelected(currentSpaceId ?? "");
  }, [currentSpaceId, open]);

  const destinationOptions = [
    { value: UNORGANIZED_SPACE_VALUE, label: t("spaces.unorganized") },
    ...spaces.map((space) => ({ value: space.id, label: space.name })),
  ];
  const selectedValue = selected || UNORGANIZED_SPACE_VALUE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("spaces.moveGoalTitle")}</DialogTitle>
          <DialogDescription>
            {t("spaces.moveGoalDescription", { title: goalTitle })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void onMove(selected || null);
          }}
        >
          <div className="flex flex-col gap-5 pb-1">
            <label className="flex flex-col gap-2 text-sm font-medium">
              <span>{t("spaces.destination")}</span>
              <Select
                items={destinationOptions}
                value={selectedValue}
                onValueChange={(next) => {
                  if (next == null) return;
                  setSelected(next === UNORGANIZED_SPACE_VALUE ? "" : next);
                }}
              >
                <SelectTrigger className={selectTriggerClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom" sideOffset={6}>
                  {destinationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {error ? <ApiErrorNotice error={error} /> : null}
          </div>
          <DialogActions
            pending={pending}
            submitDisabled={selected === (currentSpaceId ?? "")}
            submitLabel={t("spaces.move")}
            onCancel={() => onOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function itemLabel(item: LearningSpaceItem) {
  return item.goal?.title || item.plannedTitle;
}

export function RelationDialog({
  open,
  items,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  items: LearningSpaceItem[];
  pending: boolean;
  error?: unknown;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: {
    fromItemId: string;
    toItemId: string;
    relationType: LearningSpaceRelation["relationType"];
  }) => Promise<void>;
}) {
  const t = useT();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] =
    useState<LearningSpaceRelation["relationType"]>("prerequisite");

  useEffect(() => {
    if (!open) return;
    setFrom("");
    setTo("");
    setType("prerequisite");
  }, [open]);

  const canSubmit = from && to && from !== to;
  const itemOptions = items.map((item) => ({
    value: item.id,
    label: itemLabel(item),
  }));
  const chooseItemPlaceholder = t("spaces.chooseItem");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("spaces.addRelationTitle")}</DialogTitle>
          <DialogDescription>
            {t("spaces.addRelationDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit)
              void onSubmit({
                fromItemId: from,
                toItemId: to,
                relationType: type,
              });
          }}
        >
          <div className="flex flex-col gap-5 pb-1">
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <label className="flex flex-col gap-2 text-sm font-medium">
                <span>{t("spaces.from")}</span>
                <Select
                  items={itemOptions}
                  value={from || null}
                  onValueChange={(next) => setFrom(next ?? "")}
                >
                  <SelectTrigger className={selectTriggerClassName}>
                    <SelectValue placeholder={chooseItemPlaceholder} />
                  </SelectTrigger>
                  <SelectContent side="bottom" sideOffset={6}>
                    {itemOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <ArrowRight className="mx-auto mb-3.5 hidden size-4 text-[var(--text-300)] sm:block" />
              <label className="flex flex-col gap-2 text-sm font-medium">
                <span>{t("spaces.to")}</span>
                <Select
                  items={itemOptions}
                  value={to || null}
                  onValueChange={(next) => setTo(next ?? "")}
                >
                  <SelectTrigger className={selectTriggerClassName}>
                    <SelectValue placeholder={chooseItemPlaceholder} />
                  </SelectTrigger>
                  <SelectContent side="bottom" sideOffset={6}>
                    {itemOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        disabled={option.value === from}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">
                {t("spaces.relationshipType")}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  ["prerequisite", "supports", "follow_up", "related"] as const
                ).map((relationType) => (
                  <button
                    key={relationType}
                    type="button"
                    role="radio"
                    aria-checked={type === relationType}
                    onClick={() => setType(relationType)}
                    className={cn(
                      "min-h-11 rounded-xl border px-3 text-left text-sm",
                      type === relationType
                        ? "border-[var(--brand-400)] bg-[var(--brand-50)] text-[var(--brand-700)]"
                        : "border-[var(--border-200)] hover:bg-[var(--bg-100)]",
                    )}
                  >
                    {t(`spaces.relation.${relationType}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            {error ? <ApiErrorNotice error={error} /> : null}
          </div>
          <DialogActions
            pending={pending}
            submitDisabled={!canSubmit}
            submitLabel={t("spaces.addRelation")}
            onCancel={() => onOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmActionDialog({
  open,
  title,
  description,
  pending,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  pending: boolean;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/30">
            <AlertTriangle className="size-5" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("spaces.cancel")}
          </Button>
          <Button
            variant="destructive"
            className="min-h-11 sm:min-h-9"
            onClick={() => void onConfirm()}
            disabled={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmptyRoadmapIllustration() {
  return (
    <div className="relative mx-auto h-20 w-32" aria-hidden>
      <span className="absolute left-4 top-2 flex size-9 items-center justify-center rounded-full bg-[var(--brand-50)] text-[var(--brand-600)]">
        <Sparkles className="size-4" />
      </span>
      <span className="absolute left-8 top-11 h-5 w-px bg-[var(--brand-200)]" />
      <span className="absolute bottom-0 left-4 flex size-9 items-center justify-center rounded-full bg-[var(--bg-200)] text-[var(--text-500)]">
        <FolderInput className="size-4" />
      </span>
      <span className="absolute left-12 top-6 h-px w-14 bg-[var(--border-200)]" />
      <span className="absolute right-2 top-4 size-3 rounded-full bg-[var(--brand-300)]" />
    </div>
  );
}
