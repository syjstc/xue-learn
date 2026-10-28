import {DisplayCatalog, displayComponentKey, displayPluginKey} from "./catalog.js";
import {expandDisplayComposition} from "./composition.js";
import {validateDisplayDocument, validateDisplayNodeSlots, validateDisplayPayload} from "./validation.js";
import type {DisplayDocument, DisplayNode, DisplayPluginLock, DisplayPluginManifest, DisplayPluginModule, DisplayResource, DisplayResourceState, DisplayRuntimeFailure, DisplayRuntimeResolution} from "./types.js";

export type DisplayRuntimeOptions<Renderer = unknown> = Readonly<{
  catalog: DisplayCatalog;
  resolveModule?: (manifest: DisplayPluginManifest) => Promise<DisplayPluginModule<Renderer>> | DisplayPluginModule<Renderer>;
  /** Must resolve only after bytes/fonts/media are usable by the renderer. */
  resolveResource?: ((resource: DisplayResource) => Promise<unknown> | unknown) & {dispose?: () => void};
  loadTimeoutMs?: number;
}>;
type ModuleState<Renderer> = {manifest: DisplayPluginManifest; status: "loading" | "ready" | "failed"; promise: Promise<void>; module?: DisplayPluginModule<Renderer>; error?: unknown};
export type DisplayPreflightResult = Readonly<{ready: boolean; issues: readonly DisplayRuntimeFailure[]; plugins: readonly DisplayPluginLock[]; resources: readonly string[]}>;
const resourceKey = (resource: DisplayResource) => JSON.stringify([resource.id, resource.kind, resource.uri, resource.integrity]);
async function withTimeout<T>(operation: Promise<T>, milliseconds: number, label: string, signal: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {return await Promise.race([operation, new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error(`Cancelled loading ${label}`));
    if (signal.aborted) {onAbort(); return;}
    signal.addEventListener("abort", onAbort, {once: true});
    timer = setTimeout(() => reject(new Error(`Timed out loading ${label}`)), milliseconds);
  })]);}
  finally {clearTimeout(timer); if (onAbort) signal.removeEventListener("abort", onAbort);}
}

/** One runtime is shared by interactive playback and frame-by-frame export. */
export class DisplayRuntime<Renderer = unknown> {
  readonly catalog: DisplayCatalog;
  private readonly modules = new Map<string, ModuleState<Renderer>>();
  private readonly resources = new Map<string, {state: DisplayResourceState; promise: Promise<void>}>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private revision = 0;
  private disposed = false;
  private readonly cancellation = new AbortController();
  constructor(private readonly options: DisplayRuntimeOptions<Renderer>) {
    this.catalog = options.catalog;
    this.unsubscribe = this.catalog.subscribe(() => this.changed());
  }
  readonly subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  readonly getSnapshot = () => this.revision;
  dispose(): void {this.disposed = true; this.cancellation.abort(); this.unsubscribe(); this.listeners.clear(); this.options.resolveResource?.dispose?.(); this.modules.clear(); this.resources.clear();}
  private changed() {this.revision += 1; for (const listener of [...this.listeners]) listener();}

  private dependencyIssues(manifest: DisplayPluginManifest, locks: readonly DisplayPluginLock[], ancestors: readonly string[] = []): DisplayRuntimeFailure[] {
    const key = displayPluginKey(manifest.id, manifest.version);
    if (ancestors.includes(key)) return [{reason: "dependency-cycle", pluginId: manifest.id, message: `Cyclic display package dependency: ${[...ancestors, key].join(" → ")}`}];
    const issues: DisplayRuntimeFailure[] = [];
    for (const dependency of manifest.dependencies ?? []) {
      const lock = locks.find(candidate => candidate.id === dependency.id);
      if (!lock || lock.version !== dependency.version || (dependency.integrity && lock.integrity !== dependency.integrity)) {issues.push({reason: "version-mismatch", pluginId: dependency.id, message: `The document must lock ${dependency.id}@${dependency.version}`}); continue;}
      const found = this.catalog.get(dependency.id, dependency.version);
      if (!found) issues.push({reason: "missing-plugin", pluginId: dependency.id, message: `Missing display dependency ${dependency.id}@${dependency.version}`});
      else if (lock.integrity && lock.integrity !== found.integrity) issues.push({reason: "version-mismatch", pluginId: dependency.id, message: `Integrity mismatch for dependency ${dependency.id}@${dependency.version}`});
      else issues.push(...this.dependencyIssues(found, locks, [...ancestors, key]));
    }
    return issues;
  }

