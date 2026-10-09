/** Keep profile reads and mutations on one cache partition in local runtime. */
export function learnerProfileCacheUserId(
  userId: string | undefined,
  localRuntime: boolean,
): string | undefined {
  return userId ?? (localRuntime ? "local-owner" : undefined);
}
