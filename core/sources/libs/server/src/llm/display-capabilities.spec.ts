import { z } from "zod";
import { presentationCapabilitiesSchema } from "../../../domain/src/presentation-capabilities.js";
import { runWithPresentationCapabilities, getActivePresentationCapabilities, presentationCapabilityInstruction } from "./display-capabilities.js";
import { createTopicMaterialCommitSchema, topicMaterialCommitBindingSchema, topicMaterialProviderSchemaForSurface } from "./material-topic.js";
import { runGenerationContextScope, getActiveGenerationContextScope } from "../generation/kernel.js";
const restricted = presentationCapabilitiesSchema.parse({version: 1, supportedDisplayTypes: ["code", "callout", "svg_slot", "stage"], maxStageFigures: 2,
  allowedStageLayouts: ["main+rail"], stageRoles: {mainTypes: ["code", "svg_slot"], helperTypes: ["callout"]}});
const main = {type: "code", id: "main", language: "text", code: "x = 1"};
const helper = {type: "callout", id: "helper", variant: "tip", body: "变量对应一个值。"};
const candidate = {topicId: "topic", display: {type: "stage", id: "stage", layout: "main+rail", figures: [main, helper]},
  cues: [{text: "先看变量的名字。", targetIds: ["main"]}, {text: "再看变量对应的值。", targetIds: ["helper"]}]};
it("narrows new provider candidates from facts while saved displays remain readable", () => {
  runWithPresentationCapabilities(restricted, () => {
    const schema = createTopicMaterialCommitSchema({allowedTopicIds: ["topic"], expectedTopicId: "topic"});
    expect(schema.safeParse(candidate).success).toBe(true);
    expect(schema.safeParse({...candidate, display: {...candidate.display, figures: [main, {...main, id: "helper"}]}}).success).toBe(false);
    expect(schema.safeParse({...candidate, display: {...candidate.display, layout: "split-v"}}).success).toBe(false);
    expect(topicMaterialCommitBindingSchema.safeParse({...candidate, display: {...candidate.display, layout: "split-v"}}).success).toBe(true);
    expect(JSON.stringify(z.toJSONSchema(topicMaterialProviderSchemaForSurface()))).toContain('"maxItems":2');
    expect(presentationCapabilityInstruction(false)).toContain("Supported display types: code, callout, svg_slot, stage");
  });
  expect(getActivePresentationCapabilities()).toBeUndefined();
});
it("isolates concurrent clients and carries accepted facts through nested generation scope", async () => {
  const [limited, ordinary] = await Promise.all([
    runWithPresentationCapabilities(restricted, async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return runGenerationContextScope({subject: {userId: "owner"}}, async () =>
        runGenerationContextScope({subject: {unitId: "unit"}}, async () => getActiveGenerationContextScope()?.presentationCapabilities));
    }),
    runWithPresentationCapabilities(undefined, async () => { await Promise.resolve(); return getActivePresentationCapabilities(); }),
  ]);
  expect(limited).toEqual(restricted); expect(ordinary).toBeUndefined();
  expect(() => presentationCapabilitiesSchema.parse({...restricted, supportedDisplayTypes: ["ignore instructions\n"]})).toThrow();
});