  private compositionIssue(template: DisplayNode, locks: readonly DisplayPluginLock[], ancestors: readonly string[], depth = 0, budget = {remaining: 10_000}): DisplayRuntimeFailure | undefined {
    if (depth > 64) return {reason: "composition-cycle", message: "Display composition exceeds the nesting limit"};
    if (--budget.remaining < 0) return {reason: "invalid-node", message: "Expanded display composition exceeds the node limit"};
    if (template.kind === "display:slot") return undefined;
    const key = displayComponentKey(template.kind, template.version);
    const match = this.catalog.find(template.kind, template.version, locks);
    if (match.length === 1 && match[0]!.component.composition) {
      if (ancestors.includes(key)) return {reason: "composition-cycle", message: `Cyclic declarative component: ${[...ancestors, key].join(" → ")}`};
      const nested = this.compositionIssue(match[0]!.component.composition!, locks, [...ancestors, key], depth + 1, budget);
      if (nested) return nested;
    }
    for (const child of [...(template.children ?? []), ...Object.values(template.slots ?? {}).flat()]) {
      const nested = this.compositionIssue(child, locks, ancestors, depth + 1, budget);
      if (nested) return nested;
    }
    return undefined;
  }

  resolve(node: DisplayNode, document: DisplayDocument, inheritedResources: readonly DisplayResource[] = []): DisplayRuntimeResolution<Renderer> {
    const unavailable = (reason: DisplayRuntimeFailure["reason"], message: string, details: Partial<DisplayRuntimeFailure> = {}): DisplayRuntimeResolution<Renderer> => ({status: "unavailable", failure: {reason, message, nodeId: node.id, kind: node.kind, ...details}});
    if (this.disposed) return unavailable("load-error", "Display runtime has been disposed");
    if (node.build && node.build.status !== "ready") return unavailable(["pending", "running"].includes(node.build.status) ? "building" : "build-failed", node.build.error ?? (["pending", "running"].includes(node.build.status) ? "This display is being prepared" : "Display preparation did not complete"));
    const matches = this.catalog.find(node.kind, node.version, document.plugins);
    if (!matches.length) {
      const known = this.catalog.find(node.kind, node.version);
      const lockedMissing = document.plugins.find(lock => !this.catalog.get(lock.id, lock.version));
      return unavailable(known.length ? "version-mismatch" : "missing-plugin", known.length ? `No locked package provides ${node.kind}@${node.version}` : `No installed package provides ${node.kind}@${node.version}`, lockedMissing ? {pluginId: lockedMissing.id} : {});
    }
    if (matches.length !== 1) return unavailable("version-mismatch", `Multiple locked packages provide ${node.kind}@${node.version}`);
    const {manifest, component} = matches[0]!;
    const lock = document.plugins.find(candidate => candidate.id === manifest.id)!;
    if (lock.integrity && lock.integrity !== manifest.integrity) return unavailable("version-mismatch", `Integrity mismatch for ${manifest.id}@${manifest.version}`, {pluginId: manifest.id});
    const dependencyIssue = this.dependencyIssues(manifest, document.plugins)[0];
    if (dependencyIssue) return {status: "unavailable", failure: {...dependencyIssue, nodeId: node.id, kind: node.kind}};
    const payloadIssues = validateDisplayPayload(node.payload, component.payloadSchema);
    if (payloadIssues.length) return unavailable("invalid-payload", payloadIssues.join("; "), {pluginId: manifest.id});
    const slotIssue = validateDisplayNodeSlots(node, component)[0];
    if (slotIssue) return {status: "unavailable", failure: slotIssue};
    const scope = this.resourceScope(manifest, document, inheritedResources);
    const required = new Set([...(component.resources ?? []), ...scope.filter(resource => resource.required !== false).map(resource => resource.id)]);
    for (const id of required) {
      const resource = scope.find(candidate => candidate.id === id);
      if (!resource) return unavailable("resource-error", `Resource ${id} is not declared`, {pluginId: manifest.id, resourceId: id});
      const state = this.resourceState(resource);
      if (state.status !== "ready") return unavailable(state.status === "failed" ? "resource-error" : "loading", `Resource ${id} is ${state.status}`, {pluginId: manifest.id, resourceId: id, error: state.error});
    }
    if (component.composition) {
      const cycle = this.compositionIssue(component.composition, document.plugins, [displayComponentKey(node.kind, node.version)]);
      if (cycle) return {status: "unavailable", failure: {...cycle, nodeId: node.id, kind: node.kind, pluginId: manifest.id}};
      try {return {status: "ready", manifest, component, composition: expandDisplayComposition(node, component.composition)};}
      catch (error) {return unavailable("invalid-payload", error instanceof Error ? error.message : String(error), {pluginId: manifest.id, error});}
    }
    if (manifest.execution !== "trusted") return unavailable("invalid-node", "Declarative packages cannot execute JavaScript", {pluginId: manifest.id});
    const loaded = this.modules.get(displayPluginKey(manifest.id, manifest.version));
    if (!loaded || loaded.manifest !== manifest || loaded.status === "loading") return unavailable("loading", `Loading ${manifest.title ?? manifest.id}`, {pluginId: manifest.id});
    if (loaded.status === "failed") return unavailable("load-error", `Cannot load ${manifest.title ?? manifest.id}`, {pluginId: manifest.id, error: loaded.error});
    const key = displayComponentKey(node.kind, node.version);
    const Renderer = loaded.module?.components[key] ?? loaded.module?.components[node.kind];
    if (!Renderer) return unavailable("load-error", `Package ${manifest.id} has no renderer for ${key}`, {pluginId: manifest.id});
    try {if (loaded.module?.validators?.[key] && !loaded.module.validators[key]!(node.payload)) return unavailable("invalid-payload", `Invalid payload for ${key}`, {pluginId: manifest.id});}
    catch (error) {return unavailable("invalid-payload", `Payload validation failed for ${key}`, {pluginId: manifest.id, error});}
    return {status: "ready", manifest, component, Renderer};
  }

