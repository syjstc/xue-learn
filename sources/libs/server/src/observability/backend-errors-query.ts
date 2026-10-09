import type { ObservabilityRepository } from "../../../domain/src/index.js";
import type { BackendErrorSource } from "./backend-error-log.js";
import { requireObservabilityPersistence } from "./observability-persistence.js";

export type BackendErrorStatusFilter = number | "5xx";

export type BackendErrorListParams = {
  limit?: number;
  cursor?: string;
  hours?: number;
  source?: BackendErrorSource;
  service?: string;
  status?: BackendErrorStatusFilter;
  search?: string;
};

type DecodedCursor = {
  lastSeenAt: Date;
  id: string;
};

function decodeCursor(cursor: string | undefined): DecodedCursor | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { lastSeenAt?: unknown; id?: unknown };
    const lastSeenAt = new Date(String(value.lastSeenAt ?? ""));
    if (
      !Number.isFinite(lastSeenAt.getTime()) ||
      typeof value.id !== "string" ||
      !value.id
    ) {
      return undefined;
    }
    return { lastSeenAt, id: value.id };
  } catch {
    return undefined;
  }
}

function encodeCursor(input: { lastSeenAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      lastSeenAt: input.lastSeenAt.toISOString(),
      id: input.id,
    }),
  ).toString("base64url");
}

export async function queryBackendErrorGroups(
  params: BackendErrorListParams = {},
  repository: ObservabilityRepository = requireObservabilityPersistence(),
) {
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 25)));
  const hours = Math.min(24 * 30, Math.max(1, Math.floor(params.hours ?? 24)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const cursor = decodeCursor(params.cursor);
  const search = params.search?.trim().slice(0, 200);
  const groups = await repository.listBackendErrors({
    since, limit: limit + 1, source: params.source,
    service: params.service?.trim().slice(0, 80), status: params.status,
    search, cursor,
  });
  const hasMore = groups.length > limit;
  const items = hasMore ? groups.slice(0, limit) : groups;
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ lastSeenAt: last.lastSeenAt, id: last.id })
        : null,
    windowHours: hours,
  };
}

export async function queryBackendErrorGroupDetail(
  id: string,
  repository: ObservabilityRepository = requireObservabilityPersistence(),
) {
  const group = await repository.findBackendError(id);
  if (!group) return null;

  const recentApiOccurrences =
    group.source === "api"
      ? await repository.listApiErrorOccurrences(group.fingerprint, 20)
      : [];

  return { group, recentApiOccurrences };
}
