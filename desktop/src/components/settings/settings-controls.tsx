"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@xue-learn/core/ui/button";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

export type ProviderOption = {
  id: string;
  label: string;
  description?: string;
  configured?: boolean;
};

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function ProviderPicker({
  providers,
  value,
  onChange,
  accent = "indigo",
  columns = "sm:grid-cols-2 lg:grid-cols-4",
}: {
  providers: ProviderOption[];
  value: string;
  onChange: (id: string) => void;
  accent?: "indigo" | "violet";
  columns?: string;
}) {
  const t = useT();
  void accent;

  return (
    <div className={cn("grid gap-2", columns)} role="radiogroup">
      {providers.map((p) => {
        const selected = value === p.id;
        const disabled = p.configured === false;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(p.id)}
            className={cn(
              "min-h-24 rounded-lg border px-3.5 py-3 text-left text-sm transition-colors",
              selected
                ? "border-primary bg-[var(--course-content-surface-accent)] shadow-[inset_0_0_0_1px_var(--primary)]"
                : "border-border bg-card hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span className="font-semibold text-foreground">{p.label}</span>
            {p.description && (
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {p.description}
              </span>
            )}
            {disabled && (
              <span className="mt-1 block text-xs text-[var(--warning)]">
                {t("common.notConfiguredApiKey")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function LiteProviderSelect({
  providers,
  value,
  onChange,
}: {
  providers: ProviderOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onChange(nextValue);
      }}
    >
      <SelectTrigger className="w-full" size="compact">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {providers.map((p) => (
          <SelectItem key={p.id} value={p.id} disabled={p.configured === false}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LiteModelSelect({
  presets,
  value,
  onChange,
  placeholder,
  allowCustom = false,
}: {
  presets: string[];
  value: string;
  onChange: (model: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
}) {
  if (allowCustom) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-sm"
        placeholder={placeholder}
      />
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onChange(nextValue);
      }}
    >
      <SelectTrigger className="w-full" size="compact">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {presets.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ModelPicker({
  presets,
  value,
  onChange,
  placeholder,
  accent = "indigo",
  allowCustom = true,
}: {
  presets: string[];
  value: string;
  onChange: (model: string) => void;
  placeholder?: string;
  accent?: "indigo" | "violet";
  /** When false, only preset chips are shown (no free-text input). */
  allowCustom?: boolean;
}) {
  const t = useT();
  void accent;
  const selectedClass =
    "border-primary bg-[var(--course-content-surface-accent)] text-primary shadow-[inset_0_0_0_1px_var(--primary)]";

  if (!allowCustom) {
    return (
      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={t("settings.model")}
      >
        {presets.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            onClick={() => onChange(m)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              value === m
                ? selectedClass
                : "border-border bg-card text-muted-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]",
            )}
          >
            {m}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange(m)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                value === m
                  ? selectedClass
                  : "border-border bg-card text-muted-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
        placeholder={placeholder ?? t("desktop.i18n.modelCustomPlaceholder")}
      />
    </div>
  );
}

export function SettingsSaveFooter({
  saving,
  saved,
  error,
  onSave,
  label,
}: {
  saving: boolean;
  saved: boolean;
  error?: string | null;
  onSave: () => void;
  label?: string;
}) {
  const t = useT();

  return (
    <div className="flex flex-col gap-2 border-t border-border/80 pt-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && (
        <p className="text-sm text-green-700">{t("common.savedSettings")}</p>
      )}
      <Button onClick={onSave} disabled={saving} className="w-fit">
        {saving ? t("common.saving") : (label ?? t("common.saveSettings"))}
      </Button>
    </div>
  );
}
