import { AsyncLocalStorage } from "node:async_hooks";

type UserContextStore = { userId: string };

const storage = new AsyncLocalStorage<UserContextStore>();

export function runWithUserId<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn);
}

export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.userId;
}

export function resolveUserId(explicit?: string): string | undefined {
  return explicit ?? getCurrentUserId();
}
