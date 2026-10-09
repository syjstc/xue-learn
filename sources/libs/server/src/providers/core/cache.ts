export type ProviderCacheKeyInput = {
  scopeKey: string;
  selectionKey: string;
};

export function providerCacheKey(input: ProviderCacheKeyInput): string {
  return `${input.scopeKey}::${input.selectionKey}`;
}

export class ProviderCache<T> {
  private readonly store = new Map<string, T>();

  get(key: string): T | undefined {
    return this.store.get(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  set(key: string, value: T): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  deleteByScopePrefix(scopeKey: string): void {
    const prefix = `${scopeKey}::`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
