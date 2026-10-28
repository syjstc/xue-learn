import type {DisplayComponentManifest, DisplayPluginLock, DisplayPluginManifest} from "./types.js";
import {assertDisplayPluginManifest} from "./validation.js";

export const displayComponentKey = (kind: string, version: number): string => `${kind}@${version}`;
export const displayPluginKey = (id: string, version: string): string => `${id}@${version}`;
export type DisplayCatalogMatch = Readonly<{manifest: DisplayPluginManifest; component: DisplayComponentManifest}>;
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {Object.freeze(value); Object.values(value).forEach(freeze);}
  return value;
};

/** One catalog per workspace. Registration is metadata-only and never loads code. */
export class DisplayCatalog {
  private readonly manifests = new Map<string, DisplayPluginManifest>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  readonly subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  readonly getSnapshot = () => this.revision;
  register(manifest: DisplayPluginManifest): () => void {
    assertDisplayPluginManifest(manifest);
    const key = displayPluginKey(manifest.id, manifest.version);
    if (this.manifests.has(key)) throw new Error(`Display package already registered: ${key}`);
    // The catalog owns a JSON snapshot; callers cannot silently mutate routing or trust.
    const snapshot = freeze(JSON.parse(JSON.stringify(manifest)) as DisplayPluginManifest);
    this.manifests.set(key, snapshot); this.changed();
    return () => {if (this.manifests.get(key) === snapshot) {this.manifests.delete(key); this.changed();}};
  }
  get(id: string, version: string): DisplayPluginManifest | undefined {return this.manifests.get(displayPluginKey(id, version));}
  list(): readonly DisplayPluginManifest[] {return [...this.manifests.values()];}
  find(kind: string, version: number, locks?: readonly DisplayPluginLock[]): readonly DisplayCatalogMatch[] {
    const candidates = locks ? locks.flatMap(lock => {const manifest = this.get(lock.id, lock.version); return manifest ? [manifest] : [];}) : this.list();
    return candidates.flatMap(manifest => manifest.components.filter(component => component.kind === kind && component.version === version).map(component => ({manifest, component})));
  }
  /** Model-facing discovery contains schemas/examples/builders, never executable modules. */
  describe(domains?: readonly string[]): readonly DisplayPluginManifest[] {return this.list().filter(manifest => !domains?.length || manifest.domains?.some(domain => domains.includes(domain)));}
  private changed() {this.revision += 1; for (const listener of [...this.listeners]) listener();}
}
export function createDisplayCatalog(manifests: readonly DisplayPluginManifest[] = []): DisplayCatalog {const catalog = new DisplayCatalog(); manifests.forEach(manifest => catalog.register(manifest)); return catalog;}
