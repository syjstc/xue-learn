import {fromJSONSchema} from "zod";
import type {DisplayComponentManifest, DisplayDocument, DisplayJsonSchema, DisplayNode, DisplayPluginManifest, DisplayRuntimeFailure} from "./types.js";

export const isDisplayName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
export const isDisplayPackageVersion = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const positiveVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const schemas = new Map<DisplayJsonSchema, ReturnType<typeof fromJSONSchema>>();

export function validateDisplayPayload(payload: unknown, schema?: DisplayJsonSchema): string[] {
  if (schema === undefined) return [];
  try {
    let validator = schemas.get(schema);
    if (!validator) {validator = fromJSONSchema(schema as Parameters<typeof fromJSONSchema>[0]); schemas.set(schema, validator);}
    const result = validator.safeParse(payload);
    return result.success ? [] : result.error.issues.map(issue => `${issue.path.join(".") || "payload"}: ${issue.message}`);
  } catch (error) {return [`Unsupported or invalid payload schema: ${error instanceof Error ? error.message : String(error)}`];}
}

/** Validate the serializable envelope independently of an installed plugin catalog. */
export function validateDisplayDocument(input: unknown): DisplayRuntimeFailure[] {
  const issues: DisplayRuntimeFailure[] = [];
  const issue = (message: string, nodeId?: string, reason: DisplayRuntimeFailure["reason"] = "invalid-document") => issues.push({reason, message, nodeId});
  if (!record(input) || input.version !== 1 || !isDisplayName(input.id) || !Array.isArray(input.plugins)) return [{reason: "invalid-document", message: "A display document needs version 1, an id, root, and exact plugin locks"}];
  const plugins = new Set<string>();
  for (const lock of input.plugins) {
    if (!record(lock) || !isDisplayName(lock.id) || !isDisplayPackageVersion(lock.version)) {issue("Plugin dependencies require an id and an exact package version"); continue;}
    if (lock.integrity !== undefined && !isDisplayName(lock.integrity)) issue(`Invalid package integrity: ${lock.id}`);
    if (plugins.has(lock.id)) issue(`Duplicate plugin lock: ${lock.id}`);
    plugins.add(lock.id);
  }
  const ids = new Set<string>(), targets = new Set<string>(), ancestors = new Set<object>();
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    const nodeId = record(value) && isDisplayName(value.id) ? value.id : undefined;
    if (!record(value) || !nodeId || !isDisplayName(value.kind) || !positiveVersion(value.version) || !Object.hasOwn(value, "payload")) {issue("Invalid display node envelope", nodeId, "invalid-node"); return;}
    if (ancestors.has(value)) {issue("Display nodes cannot contain cycles", nodeId, "composition-cycle"); return;}
    if (++count > 10_000 || depth > 64) {issue("Display tree exceeds the supported size or nesting depth", nodeId, "invalid-node"); return;}
    if (ids.has(nodeId)) {issue(`Duplicate node id: ${nodeId}`, nodeId, "invalid-node"); return;}
    if (targets.has(nodeId)) issue(`Node id conflicts with an existing target: ${nodeId}`, nodeId, "invalid-node");
    ids.add(nodeId); targets.add(nodeId); ancestors.add(value);
    if (value.targets !== undefined) {
      if (!Array.isArray(value.targets) || value.targets.some(target => !isDisplayName(target))) issue("Targets must be local names", nodeId, "invalid-node");
      else for (const target of value.targets) {
        const key = `${nodeId}/${target}`;
        if (targets.has(key)) issue(`Duplicate target: ${key}`, nodeId, "invalid-node");
        targets.add(key);
      }
    }
    if (value.build !== undefined && (!record(value.build) || !isDisplayName(value.build.jobId) || !["pending", "running", "ready", "failed", "cancelled"].includes(String(value.build.status)) || (value.build.revision !== undefined && (!Number.isSafeInteger(value.build.revision) || Number(value.build.revision) < 0)) || (value.build.sourceHash !== undefined && !isDisplayName(value.build.sourceHash)))) issue("Invalid display build reference", nodeId, "invalid-node");
    if (value.children !== undefined) {
      if (!Array.isArray(value.children)) issue("Display children must be an array", nodeId, "invalid-node");
      else value.children.forEach(child => visit(child, depth + 1));
    }
    if (value.slots !== undefined) {
      if (!record(value.slots)) issue("Display slots must be a map of child arrays", nodeId, "invalid-slot");
      else for (const [name, children] of Object.entries(value.slots)) {
        if (name === "children") issue("Use node.children for the default slot", nodeId, "invalid-slot");
        else if (!isDisplayName(name) || !Array.isArray(children)) issue(`Invalid slot ${name}`, nodeId, "invalid-slot");
        else children.forEach(child => visit(child, depth + 1));
      }
    }
    ancestors.delete(value);
  };
  visit(input.root, 0);
  if (input.ticksPerSecond !== undefined && !positiveVersion(input.ticksPerSecond)) issue("ticksPerSecond must be a positive integer");
  if (input.durationTicks !== undefined && (!Number.isSafeInteger(input.durationTicks) || Number(input.durationTicks) < 0)) issue("durationTicks must be a nonnegative integer");
  if (input.timeline !== undefined) {
    if (!Array.isArray(input.timeline)) issue("Timeline must be an array");
    else {
      const cueIds = new Set<string>();
      for (const cue of input.timeline) {
        if (!record(cue) || !isDisplayName(cue.id) || !Number.isSafeInteger(cue.startTick) || Number(cue.startTick) < 0 || !positiveVersion(cue.durationTicks) || !Array.isArray(cue.targets) || cue.targets.some(target => !isDisplayName(target))) {issue("Invalid display timeline cue"); continue;}
        if (cueIds.has(cue.id)) issue(`Duplicate timeline cue: ${cue.id}`);
        cueIds.add(cue.id);
        if (new Set(cue.targets).size !== cue.targets.length) issue(`Duplicate cue target: ${cue.id}`);
        if (typeof input.durationTicks === "number" && Number(cue.startTick) + Number(cue.durationTicks) > input.durationTicks) issue(`Timeline cue ${cue.id} exceeds the document duration`);
        // Manifest-defined targets are checked after component resolution.
      }
    }
  }
  if (input.resources !== undefined) validateResources(input.resources, message => issue(message));
  return issues;
}

