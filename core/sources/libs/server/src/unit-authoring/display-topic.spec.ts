import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {z} from "zod";
import type {DisplayPluginManifest} from "../../../display/src/types.js";
import {materialDisplayBlockSchema} from "../../../domain/src/material-display.js";
import {createDisplayBuildRuntime, configureDisplayBuildRuntime} from "../display-build/service.js";
import {displayCatalogInstruction} from "../display-build/catalog.js";
import {acceptedDisplayBuildDrafts, createDisplayTopicSchema, createDisplayTopicTool, enqueueDisplayTopic} from "./display-topic.js";
import {createTopicMaterialCommitSchema, flattenTopicToJitItems, topicMaterialCommitBindingSchema} from "../llm/material-topic.js";
import {learningMaterialSchema, strictLearningMaterialSchema} from "../llm/schemas.js";
import {assertNarratedMaterialBlocks} from "../llm/narrated-material-sequence.js";

const manifest: DisplayPluginManifest = {apiVersion: 1, id: "org.xuelearn.display.math", version: "1.0.0", execution: "trusted",
  components: [{kind: "math:derivation", version: 1, payloadSchema: {type: "object", required: ["document"]}}],
  builders: [{id: "math:derive", description: "Complete a full proof", outputKind: "math:derivation", outputVersion: 1,
    inputSchema: {type: "object", required: ["requirement"], properties: {requirement: {type: "string", minLength: 1}}, additionalProperties: false}}]};
const draft = {topicId: "energy", display: {type: "display_build" as const, id: "energy-proof", title: "Energy conservation",
  pluginId: manifest.id, pluginVersion: manifest.version, builderId: "math:derive", input: {requirement: "Derive energy conservation with all intermediate steps"}}, cues: []};
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "display-authoring-"));
  configureDisplayBuildRuntime(createDisplayBuildRuntime({directory, builders: [{kind: "math:derivation", version: 1, build: async () => {throw Error("The main author must never wait for this builder");}}]}));
});
afterEach(async () => {configureDisplayBuildRuntime(undefined); await rm(directory, {recursive: true, force: true});});

test("the model tool gets an installed builder schema; empty cues are allowed only on the builder branch", () => {
  const tool = createDisplayTopicTool([manifest], false);
  expect(tool.schema.parse(draft)).toEqual(draft);
  expect(() => tool.schema.parse({...draft, display: {...draft.display, input: {missing: true}}})).toThrow();
  const schema = createDisplayTopicSchema(createTopicMaterialCommitSchema({allowedTopicIds: ["energy"], expectedTopicId: "energy"}), [manifest], "energy");
  expect(schema.parse(draft)).toEqual(draft);
  expect(() => schema.parse({...draft, display: {...draft.display, pluginVersion: "2.0.0"}})).toThrow("installed builder");
  expect(() => schema.parse({...draft, topicId: "another"})).toThrow("only topic energy");
  expect(displayCatalogInstruction([manifest])).toContain('"required":["requirement"]');
  expect(displayCatalogInstruction([manifest])).toContain("asynchronously");
});

test("persisted builder intents become real material slots without running or awaiting the agent", async () => {
  const input = {userId: "alice", unitId: "u1", sectionId: "s1", prompt: "Teach conservation of energy", revisionId: "tool-call-1", draft, manifests: [manifest]};
  const material = await enqueueDisplayTopic(input);
  expect(material.display.type).toBe("display");
  const display = materialDisplayBlockSchema.parse(material.display);
  expect(display.document.root.build?.status).toBe("pending");
  expect(topicMaterialCommitBindingSchema.parse(material).cues).toEqual([]);
  const repeated = await enqueueDisplayTopic(input);
  expect(repeated).toEqual(material);
  const items = flattenTopicToJitItems({id: "energy", title: "Energy conservation"}, material);
  const blocks = items.flatMap(item => item.kind === "block" ? [item.block] : []);
  expect(blocks).toHaveLength(2);
  expect(() => assertNarratedMaterialBlocks(blocks)).not.toThrow();
  const source = {introduction: "", blocks, keyTakeaways: []};
  expect(strictLearningMaterialSchema.parse(source).blocks).toEqual(blocks);
  expect(learningMaterialSchema.parse(source).blocks).toEqual(blocks);
});

