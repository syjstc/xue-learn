import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {z} from "zod";
import type {DisplayPluginManifest} from "../../../display/src/types.js";
import type {LlmMessageRecord} from "../agents/core/types.js";
import {configureDisplayPluginCatalog} from "../display-build/catalog.js";
import {configureDisplayBuildRuntime, createDisplayBuildRuntime} from "../display-build/service.js";
import {resolveDisplayBuilds} from "../display-build/material.js";
import {materialGenerationJitItemSchema} from "../llm/jit-structured-items.js";
import {runSectionMaterialAuthoringAgent} from "./runner.js";
import {runUnitAuthoringAgentRound} from "./agent-round.js";

type Saved = {id: string; stage: string; sectionId?: string; branchKind: string; message: LlmMessageRecord};
let mockRecords: Saved[] = [];
let mockState: Record<string, unknown> = {};
jest.mock("./session.js", () => ({
  ensureUnitAuthoringSession: async () => ({threadId: "thread", state: mockState}),
  loadUnitAuthoringTranscriptRecords: async () => [...mockRecords],
  loadUnitAuthoringTranscript: async () => mockRecords.map(item => item.message),
  messagesForAuthoringSection: (records: Saved[], sectionId: string) => records.filter(item => item.sectionId === sectionId).map(item => item.message),
  filterTranscriptBeforeSection: (records: Saved[], sectionId: string) => records.filter(item => item.sectionId !== sectionId).map(item => item.message),
  saveUnitAuthoringState: async (_id: string, state: Record<string, unknown>) => {mockState = state;},
  appendUnitAuthoringMessage: async (input: Omit<Saved, "id">) => {const saved = {...input, id: `message-${mockRecords.length}`}; mockRecords.push(saved); return saved;},
}));
jest.mock("./agent-round.js", () => ({
  runUnitAuthoringAgentRound: jest.fn(), compactUnitAuthoringStagePrompt: (prompt: string) => prompt,
}));
jest.mock("../generation/kernel.js", () => ({}));
jest.mock("../learning-spaces/course-display-policy.js", () => ({isGeneralEducationCourse: async () => false}));
jest.mock("../images/providers/index.js", () => ({isImageGenerationAvailable: () => false}));

test("real section runner publishes a durable derivation slot, continues authoring, and resumes without repeating model work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "display-runner-"));
  const manifests: DisplayPluginManifest[] = [{apiVersion: 1, id: "math-plugin", version: "1.0.0", execution: "trusted",
    components: [{kind: "math:derivation", version: 1}], builders: [{id: "math:derive", description: "Proof", outputKind: "math:derivation", outputVersion: 1,
      inputSchema: {type: "object", required: ["requirement"], properties: {requirement: {type: "string"}}}}]},
    {apiVersion: 1, id: "physics-plugin", version: "1.0.0", execution: "declarative", components: [{kind: "physics:diagram", version: 1,
      payloadSchema: {type: "object", required: ["text"], properties: {text: {type: "string"}}}, composition: {id: "label", kind: "general:text", version: 1, payload: {text: "Energy"}}}]}];
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => {finish = resolve;});
  const build = jest.fn(async () => pending);
  const worker = createDisplayBuildRuntime({directory, builders: [{kind: "math:derivation", version: 1, build}], pollMs: 100});
  configureDisplayBuildRuntime(worker);
  configureDisplayPluginCatalog(() => manifests);
  mockRecords = [];
  mockState = {unitId: "unit", goalId: "goal", traceId: "trace", stage: "section_material", completedSectionIds: [], lastMessageId: null};
  const rounds = jest.mocked(runUnitAuthoringAgentRound);
  rounds.mockImplementation(async (args: any) => {
    const candidate = args.expectedTool === "commit_section_topics" ? {topics: [{id: "proof", title: "Energy conservation"}, {id: "diagram", title: "Energy transfer"}]}
      : args.meta.topicId === "proof" ? {topicId: "proof", display: {type: "display_build", id: "proof-board", title: "Energy conservation",
        pluginId: "math-plugin", pluginVersion: "1.0.0", builderId: "math:derive", input: {requirement: "Derive energy conservation, including all intermediate steps."}}, cues: []}
      : {topicId: "diagram", display: {type: "display", id: "diagram-board", title: "Energy transfer", document: {version: 1, id: "diagram-board",
        plugins: [{id: "physics-plugin", version: "1.0.0"}], root: {id: "diagram-board", kind: "physics:diagram", version: 1, payload: {text: "Energy passes between objects."}}}},
        cues: [{text: "Energy passes from one object to another.", targetIds: ["diagram-board"]}]};
    const id = `call-${rounds.mock.calls.length}`;
    return {result: args.resultSchema.parse(candidate), repairMessages: [], userMessage: {role: "user", content: args.prompt},
      assistantMessage: {role: "assistant", content: "", toolCalls: [{id, name: args.expectedTool, args: candidate}]},
      toolMessage: {role: "tool", content: "accepted", toolCallId: id}} as never;
  });
  try {
    await worker.start();
    const params = {userId: "alice", goalId: "goal", unitId: "unit", sectionId: "section", prompt: "Teach the conservation and transfer of energy.",
      skipSurvey: true, resultSchema: z.array(materialGenerationJitItemSchema)};
    const result = await runSectionMaterialAuthoringAgent(params);
    expect(rounds).toHaveBeenCalledTimes(3);
    const slot = result.find(item => item.kind === "block" && item.block.type === "display" && item.block.id === "proof-board");
    expect(slot).toBeDefined();
    const jobs = await worker.repository.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).not.toBe("ready");
    expect(result.some(item => item.kind === "block" && item.block.type === "display" && item.block.id === "diagram-board")).toBe(true);
    const resumed = await runSectionMaterialAuthoringAgent(params);
    expect(rounds).toHaveBeenCalledTimes(3);
    expect((await worker.repository.list()).map(job => job.id)).toEqual(jobs.map(job => job.id));
    expect(resumed).toHaveLength(result.length);
    finish({document: {status: "complete", steps: [{index: 1}], revision: 1}, derived: {}});
    for (let i = 0; i < 200 && (await worker.repository.get(jobs[0]!.id))?.status !== "ready"; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const resolved = await resolveDisplayBuilds(result, "alice");
    const ready = resolved.find(item => item.kind === "block" && item.block.type === "display" && item.block.id === "proof-board");
    expect(ready && ready.kind === "block" && ready.block.type === "display" && ready.block.document.root.build?.status).toBe("ready");
  } finally {
    finish({}); await worker.stop(); configureDisplayBuildRuntime(undefined); configureDisplayPluginCatalog(undefined);
    await rm(directory, {recursive: true, force: true});
  }
});
