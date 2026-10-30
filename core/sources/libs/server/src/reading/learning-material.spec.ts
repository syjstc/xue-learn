import {configureReadingContext} from "./context.js";
import {readyReadingMaterial} from "./learning-material.js";

afterEach(() => configureReadingContext(undefined));

it("provides ready reading prose to the shared flow without turning self-checks into assessment evidence", async () => {
  const read = jest.fn(async () => JSON.stringify({blocks: [
    {id: "b1", type: "heading", text: "Linear equations"},
    {id: "b2", type: "paragraph", text: "Apply the same operation on both sides."},
    {id: "b3", type: "check", question: "Local practice", options: ["1", "2"], correctIndex: 1},
    {id: "b4", type: "component_slot", componentType: "derivation", title: "Worked solution",
      content: {type: "derivation", document: {steps: [{id: "s1", result: "x=2", reason: "Divide by 2", dependsOn: ["p1"]}]}}},
  ]}));
  configureReadingContext(read);
  const material = await readyReadingMaterial("owner", "unit", "chapter");
  expect(read).toHaveBeenCalledWith("owner", "unit", "chapter");
  expect(material?.blocks.map(block => block.type)).toEqual(["heading", "paragraph", "paragraph"]);
  expect(JSON.stringify(material)).toContain("x=2");
  expect(JSON.stringify(material)).toContain("Divide by 2");
  expect(JSON.stringify(material)).not.toContain("Local practice");
  expect(JSON.stringify(material)).not.toContain("p1");
});

it.each([null, "{", "{}", '{"blocks":[]}', '{"blocks":[{"type":"check","question":"Practice only"}]}'])(
  "does not unlock learning when ready teaching content is unavailable: %s", async context => {
    configureReadingContext(async () => context);
    expect(await readyReadingMaterial("owner", "unit", "chapter")).toBeNull();
  },
);
