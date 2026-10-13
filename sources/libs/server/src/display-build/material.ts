import type { DisplayNode, DisplayPluginManifest } from "../../../display/src/types.js";
import { validateDisplayPayload } from "../../../display/src/validation.js";
import type { DisplayBuildIntent, MaterialDisplayBlock } from "../../../domain/src/material-display.js";
import { getDisplayBuildRuntime, requireDisplayBuildRuntime } from "./service.js";
import { derivationDisplayBinding } from "../../../../src/components/display-plugins/derivation-sampling.js";
import { parseTeachingDerivationDocument } from "../../../teaching-derivation/src/index.js";

export async function enqueueDisplayMaterial(input: {
  ownerUserId: string; unitId: string; sectionId: string; revisionId: string; intent: DisplayBuildIntent;
  manifests: readonly DisplayPluginManifest[]; sourceContext?: string;
}): Promise<MaterialDisplayBlock> {
  const {intent} = input;
  const manifest = input.manifests.find(item => item.id === intent.pluginId && item.version === intent.pluginVersion);
  const builder = manifest?.builders?.find(item => item.id === intent.builderId);
  if (!manifest || !builder) throw Error(`Display builder is not installed: ${intent.pluginId}@${intent.pluginVersion}/${intent.builderId}`);
  const issues = validateDisplayPayload(intent.input, builder.inputSchema);
  if (issues.length) throw Error(issues.join("; "));
  const runtime = requireDisplayBuildRuntime();
  const run = await runtime.enqueue({ownerUserId: input.ownerUserId,
    scopeKey: `${input.unitId}/${input.sectionId}/${intent.id}/${input.revisionId}`, kind: builder.outputKind, componentVersion: builder.outputVersion,
    input: {...intent.input, title: intent.title, unitId: input.unitId, sourceContext: input.sourceContext}});
  const material: MaterialDisplayBlock = {type: "display", id: intent.id, title: intent.title, document: {version: 1, id: intent.id,
    plugins: [{id: manifest.id, version: manifest.version, ...(manifest.integrity ? {integrity: manifest.integrity} : {})}, ...(manifest.dependencies ?? [])],
    root: {id: intent.id, kind: builder.outputKind, version: builder.outputVersion, payload: {title: intent.title, ...intent.input},
      build: {jobId: run.id, status: run.status, sourceHash: run.sourceHash, revision: run.inputRevision}}}};
  return run.status === "ready" ? resolveDisplayBuilds(material, input.ownerUserId) : material;
}

/** Read projection only: an old job can never mutate a new input or section revision. */
export async function resolveDisplayBuilds<T>(value: T, ownerUserId: string): Promise<T> {
  const runtime = getDisplayBuildRuntime();
  const visit = async (item: unknown): Promise<unknown> => {
    if (Array.isArray(item)) return Promise.all(item.map(visit));
    if (!item || typeof item !== "object") return item;
    const record = item as Record<string, unknown>;
    let result: Record<string, unknown> = Object.fromEntries(await Promise.all(Object.entries(record).map(async ([key, child]) => [key, await visit(child)])));
    if (record.build && typeof record.kind === "string") {
      const node = record as unknown as DisplayNode;
      const ref = node.build!;
      const run = await runtime?.getOwned(ref.jobId, ownerUserId).catch(() => null);
      if (run && run.sourceHash === ref.sourceHash && run.inputRevision === ref.revision
        && run.kind === node.kind && run.componentVersion === node.version) {
        result = {...result, build: {...ref, status: run.status, ...(run.error ? {error: run.error} : {error: undefined})}};
        if (run.status === "ready") {
          result.payload = run.artifact;
          if (node.kind === "math:derivation") {
            const document = parseTeachingDerivationDocument((run.artifact as {document?: unknown})?.document);
            if (document) result.targets = derivationDisplayBinding(document, node.id).targets;
          }
        }
      } else if (!run && ref.status === "ready") {
        // A hydrated document is an immutable, portable artifact. Its historical
        // job belongs to the producing workspace and need not exist in readers.
        // Never recreate it from a missing job or replace its accepted payload.
        result = {...result, build: {...ref, status: "ready", error: undefined}};
      } else {
        result = {...result, build: {...ref, status: "failed", error: run
          ? "展示输入已改变，请重新构建。" : "展示构建任务不可用，请重新构建。"}};
      }
    }
    // Only a root derivation owns this whole document's local timeline. Nested
    // builders retain host-authored timing instead of merging competing zero origins.
    const root = result.root as DisplayNode | undefined;
    if (result.version === 1 && Array.isArray(result.plugins) && root?.kind === "math:derivation"
      && root.build?.status === "ready" && !Array.isArray(result.timeline)) {
      const document = parseTeachingDerivationDocument((root.payload as {document?: unknown})?.document);
      if (document) {
        const {timeline, durationTicks, ticksPerSecond} = derivationDisplayBinding(document, root.id);
        result = {...result, timeline, durationTicks, ticksPerSecond};
      }
    }
    return result;
  };
  return await visit(value) as T;
}

export function unfinishedDisplayBuilds(value: unknown): Array<{nodeId: string; jobId: string; status: string; error?: string}> {
  const result: Array<{nodeId: string; jobId: string; status: string; error?: string}> = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {item.forEach(visit); return;}
    if (!item || typeof item !== "object") return;
    const node = item as Partial<DisplayNode>;
    if (typeof node.kind === "string" && node.build && node.build.status !== "ready")
      result.push({nodeId: node.id ?? "", jobId: node.build.jobId, status: node.build.status, error: node.build.error});
    Object.values(item).forEach(visit);
  };
  visit(value);
  return result;
}

/** Source transfers/export must freeze complete artifacts in the producing
 * workspace. A receiving workspace cannot resolve somebody else's job. */
export function assertDisplayBuildsReady(value: unknown): void {
  const pending = unfinishedDisplayBuilds(value);
  if (pending.length) throw Error(`DISPLAY_BUILDS_PENDING: ${pending.map(item => `${item.nodeId} (${item.status})`).join(", ")}`);
}

export async function prepareDisplayBuildSnapshot<T>(value: T, ownerUserId: string): Promise<T> {
  const snapshot = await resolveDisplayBuilds(value, ownerUserId);
  assertDisplayBuildsReady(snapshot);
  return snapshot;
}