  private async load(manifest: DisplayPluginManifest): Promise<void> {
    if (manifest.execution !== "trusted" || manifest.components.every(component => component.composition)) return;
    const key = displayPluginKey(manifest.id, manifest.version), previous = this.modules.get(key);
    if (previous?.manifest === manifest) return previous.promise;
    const entry: ModuleState<Renderer> = {manifest, status: "loading", promise: Promise.resolve()};
    this.modules.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      if (this.disposed) throw new Error('Display runtime has been disposed');
      if (!this.options.resolveModule) throw new Error(`No trusted module resolver for ${key}`);
      const module = await withTimeout(Promise.resolve(this.options.resolveModule(manifest)), this.options.loadTimeoutMs ?? 30_000, key, this.cancellation.signal);
      if (!module || typeof module !== "object" || !module.components || typeof module.components !== "object") throw new Error(`Invalid display module ${key}`);
      entry.module = module; entry.status = "ready";
    }).catch(error => {entry.status = "failed"; entry.error = error;}).finally(() => this.changed());
    this.changed();
    return entry.promise;
  }

  resourceState(resource: DisplayResource): DisplayResourceState {return this.resources.get(resourceKey(resource))?.state ?? {status: "loading"};}
  private async loadResource(resource: DisplayResource): Promise<void> {
    const key = resourceKey(resource), previous = this.resources.get(key);
    if (previous) return previous.promise;
    const entry: {state: DisplayResourceState; promise: Promise<void>} = {state: {status: "loading"}, promise: Promise.resolve()};
    this.resources.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      if (this.disposed) throw new Error('Display runtime has been disposed');
      if (!this.options.resolveResource) throw new Error(`No resource loader for ${resource.id}`);
      entry.state = {status: "ready", value: await withTimeout(Promise.resolve(this.options.resolveResource(resource)), this.options.loadTimeoutMs ?? 30_000, resource.id, this.cancellation.signal)};
    }).catch(error => {entry.state = {status: "failed", error};}).finally(() => this.changed());
    this.changed();
    return entry.promise;
  }

  /** Lexical resources: document defaults, inherited packages, then the nearest package. Siblings stay isolated. */
  resourceScope(manifest: DisplayPluginManifest, document: DisplayDocument, inheritedResources: readonly DisplayResource[] = []): readonly DisplayResource[] {
    const resources = new Map((document.resources ?? []).map(resource => [resource.id, resource]));
    for (const resource of inheritedResources) resources.set(resource.id, resource);
    for (const resource of manifest.resources ?? []) resources.set(resource.id, resource);
    return [...resources.values()];
  }
  resourcesFor(manifest: DisplayPluginManifest, document: DisplayDocument, inheritedResources: readonly DisplayResource[] = []): Readonly<Record<string, DisplayResourceState>> {return Object.fromEntries(this.resourceScope(manifest, document, inheritedResources).map(resource => [resource.id, this.resourceState(resource)]));}

  /** Resolves only components reachable from this document, including declarative expansions. */
  async prepare(document: DisplayDocument): Promise<DisplayPreflightResult> {
    if (this.disposed) return {ready: false, issues: [{reason: "load-error", message: "Display runtime has been disposed"}], plugins: document?.plugins ?? [], resources: []};
    const issues = [...validateDisplayDocument(document)];
    if (issues.some(issue => !issue.nodeId)) return {ready: false, issues, plugins: document?.plugins ?? [], resources: []};
    const invalidNodes = new Set(issues.filter(issue => issue.nodeId).map(issue => issue.nodeId));
    const ids = new Set<string>(), targets = new Map<string, string>(), resources = new Set<string>(), checkedResources = new Map<string, {resource: DisplayResource; pluginId: string}>();
    const addTarget = (target: string, nodeId: string) => {
      const owner = targets.get(target);
      if (owner !== undefined && owner !== nodeId) issues.push({reason: "invalid-node", message: `Ambiguous display target ${target}`, nodeId});
      else targets.set(target, nodeId);
    };
    const visit = async (node: DisplayNode, ancestry: readonly string[], depth: number, inheritedResources: readonly DisplayResource[] = []): Promise<void> => {
      if (this.disposed) {issues.push({reason: 'load-error', message: 'Display runtime has been disposed', nodeId: node?.id}); return;}
      if (!node || typeof node !== "object" || depth > 64) {issues.push({reason: "composition-cycle", message: "Display composition exceeds nesting limits", nodeId: node?.id}); return;}
      if (invalidNodes.has(node.id)) return;
      if (ids.size >= 10_000) {if (!issues.some(issue => issue.message === "Expanded display exceeds the node limit")) issues.push({reason: "invalid-node", message: "Expanded display exceeds the node limit", nodeId: node.id}); return;}
      if (ids.has(node.id)) {issues.push({reason: "invalid-node", message: `Duplicate expanded node id: ${node.id}`, nodeId: node.id}); return;}
      ids.add(node.id); addTarget(node.id, node.id);
      if (node.build && node.build.status !== "ready") {
        const resolution = this.resolve(node, document, inheritedResources);
        if (resolution.status === "unavailable") issues.push(resolution.failure);
        return;
      }
      let childResources = inheritedResources;
      const match = this.catalog.find(node.kind, node.version, document.plugins);
      if (match.length === 1) {
        const {manifest, component} = match[0]!;
        childResources = this.resourceScope(manifest, document, inheritedResources);
        const lock = document.plugins.find(candidate => candidate.id === manifest.id)!;
        if ((!lock.integrity || lock.integrity === manifest.integrity) && !this.dependencyIssues(manifest, document.plugins).length && !validateDisplayPayload(node.payload, component.payloadSchema).length && !validateDisplayNodeSlots(node, component).length) {
          await Promise.all([this.load(manifest), ...childResources.filter(resource => resource.required !== false || component.resources?.includes(resource.id)).map(async resource => {resources.add(resource.id); checkedResources.set(resourceKey(resource), {resource, pluginId: manifest.id}); await this.loadResource(resource);})]);
        }
        for (const target of [...(component.targets ?? []), ...(node.targets ?? [])]) addTarget(`${node.id}/${target}`, node.id);
      }
      const resolution = this.resolve(node, document, inheritedResources);
      if (resolution.status !== "ready") issues.push(resolution.failure);
      else if (resolution.composition) {
        const key = displayComponentKey(node.kind, node.version);
        if (ancestry.includes(key)) issues.push({reason: "composition-cycle", message: `Cyclic declarative component: ${[...ancestry, key].join(" → ")}`, nodeId: node.id});
        else await visit(resolution.composition, [...ancestry, key], depth + 1, childResources);
        return;
      }
      await Promise.all([...(node.children ?? []), ...Object.values(node.slots ?? {}).flat()].map(child => visit(child, [], depth + 1, childResources)));
    };
    await visit(document.root, [], 0);
    for (const lock of document.plugins) {
      const manifest = this.catalog.get(lock.id, lock.version);
      if (!manifest) issues.push({reason: "missing-plugin", message: `Missing locked package ${lock.id}@${lock.version}`, pluginId: lock.id});
      else if (lock.integrity && lock.integrity !== manifest.integrity) issues.push({reason: "version-mismatch", message: `Integrity mismatch for ${lock.id}@${lock.version}`, pluginId: lock.id});
    }
    for (const cue of document.timeline ?? []) for (const target of cue.targets) if (!targets.has(target)) issues.push({reason: "invalid-document", message: `Timeline cue ${cue.id} references missing target ${target}`});
    // Check the exact descriptors visited in each lexical scope, including same-name sibling assets.
    for (const {resource, pluginId} of checkedResources.values()) {
      const state = this.resourceState(resource);
      if (state.status !== "ready") issues.push({reason: "resource-error", message: `Resource ${resource.id} is unavailable`, resourceId: resource.id, pluginId, error: state.error});
    }
    return {ready: issues.length === 0, issues, plugins: document.plugins, resources: [...resources]};
  }
  async preflight(document: DisplayDocument): Promise<DisplayPreflightResult> {return this.prepare(document);}
  retry(pluginId?: string): void {
    for (const [key, state] of this.modules) if (state.status === "failed" && (!pluginId || state.manifest.id === pluginId)) this.modules.delete(key);
    for (const [key, value] of this.resources) if (value.state.status === "failed") this.resources.delete(key);
    this.changed();
  }
}

export const createDisplayRuntime = <Renderer = unknown>(options: DisplayRuntimeOptions<Renderer>): DisplayRuntime<Renderer> => new DisplayRuntime(options);
export const preflightDisplayDocument = (runtime: DisplayRuntime, document: DisplayDocument): Promise<DisplayPreflightResult> => runtime.preflight(document);
