import { AIMessageChunk } from "@langchain/core/messages";
import { z } from "zod";
import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { goalCurriculumJourneyBindingSchema } from "../llm/schemas.js";
import { goalPathPartBindingSchema, goalPathOutlineCommitSchema, registryCommitSchema, moduleCommitSchema } from "../goal-authoring/path-parts.js";
import type { LlmMessageRecord } from "../agents/core/types.js";
import { getChatModel } from "../llm/client.js";
import {createTopicMaterialCommitSchema} from "../llm/material-topic.js";
import {createDisplayTopicSchema, createDisplayTopicTool} from "./display-topic.js";
import type {DisplayPluginManifest} from "../../../display/src/types.js";
import {topicMaterialCommitBindingSchema} from "../llm/material-topic.js";
import {builtinDisplayManifests} from "../../../../src/components/display-plugins/catalog.js";
const mockLlmLogFinish = jest.fn();
import {
  compactSurveyPreviewBindingSchema,
  surveyAuthoringItemsSchemaFor,
} from "../survey/authoring.js";
import {
  langChainTools,
  resolveUnitAuthoringToolBinding,
  runUnitAuthoringAgentRound,
  unitAuthoringValidationRepairPrompt,
} from "./agent-round.js";

jest.mock("../llm/client.js", () => ({ getChatModel: jest.fn() }));
jest.mock("../llm/logger.js", () => ({ beginLlmRequestLog: async () => ({ finish: mockLlmLogFinish }) }));
jest.mock("../providers/llm/index.js", () => ({
  getActiveLlmOperationRoute: () => ({ operationKey: "unit.authoring_agent", provider: "minimax", model: "MiniMax-M3.1-Flash" }),
  withLlmOperationRoute: async (_operation: string, run: () => unknown) => run(),
}));
jest.mock("../llm/validated-structured-generation.js", () => ({
  runValidatedStructuredGeneration: async (input: { operation: string; schema: z.ZodType; contract?: object; invoke: (args: object) => Promise<unknown> }) => {
    const { resolveStructuredContract } = jest.requireActual("../llm/structured-contract.js");
    const { limits: { maxTokens } } = resolveStructuredContract({
      operation: input.operation, mode: "tool-call", schemas: [input.schema], metadata: input.contract,
    });
    try { return input.schema.parse(await input.invoke({ attempt: 0, maxTokens })); }
    catch (error) { return input.schema.parse(await input.invoke({ attempt: 1, maxTokens, validationError: String(error) })); }
  },
}));

const catalog = [
  { name: "commit_component_selection", description: "Commit the palette", schema: z.object({ ok: z.boolean() }) },
  { name: "commit_survey", description: "Commit Survey", schema: compactSurveyPreviewBindingSchema },
];

it("keeps the long path budget for generation and repair while rejecting a modules-only commit", async () => {
  const journey = {
    modules: [{ title: "Build the loop", summary: "Implement and verify the loop.",
      objective: "Run a bounded tool loop.", dependsOnPrevious: "Basic programming." }],
    learningPath: learningPathFixture(1),
  };
  let attempt = 0;
  const stream = jest.fn().mockImplementation(async function* () {
    const args = attempt++ === 0 ? { modules: journey.modules } : journey;
    yield new AIMessageChunk({ content: "", tool_call_chunks: [{ index: 0,
      id: `journey-${attempt}`, name: "commit_goal_journey", args: JSON.stringify(args), type: "tool_call_chunk" }] });
  });
  const getModel = jest.mocked(getChatModel);
  getModel.mockClear();
  getModel.mockResolvedValue({ bindTools: () => ({ stream }) } as never);
  const round = await runUnitAuthoringAgentRound({ transcript: [], prompt: "Plan every lesson.",
    expectedTool: "commit_goal_journey", resultSchema: goalCurriculumJourneyBindingSchema,
    toolCatalog: [{ name: "commit_goal_journey", description: "Commit the complete path.", schema: goalCurriculumJourneyBindingSchema }],
    contract: { sizeProfile: "long" } });
  expect(getModel).toHaveBeenCalledTimes(2);
  for (const [options] of getModel.mock.calls) expect(options).toMatchObject({ maxTokens: 65_536 });
  expect(round.repairMessages[2]!.content).toContain("learningPath");
  expect(round.result.learningPath).toEqual(journey.learningPath);
});

