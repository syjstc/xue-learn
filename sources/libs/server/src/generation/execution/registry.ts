import type { EvaluableOperation } from "./types.js";

const adapters = new Map<string, EvaluableOperation<unknown, unknown>>();

export function registerOperationAdapter<TInput, TOutput>(
  operation: EvaluableOperation<TInput, TOutput>,
): void {
  const current = adapters.get(operation.key);
  if (current && current !== operation) {
    throw new Error(`Operation adapter already registered: ${operation.key}`);
  }
  adapters.set(
    operation.key,
    operation as EvaluableOperation<unknown, unknown>,
  );
}

export function getOperationAdapter<TInput, TOutput>(
  key: string,
): EvaluableOperation<TInput, TOutput> | undefined {
  return adapters.get(key) as EvaluableOperation<TInput, TOutput> | undefined;
}

export function listOperationAdapters(): string[] {
  return [...adapters.keys()].sort();
}

export function clearOperationAdaptersForTests(): void {
  adapters.clear();
}
