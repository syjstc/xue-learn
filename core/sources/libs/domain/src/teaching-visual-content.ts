import {z} from "zod";

/** General video primitives use semantic facts; geometry, timing and SVG stay
 * host-owned. These are also ordinary course displays, not gallery-only art. */
export const VISUAL_TEACHING_IDS = [
  "visual-timeline", "visual-cycle", "visual-decision", "visual-funnel",
  "visual-balance", "visual-matrix", "visual-proportion", "visual-network",
  "visual-counter", "visual-interval", "visual-hierarchy", "visual-ranking",
] as const;
export type VisualTeachingId = typeof VISUAL_TEACHING_IDS[number];
const text = (max: number) => z.string().trim().min(1).max(max);
const label = text(18), detail = text(60), unit = z.string().max(8);
const value = z.number().finite().min(-1e6).max(1e6);
const amount = z.number().finite().min(0).max(1e6);
const positive = amount.min(.001);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const item = z.object({label, value: amount}).strict();
const props = <K extends VisualTeachingId, T extends z.ZodType>(templateId: K, content: T) => z.object({templateId: z.literal(templateId), content}).strict();
export const visualTeachingOptions = [
  props("visual-timeline", z.object({unit, events: z.array(z.object({at: value, label, detail}).strict()).min(2).max(6)}).strict()),
  props("visual-cycle", z.object({center: label, nodes: z.array(z.object({label, process: text(24)}).strict()).min(3).max(6)}).strict()),
  props("visual-decision", z.object({question: text(42), branches: z.array(z.object({condition: text(24), outcome: text(36)}).strict()).min(2).max(4)}).strict()),
  props("visual-funnel", z.object({unit, stages: z.array(item).min(2).max(5)}).strict()),
  props("visual-balance", z.object({unit, left: z.object({label, items: z.array(item).min(1).max(3)}).strict(), right: z.object({label, items: z.array(item).min(1).max(3)}).strict()}).strict()),
  props("visual-matrix", z.object({columns: z.array(label).min(2).max(4), rows: z.array(z.object({label, values: z.array(amount).min(2).max(4)}).strict()).min(2).max(4), unit, max: positive}).strict()),
  props("visual-proportion", z.object({whole: label, unit, parts: z.array(item.extend({value: positive})).min(2).max(5)}).strict()),
  props("visual-network", z.object({nodes: z.array(z.object({id, label}).strict()).min(3).max(7), links: z.array(z.object({from: id, to: id, label: text(20)}).strict()).min(2).max(8)}).strict()),
  props("visual-counter", z.object({label, unit, from: value, to: value, context: detail}).strict()),
  props("visual-interval", z.object({label, unit, min: value, max: value, low: value, high: value, points: z.array(z.object({label, value}).strict()).min(1).max(4)}).strict()),
  props("visual-hierarchy", z.object({root: label, groups: z.array(z.object({label, members: z.array(label).min(1).max(3)}).strict()).min(2).max(4)}).strict()),
  props("visual-ranking", z.object({unit, before: label, after: label, items: z.array(z.object({label, before: amount, after: amount}).strict()).min(2).max(5)}).strict()),
] as const;
export const visualTeachingSchema = z.discriminatedUnion("templateId", visualTeachingOptions);
export type VisualTeachingProps = z.infer<typeof visualTeachingSchema>;

export const VISUAL_TEACHING_DEFINITIONS: readonly [VisualTeachingId, string, string, string, string, string][] = [
  ["visual-timeline", "通用动画", "时间轴展开", "带时间数值的事件先后与间隔", "按真实时间刻度描线、落点并展开固定事件注解", "2–6个严格递增时间；先后不证明因果；密集注解用固定引线分隔"],
  ["visual-cycle", "通用动画", "循环与反馈", "3–6个环节构成闭环的循环机制", "依次描出环形路径，沿当前路径输送粒子，闭合最后反馈", "必须有明确的循环依据；不自动计算守恒或反馈稳定性"],
  ["visual-decision", "通用动画", "条件分支", "同一问题在不同条件下的处理选择", "菱形判断向扇形分支展开，逐条照亮条件和结果", "2–4条显式条件分支；无自动决策或概率推断"],
  ["visual-funnel", "通用动画", "筛选漏斗", "逐级筛选后数量减少的共同群体", "按数量比例收窄漏斗宽度，颗粒进入下一层，显示保留率", "2–5个同单位非增数量；必须是同一群体，不编造转化率"],
  ["visual-balance", "通用动画", "天平与权衡", "同一单位下两侧分项的总量比较", "分项砝码落盘，梁随累计总量倾斜，核对实际差值", "每侧1–3项；只能比较同单位数量，不给抽象价值随意打分"],
  ["visual-matrix", "通用动画", "矩阵扫描", "交叉维度下的数据分布与强弱", "逐行扫描热力网格，单元强度和数值来自共同上限", "2–4行列；非负同量纲数值，不自动执行矩阵乘法"],
  ["visual-proportion", "通用动画", "整体与份额", "同一整体由不重叠份额构成", "圆环按份额依次绘制，标签与累计比例联动", "2–5个正数份额；整体为求和结果，不将重叠集合当份额"],
  ["visual-network", "通用动画", "关系网络", "实体之间多对多的有向关系", "稳定节点组成网络，曲线逐条描出并传递信号", "3–7节点、2–8条显式边；关系不自动等于因果或计算"],
  ["visual-counter", "通用动画", "数值变化与计量", "明确起点到终点的数量变化", "大数值计量、差值轨迹和刻度指针同步推进", "插值只作变化示意，不宣称中间值是实测；使用真实或明确示例值"],
  ["visual-interval", "通用动画", "范围与阈值", "连续数轴上区间、阈值与观察值", "描出完整刻度、展开有效区间，观察点沿数轴定位", "最多4个范围内观察值；仅闭区间，不推断概率或临界机制"],
  ["visual-hierarchy", "通用动画", "分类树展开", "一个整体下的分类及各自成员", "从根到分组展开树枝，成员保持固定布局逐组揭示", "2–4组、每组1–3成员；分类关系由作者显式给出"],
  ["visual-ranking", "通用动画", "排序与名次变化", "两次观察中的共同对象和数值排名", "稳定颜色和身份的横条变长并交叉换位，核对前后名次", "2–5对象；共有零基线，按真实值稳定排序，非自动因果解释"],
];