test("resume recovers the immutable intent revision, and replacement intents supersede older pointers", () => {
  const messages = [{role: "assistant" as const, content: "", toolCalls: [{id: "first", name: "commit_topic_material", args: draft},
    {id: "second", name: "commit_topic_material", args: {...draft, display: {...draft.display, title: "Changed title"}}}]}];
  expect(acceptedDisplayBuildDrafts(messages, ["energy"]).get("energy")?.revisionId).toBe("second");
});

test("direct display authoring cannot forge job references or invoke an uninstalled plugin", () => {
  const display = {type: "display", id: "proof", title: "Proof", document: {version: 1, id: "proof", plugins: [{id: manifest.id, version: manifest.version}],
    root: {id: "proof", kind: "math:derivation", version: 1, payload: {document: {}}, build: {jobId: "forged", status: "ready"}}}};
  const base = z.object({topicId: z.string(), display: materialDisplayBlockSchema, cues: z.array(z.unknown())});
  const schema = createDisplayTopicSchema(base, [manifest], "energy");
  expect(() => schema.parse({topicId: "energy", display, cues: []})).toThrow("Only the host");
  const clean = {...display, document: {...display.document, plugins: [{id: "uninstalled", version: "1.0.0"}], root: {...display.document.root, build: undefined}}};
  expect(() => schema.parse({topicId: "energy", display: clean, cues: []})).toThrow("plugin unavailable");
});

describe("malformed provider display documents", () => {
  const topic = () => ({topicId: "energy", display: {type: "display", id: "proof", title: "Energy conservation",
    document: {version: 1, id: "proof", plugins: [{id: manifest.id, version: manifest.version}],
      root: {id: "proof", kind: "math:derivation", version: 1, payload: {document: {}}}}},
    cues: [{text: "Energy passes from one object to another.", targetIds: ["proof"]}]});
  const schemas = () => [topicMaterialCommitBindingSchema,
    createTopicMaterialCommitSchema({allowedTopicIds: ["energy"], expectedTopicId: "energy"}),
    createDisplayTopicSchema(createTopicMaterialCommitSchema({allowedTopicIds: ["energy"], expectedTopicId: "energy"}), [manifest], "energy")];

  test.each([
    ["children", {children: {item: []}}, "children"],
    ["slot children", {slots: {detail: {item: []}}}, "slots.detail"],
    ["targets", {targets: {item: ["focus"]}}, "targets"],
    ["nested children", {children: [{id: "child", kind: "math:derivation", version: 1, payload: {document: {}}, children: {item: []}}]}, "children.0.children"],
  ])("%s reach schema validation instead of throwing during cue preprocessing", (_name, invalid, path) => {
    const candidate = topic();
    Object.assign(candidate.display.document.root, invalid);
    const original = structuredClone(candidate);
    for (const schema of schemas()) {
      const parsed = schema.safeParse(candidate);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw Error("Malformed display was accepted");
      expect(JSON.stringify(parsed.error.issues)).toContain(path.split(".").at(-1));
      expect(parsed.error.message).toContain("expected array");
    }
    expect(candidate).toEqual(original);
  });

  test("wrapped plugin locks and string node versions remain repairable validation errors", () => {
    const candidate = topic();
    Object.assign(candidate.display.document, {plugins: {item: candidate.display.document.plugins}});
    Object.assign(candidate.display.document.root, {version: "1", children: {item: []}});
    for (const schema of schemas()) {
      const parsed = schema.safeParse(candidate);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw Error("Malformed display was accepted");
      expect(parsed.error.message).toContain("expected number");
      expect(parsed.error.message).toContain("expected array");
    }
  });

  test("valid child and slot targets still retain their narration and exact plugin version", () => {
    const candidate = topic();
    Object.assign(candidate.display.document.root, {
      children: [{id: "child", kind: "math:derivation", version: 1, payload: {document: {}}, targets: ["focus"]}],
      slots: {detail: [{id: "detail", kind: "math:derivation", version: 1, payload: {document: {}}}]},
    });
    candidate.cues[0]!.targetIds = ["child/focus", "detail"];
    const parsed = topicMaterialCommitBindingSchema.parse(candidate);
    expect(parsed.display).toEqual(candidate.display);
    expect(parsed.cues[0]!.targetIds).toEqual(["child/focus", "detail"]);
  });
});
