"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  useAgendaSettings,
  usePatchAgendaSettings,
} from "@/hooks/api/use-agenda";
import { supportsAgendaReminderDelivery } from "@xue-learn/core/client-runtime";
import { useT } from "@xue-learn/core/i18n";

export function AgendaSettingsForm() {
  const t = useT();
  const query = useAgendaSettings();
  const patch = usePatchAgendaSettings();
  const settings = query.data;
  const error = query.error?.message ?? patch.error?.message;
  const reminderDeliveryEnabled = supportsAgendaReminderDelivery();

  if (query.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.experience.loading")}
      </p>
    );
  }

  if (!settings) {
    return (
      <p className="text-sm text-destructive">
        {error || t("settings.experience.unavailable")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="settings-agenda-enabled">
            {t("agenda.settingsTitle")}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("agenda.settingsDescription")}
          </p>
        </div>
        <Switch
          id="settings-agenda-enabled"
          checked={settings.enabled}
          onCheckedChange={(enabled) => patch.mutate({ enabled })}
          disabled={patch.isPending}
          className="shrink-0"
        />
      </div>

      {settings.enabled ? (
        <div className="flex items-start justify-between gap-4 border-t border-border/70 pt-4">
          <div className="min-w-0">
            <Label htmlFor="settings-agenda-capacity">
              {t("settings.agenda.dailyCapacity")}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.agenda.dailyCapacityDescription")}
            </p>
          </div>
          <Input
            id="settings-agenda-capacity"
            type="number"
            min={15}
            max={180}
            defaultValue={settings.dailyCapacityTargetMin}
            disabled={patch.isPending}
            className="w-24 shrink-0"
            aria-label={t("settings.agenda.dailyCapacityAria")}
            onBlur={(event) => {
              const value = Number(event.currentTarget.value);
              if (
                Number.isFinite(value) &&
                value !== settings.dailyCapacityTargetMin
              ) {
                patch.mutate({ dailyCapacityTargetMin: value });
              }
            }}
          />
        </div>
      ) : null}

      {settings.enabled && reminderDeliveryEnabled ? (
        <div className="flex items-start justify-between gap-4 border-t border-border/70 pt-4">
          <div className="min-w-0">
            <Label htmlFor="settings-agenda-reminder">
              {t("agenda.reminderEnabled")}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {settings.reminderEnabled
                ? `${String(settings.reminderHour).padStart(2, "0")}:${String(
                    settings.reminderMinute,
                  ).padStart(2, "0")}`
                : t("agenda.reminderOff")}
            </p>
          </div>
          <Switch
            id="settings-agenda-reminder"
            checked={settings.reminderEnabled}
            onCheckedChange={(reminderEnabled) =>
              patch.mutate({ reminderEnabled })
            }
            disabled={patch.isPending}
            className="shrink-0"
          />
        </div>
      ) : null}

      {patch.error ? (
        <p className="text-xs text-destructive">{patch.error.message}</p>
      ) : null}
    </div>
  );
}
