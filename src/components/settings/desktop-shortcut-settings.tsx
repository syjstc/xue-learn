import { useState } from "react";
import { useT } from "@xue-learn/core/i18n";
import { getClientRuntime } from "@xue-learn/core/client-runtime";
import {
  formatSidebarShortcut,
  readSidebarShortcut,
  writeSidebarShortcut,
  type SidebarShortcut,
} from "@/shared/runtime/sidebar-shortcut";

export function DesktopShortcutSettings() {
  const t = useT();
  const runtime = getClientRuntime();
  const [shortcut, setShortcut] = useState(readSidebarShortcut);

  function updateShortcut(next: SidebarShortcut) {
    setShortcut(next);
    writeSidebarShortcut(next);
  }

  return (
    <label className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span>
        <span className="block text-sm font-medium">
          {t("settings.shortcuts.toggleSidebar")}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {t("settings.shortcuts.toggleSidebarDescription")}
        </span>
      </span>
      <select
        value={shortcut}
        onChange={(event) =>
          updateShortcut(event.target.value as SidebarShortcut)
        }
        className="h-9 min-w-40 rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("settings.shortcuts.toggleSidebar")}
      >
        <option value="mod+b">
          {formatSidebarShortcut("mod+b", runtime.os)}
        </option>
        <option value="mod+shift+b">
          {formatSidebarShortcut("mod+shift+b", runtime.os)}
        </option>
        <option value="disabled">{t("settings.shortcuts.disabled")}</option>
      </select>
    </label>
  );
}
