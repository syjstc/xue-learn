import { join } from "node:path";
import type { DisplayBuildRun } from "../../../domain/src/persistence/display-build-port.js";
import { createDisplayBuildRuntime } from "../display-build/service.js";
import { readingDraftSchema, type ReadingDraft, type ReadingDocument, type ReadingComponentArtifact,
  type ReadingSnapshot, type ReadingCourse } from "../../../domain/src/reading-document.js";
import { runWithUserId } from "../user-context.js";
import { configureReadingContext, configureReadingDocument } from "./context.js";

export type ReadingSectionSource = {
  id: string; title: string; scope: string;
  reference?: string;
  artifacts?: Record<string, ReadingComponentArtifact>;
};
export type ReadingSource = {
  unitId: string; goalId: string; title: string; language: string;
  sections: ReadingSectionSource[];
};
export type ReadingGenerationInput = {
  unitId: string; goalId: string; language: string; section: ReadingSectionSource;
};
export type ReadingGenerators = {
  document(input: ReadingGenerationInput, signal: AbortSignal,
    onPartial: (draft: ReadingDraft, sourceIndices?: readonly number[]) => Promise<void>): Promise<ReadingDraft>;
  component(input: ReadingGenerationInput, slot: Extract<ReadingDraft["blocks"][number], {type: "component_slot"}>,
    signal: AbortSignal, jobId: string): Promise<ReadingComponentArtifact>;
};
const bodyKind = "reading:document";
const componentKind = "reading:component";
const scope = (unit: string, section: string) => JSON.stringify([unit, section]);
const active = (run: {status: string}) => run.status === "pending" || run.status === "running";

/** Independent persistent queues: reading body, reading figures and Display never
 * hold one another's section lock or wait for one another's model calls. */