/** One addressed operation per real narrated item, plus explicit initial/final
 * states where the evidence needs them. No cue may silently advance a sibling. */
export function visualTeachingOperations(props: VisualTeachingProps): {id: string; label: string}[] {
  const indexed = (prefix: string, labels: string[]) => labels.map((label, i) => ({id: `${prefix}-${i + 1}`, label}));
  switch (props.templateId) {
    case "visual-timeline": return indexed("event", props.content.events.map(x => x.label));
    case "visual-cycle": return indexed("path", props.content.nodes.map(x => x.process));
    case "visual-decision": return [{id: "question", label: props.content.question}, ...indexed("branch", props.content.branches.map(x => x.condition))];
    case "visual-funnel": return indexed("stage", props.content.stages.map(x => x.label));
    case "visual-balance": return [{id: "left", label: props.content.left.label}, {id: "right", label: props.content.right.label}, {id: "difference", label: "核对总量与差值"}];
    case "visual-matrix": return indexed("row", props.content.rows.map(x => x.label));
    case "visual-proportion": return indexed("part", props.content.parts.map(x => x.label));
    case "visual-network": return [{id: "nodes", label: "辨认各实体"}, ...indexed("link", props.content.links.map(x => x.label))];
    case "visual-counter": return [{id: "baseline", label: "确认起点"}, {id: "change", label: "观察数值变化"}, {id: "result", label: "核对终点与差值"}];
    case "visual-interval": return [{id: "range", label: "确认共同范围"}, {id: "interval", label: "定位有效区间"}, ...indexed("point", props.content.points.map(x => x.label))];
    case "visual-hierarchy": return [{id: "root", label: props.content.root}, ...indexed("group", props.content.groups.map(x => x.label))];
    case "visual-ranking": return [{id: "before", label: props.content.before}, {id: "change", label: "保持对象身份比较变化"}, {id: "after", label: props.content.after}];
  }
}
export const VISUAL_TEACHING_STEP_RULES = {
  "visual-timeline": "event-1 → … → event-N（events顺序）",
  "visual-cycle": "path-1 → … → path-N（nodes顺序，最后一条回到首节点）",
  "visual-decision": "question → branch-1 → … → branch-N",
  "visual-funnel": "stage-1 → … → stage-N（stages顺序）",
  "visual-balance": "left → right → difference",
  "visual-matrix": "row-1 → … → row-N",
  "visual-proportion": "part-1 → … → part-N",
  "visual-network": "nodes → link-1 → … → link-N（links顺序）",
  "visual-counter": "baseline → change → result",
  "visual-interval": "range → interval → point-1 → … → point-N",
  "visual-hierarchy": "root → group-1 → … → group-N",
  "visual-ranking": "before → change → after",
} as const;
export const isVisualTeaching = (props: {templateId: string}): props is VisualTeachingProps => (VISUAL_TEACHING_IDS as readonly string[]).includes(props.templateId);
export function validateVisualTeaching(props: VisualTeachingProps, issue: (path: (string | number)[], message: string) => void): void {
  const fail = (message: string) => issue(["content"], message);
  switch (props.templateId) {
    case "visual-timeline": if (props.content.events.some((x, i, all) => i > 0 && x.at <= all[i - 1]!.at)) fail("Timeline times must be strictly increasing"); break;
    case "visual-funnel": if (props.content.stages[0]!.value <= 0 || props.content.stages.some((x, i, all) => i > 0 && x.value > all[i - 1]!.value)) fail("Funnel starts above zero and preserves non-increasing counts"); break;
    case "visual-matrix": if (props.content.rows.some(row => row.values.length !== props.content.columns.length || row.values.some(v => v > props.content.max))) fail("Matrix rows must match the columns and shared maximum"); break;
    case "visual-network": {
      const ids = props.content.nodes.map(x => x.id), edges = new Set<string>();
      if (new Set(ids).size !== ids.length) fail("Network node IDs must be unique");
      for (const link of props.content.links) {
        const key = `${link.from}:${link.to}`;
        if (!ids.includes(link.from) || !ids.includes(link.to) || link.from === link.to || edges.has(key)) fail("Network links need distinct existing endpoints and cannot repeat");
        edges.add(key);
      }
      break;
    }
    case "visual-counter": if (props.content.from === props.content.to) fail("A counter needs an actual value change"); break;
    case "visual-interval": {const c = props.content; if (c.min >= c.max || c.low < c.min || c.high > c.max || c.low >= c.high || c.points.some(p => p.value < c.min || p.value > c.max)) fail("Interval and observations must fit one increasing axis"); break;}
    case "visual-ranking": if (props.content.items.every(x => x.before === x.after) || new Set(props.content.items.map(x => x.label)).size !== props.content.items.length) fail("Ranking needs unique objects and an actual change"); break;
  }
}
