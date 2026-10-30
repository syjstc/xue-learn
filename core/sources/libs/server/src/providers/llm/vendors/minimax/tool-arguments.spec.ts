import {normalizeMinimaxToolValue} from "./tool-arguments.js";

const schema = {type: "object", properties: {id: {type: "string"}, version: {type: "integer"},
  enabled: {type: "boolean"}, children: {type: "array", items: {$ref: "#/$defs/node"}}, payload: {}},
  $defs: {node: {type: "object", properties: {id: {type: "string"}, version: {type: "integer"}, children: {type: "array", items: {$ref: "#/$defs/node"}}}}}};

test("decodes singleton and repeated XML items recursively without coercing IDs, text, or opaque payloads", () => {
  const value = {id: "001", version: "1", enabled: "false", payload: {item: "literal", version: "2"},
    children: {item: [{id: "child", version: "1", children: {item: {id: "grandchild", version: "2"}}}]}};
  const original = structuredClone(value);
  expect(normalizeMinimaxToolValue(value, schema)).toEqual({id: "001", version: 1, enabled: false, payload: value.payload,
    children: [{id: "child", version: 1, children: [{id: "grandchild", version: 2}]}]});
  expect(value).toEqual(original);
});

test("decodes JSON in a sole $text wrapper only for a declared container", () => {
  const value = {id: "root", version: 1};
  expect(normalizeMinimaxToolValue({$text: JSON.stringify(value)}, schema)).toEqual(value);
  expect(normalizeMinimaxToolValue({$text: "literal"}, {type: "string"})).toEqual({$text: "literal"});
  expect(normalizeMinimaxToolValue({$text: JSON.stringify(value), extra: true}, schema)).toEqual({$text: JSON.stringify(value), extra: true});
});

test.each(["NaN", "Infinity", "1 trailing", "9007199254740993", "1.5"])("leaves invalid integer %s for strict validation", version => {
  expect(normalizeMinimaxToolValue({version}, schema)).toEqual({version});
});

test("keeps missing fields, unknown wrapper keys, nulls and invalid JSON for repair", () => {
  const value = {children: {item: null, extra: true}, payload: {item: []}};
  expect(normalizeMinimaxToolValue(value, schema)).toEqual(value);
  expect(normalizeMinimaxToolValue({$text: "{partial"}, schema)).toEqual({$text: "{partial"});
});

test("preserves numeric prose when a string is already allowed by a union", () => {
  expect(normalizeMinimaxToolValue("1", {anyOf: [{type: "number"}, {type: "string"}]})).toBe("1");
  expect(normalizeMinimaxToolValue("1", {type: ["number", "string"]})).toBe("1");
});
