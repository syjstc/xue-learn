import type { DisplayDocument, DisplayNode, DisplayPluginManifest } from "../../../display/src/types.js";
import { validateDisplayPayload } from "../../../display/src/validation.js";
import { getDisplayBuildRuntime } from "./service.js";
import {isMotionSceneDisplayPayload} from '../../../../src/components/display-plugins/film/motion-scene-schema.js';

let provider: (() => readonly DisplayPluginManifest[] | Promise<readonly DisplayPluginManifest[]>) | undefined;
export function configureDisplayPluginCatalog(next: typeof provider) { provider = next; }
export async function loadDisplayAuthoringCatalog(): Promise<readonly DisplayPluginManifest[]> {
  return provider ? [...await provider()] : [];
}
export function displayCatalogInstruction(manifests: readonly DisplayPluginManifest[]): string {
  if (!manifests.length) return "";
  const catalog = manifests.map(manifest => ({id: manifest.id, version: manifest.version, description: manifest.description,
    dependencies: manifest.dependencies, components: manifest.components,
    builders: manifest.builders?.filter(builder => getDisplayBuildRuntime()?.hasBuilder(builder.outputKind, builder.outputVersion))}));
  return `Installed display plugin catalog (exact versions, schemas and examples are authoritative):\n${JSON.stringify(catalog)}\n`
    + "Course learning and video export share this exact teaching source. Author complete narration and reusable animation once. For physics:motion-scene, declare both object IDs and stage IDs in node.targets. A cue targeting nodeId/stageId executes that transformation, while nodeId/objectId focuses the object. Supply the same ordered cues in document.timeline for standalone playback and reference their IDs with paragraph cue.timelineCueId; the host synchronizes these to narration without regenerating geometry.\n"
    + "This installed plugin contract supersedes legacy raw display catalogs. New non-image topics use type=display or type=display_build only; raw legacy callout/stage/visual formats are read compatibility data. Compose multiple domains through document.root children/slots. A plugin display can be arbitrarily simple or a complex complete teaching object.\n"
    + "Use type=display with a version 1 document to compose components from the installed plugins. Declare every required exact plugin version in document.plugins. Stable node IDs and nodeId/target cue identities must refer to existing nodes. Never author build/job fields. For a complex component, use type=display_build with pluginId, pluginVersion, builderId and input matching its builder inputSchema, and cues:[]. The host persists the job and continues other topics immediately; the component agent generates its complete content and narration asynchronously. For music:score or music:teaching components, preserve actual score notes, durations and clips in payload.block; a performance cue uses music:{figureId:node.id,clipId:an existing clip or step ID,repeat?:1..4}. Use short ASCII node IDs for musical figures, declare local focus targets, and never claim a performance without an explicit music action. A derivation is a display within an ordinary section. Keep one continuous derivation in one component, preserve all intermediate steps, and never replace it with a text summary.";
}

export function authoredDisplayDocumentIssues(document: DisplayDocument, manifests: readonly DisplayPluginManifest[]): string[] {
  const issues: string[] = [];
  const locked = document.plugins.map(lock => manifests.find(manifest => manifest.id === lock.id && manifest.version === lock.version));
  document.plugins.forEach((lock, index) => {if (!locked[index]) issues.push(`Display plugin unavailable: ${lock.id}@${lock.version}`);});
  for (const manifest of locked) for (const dependency of manifest?.dependencies ?? []) {
    if (!document.plugins.some(lock => lock.id === dependency.id && lock.version === dependency.version)) issues.push(`Missing exact plugin dependency ${dependency.id}@${dependency.version}`);
  }
  const visit = (node: DisplayNode) => {
    if (node.build) issues.push("Only the host may assign a display build reference");
    const matches = locked.flatMap(manifest => manifest?.components.filter(component => component.kind === node.kind && component.version === node.version) ?? []);
    if (matches.length !== 1) issues.push(`Component must resolve to one installed locked plugin: ${node.kind}@${node.version}`);
    else {
      issues.push(...validateDisplayPayload(node.payload, matches[0]!.payloadSchema));
      if (node.kind === 'physics:motion-scene') {
        if ((node.payload as Record<string,unknown>)?.presentation !== undefined) issues.push(`Only the host may assign narration sampling on ${node.id}`);
        if (!isMotionSceneDisplayPayload(node.payload)) issues.push(`Invalid advanced animation geometry on ${node.id}`);
        const stages = (node.payload as {stages?:{id:string}[]})?.stages ?? [];
        let previous = -1;
        for (const stage of stages) {
          const index = document.timeline?.findIndex(cue => cue.targets.includes(`${node.id}/${stage.id}`)) ?? -1;
          if (index < 0 || index <= previous || !node.targets?.includes(stage.id)) issues.push(`Animation stage ${node.id}/${stage.id} needs a declared target and an ordered timeline cue`);
          previous = index;
        }
      }
      for (const [name, slot] of Object.entries(matches[0]!.slots ?? {})) {
        const children = node.slots?.[name] ?? [];
        if (slot.required && !children.length) issues.push(`Required slot ${node.id}/${name} is empty`);
        if (!slot.multiple && children.length > 1) issues.push(`Slot ${node.id}/${name} accepts one component`);
        if (slot.accepts && children.some(child => !slot.accepts!.includes(child.kind))) issues.push(`Slot ${node.id}/${name} has an incompatible component`);
      }
      if (Object.keys(node.slots ?? {}).some(name => !matches[0]!.slots?.[name])) issues.push(`Unknown slot on ${node.id}`);
    }
    node.children?.forEach(visit);
    Object.values(node.slots ?? {}).forEach(children => children.forEach(visit));
  };
  visit(document.root);
  return issues;
}
