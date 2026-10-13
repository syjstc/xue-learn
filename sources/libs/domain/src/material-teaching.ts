import {materialTeachingSortOperations} from "./material-teaching-sort.js";
export {materialTeachingSortOperations, materialTeachingSortTrace, type TeachingSortState, type TeachingSortOperation} from "./material-teaching-sort.js";
import { z } from "zod";
import {isVisualTeaching, visualTeachingOperations, VISUAL_TEACHING_STEP_RULES, VISUAL_TEACHING_DEFINITIONS} from "./teaching-visual-content.js";
import {materialTeachingFocusTargets, materialTeachingFocusId, MATERIAL_TEACHING_FOCUS_RULES} from "./material-teaching-focus.js";
import {
  teachingContentAuthoringSchema,
  teachingContentSchema,
  teachingTemplateMusicBlock,
  validateTeachingTemplateContent,
  type TeachingContentProps,
} from "./material-teaching-content.js";

const fields = {
  type: z.literal("teaching"),
  version: z.literal(1),
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  title: z.string().trim().min(1).max(80),
};

/** Timing and generated operation IDs are deliberately absent from saved data. */
export type MaterialTeaching = TeachingContentProps & {
  type: "teaching"; version: 1; id: string; title: string;
};

const validate = (block: MaterialTeaching, context: z.RefinementCtx) => {
  validateTeachingTemplateContent(block, (path, message) => context.addIssue({code: "custom", path, message}));
  if (["whole", "display", ...materialTeachingSteps(block).map(step => step.id)].includes(block.id))
    context.addIssue({code: "custom", path: ["id"], message: "Teaching display ID must be distinct from its operation IDs and overview targets"});
};
export const materialTeachingBindingSchema = z.discriminatedUnion("templateId", [
  teachingContentSchema.options[0].extend(fields),
  teachingContentSchema.options[1].extend(fields),
  teachingContentSchema.options[2].extend(fields),
  teachingContentSchema.options[3].extend(fields),
  teachingContentSchema.options[4].extend(fields),
  teachingContentSchema.options[5].extend(fields),
  teachingContentSchema.options[6].extend(fields),
  teachingContentSchema.options[7].extend(fields),
  teachingContentSchema.options[8].extend(fields),
  teachingContentSchema.options[9].extend(fields),
  teachingContentSchema.options[10].extend(fields),
  teachingContentSchema.options[11].extend(fields),
  teachingContentSchema.options[12].extend(fields),
  teachingContentSchema.options[13].extend(fields),
  teachingContentSchema.options[14].extend(fields),
  teachingContentSchema.options[15].extend(fields),
  teachingContentSchema.options[16].extend(fields),
  teachingContentSchema.options[17].extend(fields),
  teachingContentSchema.options[18].extend(fields),
  teachingContentSchema.options[19].extend(fields),
  teachingContentSchema.options[20].extend(fields),
  teachingContentSchema.options[21].extend(fields),
  teachingContentSchema.options[22].extend(fields),
  teachingContentSchema.options[23].extend(fields),
  teachingContentSchema.options[24].extend(fields),
  teachingContentSchema.options[25].extend(fields),
  teachingContentSchema.options[26].extend(fields),
  teachingContentSchema.options[27].extend(fields),
  teachingContentSchema.options[28].extend(fields),
  teachingContentSchema.options[29].extend(fields),
  teachingContentSchema.options[30].extend(fields),
  teachingContentSchema.options[31].extend(fields),
  teachingContentSchema.options[32].extend(fields),
  teachingContentSchema.options[33].extend(fields),
  teachingContentSchema.options[34].extend(fields),
  teachingContentSchema.options[35].extend(fields),
  teachingContentSchema.options[36].extend(fields),
]);
export const materialTeachingAuthoringBindingSchema = z.discriminatedUnion("templateId", [
  teachingContentAuthoringSchema.options[0].extend(fields),
  teachingContentAuthoringSchema.options[1].extend(fields),
  teachingContentAuthoringSchema.options[2].extend(fields),
  teachingContentAuthoringSchema.options[3].extend(fields),
  teachingContentAuthoringSchema.options[4].extend(fields),
  teachingContentAuthoringSchema.options[5].extend(fields),
  teachingContentAuthoringSchema.options[6].extend(fields),
  teachingContentAuthoringSchema.options[7].extend(fields),
  teachingContentAuthoringSchema.options[8].extend(fields),
  teachingContentAuthoringSchema.options[9].extend(fields),
  teachingContentAuthoringSchema.options[10].extend(fields),
  teachingContentAuthoringSchema.options[11].extend(fields),
  teachingContentAuthoringSchema.options[12].extend(fields),
  teachingContentAuthoringSchema.options[13].extend(fields),
  teachingContentAuthoringSchema.options[14].extend(fields),
  teachingContentAuthoringSchema.options[15].extend(fields),
  teachingContentAuthoringSchema.options[16].extend(fields),
  teachingContentAuthoringSchema.options[17].extend(fields),
  teachingContentAuthoringSchema.options[18].extend(fields),
  teachingContentAuthoringSchema.options[19].extend(fields),
  teachingContentAuthoringSchema.options[20].extend(fields),
  teachingContentAuthoringSchema.options[21].extend(fields),
  teachingContentAuthoringSchema.options[22].extend(fields),
  teachingContentAuthoringSchema.options[23].extend(fields),
  teachingContentAuthoringSchema.options[24].extend(fields),
  teachingContentAuthoringSchema.options[25].extend(fields),
  teachingContentAuthoringSchema.options[26].extend(fields),
  teachingContentAuthoringSchema.options[27].extend(fields),
  teachingContentAuthoringSchema.options[28].extend(fields),
  teachingContentAuthoringSchema.options[29].extend(fields),
  teachingContentAuthoringSchema.options[30].extend(fields),
  teachingContentAuthoringSchema.options[31].extend(fields),
  teachingContentAuthoringSchema.options[32].extend(fields),
  teachingContentAuthoringSchema.options[33].extend(fields),
  teachingContentAuthoringSchema.options[34].extend(fields),
  teachingContentAuthoringSchema.options[35].extend(fields),
  teachingContentAuthoringSchema.options[36].extend(fields),
]);
export const materialTeachingSchema = materialTeachingBindingSchema.superRefine(validate);
/** New authoring cannot attach host-owned accepted score envelopes. */
export const materialTeachingAuthoringSchema = materialTeachingAuthoringBindingSchema.superRefine(validate);

