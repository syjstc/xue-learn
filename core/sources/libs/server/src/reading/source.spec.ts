import {readingReferenceText, readingSourceFromCourse} from "./source.js";
import {readingDerivationToTeaching} from "../../../teaching-derivation/src/reading.js";

it("reads source content while Display is pending and preserves the original payload", () => {
  const material = {introduction: "Read this now.", blocks: [
    {type: "paragraph", text: "Keep this explanation."},
    {type: "svg", svg: '<svg viewBox="0 0 10 10"></svg>', caption: "Accepted picture"},
    {type: "display", document: {root: {kind: "general:text", payload: {text: "Accepted Display text"}},
      timeline: [{text: "Do not copy this narration"}], derived: {text: "Do not copy compiled caches"}}},
  ]};
  const teaching = readingDerivationToTeaching({title: "Solve", premises: [{id: "p1", text: "$a\\ne0$"}],
    steps: [{id: "s1", result: "x=b/a", reason: "Divide both sides", dependsOn: ["p1"]}]}, {id: "saved", locale: "en"});
  const formal = {legacy: true};
  const source = readingSourceFromCourse({
    source: {unitId: "unit", goalId: "goal"} as never,
    metadata: {title: "Equations", scope: "Solve linear equations", contentLanguage: "en"} as never,
    sections: [{id: "section", title: "Solve", scope: "Linear equations", material, generationStatus: "running",
      teachingDerivationDocument: teaching, derivationDocument: formal} as never], legacyMaterial: null,
  });
  expect(source.sections[0]).not.toHaveProperty("legacy");
  expect(material.introduction).toBe("Read this now.");
  expect(source.sections[0].reference).toContain("Accepted Display text");
  expect(source.sections[0].reference).not.toContain("Do not copy");
  expect(Object.values(source.sections[0].artifacts!)).toEqual(expect.arrayContaining([
    expect.objectContaining({type: "derivation"}), expect.objectContaining({type: "svg"}),
  ]));
  expect(readingReferenceText(material)).not.toContain("<svg");
});
