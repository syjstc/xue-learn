/** Decide whether a thread GET snapshot should replace the local chat view. */
export function shouldApplyServerThreadSnapshot(input: {
  localStreaming: boolean;
  queryPending: boolean;
  serverMessages: unknown[] | undefined;
  localMessageCount: number;
}) {
  if (input.localStreaming) return false;
  if (input.queryPending) return false;
  if (!input.serverMessages) return false;
  // An in-flight GET started on an empty thread can complete after the local
  // SSE turn already painted. Keep the live view until a non-empty snapshot
  // (or a later empty snapshot on a truly idle thread) arrives.
  if (input.serverMessages.length === 0 && input.localMessageCount > 0) {
    return false;
  }
  return true;
}