export function readMaterialTeaching(value: unknown): MaterialTeaching | null {
  const parsed = materialTeachingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type MaterialTeachingStep = Readonly<{
  id: string;
  label: string;
  action: "focus" | "transform";
  sourceItemIds: readonly string[];
  /** Renderer-owned grammar coordinates, never film seconds or authored data. */
  fromSeconds: number;
  toSeconds: number;
}>;
type StepInput = readonly [id: string, label: string, from: number, to: number, sourceItemIds?: readonly string[]];
const steps = (input: readonly StepInput[]): MaterialTeachingStep[] => input.map(([id, label, fromSeconds, toSeconds, sourceItemIds]) => ({
  id, label, fromSeconds, toSeconds, action: fromSeconds === toSeconds ? "focus" : "transform", sourceItemIds: sourceItemIds ?? [id],
}));

export type TeachingRecursionState = {stack: number[]; returned: number | null; caption: string};
export function materialTeachingRecursionTrace(config: {operation: "sum" | "product"; start: number}): TeachingRecursionState[] {
  const result: TeachingRecursionState[] = [], stack: number[] = [];
  const name = config.operation === "product" ? "factorial" : "sum", operator = config.operation === "product" ? "×" : "+";
  for (let n = config.start; n >= 1; n--) {
    stack.push(n);
    result.push({stack: [...stack], returned: null, caption: n === 1 ? "进入基例：f(1) = 1" : `调用 ${name}(${n})，等待 f(${n - 1})`});
  }
  let value = 1;
  for (let n = 1; n <= config.start; n++) {
    stack.pop();
    const next = config.operation === "product" ? (n + 1) * value : n + 1 + value;
    result.push({stack: [...stack], returned: value, caption: n === config.start ? `返回最终结果：f(${config.start}) = ${value}` : `返回 ${value}；计算 ${n + 1} ${operator} ${value} = ${next}`});
    value = next;
  }
  return result;
}

/** Every component exposes its actual operations, never three generic phases. */
export function materialTeachingSteps(block: TeachingContentProps): MaterialTeachingStep[] {
  if (isVisualTeaching(block)) {
    const operations = visualTeachingOperations(block);
    return steps(operations.map((operation, index) => [operation.id, operation.label, index * 12 / operations.length, (index + 1) * 12 / operations.length]));
  }
  switch (block.templateId) {
    case "general-question": return steps([["observe", "观察共同对象", 0, 2], ["compare", "比较观察差异", 4, 6], ["goal", "明确需要解释的问题", 8, 10]]);
    case "general-layers": return steps(block.content.layers.map((layer, index) => [`layer-${index + 1}`, layer.title, 1, 6, [`layer-${index + 1}`]]));
    case "general-flow": return steps(block.content.nodes.map((node, index) => [`node-${index + 1}`, node, index * 1.4, index * 1.4 + .9, [`node-${index + 1}`]]));
    case "general-compare": return steps(block.content.metrics.map((metric, index) => [`metric-${index + 1}`, metric.label, .6, 6, [`metric-${index + 1}`]]));
    case "general-summary": return steps([...block.content.concepts.map((concept, index): StepInput => [`concept-${index + 1}`, concept, index * 1.7, index * 1.7 + 1.5]), ["transfer", "应用已经建立的关系", 8, 10]]);
    case "math-pythagoras": return steps([["areas", "观察边长与面积", 0, 4], ["rearrange", "重排相同三角形", 4, 7.3], ["identity", "核对面积相等关系", 8, 12]]);
    case "math-tangent": return steps([["secant", "观察割线与取样点", 0, 3], ["approach", "第二取样点逐渐接近", 3, 7], ["tangent", "比较极限切线与斜率", 7, 9]]);
    case "math-integral": return steps([["interval", "确认累积区间", 0, 1.5], ["partition", "建立有限矩形近似", 1.5, 4.5], ["refine", "细分矩形并比较误差", 5, 9], ["integral", "核对精确累积量", 9, 12]]);
    case "math-probability": return steps([["inventory", "观察完整样本", 0, 3], ["condition", "按条件筛选同一批样本", 3, 6.5], ["ratio", "核对交集与新分母", 8, 12]]);
    case "physics-forces": return steps([["forces", "观察质量与各力", 0, 2.5], ["resultant", "合成同一直线上的力", 2.5, 3], ["motion", "从静止追踪运动", 3, 8], ["quantities", "核对加速度与位移", 8, 12]]);
    case "physics-waves": return steps([["components", "观察两列分量波", 0, 3.5], ["superpose", "逐点相加得到合成波", 3.5, 5.5], ["propagate", "追踪相位与合成变化", 5.5, 8], ["compare", "比较振幅和相位关系", 8, 12]]);
    case "physics-circuit": return steps([["circuit", "辨认元件与连接", 0, 1], ["current", "闭合电路并追踪电流", 1, 4], ["quantities", "核对电阻电压与电流", 8, 12]]);
    case "chemistry-reaction": return steps([["atoms", "核对原子与原有化学键", 0, 3.4, block.content.reactants.flatMap(m => m.atoms.map(a => a.id))], ["break-bonds", "断开原有连接", 3.4, 4.3], ["rearrange", "保持原子身份重新排列", 4.3, 7], ["form-bonds", "建立产物中的化学键", 7, 8.4], ["conservation", "核对原子守恒", 8.4, 12]]);
    case "chemistry-titration": return steps([["before-equivalence", "加液并观察等当点之前", 0, 4], ["equivalence", "越过等当点附近的突变", 4, 8], ["excess", "观察碱过量后的变化", 8, 12]]);
    case "biology-mitosis": return steps([["alignment", "观察复制后的染色体排列", 0, 4], ["separation", "姐妹染色单体分离", 4, 7], ["division", "形成两个子细胞", 8, 10.5]]);
    case "biology-enzyme": return steps([["recognition", "辨认酶与底物", 0, .8], ["binding", "底物进入并结合", .8, 4], ["reaction", "结合后生成产物", 4, 7.5], ["release", "释放产物并保留酶", 7.5, 10.5]]);
    case "geography-water": return steps(block.content.transitions.map((label, index) => [`path-${index + 1}`, label, index * 2.4, (index + 1) * 2.4, [`node-${index + 1}`, `node-${(index + 1) % 5 + 1}`]]));
    case "history-timeline": return steps([["event-1", block.content.events[0].label, 0, 4], ["event-2", block.content.events[1].label, 4, 8], ["evidence", "区分史料事实与推断", 8, 12]]);
    case "language-syntax": return steps([["sentence", "阅读完整句子", 0, 2], ["parse", "分解主语谓语和宾语", 2, 4.5], ["verb", "辨认动作及其关系", 4.5, 6.5], ["relation", "联系各成分理解整句", 8, 10]]);
    case "language-perspective": return steps([["event", "观察共同事件", 1, 4], ["first-person", "辨认内心叙述的范围", 4, 6], ["observer", "辨认外部可观察证据", 8, 10]]);
    case "cs-sorting": {
      const trace = materialTeachingSortOperations(block.content.values), count = trace.length;
      return trace.map((operation, index) => ({id: operation.id, label: operation.label, action: operation.kind === "swap" ? "transform" as const : "focus" as const, sourceItemIds: operation.sourceItemIds, fromSeconds: index * 12 / count, toSeconds: (index + 1) * 12 / count}));
    }
    case "cs-recursion": {
      const trace = materialTeachingRecursionTrace(block.content), width = 12 / trace.length;
      return steps(trace.map((state, index) => [index < block.content.start ? `call-${block.content.start - index}` : `return-${index - block.content.start + 1}`, state.caption, index * width, (index + 1) * width, [`frame-${index < block.content.start ? block.content.start - index : index - block.content.start + 1}`]]));
    }
    case "music-score": case "music-harmony": {
      const music = teachingTemplateMusicBlock(block)!;
      return steps(music.notes.map((note, index) => [`note-${index + 1}`, !note.pitches.length ? "辨认休止" : `辨认音符 ${note.pitches.join("、")}`, index, index, [note.id]]));
    }
    case "economics-equilibrium": return steps([["curves", "读取共同供需曲线", 0, 3], ["equilibrium", "寻找原有均衡", 3, 6.5], ["shift", "移动需求并核对新均衡", 8, 10.5]]);
  }
}

export const materialTeachingTarget = (figureId: string, stepId: string) => `teaching:${figureId}:${stepId}`;
export function materialTeachingStepId(block: MaterialTeaching, target: string): string | undefined {
  return materialTeachingSteps(block).find(step => target === step.id || target === materialTeachingTarget(block.id, step.id))?.id;
}

/** Authoring must visit every actual operation in order; a repeated explanation
 * holds its state. Overview cues neither advance nor satisfy an operation. */
export function materialTeachingCueIssues(block: MaterialTeaching, cues: readonly {targetIds?: readonly string[]; figureId?: string}[], {scopedFocus = false}: {scopedFocus?: boolean} = {}): string[] {
  const operations = materialTeachingSteps(block), visited = new Set<string>(), issues: string[] = [];
  let current = -1;
  for (const [cueIndex, cue] of cues.entries()) {
    if (cue.figureId && cue.figureId !== block.id) continue;
    const ids = [...new Set((cue.targetIds ?? []).flatMap(target => {
      const id = materialTeachingStepId(block, target); return id ? [id] : [];
    }))];
    if (ids.length > 1) {issues.push(`cue ${cueIndex + 1}: narrate one teaching operation at a time`); continue;}
    const focusIds = (cue.targetIds ?? []).flatMap(target => {
      const id = materialTeachingFocusId(block, target, !scopedFocus); return id ? [id] : [];
    });
    for (const focusId of focusIds) {
      const focus = materialTeachingFocusTargets(block).find(item => item.id === focusId)!;
      if (!ids.length || !focus.operationIds.includes(ids[0]!))
        issues.push(`cue ${cueIndex + 1}: focus ${focusId} needs one of its teaching operations: ${focus.operationIds.join(', ')}`);
    }
    if (!ids.length) continue;
    const next = operations.findIndex(step => step.id === ids[0]);
    if (next !== current && next !== current + 1) issues.push(`cue ${cueIndex + 1}: teaching operations must follow their host-derived order without skipping`);
    current = next;
    visited.add(ids[0]!);
  }
  const missing = operations.filter(step => !visited.has(step.id));
  if (missing.length) issues.push(`Every teaching operation needs narration: ${missing.map(step => step.id).join(", ")}`);
  return issues;
}

/** Author-visible addressing rules; concrete step catalogs are returned by the
 * host once content is accepted, especially for executed algorithm traces. */
export const MATERIAL_TEACHING_STEP_RULES = {
  ...VISUAL_TEACHING_STEP_RULES,
  "general-question": "observe → compare → goal",
  "general-layers": "layer-1 → … → layer-N，N 为 layers 数量",
  "general-flow": "node-1 → … → node-N，N 为 nodes 数量",
  "general-compare": "metric-1 → … → metric-N，N 为 metrics 数量",
  "general-summary": "concept-1 → concept-2 → concept-3 → transfer",
  "math-pythagoras": "areas → rearrange → identity",
  "math-tangent": "secant → approach → tangent",
  "math-integral": "interval → partition → refine → integral",
  "math-probability": "inventory → condition → ratio",
  "physics-forces": "forces → resultant → motion → quantities",
  "physics-waves": "components → superpose → propagate → compare",
  "physics-circuit": "circuit → current → quantities",
  "chemistry-reaction": "atoms → break-bonds → rearrange → form-bonds → conservation",
  "chemistry-titration": "before-equivalence → equivalence → excess",
  "biology-mitosis": "alignment → separation → division",
  "biology-enzyme": "recognition → binding → reaction → release",
  "geography-water": "path-1 → path-2 → path-3 → path-4 → path-5",
  "history-timeline": "event-1 → event-2 → evidence",
  "language-syntax": "sentence → parse → verb → relation",
  "language-perspective": "event → first-person → observer",
  "cs-sorting": "values → 按真实稳定插入排序执行的 compare-N / swap-N → sorted。从数组第二项开始向左比较；每次比较令 N 加一，先 compare-N；仅当左值大于右值时随后 swap-N 并继续向左，否则结束当前项。相等值不交换。不交换的比较同样必须讲到。例 [3,1,2]：values, compare-1, swap-1, compare-2, swap-2, compare-3, sorted；compare-3 检查 1 与 2，无 swap-3。不得把比较与交换写成同一 cue。",
  "cs-recursion": "call-N → call-(N-1) → … → call-1 → return-1 → … → return-N，N 为 start；每次调用与每次返回独立一句",
  "music-score": "note-1 → … → note-N，N 为实际 notes/groups 数量；这是谱面观察，播放仍须显式音乐 cue",
  "music-harmony": "note-1 → … → note-N，N 为实际 notes/groups 数量；这是和声音组观察，播放仍须显式音乐 cue",
  "economics-equilibrium": "curves → equilibrium → shift",
} as const;
/** A renderer's supported model must fit the evidence before its kind is
 * frozen. Narration cannot excuse a different graph as an auxiliary example. */
export const MATERIAL_TEACHING_EVIDENCE_RULES = [
  "选择原生教学模板前，先用其实际公式与参数逐一核对题设数值、取样点、单位和所讲关系。画面、讲稿与计算必须使用同一组证据；不能保留不匹配的图，再用‘辅助模型与题设不同’之类说明替代修正。模板无法表示指定证据时，在内容清单冻结前改选能忠实表示它的组件。",
  "math-tangent 只绘制 f(x)=coefficient*x^power（power为2或3），两点为(at,f(at))和(at+startDx,f(at+startDx))。例如 coefficient=2、power=2、at=1、startDx=2 时，两点必为(1,2)、(3,18)，横向差2、纵向差16、割线斜率8、at处导数4；它不能表示(1,2)、(3,8)及纵向差6。保留指定点时改选匹配的表示，不可为迁就模板擅自改题设。独立算例可以分别教学，但每个算例必须有自己的准确画面和对应讲稿。",
].join("\n");

export const MATERIAL_TEACHING_AUTHORING_RULES = [
  'Web/Electron 的原生 teaching display 为 {type:"teaching",version:1,id,title,templateId,content}。content 使用该模板的严格语义数据；不写 stages、秒数、frame、坐标、variant 或素材地址。',
  MATERIAL_TEACHING_EVIDENCE_RULES,
  "讲稿仍只写在普通 cues/paragraph 中。每句用 figureId 指向该 display，targetIds 引用恰好一个下面的操作 ID，并可附上该操作支持的具体内容 focus ID。按顺序讲全，不跳过，不提前揭示后续步骤。同一步讲到新的对象、数值或关系时，另写一句并切换到准确的 focus ID；重复讲同一个对象时保持该 ID，不重复播放整个步骤。整体现象的开头/结尾可只引用 display.id。",
  "操作 ID 由系统根据 content 生成，不能自创；同时有几个对象参与比较时，它们属于一个 compare 操作。比较和交换、调用和返回分别有独立 ID。教学解释保持完整，不为固定句数删减。",
  ...VISUAL_TEACHING_DEFINITIONS.map(([id, , title, purpose, operations, limits]) => `${id}（${title}）：${purpose}；可见动作：${operations}；边界：${limits}`),
  ...Object.entries(MATERIAL_TEACHING_STEP_RULES).map(([templateId, rule]) => `${templateId}: ${rule}`),
  ...Object.entries(MATERIAL_TEACHING_FOCUS_RULES).map(([templateId, rule]) => `${templateId}: 可选局部focus目标（必须与括号内一个操作ID同句绑定，N/M从1开始且必须存在于content）：${rule}。原子display可用短ID；stage内用teaching:<figureId>:focus:<focusId>，操作用teaching:<figureId>:<operationId>。`),
].join("\n");
export const materialTeachingStepInstructions = (block: MaterialTeaching): string => [
  ...materialTeachingSteps(block).map(step => `${step.id}: ${step.label} (${step.action}; objects: ${step.sourceItemIds.join(", ")})`),
  ...materialTeachingFocusTargets(block).map(target => `focus ${target.id}: ${target.label} (alongside operation: ${target.operationIds.join(', ')})`),
].join("\n");
