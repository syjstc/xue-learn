import type { RuntimeDescriptor } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { canUseBrowserPersistentStorage } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import {
  readLocalClientPreference,
  writeLocalClientPreference,
} from "./local-client-preferences.ts";

export type SidebarShortcut = "mod+b" | "mod+shift+b" | "disabled";

export const DEFAULT_SIDEBAR_SHORTCUT: SidebarShortcut = "mod+b";
export const SIDEBAR_SHORTCUT_CHANGED_EVENT =
  "xue-learn:sidebar-shortcut-changed";

const STORAGE_KEY = "xue-learn:sidebar-shortcut";

function normalize(value: string | null): SidebarShortcut {
  return value === "mod+b" || value === "mod+shift+b" || value === "disabled"
    ? value
    : DEFAULT_SIDEBAR_SHORTCUT;
}

export function readSidebarShortcut(): SidebarShortcut {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_SHORTCUT;
  if (!canUseBrowserPersistentStorage()) {
    return normalize(
      readLocalClientPreference<string | null>(STORAGE_KEY, null),
    );
  }
  return normalize(window.localStorage.getItem(STORAGE_KEY));
}

export function writeSidebarShortcut(shortcut: SidebarShortcut): void {
  if (canUseBrowserPersistentStorage()) {
    window.localStorage.setItem(STORAGE_KEY, shortcut);
  } else {
    writeLocalClientPreference(STORAGE_KEY, shortcut);
  }
  window.dispatchEvent(
    new CustomEvent<SidebarShortcut>(SIDEBAR_SHORTCUT_CHANGED_EVENT, {
      detail: shortcut,
    }),
  );
}

export function formatSidebarShortcut(
  shortcut: SidebarShortcut,
  os: RuntimeDescriptor["os"],
): string | null {
  if (shortcut === "disabled") return null;
  const modifier = os === "macos" ? "⌘" : "Ctrl+";
  const shift =
    shortcut === "mod+shift+b" ? (os === "macos" ? "⇧" : "Shift+") : "";
  return `${shift}${modifier}B`;
}

export function matchesSidebarShortcut(
  event: KeyboardEvent,
  shortcut: SidebarShortcut,
  os: RuntimeDescriptor["os"],
): boolean {
  if (shortcut === "disabled") return false;
  const platformModifier =
    os === "macos"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  return (
    platformModifier &&
    !event.altKey &&
    event.shiftKey === (shortcut === "mod+shift+b") &&
    event.key.toLowerCase() === "b"
  );
}