function validateResources(resources: unknown, issue: (message: string) => void): void {
  if (!Array.isArray(resources)) {issue("Resources must be an array"); return;}
  const ids = new Set<string>();
  for (const resource of resources) {
    if (!record(resource) || !isDisplayName(resource.id) || !["image", "audio", "video", "font", "data"].includes(String(resource.kind)) || typeof resource.uri !== "string" || !resource.uri.trim()) {issue("Invalid resource descriptor"); continue;}
    if (resource.integrity !== undefined && !isDisplayName(resource.integrity)) issue(`Invalid resource integrity: ${resource.id}`);
    if (resource.required !== undefined && typeof resource.required !== "boolean") issue(`Invalid resource readiness requirement: ${resource.id}`);
    if (ids.has(resource.id)) issue(`Duplicate resource: ${resource.id}`);
    ids.add(resource.id);
  }
}

export function validateDisplayPluginManifest(value: unknown): DisplayRuntimeFailure[] {
  const issues: DisplayRuntimeFailure[] = [];
  const issue = (message: string) => issues.push({reason: "invalid-document", message} as DisplayRuntimeFailure);
  if (!record(value) || value.apiVersion !== 1 || !isDisplayName(value.id) || !isDisplayPackageVersion(value.version) || !["trusted", "declarative"].includes(String(value.execution)) || !Array.isArray(value.components) || !value.components.length) return [{reason: "invalid-document", message: "Manifest needs apiVersion 1, id, exact version, execution mode and components"}];
  if (value.integrity !== undefined && !isDisplayName(value.integrity)) issue("Invalid manifest integrity");
  if (value.domains !== undefined && (!Array.isArray(value.domains) || value.domains.some(domain => !isDisplayName(domain)))) issue("Domains must be names");
  const routes = new Set<string>();
  for (const component of value.components) {
    if (!record(component) || !isDisplayName(component.kind) || !positiveVersion(component.version)) {issue("Invalid component kind or schema version"); continue;}
    const key = `${component.kind}@${component.version}`;
    if (routes.has(key)) issue(`Duplicate component: ${key}`);
    routes.add(key);
    if (component.payloadSchema !== undefined) {
      if (typeof component.payloadSchema !== "boolean" && !record(component.payloadSchema)) issue(`Invalid JSON schema for ${key}`);
      else try {fromJSONSchema(component.payloadSchema as Parameters<typeof fromJSONSchema>[0]);} catch (error) {issue(`Unsupported JSON schema for ${key}: ${error instanceof Error ? error.message : String(error)}`);}
    }
    if (value.execution === "declarative" && !component.composition) issue(`Declarative component ${key} needs a composition`);
    if (component.composition !== undefined) issues.push(...validateDisplayDocument({version: 1, id: "template", root: component.composition, plugins: []}).map(failure => ({...failure, message: `${key}: ${failure.message}`})));
    if (component.targets !== undefined && (!Array.isArray(component.targets) || component.targets.some(target => !isDisplayName(target)) || new Set(component.targets).size !== component.targets.length)) issue(`Invalid or duplicate targets for ${key}`);
    if (component.resources !== undefined && (!Array.isArray(component.resources) || component.resources.some(resource => !isDisplayName(resource)))) issue(`Invalid resource requirements for ${key}`);
    if (component.slots !== undefined) {
      if (!record(component.slots)) issue(`Invalid slots for ${key}`);
      else for (const [slot, definition] of Object.entries(component.slots)) {
        if (!isDisplayName(slot) || !record(definition) || (definition.required !== undefined && typeof definition.required !== "boolean") || (definition.multiple !== undefined && typeof definition.multiple !== "boolean") || (definition.accepts !== undefined && (!Array.isArray(definition.accepts) || definition.accepts.some(kind => !isDisplayName(kind))))) issue(`Invalid slot definition ${key}/${slot}`);
      }
    }
  }
  if (value.dependencies !== undefined) {
    if (!Array.isArray(value.dependencies)) issue("Dependencies must be exact package locks");
    else {
      const ids = new Set<string>();
      for (const dependency of value.dependencies) {
        if (!record(dependency) || !isDisplayName(dependency.id) || !isDisplayPackageVersion(dependency.version)) {issue("Invalid dependency lock"); continue;}
        if (dependency.integrity !== undefined && !isDisplayName(dependency.integrity)) issue(`Invalid dependency integrity: ${dependency.id}`);
        if (ids.has(dependency.id)) issue(`Duplicate dependency ${dependency.id}`);
        ids.add(dependency.id);
      }
    }
  }
  if (value.resources !== undefined) validateResources(value.resources, issue);
  if (value.builders !== undefined) {
    if (!Array.isArray(value.builders)) issue("Builders must be descriptors");
    else {
      const ids = new Set<string>();
      for (const builder of value.builders) {
        if (!record(builder) || !isDisplayName(builder.id) || typeof builder.description !== "string" || !isDisplayName(builder.outputKind) || !positiveVersion(builder.outputVersion)) {issue("Invalid display builder descriptor"); continue;}
        if (ids.has(builder.id)) issue(`Duplicate display builder: ${builder.id}`);
        ids.add(builder.id);
        if (builder.inputSchema !== undefined) try {fromJSONSchema(builder.inputSchema as Parameters<typeof fromJSONSchema>[0]);} catch (error) {issue(`Invalid builder input schema: ${builder.id}`);}
      }
    }
  }
  return issues;
}

