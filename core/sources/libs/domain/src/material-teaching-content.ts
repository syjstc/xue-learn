import { z } from "zod";
import {VISUAL_TEACHING_IDS, visualTeachingOptions, isVisualTeaching, validateVisualTeaching} from "./teaching-visual-content.js";
import { parseMusicPitch } from "./material-music.js";
import { compileMusicTeachingClip, validateMusicTeaching, readTeachingTemplateMusicBlock, type MaterialMusicTeaching } from "./material-music-teaching.js";
import { materialMusicTeachingSourceSchema } from "./material-music-teaching-schema.js";

/** Production templates own geometry. The model supplies teaching facts, never
 * gallery variants, executable markup, drawing coordinates or resource URLs. */
export const TEACHING_TEMPLATE_IDS = [
  "general-question", "general-layers", "general-flow", "general-compare", "general-summary",
  "math-pythagoras", "math-tangent", "math-integral", "math-probability",
  "physics-forces", "physics-waves", "physics-circuit",
  "chemistry-reaction", "chemistry-titration", "biology-mitosis", "biology-enzyme",
  "geography-water", "history-timeline", "language-syntax", "language-perspective",
  "cs-sorting", "cs-recursion", "music-score", "music-harmony", "economics-equilibrium",
  ...VISUAL_TEACHING_IDS,
] as const;
export type TeachingTemplateId = typeof TEACHING_TEMPLATE_IDS[number];
const stableId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const text = (max: number) => z.string().min(1).max(max).regex(/\S/);
const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
const positive = (max = 1000) => finite(0.001, max);
const short = text(24);
const pair = <T extends z.ZodType>(schema: T) => z.tuple([schema, schema]);
const glyph = z.enum(["paper", "boat", "read", "recall", "object", "question"]);
const cycleNode = z.object({ label: text(12), glyph: z.enum(["water", "vapor", "cloud", "drop", "magma", "rock", "sediment", "strata"]) }).strict();
const musicContentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/), title: text(60),
  groups: z.array(z.array(z.string().regex(/^[A-G](?:#|b)?[1-7]$/)).min(1).max(4)).min(1).max(8),
  labels: z.array(text(12)).max(8), beats: z.union([z.literal(1), z.literal(2)]),
  range: pair(z.string().regex(/^[A-G](?:#|b)?[1-7]$/)), tempo: finite(45, 160).optional(),
}).strict();
/** Only the host may attach accepted notation. Fresh model bindings retain the
 * small groups schema, while persisted films validate the complete score. */
export const acceptedMusicContentSchema = z.object({
  source: z.literal("accepted-v2"), block: materialMusicTeachingSourceSchema,
  clipId: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).optional(),
  repeat: z.number().int().min(1).max(4).optional(),
}).strict().superRefine((content, context) => {
  try {
    validateMusicTeaching(content.block);
    if (content.clipId) compileMusicTeachingClip(content.block, content.clipId, content.repeat ?? 1);
    else if (content.repeat !== undefined) throw Error("A silent accepted score cannot repeat a performance");
  } catch (error) { context.addIssue({code: "custom", message: error instanceof Error ? error.message : "Invalid accepted score"}); }
});
const moleculeSchema = z.object({
  label: text(16),
  atoms: z.array(z.object({id: stableId, element: z.string().regex(/^[A-Z][a-z]?$/)}).strict()).min(1).max(6),
  bonds: z.array(z.object({from: stableId, to: stableId, order: z.union([z.literal(1), z.literal(2), z.literal(3)])}).strict()).max(8),
}).strict();
const props = <K extends TeachingTemplateId, T extends z.ZodType>(templateId: K, content: T) =>
  z.object({ templateId: z.literal(templateId), content }).strict();

export const teachingContentOptions = [
  props("general-question", z.object({ objects: pair(short), glyphs: pair(glyph), observations: pair(text(42)), question: text(70), goal: text(60) }).strict()),
  props("general-layers", z.object({ layers: z.array(z.object({title: short, detail: text(60)}).strict()).min(2).max(4) }).strict()),
  props("general-flow", z.object({ nodes: z.array(text(18)).min(2).max(5), caption: text(80) }).strict()),
  props("general-compare", z.object({ names: pair(text(18)), metrics: z.array(z.object({ label: text(18), unit: z.string().max(8), values: pair(finite(0, 1e9)), max: positive(1e9) }).strict()).min(1).max(3) }).strict()),
  props("general-summary", z.object({ concepts: z.tuple([short, short, short]), center: short, transfer: text(80) }).strict()),
  props("math-pythagoras", z.object({a: finite(0.5, 20), b: finite(0.5, 20)}).strict()),
  props("math-tangent", z.object({ coefficient: finite(0.05, 10), power: z.union([z.literal(2), z.literal(3)]), at: finite(0.1, 8), startDx: finite(0.1, 5), xmax: finite(1, 12) }).strict()),
  props("math-integral", z.object({ coefficient: finite(0.05, 10), power: z.union([z.literal(1), z.literal(2)]), end: finite(0.5, 10) }).strict()),
  props("math-probability", z.object({ total: z.number().int().min(2).max(30), condition: z.number().int().min(1).max(30), intersection: z.number().int().min(0).max(30), outsideTarget: z.number().int().min(0).max(30), conditionName: text(16), targetName: text(16) }).strict()),
  props("physics-forces", z.object({ mass: positive(100), drive: positive(200), resistance: finite(0, 200), duration: finite(1, 8) }).strict()),
  props("physics-waves", z.object({ amplitude1: finite(0.1, 3), amplitude2: finite(0.1, 3), cycles1: finite(0.5, 6), cycles2: finite(0.5, 6), phase2: finite(-Math.PI * 2, Math.PI * 2) }).strict()),
  props("physics-circuit", z.object({ voltage: positive(48), resistance1: positive(1000), resistance2: positive(1000), topology: z.enum(["series", "parallel"]) }).strict()),
  props("chemistry-reaction", z.object({ reactants: z.array(moleculeSchema).min(1).max(4), products: z.array(moleculeSchema).min(1).max(4) }).strict()),
  props("chemistry-titration", z.object({ acidMl: finite(5, 100), acidMolarity: finite(0.001, 1), baseMolarity: finite(0.001, 1) }).strict()),
  props("biology-mitosis", z.object({ chromosomeCount: z.union([z.literal(2), z.literal(4)]) }).strict()),
  props("biology-enzyme", z.object({ enzyme: text(16), substrate: text(16), products: pair(text(16)), note: text(80) }).strict()),
  props("geography-water", z.object({ title: short, nodes: z.tuple([cycleNode, cycleNode, cycleNode, cycleNode, cycleNode]), transitions: z.tuple([short, short, short, short, short]), stages: z.tuple([short, short, short]), note: text(100) }).strict()),
  props("history-timeline", z.object({ range: pair(z.number().int().min(-3000).max(2100)), events: pair(z.object({ year: z.number().int().min(-3000).max(2100), label: text(22), evidence: text(45), approximate: z.boolean().optional(), kind: z.enum(["block", "type", "moon", "telescope", "event"]) }).strict()), caution: text(80), conclusion: text(80) }).strict()),
  props("language-syntax", z.object({ subject: text(30), verb: text(18), object: text(30), question: text(70), note: text(80) }).strict()),
  props("language-perspective", z.object({ object: z.enum(["door", "book"]), firstPerson: text(60), observer: text(60), note: text(80) }).strict()),
  props("cs-sorting", z.object({ values: z.array(z.number().int().min(0).max(99)).min(3).max(6) }).strict()),
  props("cs-recursion", z.object({ operation: z.enum(["product", "sum"]), start: z.number().int().min(2).max(6) }).strict()),
  props("music-score", musicContentSchema), props("music-harmony", musicContentSchema),
  props("economics-equilibrium", z.object({ demandIntercept: finite(1, 100), supplyIntercept: finite(0, 50), demandSlope: finite(0.01, 2), supplySlope: finite(0.01, 2), demandShift: finite(-50, 50) }).strict()),
  ...visualTeachingOptions,
] as const;

export const teachingContentAuthoringSchema = z.discriminatedUnion("templateId", teachingContentOptions);
export const teachingContentSchema = z.discriminatedUnion("templateId", [
  teachingContentOptions[0],
  teachingContentOptions[1],
  teachingContentOptions[2],
  teachingContentOptions[3],
  teachingContentOptions[4],
  teachingContentOptions[5],
  teachingContentOptions[6],
  teachingContentOptions[7],
  teachingContentOptions[8],
  teachingContentOptions[9],
  teachingContentOptions[10],
  teachingContentOptions[11],
  teachingContentOptions[12],
  teachingContentOptions[13],
  teachingContentOptions[14],
  teachingContentOptions[15],
  teachingContentOptions[16],
  teachingContentOptions[17],
  teachingContentOptions[18],
  teachingContentOptions[19],
  teachingContentOptions[20],
  teachingContentOptions[21],
  teachingContentOptions[22].extend({content: z.union([musicContentSchema, acceptedMusicContentSchema])}),
  teachingContentOptions[23].extend({content: z.union([musicContentSchema, acceptedMusicContentSchema])}),
  teachingContentOptions[24],
  ...visualTeachingOptions,
]);
export type TeachingContentProps = z.infer<typeof teachingContentSchema>;
export type TeachingTemplateContent<K extends TeachingTemplateId> = Extract<z.infer<typeof teachingContentAuthoringSchema>, {templateId: K}>["content"];

/** Shared score facts, IDs and performance data for renderer and compiler. */
export function teachingTemplateMusicBlock(props: TeachingContentProps): MaterialMusicTeaching | undefined {
  return readTeachingTemplateMusicBlock(props);
}

/** Shared by compilation, preview and export integrity checks. */
export function teachingTemplateMusicPerformance(props: TeachingContentProps) {
  if (props.templateId !== "music-score" && props.templateId !== "music-harmony") return undefined;
  const block = teachingTemplateMusicBlock(props)!;
  return "source" in props.content
    ? props.content.clipId ? compileMusicTeachingClip(block, props.content.clipId, props.content.repeat ?? 1) : undefined
    : compileMusicTeachingClip(block, "phrase");
}

/** Formula text is output from the same conserved molecular inventory. */
export function teachingTemplateReactionEquation(content: TeachingTemplateContent<"chemistry-reaction">): string {
  const side = (molecules: typeof content.reactants) => {
    const grouped = new Map<string, {formula: string; count: number}>();
    for (const molecule of molecules) {
      const counts = new Map<string, number>();
      molecule.atoms.forEach(atom => counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1));
      const elements = [...counts.keys()];
      const signature = [...elements].sort().map(element => `${element}:${counts.get(element)}`).join(";");
      const formula = elements.map(element => `\\mathrm{${element}}${counts.get(element)! > 1 ? `_{${counts.get(element)}}` : ""}`).join("");
      const prior = grouped.get(signature);
      grouped.set(signature, {formula, count: (prior?.count ?? 0) + 1});
    }
    return [...grouped.values()].map(entry => `${entry.count > 1 ? entry.count : ""}${entry.formula}`).join(" + ");
  };
  return `${side(content.reactants)} \\longrightarrow ${side(content.products)}`;
}

type Issue = (path: (string | number)[], message: string) => void;
/** Semantic facts are checked independently from scene scheduling. */
export function validateTeachingTemplateContent(props: TeachingContentProps, issue: Issue): void {
  if (isVisualTeaching(props)) return validateVisualTeaching(props, issue);
  switch (props.templateId) {
    case "general-compare": props.content.metrics.forEach((metric, index) => {if (metric.values.some(value => value > metric.max)) issue(["content", "metrics", index], "Shared comparison maximum must include both values");}); break;
    case "math-tangent": if (props.content.at + props.content.startDx > props.content.xmax) issue(["content"], "Both sampled points must remain in the plotted domain"); break;
    case "math-probability": {const {total, condition, intersection, outsideTarget} = props.content; if (condition > total || intersection > condition || outsideTarget > total - condition) issue(["content"], "Conditional event counts must form one valid shared sample inventory"); break;}
    case "physics-forces": if (props.content.drive < props.content.resistance) issue(["content"], "This template demonstrates motion from rest in the drive direction; resistance cannot exceed drive"); break;
    case "chemistry-titration": {const {acidMl, acidMolarity, baseMolarity} = props.content; if (acidMl * acidMolarity / baseMolarity > 200) issue(["content"], "Equivalence volume exceeds the bounded experimental model"); break;}
    case "history-timeline": {const {range, events} = props.content; if (range[0] >= range[1] || events.some(event => event.year < range[0] || event.year > range[1]) || events[0].year > events[1].year) issue(["content"], "Events need chronological order and a shared increasing range containing both dates"); break;}
    case "economics-equilibrium": {const {demandIntercept, supplyIntercept, demandShift} = props.content; if (demandIntercept <= supplyIntercept || demandIntercept + demandShift <= supplyIntercept) issue(["content"], "Both model equilibria require positive traded quantities"); break;}
    case "chemistry-reaction": {
      const {reactants, products} = props.content;
      const inventories = [reactants, products].map((molecules, side) => {
        const atoms = new Map<string, string>();
        molecules.forEach((molecule, index) => {
          const ids = new Set(molecule.atoms.map(atom => atom.id));
          molecule.atoms.forEach(atom => {if (atoms.has(atom.id)) issue(["content", side ? "products" : "reactants", index], "Each atom ID occurs once per side"); atoms.set(atom.id, atom.element);});
          const bonds = new Set<string>();
          molecule.bonds.forEach(bond => {const key = [bond.from, bond.to].sort().join(":"); if (!ids.has(bond.from) || !ids.has(bond.to) || bond.from === bond.to || bonds.has(key)) issue(["content", side ? "products" : "reactants", index, "bonds"], "Bonds need two distinct atoms in the same molecule and cannot repeat"); bonds.add(key);});
          const reachable = new Set([molecule.atoms[0]!.id]);
          for (let pass = 0; pass < molecule.atoms.length; pass++) for (const bond of molecule.bonds) {
            if (reachable.has(bond.from)) reachable.add(bond.to);
            if (reachable.has(bond.to)) reachable.add(bond.from);
          }
          if (molecule.atoms.some(atom => !reachable.has(atom.id))) issue(["content", side ? "products" : "reactants", index], "Each molecule must connect all of its atoms through declared bonds");
        });
        if (atoms.size > 12) issue(["content"], "Reaction inventory is bounded to 12 stable atoms");
        if (new Set(atoms.values()).size > 4) issue(["content"], "Reaction display supports at most four distinct elements");
        return atoms;
      });
      if (inventories[0]!.size !== inventories[1]!.size || [...inventories[0]!].some(([id, element]) => inventories[1]!.get(id) !== element)) issue(["content"], "Reaction preserves every atom ID and element exactly; generation cannot create, delete or transmute atoms");
      const bondInventory = (molecules: typeof reactants) => molecules.flatMap(molecule => molecule.bonds.map(bond => `${[bond.from, bond.to].sort().join(":")}:${bond.order}`)).sort().join(";");
      if (bondInventory(reactants) === bondInventory(products)) issue(["content"], "A reaction demonstration needs an actual declared bond rearrangement");
      break;
    }
    case "music-score": case "music-harmony": {
      if ("source" in props.content) {
        const parsed = acceptedMusicContentSchema.safeParse(props.content);
        if (!parsed.success) for (const error of parsed.error.issues) issue(["content", ...error.path as (string | number)[]], error.message);
        break;
      }
      if (props.content.labels.length > props.content.groups.length) issue(["content", "labels"], "Music labels must reference an actual note group");
      if (props.templateId === "music-score" && props.content.groups.some(group => group.length !== 1)) issue(["content", "groups"], "Score template demonstrates a single melody; use harmony for simultaneous voices");
      if (props.templateId === "music-harmony" && props.content.groups.some(group => group.length < 2)) issue(["content", "groups"], "Harmony requires actual simultaneous pitch groups");
      try {teachingTemplateMusicBlock(props);} catch (error) {issue(["content"], error instanceof Error ? error.message : "Invalid musical facts");}
      // Check pitch spelling through the same parser used by actual performance.
      props.content.groups.flat().forEach(pitch => {try {parseMusicPitch(pitch);} catch {issue(["content", "groups"], `Invalid pitch: ${pitch}`);}});
      break;
    }
  }
}

