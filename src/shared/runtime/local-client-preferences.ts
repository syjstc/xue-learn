import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

let preferences: Record<string, unknown> = {};
let writeQueue = Promise.resolve();

export async function hydrateLocalClientPreferences(): Promise<void> {
  if (!isDesktopLocalRuntime()) return;
  try {
    const response = await fetch("/api/settings/client-preferences", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) return;
    const value = await response.json();
    preferences =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
  } catch {
    preferences = {};
  }
}

export function readLocalClientPreference<T>(key: string, fallback: T): T {
  return isDesktopLocalRuntime() && key in preferences
    ? (preferences[key] as T)
    : fallback;
}

export function writeLocalClientPreference(key: string, value: unknown): void {
  if (!isDesktopLocalRuntime()) return;
  if (value === null) {
    const next = { ...preferences };
    delete next[key];
    preferences = next;
  } else {
    preferences = { ...preferences, [key]: value };
  }
  writeQueue = writeQueue
    .then(() =>
      fetch("/api/settings/client-preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        credentials: "omit",
        body: JSON.stringify({ patch: { [key]: value } }),
      }),
    )
    .then(() => undefined)
    .catch(() => undefined);
}
