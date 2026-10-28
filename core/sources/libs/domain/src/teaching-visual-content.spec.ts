import {z} from "zod";
import {materialTeachingSchema, materialTeachingAuthoringSchema, materialTeachingBindingSchema, materialTeachingSteps, materialTeachingCueIssues} from "./material-teaching.js";
import {sampleMaterialTeachingTimeline} from "./material-teaching-motion.js";
import {VISUAL_EXAMPLES, VISUAL_STRESS_EXAMPLES} from "./fixtures/teaching-visual.js";
import {VISUAL_TEACHING_IDS} from "./teaching-visual-content.js";
import contract from "../../../contracts/schemas/learning-material.json";

const block = (id: typeof VISUAL_TEACHING_IDS[number], variant = 0) => materialTeachingSchema.parse({
  ...VISUAL_EXAMPLES[id][variant], type: "teaching", version: 1, id: "evidence", title: "观察真实关系",
});
test.each(VISUAL_TEACHING_IDS)("%s has two valid data sets, addressable operations and deterministic narrated holds", id => {
  expect(materialTeachingSchema.safeParse({...VISUAL_STRESS_EXAMPLES[id],type:"teaching",version:1,id:"stress",title:"最大容量"}).success).toBe(true);
  for (const variant of [0, 1]) {
    const display = block(id, variant), steps = materialTeachingSteps(display);
    expect(materialTeachingAuthoringSchema.parse(display)).toEqual(display);
    const intervals = steps.flatMap((step, i) => [
      {targetIds: [step.id], startTick: i * 192000, durationTicks: 96000},
      {targetIds: [step.id], startTick: i * 192000 + 96000, durationTicks: 96000},
    ]);
    expect(materialTeachingCueIssues(display, intervals)).toEqual([]);
    expect(materialTeachingCueIssues(display, intervals.filter(x => x.targetIds[0] !== steps[1]!.id)).length).toBeGreaterThan(0);
    const at = (tick: number) => sampleMaterialTeachingTimeline(display, intervals, tick);
    expect(at(96000).items[0]?.reveal).toBe(1);
    expect(at(96000).items[1]?.reveal).toBe(0);
    expect(at(96000).frame).toEqual(at(191999).frame);
    const sample = at(210000); at(900000);
    expect(at(210000)).toEqual(sample);
    expect(at(210000).stepId).toEqual(steps[1]?.id);
  }
});

test("semantic checks reject misleading numeric diagrams and broken network identities", () => {
  const invalid: unknown[] = [
    {...block("visual-funnel"),content:{unit:"人",stages:[{label:"起点",value:0},{label:"终点",value:2}]}},
    {...block("visual-timeline"),content:{unit:"年",events:[{at:2,label:"甲",detail:"甲"},{at:1,label:"乙",detail:"乙"}]}},
    {...block("visual-matrix"),content:{columns:["甲","乙"],rows:[{label:"一",values:[1,2]},{label:"二",values:[3,4,5]}],max:3,unit:""}},
    {...block("visual-interval"),content:{label:"区间",unit:"",min:0,max:10,low:2,high:8,points:[{label:"越界",value:11}]}},
    {...block("visual-counter"),content:{label:"变化",unit:"",from:1,to:1,context:"没有变化"}},
    {...block("visual-network"),content:{nodes:[{id:"a",label:"甲"},{id:"b",label:"乙"},{id:"c",label:"丙"}],links:[{from:"a",to:"missing",label:"引用缺失"},{from:"a",to:"a",label:"自指"}]}},
  ];
  for (const input of invalid) expect(materialTeachingSchema.safeParse(input).success).toBe(false);
  for (const extra of [{html:"<script/>"},{x:5},{seconds:2},{src:"https://example.org"}])
    expect(materialTeachingSchema.safeParse({...block("visual-cycle"),...extra}).success).toBe(false);
});

test("source contract contains the exact new strict schemas used by course generation", () => {
  for (const id of VISUAL_TEACHING_IDS) {
    const schema = z.toJSONSchema(materialTeachingBindingSchema.options.find(option => option.shape.templateId.value === id)!, {target:"draft-7"});
    delete schema.$schema;
    const raw = contract.$defs.MaterialTeaching.oneOf.find(item => item.properties.templateId.const === id);
    expect(raw).toBeDefined();
    expect(raw).toEqual(schema);
    expect(raw!.additionalProperties).toBe(false);
    expect(Object.keys(raw!.properties)).toEqual(expect.arrayContaining(["type","version","id","title","templateId","content"]));
    expect(JSON.stringify(raw)).not.toMatch(/"(?:seconds|frame|src|html)"/);
  }
});
