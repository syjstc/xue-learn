import { createHash, randomUUID } from "node:crypto";
import type { DisplayBuildRepository, DisplayBuildRun } from "../../../domain/src/persistence/display-build-port.js";
import { FileDisplayBuildRepository } from "./file-repository.js";

export type DisplayBuilder = Readonly<{
  kind: string;
  version: number;
  build(context: {
    run: DisplayBuildRun;
    signal: AbortSignal;
    saveCheckpoint(checkpoint: unknown): Promise<void>;
  }): Promise<unknown>;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function displayBuildSourceHash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

export type DisplayBuildRuntimeOptions = {
  directory?: string;
  repository?: DisplayBuildRepository;
  builders: readonly DisplayBuilder[];
  concurrency?: number;
  pollMs?: number;
  leaseMs?: number;
  onUpdate?: (run: DisplayBuildRun) => void | Promise<void>;
};

/** Durable background scheduler. Enqueue persists before returning; rendering never runs builders. */
export class DisplayBuildRuntime {
  readonly repository: DisplayBuildRepository;
  private builders = new Map<string, DisplayBuilder>();
  private active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private timer?: ReturnType<typeof setInterval>;
  private tickPromise?: Promise<void>;
  private stopped = true;
  private readonly leaseMs: number;
  constructor(private options: DisplayBuildRuntimeOptions) {
    if (!options.repository && !options.directory) throw Error("Display builds need persistent storage");
    this.repository = options.repository ?? new FileDisplayBuildRepository(options.directory!);
    this.leaseMs = Math.max(1000, options.leaseMs ?? 60_000);
    for (const builder of options.builders) {
      const key = `${builder.kind}@${builder.version}`;
      if (this.builders.has(key)) throw Error(`Duplicate display builder ${key}`);
      this.builders.set(key, builder);
    }
  }
  hasBuilder(kind: string, version: number) { return this.builders.has(`${kind}@${version}`); }
  async enqueue(input: {ownerUserId: string; scopeKey: string; kind: string; componentVersion: number;
    inputRevision?: number; input: Readonly<Record<string, unknown>>}): Promise<DisplayBuildRun> {
    if (!this.hasBuilder(input.kind, input.componentVersion)) throw Error(`Display builder unavailable: ${input.kind}@${input.componentVersion}`);
    const sourceHash = displayBuildSourceHash({kind: input.kind, version: input.componentVersion, input: input.input});
    const inputRevision = input.inputRevision ?? 1;
    const id = displayBuildSourceHash({owner: input.ownerUserId, scope: input.scopeKey, sourceHash, inputRevision});
    const now = Date.now();
    const run = await this.repository.create({ id, ...input, inputRevision, sourceHash, status: "pending", revision: 0,
      attempt: 0, createdAt: now, updatedAt: now });
    this.kick();
    return run;
  }
  async getOwned(id: string, ownerUserId: string): Promise<DisplayBuildRun | null> {
    const run = await this.repository.get(id);
    return run?.ownerUserId === ownerUserId ? run : null;
  }
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => this.kick(), Math.max(100, this.options.pollMs ?? 1000));
    this.timer.unref?.();
    await this.tick();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    // A claim may be awaiting durable CAS when shutdown begins. Drain it
    // before taking the active-job snapshot, so it cannot start after stop.
    await this.tickPromise?.catch(() => { /* A failed scan cannot prevent active jobs from being stopped. */ });
    for (const {controller} of this.active.values()) controller.abort(Error("Display build worker stopped"));
    await Promise.allSettled([...this.active.values()].map(item => item.promise));
  }
  private kick() { if (!this.stopped) void this.tick().catch(() => { /* Persisted jobs remain available for the next poll. */ }); }
  private async notify(run: DisplayBuildRun) {
    try { await this.options.onUpdate?.(run); } catch { /* Observers cannot invalidate committed work. */ }
  }
  async retry(id: string, ownerUserId: string, options: {onlyIfFailed?: boolean} = {}): Promise<DisplayBuildRun> {
    for (;;) {
      const run = await this.getOwned(id, ownerUserId);
      if (!run) throw Error("Display build not found");
      if (options.onlyIfFailed && run.status !== "failed") return run;
      if (run.status === "ready" || run.status === "running" || run.status === "pending") return run;
      const next = {...run, status: "pending" as const, error: undefined, leaseToken: undefined, leaseUntil: undefined,
        revision: run.revision + 1, updatedAt: Date.now()};
      if (await this.repository.replace(next, run.revision)) { await this.notify(next); this.kick(); return next; }
    }
  }
  async cancel(id: string, ownerUserId: string): Promise<DisplayBuildRun> {
    for (;;) {
      const run = await this.getOwned(id, ownerUserId);
      if (!run) throw Error("Display build not found");
      if (run.status === "ready" || run.status === "cancelled") return run;
      const next = {...run, status: "cancelled" as const, leaseToken: undefined, leaseUntil: undefined,
        revision: run.revision + 1, updatedAt: Date.now()};
      if (await this.repository.replace(next, run.revision)) {
        this.active.get(id)?.controller.abort(Error("Display build cancelled"));
        await this.notify(next); return next;
      }
    }
  }
  tick(): Promise<void> {
    if (this.stopped || this.tickPromise) return this.tickPromise ?? Promise.resolve();
    this.tickPromise = this.runTick().finally(() => {this.tickPromise = undefined;});
    return this.tickPromise;
  }
  private async runTick(): Promise<void> {
      const runs = [...await this.repository.list()].sort((a, b) => a.createdAt - b.createdAt);
      for (const run of runs) {
        if (this.stopped || this.active.size >= (this.options.concurrency ?? 2)) break;
        if (this.active.has(run.id) || !this.hasBuilder(run.kind, run.componentVersion)
          || !(run.status === "pending" || run.status === "running" && (run.leaseUntil ?? 0) < Date.now())) continue;
        const claimed = {...run, status: "running" as const, leaseToken: randomUUID(), leaseUntil: Date.now() + this.leaseMs,
          attempt: run.attempt + 1, revision: run.revision + 1, updatedAt: Date.now(), error: undefined};
        if (!await this.repository.replace(claimed, run.revision)) continue;
        if (this.stopped) {
          await this.repository.replace({...claimed, status: "pending", leaseToken: undefined, leaseUntil: undefined,
            revision: claimed.revision + 1, updatedAt: Date.now()}, claimed.revision);
          break;
        }
        const controller = new AbortController();
        const promise = this.execute(claimed, controller).finally(() => { this.active.delete(run.id); this.kick(); });
        this.active.set(run.id, {controller, promise});
      }
  }
  private async execute(claimed: DisplayBuildRun, controller: AbortController): Promise<void> {
    const update = async (patch: Partial<DisplayBuildRun>) => {
      for (;;) {
        const current = await this.repository.get(claimed.id);
        if (!current || current.status !== "running" || current.leaseToken !== claimed.leaseToken) throw Error("Display build lease lost");
        const next = {...current, ...patch, revision: current.revision + 1, updatedAt: Date.now()};
        if (await this.repository.replace(next, current.revision)) { await this.notify(next); return; }
      }
    };
    const heartbeat = setInterval(() => {
      void update({leaseUntil: Date.now() + this.leaseMs}).catch(error => controller.abort(error));
    }, Math.floor(this.leaseMs / 3));
    heartbeat.unref?.();
    try {
      await this.notify(claimed);
      const artifact = await this.builders.get(`${claimed.kind}@${claimed.componentVersion}`)!.build({run: claimed,
        signal: controller.signal, saveCheckpoint: checkpoint => update({checkpoint, leaseUntil: Date.now() + this.leaseMs})});
      controller.signal.throwIfAborted();
      if (artifact === undefined) throw Error("Display builder produced no artifact");
      await update({status: "ready", artifact, leaseToken: undefined, leaseUntil: undefined});
    } catch (error) {
      try { await update({status: this.stopped ? "pending" : "failed", error: this.stopped ? undefined : error instanceof Error ? error.message : String(error),
        leaseToken: undefined, leaseUntil: undefined}); } catch { /* A newer owner or cancellation wins. */ }
    } finally { clearInterval(heartbeat); }
  }
}

export function createDisplayBuildRuntime(options: DisplayBuildRuntimeOptions) { return new DisplayBuildRuntime(options); }
let configured: DisplayBuildRuntime | undefined;
export function configureDisplayBuildRuntime(runtime: DisplayBuildRuntime | undefined) { configured = runtime; }
export function getDisplayBuildRuntime() { return configured; }
export function requireDisplayBuildRuntime() {
  if (!configured) throw Error("Display build runtime is not configured");
  return configured;
}
