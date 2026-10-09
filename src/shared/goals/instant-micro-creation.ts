import { apiFetch } from "@/shared/api-client";
import { consumeSseResponse } from "@/shared/client/consume-sse";
import type { SseEvent } from "@/shared/llm/sse";
import { canUseBrowserPersistentStorage } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import {
  readLocalClientPreference,
  writeLocalClientPreference,
} from "@/shared/runtime/local-client-preferences";

export type InstantMicroStreamInput = {
  topic?: string;
  files?: File[];
  runId?: string;
};

export type InstantMicroShellReady = {
  goalId: string;
  unitId: string;
  navigateTo: string;
  runId?: string;
};

export function parseInstantMicroShellReady(
  event: SseEvent,
): InstantMicroShellReady | null {
  if (event.type !== "shell_ready") return null;
  const goalId = typeof event.goalId === "string" ? event.goalId : "";
  const unitId = typeof event.unitId === "string" ? event.unitId : "";
  const navigateTo =
    typeof event.navigateTo === "string" ? event.navigateTo : "";
  if (!goalId || !unitId || !navigateTo) return null;
  return {
    goalId,
    unitId,
    navigateTo,
    runId: typeof event.runId === "string" ? event.runId : undefined,
  };
}

export async function streamInstantMicroCreation(
  input: InstantMicroStreamInput,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<SseEvent | null> {
  const form = new FormData();
  if (input.topic?.trim()) {
    form.append("topic", input.topic.trim());
  }
  if (input.runId) {
    form.append("runId", input.runId);
  }
  for (const file of input.files ?? []) {
    form.append("files", file);
  }

  const res = await apiFetch("/api/goals/instant-micro/stream", {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    body: form,
    signal,
  });

  return consumeSseResponse(res, onEvent);
}

export const INSTANT_MICRO_SESSION_KEY_PREFIX = "instant-micro:";

export function markUnitInstantMicro(unitId: string) {
  if (!canUseBrowserPersistentStorage()) {
    writeLocalClientPreference(
      `${INSTANT_MICRO_SESSION_KEY_PREFIX}${unitId}`,
      true,
    );
    return;
  }
  try {
    sessionStorage.setItem(`${INSTANT_MICRO_SESSION_KEY_PREFIX}${unitId}`, "1");
  } catch {
    // ignore storage failures
  }
}

export function isUnitInstantMicro(unitId: string): boolean {
  if (!canUseBrowserPersistentStorage()) {
    return readLocalClientPreference(
      `${INSTANT_MICRO_SESSION_KEY_PREFIX}${unitId}`,
      false,
    );
  }
  try {
    return (
      sessionStorage.getItem(`${INSTANT_MICRO_SESSION_KEY_PREFIX}${unitId}`) ===
      "1"
    );
  } catch {
    return false;
  }
}

export function clearUnitInstantMicro(unitId: string) {
  if (!canUseBrowserPersistentStorage()) {
    writeLocalClientPreference(
      `${INSTANT_MICRO_SESSION_KEY_PREFIX}${unitId}`,
      null,
    );
    return;
  }
  try {
    sessionStorage.removeItem(`${INSTANT_MICRO_SESSION_KEY_PREFIX}${unitId}`);
  } catch {
    // ignore storage failures
  }
}