export function validateDisplayNodeSlots(node: DisplayNode, component: DisplayComponentManifest): DisplayRuntimeFailure[] {
  const issues: DisplayRuntimeFailure[] = [];
  const fail = (message: string) => issues.push({reason: "invalid-slot", nodeId: node.id, kind: node.kind, message} as DisplayRuntimeFailure);
  for (const [name, definition] of Object.entries(component.slots ?? {})) {
    const children = name === "children" ? node.children ?? [] : node.slots?.[name] ?? [];
    if (definition.required && !children.length) fail(`Required slot ${name} is empty`);
    if (definition.multiple === false && children.length > 1) fail(`Slot ${name} accepts one child`);
    if (definition.accepts) for (const child of children) if (!definition.accepts.includes(child.kind)) fail(`Slot ${name} cannot accept ${child.kind}`);
  }
  if (component.slots) for (const name of [...Object.keys(node.slots ?? {}), ...(node.children?.length ? ["children"] : [])]) if (!Object.hasOwn(component.slots, name)) fail(`Unknown slot ${name}`);
  return issues;
}

export function assertDisplayDocument(value: unknown): asserts value is DisplayDocument {
  const issues = validateDisplayDocument(value);
  if (issues.length) throw new Error(issues.map(issue => issue.message).join("; "));
}
export function assertDisplayPluginManifest(value: unknown): asserts value is DisplayPluginManifest {
  const issues = validateDisplayPluginManifest(value);
  if (issues.length) throw new Error(issues.map(issue => issue.message).join("; "));
}
