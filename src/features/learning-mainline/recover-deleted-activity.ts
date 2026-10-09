import type { MainlineCommand, MainlineSnapshot } from "@xue-learn/core/source/libs/domain/src/index.ts";

/** Only abandon a stale save when fresh server state confirms its activity is gone. */
export async function recoverDeletedActivity(
  error: unknown,
  command: MainlineCommand,
  reload: () => Promise<MainlineSnapshot>,
): Promise<MainlineSnapshot | null> {
  if (
    !error ||
    typeof error !== "object" ||
    !("status" in error) ||
    (error.status !== 404 && error.status !== 409) ||
    !["position", "pause"].includes(command.action) ||
    !command.activityId
  )
    return null;
  const snapshot = await reload();
  return snapshot.activities.some(
    (activity) => activity.id === command.activityId,
  )
    ? null
    : snapshot;
}