it("keeps MiniMax tool bytes and append-only message prefixes stable across path parts", async () => {
  const path = learningPathFixture();
  const registry = { entities: path.entities, baseline: path.baseline, goal: path.goal,
    moduleTargets: path.modules.map(({ moduleRef, provides }) => ({ moduleRef, provides })) };
  const summaries = path.modules.map((_, i) => ({ title: `Module ${i + 1}`, summary: "Learn an operation.",
    objective: "Apply the operation.", dependsOnPrevious: "The earlier operation." }));
  const proposals = [{ part: "outline", modules: summaries }, { part: "registry", registry },
    { part: "module", entities: [], module: path.modules[0] }];
  const schemas = [goalPathOutlineCommitSchema, registryCommitSchema(3, 3),
    moduleCommitSchema({ registry, entities: path.entities, previous: [], moduleCount: 3, outcomeCount: 3 })];
  let index = 0;
  const stream = jest.fn().mockImplementation(async function* () {
    const turn = index++;
    yield new AIMessageChunk({ content: "", tool_call_chunks: [{ index: 0,
      id: `part-${turn}`, name: "commit_goal_path_part", args: JSON.stringify(proposals[turn]), type: "tool_call_chunk" }] });
  });
  const bindTools = jest.fn(() => ({ stream }));
  const getModel = jest.mocked(getChatModel);
  getModel.mockClear();
  getModel.mockResolvedValue({ bindTools } as never);
  const toolCatalog = [{ name: "commit_goal_path_part", description: "Commit the requested part.", schema: goalPathPartBindingSchema }];
  let transcript: LlmMessageRecord[] = [{ role: "system", content: "Stable source and policy prefix." }];
  for (let turn = 0; turn < schemas.length; turn++) {
    const round = await runUnitAuthoringAgentRound({ transcript, prompt: `Current part ${turn + 1}.`,
      expectedTool: "commit_goal_path_part", toolCatalog, resultSchema: schemas[turn] as z.ZodType });
    transcript = [...transcript, round.userMessage, round.assistantMessage, round.toolMessage];
  }
  expect(bindTools.mock.calls[1]).toEqual(bindTools.mock.calls[0]);
  expect(bindTools.mock.calls[2]).toEqual(bindTools.mock.calls[0]);
  const first = stream.mock.calls[0]![0];
  const second = stream.mock.calls[1]![0];
  const third = stream.mock.calls[2]![0];
  const wire = (messages: Array<{ toDict(): unknown }>) => messages.map((message) => message.toDict());
  expect(wire(second.slice(0, first.length))).toEqual(wire(first));
  expect(wire(third.slice(0, second.length))).toEqual(wire(second));
  for (const [options] of getModel.mock.calls) expect(options).toMatchObject({ maxTokens: 16_384 });
});

it("forces the current MiniMax commit and excludes unrelated stage schemas", () => {
  const binding = resolveUnitAuthoringToolBinding("minimax", "commit_survey", catalog, { model: "MiniMax-M3.1-Flash" });
  expect(binding.toolChoice).toEqual({ type: "function", function: { name: "commit_survey" } });
  expect(binding.toolCatalog.map(tool => tool.name)).toEqual(["commit_survey"]);
  const wire = langChainTools(binding.toolCatalog)[0]!.function.parameters as { properties: { items: { description: string } } };
  expect(wire.properties.items.description).toContain("At most 8");
  expect(resolveUnitAuthoringToolBinding("deepseek", "commit_survey", catalog).toolChoice).toBe("required");
});

