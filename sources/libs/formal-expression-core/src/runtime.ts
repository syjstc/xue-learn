import {
  affectedSubjects,
  applyPatches,
  clone,
  createDocument,
  validateDocument,
} from "./document.js";
import { prepareCommand } from "./commands.js";
import type {
  FormalDocument,
  HistoryEntry,
  HistoryView,
  JsonObject,
  OperationHook,
  OperationId,
  Patch,
  RuntimeError,
  RuntimeListener,
  SerializedCommand,
} from "./types.js";

const failure = (
  code: RuntimeError["code"],
  message: string,
): RuntimeError => ({ code, message });
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export interface ExecuteOptions {
  baseRevision?: number;
  metadata?: JsonObject;
}
export type ExecuteResult =
  | { ok: true; document: FormalDocument; entry: HistoryEntry }
  | { ok: false; error: RuntimeError };
export type JumpResult =
  | {
      ok: true;
      document: FormalDocument;
      steps: HistoryEntry[];
      currentId?: string;
    }
  | { ok: false };
export interface RuntimeExport {
  version: 1;
  base: FormalDocument;
  entries: HistoryEntry[];
  currentId?: string;
}

export class FormalExpressionRuntime {
  private document: FormalDocument;
  private base: FormalDocument;
  private entries: HistoryEntry[] = [];
  private currentId?: string;
  private hooks: OperationHook[] = [];
  private listeners = new Set<RuntimeListener>();
  constructor(document: FormalDocument = createDocument()) {
    const errors = validateDocument(document);
    if (errors.length) throw new Error(errors.join("; "));
    this.document = clone(document);
    this.base = clone(document);
  }
  getSnapshot() {
    return clone(this.document);
  }
  getHistory(): HistoryView {
    const branches: Record<string, string[]> = {};
    for (const entry of this.entries)
      (branches[entry.parentId ?? "root"] ??= []).push(entry.id);
    return {
      entries: clone(this.entries),
      currentId: this.currentId,
      branches,
    };
  }
  addHook(hook: OperationHook) {
    this.hooks.push(hook);
    return () => {
      this.hooks = this.hooks.filter((item) => item !== hook);
    };
  }
  subscribe(listener: RuntimeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: Parameters<RuntimeListener>[0]) {
    this.listeners.forEach((listener) => listener(event));
  }
  private async reject(error: RuntimeError): Promise<ExecuteResult> {
    for (const hook of this.hooks)
      try {
        await hook.onReject?.(error);
      } catch {}
    this.emit({ type: "reject", document: this.getSnapshot(), error });
    return { ok: false, error };
  }
  async execute(
    input: SerializedCommand,
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    if (
      (options.baseRevision ?? this.document.revision) !==
      this.document.revision
    )
      return this.reject(
        failure(
          "REVISION_CONFLICT",
          `expected revision ${options.baseRevision}, current is ${this.document.revision}`,
        ),
      );
    let command = clone(input);
    try {
      for (const hook of this.hooks) {
        const result = await hook.beforePrepare?.({
          document: this.getSnapshot(),
          command,
        });
        if (result && "reject" in result)
          return this.reject(failure("HOOK_REJECTED", result.reject));
        if (result?.command) command = result.command;
      }
    } catch (error) {
      return this.reject(
        failure(
          "HOOK_ERROR",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    let patches: Patch[];
    try {
      patches = prepareCommand(this.document, command);
    } catch (error) {
      return this.reject(
        failure(
          "COMMAND",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    try {
      for (const hook of this.hooks) {
        const result = await hook.beforeCommit?.({
          document: this.getSnapshot(),
          command,
          patches: clone(patches),
        });
        if (result && "reject" in result)
          return this.reject(failure("HOOK_REJECTED", result.reject));
        if (result?.patches) patches.push(...result.patches);
      }
    } catch (error) {
      return this.reject(
        failure(
          "HOOK_ERROR",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    const applied = applyPatches(this.document, patches);
    const errors = validateDocument(applied.document);
    if (errors.length)
      return this.reject({
        ...failure("VALIDATION", errors.join("; ")),
        details: errors,
      });
    const entry: HistoryEntry = {
      id: uid(),
      parentId: this.currentId,
      beforeRevision: this.document.revision,
      afterRevision: this.document.revision + 1,
      command,
      patches: clone(patches),
      inversePatches: applied.inverse,
      affectedSubjects: affectedSubjects(patches),
      metadata: options.metadata,
    };
    applied.document.revision = entry.afterRevision;
    this.document = applied.document;
    this.entries.push(entry);
    this.currentId = entry.id;
    this.emit({
      type: "commit",
      document: this.getSnapshot(),
      entry: clone(entry),
    });
    for (const hook of this.hooks)
      Promise.resolve(
        hook.afterCommit?.({
          document: this.getSnapshot(),
          command,
          patches,
          entry,
        }),
      ).catch(() => undefined);
    return { ok: true, document: this.getSnapshot(), entry: clone(entry) };
  }
  async undo(): Promise<boolean> {
    const entry = this.entries.find((e) => e.id === this.currentId);
    if (!entry) return false;
    const applied = applyPatches(this.document, entry.inversePatches);
    applied.document.revision = entry.beforeRevision;
    this.document = applied.document;
    this.currentId = entry.parentId;
    this.emit({ type: "undo", document: this.getSnapshot(), entry });
    for (const h of this.hooks) await h.onUndo?.(clone(entry));
    return true;
  }
  async redo(entryId?: string): Promise<boolean> {
    const choices = this.entries.filter((e) => e.parentId === this.currentId);
    const entry = entryId
      ? choices.find((e) => e.id === entryId)
      : choices.at(-1);
    if (!entry) return false;
    const applied = applyPatches(this.document, entry.patches);
    const errors = validateDocument(applied.document);
    if (errors.length) return false;
    applied.document.revision = entry.afterRevision;
    this.document = applied.document;
    this.currentId = entry.id;
    this.emit({ type: "redo", document: this.getSnapshot(), entry });
    for (const h of this.hooks) await h.onRedo?.(clone(entry));
    return true;
  }
  async jumpTo(targetId?: OperationId): Promise<JumpResult> {
    if (targetId === this.currentId)
      return {
        ok: true,
        document: this.getSnapshot(),
        steps: [],
        currentId: this.currentId,
      };
    if (targetId && !this.entries.some((entry) => entry.id === targetId))
      return { ok: false };
    const fromChain = ancestorChain(this.currentId, this.entries);
    const toChain = targetId ? ancestorChain(targetId, this.entries) : [];
    const fromSet = new Set(fromChain);
    const lca = toChain.find((id) => fromSet.has(id));
    const undoIds: string[] = [];
    for (const id of fromChain) {
      if (id === lca) break;
      undoIds.push(id);
    }
    const redoIds: string[] = [];
    for (const id of toChain) {
      if (id === lca) break;
      redoIds.push(id);
    }
    redoIds.reverse();
    let document = this.document;
    let currentId = this.currentId;
    const steps: HistoryEntry[] = [];
    for (const id of undoIds) {
      const entry = this.entries.find((item) => item.id === id);
      if (!entry) return { ok: false };
      const applied = applyPatches(document, entry.inversePatches);
      applied.document.revision = entry.beforeRevision;
      document = applied.document;
      currentId = entry.parentId;
      steps.push(entry);
    }
    for (const id of redoIds) {
      const entry = this.entries.find((item) => item.id === id);
      if (!entry) return { ok: false };
      const applied = applyPatches(document, entry.patches);
      const errors = validateDocument(applied.document);
      if (errors.length) return { ok: false };
      applied.document.revision = entry.afterRevision;
      document = applied.document;
      currentId = entry.id;
      steps.push(entry);
    }
    this.document = document;
    this.currentId = currentId;
    for (const entry of steps) {
      if (undoIds.includes(entry.id) && !redoIds.includes(entry.id))
        for (const hook of this.hooks) await hook.onUndo?.(clone(entry));
      else for (const hook of this.hooks) await hook.onRedo?.(clone(entry));
    }
    this.emit({
      type: "jump",
      document: this.getSnapshot(),
      entry: steps.at(-1),
      steps: clone(steps),
    });
    for (const hook of this.hooks) await hook.onJump?.(clone(steps));
    return {
      ok: true,
      document: this.getSnapshot(),
      steps: clone(steps),
      currentId: this.currentId,
    };
  }
  export(): RuntimeExport {
    return {
      version: 1,
      base: clone(this.base),
      entries: clone(this.entries),
      currentId: this.currentId,
    };
  }
  static import(data: RuntimeExport): FormalExpressionRuntime {
    if (data.version !== 1) throw new Error("unsupported runtime export");
    const runtime = new FormalExpressionRuntime(data.base);
    const byParent = new Map<string | undefined, HistoryEntry[]>();
    data.entries.forEach((e) =>
      byParent.set(e.parentId, [...(byParent.get(e.parentId) ?? []), e]),
    );
    let cursor: string | undefined;
    while (cursor !== data.currentId) {
      const next = (byParent.get(cursor) ?? []).find(
        (e) =>
          data.currentId === e.id ||
          isAncestor(e.id, data.currentId, data.entries),
      );
      if (!next) throw new Error("history currentId is unreachable");
      const applied = applyPatches(runtime.document, next.patches);
      const errors = validateDocument(applied.document);
      if (errors.length) throw new Error(errors.join("; "));
      applied.document.revision = next.afterRevision;
      runtime.document = applied.document;
      cursor = next.id;
    }
    runtime.entries = clone(data.entries);
    runtime.currentId = data.currentId;
    return runtime;
  }
  static replay(base: FormalDocument, entries: HistoryEntry[]): FormalDocument {
    let doc = clone(base);
    for (const entry of entries) {
      if (doc.revision !== entry.beforeRevision)
        throw new Error(`replay revision conflict at ${entry.id}`);
      const applied = applyPatches(doc, entry.patches);
      const errors = validateDocument(applied.document);
      if (errors.length) throw new Error(errors.join("; "));
      applied.document.revision = entry.afterRevision;
      doc = applied.document;
    }
    return doc;
  }
}
function ancestorChain(id: string | undefined, entries: HistoryEntry[]) {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = entries.find((entry) => entry.id === cursor)?.parentId;
  }
  return chain;
}
export function historyCursorAfterSteps(
  entries: HistoryEntry[],
  currentId: string | undefined,
  stepsBack: number,
) {
  let cursor = currentId;
  let remaining = Math.max(0, stepsBack);
  while (remaining > 0 && cursor) {
    const entry = entries.find((item) => item.id === cursor);
    if (!entry) break;
    cursor = entry.parentId;
    remaining -= 1;
  }
  return cursor;
}
function isAncestor(
  candidate: string,
  target: string | undefined,
  entries: HistoryEntry[],
) {
  let id = target;
  while (id) {
    if (id === candidate) return true;
    id = entries.find((e) => e.id === id)?.parentId;
  }
  return false;
}
