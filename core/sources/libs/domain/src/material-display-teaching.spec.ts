import {readDisplayTeaching} from "./material-teaching.js";
import {materialDisplayDocumentSchema} from "./material-display.js";
import {z} from "zod";

const source = {templateId: "general-flow", content: {title: "土壤通气", nodes: [
  {id: "air", label: "孔隙通气"}, {id: "root", label: "根系呼吸"},
]}};
const document = (block: unknown) => ({version: 1, id: "lesson", plugins: [],
  root: {id: "flow", kind: "general:teaching", version: 1, payload: {block}}});

it("recovers saved object labels and missing metadata without changing the source or its teaching facts", () => {
  const before = structuredClone(source);
  const normalized = readDisplayTeaching(source, "flow");
  expect(normalized).toMatchObject({type: "teaching", title: "土壤通气", templateId: "general-flow",
    content: {nodes: ["孔隙通气", "根系呼吸"], caption: "土壤通气"}});
  expect(source).toEqual(before);
  const saved = materialDisplayDocumentSchema.parse(document(source));
  expect(saved.root.payload).toEqual({block: normalized, teachingOverviewFallback: true});
  expect(materialDisplayDocumentSchema.parse(saved)).toEqual(saved);
});

it("rejects malformed new template facts before a course can publish a crashing display", () => {
  expect(materialDisplayDocumentSchema.safeParse(document({templateId: "general-flow", content: {nodes: [{id: "missing"}]}})).success).toBe(false);
});

it("keeps the recursive display schema exportable for model tool bindings", () => {
  const binding = z.toJSONSchema(materialDisplayDocumentSchema);
  expect(binding.type).toBe("object");
  expect(binding.properties).toHaveProperty("root");
  expect(materialDisplayDocumentSchema.parse(document(source)).root.payload).toHaveProperty("teachingOverviewFallback", true);
});

it("retains valid layer facts while removing obsolete presentation-only fields", () => {
  expect(readDisplayTeaching({templateId: "general-layers", content: {title: "土层", layers: [
    {id: "surface", title: "表层", detail: "吸收根较多"}, {id: "deep", title: "深层", detail: "根较少"},
  ]}}, "layers")).toMatchObject({content: {layers: [{title: "表层", detail: "吸收根较多"}, {title: "深层", detail: "根较少"}]}});
});