export class ReadingWorkspaceService {
  readonly documents;
  readonly components;
  private listeners = new Map<string, Set<() => void>>();
  constructor(private options: {
    directory: string;
    readSource(owner: string, unit: string): Promise<ReadingSource | null>;
    generators: ReadingGenerators;
  }) {
    this.components = createDisplayBuildRuntime({
      directory: join(options.directory, "reading-components"), concurrency: 2,
      onUpdate: run => this.notify(run),
      builders: [{kind: componentKind, version: 1, build: ({run, signal}) =>
        runWithUserId(run.ownerUserId, async () => {
          const {source, slot} = run.input as unknown as {
            source: ReadingGenerationInput; slot: Extract<ReadingDraft["blocks"][number], {type: "component_slot"}>;
          };
          const reused = slot.sourceId && source.section.artifacts?.[slot.sourceId];
          if (reused && reused.type === slot.componentType) return reused;
          return options.generators.component(source, slot, signal, run.id);
        })}],
    });
    this.documents = createDisplayBuildRuntime({
      directory: join(options.directory, "reading-documents"), concurrency: 2,
      onUpdate: run => this.notify(run),
      builders: [{kind: bodyKind, version: 1, build: ({run, signal, saveCheckpoint}) =>
        runWithUserId(run.ownerUserId, async () => {
          const source = run.input.source as ReadingGenerationInput;
          const prepare = async (draft: ReadingDraft, sourceIndices?: readonly number[]): Promise<ReadingDocument> => ({
            version: 1, title: draft.title,
            blocks: await Promise.all(draft.blocks.map(async (block, index) => {
              const id = `b${(sourceIndices?.[index] ?? index) + 1}`;
              if (block.type !== "component_slot") return {...block, id};
              const job = await this.components.enqueue({
                ownerUserId: run.ownerUserId, scopeKey: `${run.id}/${id}`,
                kind: componentKind, componentVersion: 1, input: {source, slot: block},
              });
              return {...block, id, component: {jobId: job.id, status: job.status}};
            })),
          });
          // A completed authoring checkpoint survives process shutdown without a second model call.
          const checkpoint = run.checkpoint as {authored?: ReadingDraft} | undefined;
          const draft = checkpoint?.authored ?? await options.generators.document(source, signal, async (partial, sourceIndices) => {
            signal.throwIfAborted();
            await saveCheckpoint({document: await prepare(partial, sourceIndices)});
          });
          const validated = readingDraftSchema.parse(draft);
          const document = await prepare(validated);
          await saveCheckpoint({authored: validated, document});
          // Component enqueues are durable; component completion is deliberately not awaited.
          return document;
        })}],
    });
  }
  /** Live JIT observers are optional; disconnecting never cancels durable work. */
  subscribe(owner: string, unit: string, listener: () => void): () => void {
    const key = JSON.stringify([owner, unit]);
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
  private notify(run: DisplayBuildRun) {
    const source = run.input.source as ReadingGenerationInput | undefined;
    if (!source?.unitId) return;
    for (const listener of this.listeners.get(JSON.stringify([run.ownerUserId, source.unitId])) ?? []) {
      try { listener(); } catch { /* Observers do not own generation. */ }
    }
  }
  async start() {
    configureReadingContext((owner, unit, section) => this.context(owner, unit, section));
    configureReadingDocument((owner, unit, section, documentId) => this.document(owner, unit, section, documentId));
    await Promise.all([this.documents.start(), this.components.start()]);
  }
  async stop() {
    // Stop body first so it cannot enqueue after component workers have stopped.
    await this.documents.stop();
    await this.components.stop();
    this.listeners.clear();
    configureReadingContext(undefined);
    configureReadingDocument(undefined);
  }
  onApplicationBootstrap() { return this.start(); }
  onModuleDestroy() { return this.stop(); }
  async backgroundTaskCount() {
    const queues = await Promise.all([this.documents.repository.list(), this.components.repository.list()]);
    return queues.flat().filter(active).length;
  }
  private async runs(owner: string, unit: string, section: string) {
    return (await this.documents.repository.list())
      .filter(run => run.ownerUserId === owner && run.scopeKey === scope(unit, section))
      .sort((a, b) => b.inputRevision - a.inputRevision || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }
  private async source(owner: string, unit: string) {
    const source = await this.options.readSource(owner, unit);
    if (!source) return null;
    const sections = [...source.sections], ids = new Set(sections.map(section => section.id));
    // Display may add or replace its chapter outline while a whole-unit reading
    // is being written. Its saved reading scope must remain readable/retryable.
    for (const run of await this.documents.repository.list()) {
      const saved = run.input.source as ReadingGenerationInput | undefined;
      if (run.ownerUserId !== owner || saved?.unitId !== unit || !saved.section?.id || ids.has(saved.section.id)) continue;
      sections.push(saved.section); ids.add(saved.section.id);
    }
    return {...source, sections};
  }
  private async snapshot(run: DisplayBuildRun): Promise<ReadingSnapshot> {
    const checkpoint = run.checkpoint as {document?: ReadingDocument} | undefined;
    const document = (run.artifact as ReadingDocument | undefined) ?? checkpoint?.document ?? null;
    const blocks = document && await Promise.all(document.blocks.map(async block => {
      if (!block.component) return block;
      const component = await this.components.getOwned(block.component.jobId, run.ownerUserId);
      if (!component || component.scopeKey !== `${run.id}/${block.id}`)
        return {...block, component: {...block.component, status: "failed" as const, error: "组件任务不可用，请重试。"}};
      return {...block, component: {jobId: component.id, status: component.status, error: component.error,
        artifact: component.status === "ready" ? component.artifact as ReadingComponentArtifact : undefined}};
    }));
    return {
      jobId: run.id, revision: run.inputRevision, status: run.status, error: run.error,
      document: document && blocks ? {...document, blocks} : null,
      pendingComponents: blocks?.filter(block => block.component && active(block.component)).length ?? 0,
    };
  }
  async read(owner: string, unit: string): Promise<ReadingCourse | null> {
    const source = await this.source(owner, unit);
    if (!source) return null;
    return {
      unitId: unit, title: source.title, language: source.language,
      sections: await Promise.all(source.sections.map(async section => {
        const run = (await this.runs(owner, unit, section.id))[0];
        return {id: section.id, title: section.title, scope: section.scope,
          reading: run ? await this.snapshot(run) : null};
      })),
    };
  }
  async generate(owner: string, unit: string, sectionId: string, regenerate = false) {
    const source = await this.source(owner, unit);
    const section = source?.sections.find(item => item.id === sectionId);
    if (!source || !section) throw Error("阅读章节不存在。");
    const current = (await this.runs(owner, unit, sectionId))[0];
    if (current && !regenerate) return this.snapshot(current);
    const run = await this.documents.enqueue({
      ownerUserId: owner, scopeKey: scope(unit, sectionId), kind: bodyKind, componentVersion: 1,
      inputRevision: (current?.inputRevision ?? 0) + 1,
      input: {source: {unitId: unit, goalId: source.goalId, language: source.language, section}},
    });
    return this.snapshot(run);
  }
  async control(owner: string, unit: string, section: string,
    input: {jobId: string; action: "retry" | "cancel"; componentId?: string}) {
    const current = (await this.runs(owner, unit, section))[0];
    if (!current || current.id !== input.jobId) throw Error("阅读版本已变化，请刷新后重试。");
    const snapshot = await this.snapshot(current);
    const component = input.componentId && snapshot.document?.blocks.find(b => b.id === input.componentId)?.component;
    if (input.componentId && !component) throw Error("阅读组件不存在。");
    const runtime = component ? this.components : this.documents;
    await runtime[input.action](component ? component.jobId : current.id, owner);
    return this.snapshot((await this.documents.getOwned(current.id, owner))!);
  }
  /** Resolve the exact saved reading version, including a published JIT prefix. */
  async document(owner: string, unit: string, section: string, documentId: string) {
    const run = await this.documents.getOwned(documentId, owner);
    if (!run || run.scopeKey !== scope(unit, section)) return null;
    return (await this.snapshot(run)).document;
  }
  async context(owner: string, unit: string, section: string) {
    const runs = await this.runs(owner, unit, section);
    const run = runs.find(item => item.status === "ready");
    if (!run) return null;
    const snapshot = await this.snapshot(run);
    return JSON.stringify({readingRevision: run.inputRevision, title: snapshot.document?.title,
      blocks: snapshot.document?.blocks.map(({component, id: _id, ...block}) => ({
        ...block, ...(component?.artifact ? {content: component.artifact} : {}),
      }))});
  }
}