it.each([10, 11])("reports the actual %s-outline failure and asks for coverage-preserving merging", count => {
  const items = [...Array.from({ length: count }, (_, index) => ({ kind: "outline", text: `Topic ${index + 1}` })),
    { kind: "question", question: { text: "How do these topics connect?", learningTargetIds: [] } }];
  const result = surveyAuthoringItemsSchemaFor("micro").safeParse(items);
  expect(result.success).toBe(false);
  if (result.success) throw Error("Over-limit Survey was accepted");
  expect(result.error.issues[0]!.message).toContain(`received ${count}`);
  const repair = unitAuthoringValidationRepairPrompt("commit_survey", result.error.message);
  expect(repair).toContain("at most 8 outline items");
  expect(repair).toContain("preserving all required topic coverage");
});

it("keeps a rejected text response in repair history while still requiring a real commit call", async () => {
  const plain = '{"ok":true}';
  let attempt = 0;
  const stream = jest.fn().mockImplementation(async function* () {
    if (attempt++ === 0) yield new AIMessageChunk({ content: plain });
    else yield new AIMessageChunk({ content: "", tool_call_chunks: [{ index: 0, id: "fixture-call", name: "commit_component_selection", args: plain, type: "tool_call_chunk" }] });
  });
  const bindTools = jest.fn(() => ({ stream }));
  jest.mocked(getChatModel).mockResolvedValue({ bindTools } as never);
  const round = await runUnitAuthoringAgentRound({ transcript: [], prompt: "Return one JSON object.",
    expectedTool: "commit_component_selection", toolCatalog: catalog, resultSchema: z.object({ ok: z.boolean() }) });
  expect(round.result).toEqual({ ok: true });
  expect(stream).toHaveBeenCalledTimes(2);
  expect(bindTools.mock.calls[0]![1]).toMatchObject({
    tool_choice: { type: "function", function: { name: "commit_component_selection" } }, parallel_tool_calls: false,
  });
  const firstMessages = stream.mock.calls[0]![0];
  expect(firstMessages.at(-1).content).toContain("Any instruction above to return JSON describes this function's arguments");
  const repairMessages = stream.mock.calls[1]![0];
  expect(repairMessages.some((message: { content: string }) => message.content === plain)).toBe(true);
  expect(repairMessages.some((message: { _getType(): string }) => message._getType() === "tool")).toBe(false);
  expect(round.repairMessages.map(message => message.role)).toEqual(["user", "assistant", "user"]);
  expect(round.assistantMessage.toolCalls).toHaveLength(1);
});

it("repairs invalid MiniMax display values using concrete document errors and the rejected tool turn", async () => {
  const manifests: DisplayPluginManifest[] = [{apiVersion: 1, id: "general", version: "1.0.0", execution: "trusted",
    components: [{kind: "general:text", version: 1}]}];
  const valid = {topicId: "energy", display: {type: "display", id: "energy", title: "Energy transfer", document: {
    version: 1, id: "energy", plugins: [{id: "general", version: "1.0.0"}],
    root: {id: "energy", kind: "general:text", version: 1, payload: {text: "Energy passes between objects."}, children: []},
  }}, cues: [{text: "Energy passes from one object to another.", targetIds: ["energy"]}]};
  const invalid = structuredClone(valid);
  Object.assign(invalid.display.document.root, {version: "invalid", children: {item: []}});
  let attempt = 0;
  const stream = jest.fn().mockImplementation(async function* () {
    const candidate = attempt++ === 0 ? invalid : valid;
    yield new AIMessageChunk({content: "", tool_call_chunks: [{index: 0, id: `display-${attempt}`,
      name: "commit_topic_material", args: JSON.stringify(candidate), type: "tool_call_chunk"}]});
  });
  jest.mocked(getChatModel).mockResolvedValue({bindTools: () => ({stream})} as never);
  const round = await runUnitAuthoringAgentRound({transcript: [], prompt: "Teach energy transfer.",
    expectedTool: "commit_topic_material", toolCatalog: [createDisplayTopicTool(manifests, false)],
    resultSchema: createDisplayTopicSchema(createTopicMaterialCommitSchema({allowedTopicIds: ["energy"], expectedTopicId: "energy"}), manifests, "energy")});
  expect(stream).toHaveBeenCalledTimes(2);
  expect(round.result.display).toEqual(valid.display);
  const messages = stream.mock.calls[1]![0];
  const rejection = messages.find((message: {_getType(): string}) => message._getType() === "tool");
  expect(rejection.content).toContain("display.document.root.version");
  expect(rejection.content).toContain("expected number");
  expect(round.repairMessages.map(message => message.role)).toEqual(["user", "assistant", "tool"]);
  expect(round.repairMessages[1]!.toolCalls?.[0]!.args.display.document.root.version).toBe("invalid");
});

