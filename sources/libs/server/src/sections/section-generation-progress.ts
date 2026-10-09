import type { LearningMaterialContent } from "../llm/schemas.js";

export type SectionGenerationPartial = Readonly<{
  material: LearningMaterialContent;
  completeBlockCount: number;
  placeholderBlockCount?: number;
}>;

type Listener = (partial: SectionGenerationPartial) => void | Promise<void>;

type Entry = {
  token: string | null;
  latest: SectionGenerationPartial | null;
  listeners: Set<Listener>;
};

/**
 * Keeps renderer reconnects attached to section work that remains alive in the
 * local sidecar. This is intentionally process-local: a full sidecar restart
 * is handled by the persisted interrupted-generation recovery path.
 */
export class SectionGenerationProgressBroker {
  private readonly entries = new Map<string, Entry>();

  begin(key: string, token: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.token = token;
      entry.latest = null;
      return;
    }
    this.entries.set(key, {
      token,
      latest: null,
      listeners: new Set(),
    });
  }

  subscribe(key: string, listener: Listener): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { token: null, latest: null, listeners: new Set() };
      this.entries.set(key, entry);
    }
    entry.listeners.add(listener);
    if (entry.latest) {
      void Promise.resolve(listener(entry.latest)).catch(() => undefined);
    }

    return () => {
      entry!.listeners.delete(listener);
      if (entry!.token === null && entry!.listeners.size === 0) {
        this.entries.delete(key);
      }
    };
  }

  async publish(
    key: string,
    token: string,
    partial: SectionGenerationPartial,
  ): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.token !== token) return;
    entry.latest = structuredClone(partial);
    await Promise.all(
      [...entry.listeners].map((listener) => listener(entry.latest!)),
    );
  }

  end(key: string, token: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.token !== token) return;
    // Existing listeners retain their closure until they unsubscribe. No more
    // progress can arrive after release, so the keyed snapshot can be dropped.
    entry.token = null;
    entry.latest = null;
    if (entry.listeners.size === 0) this.entries.delete(key);
  }
}

export const sectionGenerationProgress = new SectionGenerationProgressBroker();
