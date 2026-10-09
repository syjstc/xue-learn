"use client";

import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Settings } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/ui/sheet";
import {
  useAgendaSettings,
  usePatchAgendaSettings,
} from "@/hooks/api/use-agenda";
import {
  useSelectTeachingPersona,
  useTeachingPersonas,
} from "@/hooks/api/use-teaching-personas";
import { useT } from "@xue-learn/core/i18n";
import {
  isDesktopLocalRuntime,
  supportsAgendaReminderDelivery,
} from "@xue-learn/core/client-runtime";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { localizeTeachingPersonaContent } from "@/shared/teaching-persona-i18n";
import { cn } from "@xue-learn/core/utils";
import { LlmSettingsForm } from "./llm-settings-form.tsx";
import { ThemeSettingsForm } from "./theme-settings-form.tsx";

export function QuickSettingsPanel({
  open,
  onClose,
  unitId,
}: {
  open: boolean;
  onClose: () => void;
  unitId?: string | null;
}) {
  const agendaSettingsQuery = useAgendaSettings();
  const patchAgenda = usePatchAgendaSettings();
  const personasQuery = useTeachingPersonas();
  const selectPersona = useSelectTeachingPersona();
  const t = useT();
  const localRuntime = isDesktopLocalRuntime();
  const reminderDeliveryEnabled = supportsAgendaReminderDelivery();
  const agendaSettings = agendaSettingsQuery.data ?? null;
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const personaCatalog = personasQuery.data;
  const currentPersona = personaCatalog?.current;
  const localizedCurrentPersona = currentPersona
    ? localizeTeachingPersonaContent(currentPersona, t)
    : null;
  const personaOptions = [
    ...(personaCatalog?.builtin ?? []),
    ...(personaCatalog?.custom ?? []),
  ];

  function toggleAgendaEnabled(enabled: boolean) {
    patchAgenda.mutate({ enabled });
  }

  function choosePersona(personaRef: string) {
    if (personaRef !== currentPersona?.ref) {
      selectPersona.mutate(personaRef);
    }
    setPersonaPickerOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="right"
        className={cn("w-full p-0 data-[side=right]:w-full sm:max-w-md")}
      >
        <SheetHeader className="border-b px-4 py-3 text-left">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" aria-hidden />
            <SheetTitle>{t("quickSettings.title")}</SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            {t("quickSettings.description")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <section className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
              <Label className="text-xs font-semibold">
                {t("settings.quick.aiAssistant")}
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {t("settings.quick.chooseTeacher")}
              </span>
            </div>
            <Popover
              open={personaPickerOpen}
              onOpenChange={setPersonaPickerOpen}
            >
              <PopoverTrigger
                disabled={!personaCatalog || selectPersona.isPending}
                render={
                  <button
                    id="quick-assistant-persona"
                    type="button"
                    className="flex h-12 w-full items-center gap-2.5 rounded-xl border border-primary/15 bg-background px-2.5 text-left shadow-xs outline-none transition hover:border-primary/30 hover:bg-primary/[0.025] focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={t("settings.quick.chooseTeacherAria")}
                  >
                    <img
                      src={teachingPersonaAvatarSrc(
                        currentPersona?.avatarCode ?? "xiaohui_female",
                      )}
                      alt=""
                      className="size-8 shrink-0 rounded-lg object-cover ring-1 ring-primary/15"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {localizedCurrentPersona?.name ??
                          t("settings.quick.loadingTeacher")}
                      </span>
                      {localizedCurrentPersona?.tagline ? (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {localizedCurrentPersona.tagline}
                        </span>
                      ) : null}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        personaPickerOpen && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                }
              />
              <PopoverContent
                align="start"
                sideOffset={6}
                className="w-[var(--anchor-width)] min-w-64 gap-1 rounded-xl p-1.5"
              >
                <div
                  className="max-h-72 space-y-0.5 overflow-y-auto"
                  role="listbox"
                  aria-label={t("settings.quick.chooseTeacher")}
                >
                  {personaOptions.map((persona) => {
                    const selected = persona.ref === currentPersona?.ref;
                    const localized = localizeTeachingPersonaContent(
                      persona,
                      t,
                    );
                    return (
                      <button
                        key={persona.ref}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => choosePersona(persona.ref)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
                          selected && "bg-primary/[0.08]",
                        )}
                      >
                        <img
                          src={teachingPersonaAvatarSrc(persona.avatarCode)}
                          alt=""
                          className="size-9 shrink-0 rounded-lg object-cover ring-1 ring-border"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {localized.name}
                          </span>
                          {localized.tagline ? (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {localized.tagline}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" aria-hidden />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            {selectPersona.error ? (
              <p className="mt-2 text-xs text-destructive">
                {selectPersona.error.message}
              </p>
            ) : null}
          </section>

          {!localRuntime ? (
            <section className="rounded-xl border border-border bg-card p-4">
              <LlmSettingsForm
                productMode
                lite
                autoSave
                showSaveFooter={false}
              />
            </section>
          ) : null}

          <section className="rounded-xl border border-border bg-card p-4">
            <ThemeSettingsForm compact />
          </section>

          {/* Adaptive agenda planner settings */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Label
                  htmlFor="quick-agenda-enabled"
                  className="text-sm font-medium"
                >
                  {t("agenda.settingsTitle")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("agenda.settingsDescription")}
                </p>
              </div>
              <Switch
                id="quick-agenda-enabled"
                checked={agendaSettings?.enabled ?? false}
                onCheckedChange={toggleAgendaEnabled}
                disabled={!agendaSettings || patchAgenda.isPending}
                aria-label={t("agenda.settingsTitle")}
                className="shrink-0"
              />
            </div>

            {agendaSettings?.enabled && reminderDeliveryEnabled && (
              <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
                <div className="min-w-0 space-y-1">
                  <Label
                    htmlFor="quick-agenda-reminder"
                    className="text-sm font-medium"
                  >
                    {t("agenda.reminderEnabled")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {agendaSettings.reminderEnabled
                      ? `${String(agendaSettings.reminderHour).padStart(2, "0")}:${String(agendaSettings.reminderMinute).padStart(2, "0")}`
                      : t("agenda.reminderOff")}
                  </p>
                </div>
                <Switch
                  id="quick-agenda-reminder"
                  checked={agendaSettings.reminderEnabled}
                  onCheckedChange={(reminderEnabled) =>
                    patchAgenda.mutate({ reminderEnabled })
                  }
                  disabled={patchAgenda.isPending}
                  className="shrink-0"
                />
              </div>
            )}

            {patchAgenda.error && (
              <p className="text-xs text-destructive">
                {patchAgenda.error.message}
              </p>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            {t("quickSettings.fullSettingsPrefix")}{" "}
            <Link
              to="/settings"
              className="font-medium text-primary hover:underline"
              onClick={onClose}
            >
              {t("quickSettings.fullSettingsLink")}
            </Link>
            {t("quickSettings.fullSettingsSuffix")}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