it("accepts MiniMax transport wrappers once and persists canonical display and payload arrays for resume", async () => {
  const tool = createDisplayTopicTool(builtinDisplayManifests, false);
  const document = {version: 1, id: "board", plugins: [{id: "org.xuelearn.display.general", version: "1.0.0"}],
    root: {id: "board", kind: "general:composition", version: "1", payload: {layout: "column", columns: "1"}, children: {item: {
      id: "compare", kind: "general:compare", version: "1", payload: {
        left: {id: "left", label: "A", points: {item: {id: "p1", text: "Keep {item: ...} as literal prose."}}},
        right: {id: "right", label: "B", points: {item: [{id: "p2", text: "Second point."}]}},
      },
    }}}};
  const args = {topicId: "energy", display: {type: "display", id: "board", title: "Energy transfer", document: {$text: JSON.stringify(document)}},
    cues: [{text: "Energy passes from one object to another.", targetIds: ["board"]}]};
  const stream = jest.fn().mockImplementation(async function* () {
    yield new AIMessageChunk({content: "", tool_call_chunks: [{index: 0, id: "wrapped-display", name: tool.name,
      args: JSON.stringify(args), type: "tool_call_chunk"}]});
  });
  jest.mocked(getChatModel).mockResolvedValue({bindTools: () => ({stream})} as never);
  const round = await runUnitAuthoringAgentRound({transcript: [], prompt: "Teach energy transfer.", expectedTool: tool.name,
    toolCatalog: [tool], resultSchema: createDisplayTopicSchema(createTopicMaterialCommitSchema({allowedTopicIds: ["energy"], expectedTopicId: "energy"}), builtinDisplayManifests, "energy")});
  expect(stream).toHaveBeenCalledTimes(1);
  expect(round.repairMessages).toEqual([]);
  const accepted = round.assistantMessage.toolCalls![0]!.args as any;
  expect(accepted.display.document.root.version).toBe(1);
  expect(accepted.display.document.root.payload.columns).toBe(1);
  expect(accepted.display.document.plugins[0].version).toBe("1.0.0");
  expect(accepted.display.document.root.children[0].payload.left.points).toEqual([{id: "p1", text: "Keep {item: ...} as literal prose."}]);
  expect(topicMaterialCommitBindingSchema.parse(accepted).display).toEqual(round.result.display);
  expect(args.display.document).toHaveProperty("$text");
});

it("logs native tool-call token usage and TPS from the final usage-only chunk", async () => {
  const clock = jest.spyOn(Date, "now");
  let now = 1000;
  clock.mockImplementation(() => now += 500);
  mockLlmLogFinish.mockClear();
  const stream = jest.fn().mockImplementation(async function* () {
    yield new AIMessageChunk({content: "", tool_call_chunks: [{index: 0, id: "usage-call", name: "commit_component_selection",
      args: '{"ok":true}', type: "tool_call_chunk"}]});
    yield new AIMessageChunk({content: "", usage_metadata: {input_tokens: 120, output_tokens: 30, total_tokens: 150}});
  });
  jest.mocked(getChatModel).mockResolvedValue({bindTools: () => ({stream})} as never);
  try {
    const round = await runUnitAuthoringAgentRound({transcript: [], prompt: "Usage probe", expectedTool: "commit_component_selection",
      toolCatalog: catalog, resultSchema: z.object({ok: z.boolean()})});
    expect(round.result).toEqual({ok: true});
    expect(mockLlmLogFinish).toHaveBeenCalledWith(expect.objectContaining({status: "success", response: expect.objectContaining({
      usage: expect.objectContaining({input_tokens: 120, output_tokens: 30, total_tokens: 150}), outputTps: expect.any(Number),
    })}));
  } finally { clock.mockRestore(); }
});
