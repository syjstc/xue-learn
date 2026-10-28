export type DisplayState = Readonly<Record<string, unknown>>;
const emptyState: DisplayState = Object.freeze({});

/** Host-owned interactive state is separate from the immutable authored document. */
export class DisplayStateStore {
  private readonly states = new Map<string, DisplayState>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  readonly subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  readonly getSnapshot = () => this.revision;
  get(nodeId: string): DisplayState {return this.states.get(nodeId) ?? emptyState;}
  set(nodeId: string, patch: DisplayState | ((previous: DisplayState) => DisplayState)): void {
    const current = this.get(nodeId);
    const next = typeof patch === "function" ? patch(current) : {...current, ...patch};
    this.states.set(nodeId, Object.freeze({...next}));
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }
  clear(nodeId?: string): void {
    if (nodeId === undefined) this.states.clear(); else this.states.delete(nodeId);
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }
  snapshot(): Readonly<Record<string, DisplayState>> {return Object.freeze(Object.fromEntries(this.states));}
}
export const createDisplayStateStore = (): DisplayStateStore => new DisplayStateStore();
