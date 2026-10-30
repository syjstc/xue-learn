import type {
  DisplayComponentManifest,
  DisplayDocument,
  DisplayNode,
  DisplayPluginManifest,
} from "../../../libs/display/src/types.js";
import {
  displayDocumentForNode,
  derivationDisplayDocument,
} from "../display-plugins/adapters.js";
import type { TeachingDerivationDocumentV1 } from "../../../libs/teaching-derivation/src/types.js";

export const DISPLAY_PREVIEW_FPS = 30;
export const DISPLAY_PREVIEW_SECONDS = 12;
export type DisplayPluginSelection = Readonly<{
  pluginId: string;
  pluginVersion: string;
  kind: string;
  componentVersion: number;
}>;
export type DisplayPreviewExample = Readonly<{
  label: string;
  payload: unknown;
  children?: readonly DisplayNode[];
  targets?: readonly string[];
  cues?: readonly (readonly string[])[];
}>;

const domains: Record<
  string,
  { title: string; summary: string; symbol: string }
> = {
  general: {
    title: "通用表达",
    summary: "用卡片、对话和流程，把知识讲清楚。",
    symbol: "▦",
  },
  math: {
    title: "数学与推导",
    summary: "让公式、数据和每一步推导都看得见。",
    symbol: "∑",
  },
  music: {
    title: "音乐与乐谱",
    summary: "通过乐谱、键盘与和声理解音乐。",
    symbol: "♫",
  },
  physics: {
    title: "物理与空间",
    summary: "观察运动、空间结构和实验过程。",
    symbol: "↗",
  },
  computing: {
    title: "代码与计算",
    summary: "逐行阅读代码，对比计算与评测结果。",
    symbol: "⌘",
  },
  media: {
    title: "图像与动画",
    summary: "让图像与动态图解成为讲解的一部分。",
    symbol: "◈",
  },
};
const components: Record<string, readonly [string, string]> = {
  "general:composition": [
    "组合画布",
    "在同一画布中组合文字、公式和其他领域组件。",
  ],
  "general:text": ["文字讲解", "展示标题、正文和带公式的解释。"],
  "general:callout": ["重点提示", "突出定义、结论和需要记住的知识点。"],
  "general:conversation": ["教学对话", "通过师生问答展开思考过程。"],
  "general:title": ["开场与总结", "以标题、关键词和简短说明引入主题。"],
  "general:cards": ["概念卡片", "把并列知识点整理成清晰的卡片。"],
  "general:compare": ["对比讲解", "并排比较两种观点、方法或结果。"],
  "general:process": ["流程与步骤", "按顺序展示过程，逐步聚焦每一个环节。"],
  "general:concept-network": ["概念关系", "用连接关系解释知识点如何相互关联。"],
  "general:teaching": ["通用教学动画", "通过层次、流程等动画组织教学内容。"],
  "general:visual": ["结构化图解", "把知识组织成层次、流程或数据图。"],
  "math:formula": ["公式讲解", "呈现公式与对应的解释，支持逐项聚焦。"],
  "math:chart": ["数据图表", "从真实数值绘制柱状图、折线图或环形图。"],
  "math:derivation": ["分步推导", "观察公式变换，并阅读每一步的理由。"],
  "math:formal-derivation": ["形式化推导", "展示保留公式结构的推导画布。"],
  "math:teaching": ["数学教学动画", "通过几何、函数和面积动画理解数学。"],
  "music:score": ["交互乐谱", "阅读五线谱和键盘，并试听乐句。"],
  "music:teaching": ["音乐教学动画", "观察旋律与和声中的音符关系。"],
  "physics:teaching": ["物理教学动画", "通过力、波和电路的变化理解物理关系。"],
  "physics:presentation": [
    "实验与关系演示",
    "用关系图和观测场景组织物理讲解。",
  ],
  "physics:spatial-assembly": ["空间结构", "观察几何部件如何组成空间结构。"],
  "physics:motion-scene": ["运动场景", "观察物体平移、转动和分阶段运动。"],
  "physics:occlusion-lab": [
    "遮挡实验",
    "对照实际观测和教学透视，理解隐藏状态。",
  ],
  "computing:code": ["代码讲解", "保留完整源代码，按讲解突出相关行。"],
  "computing:evaluation-lab": ["评测对照", "让相同测试样例经过不同评测流程。"],
  "media:image": ["图像讲解", "呈现教学图像，并支持镜头移动与区域聚焦。"],
  "media:lottie": ["动态图解", "用信号流、循环和变化动画辅助讲解。"],
};
export function displayPluginInfo(manifest: DisplayPluginManifest) {
  const domain = manifest.domains?.[0] ?? manifest.id.split(".").at(-1) ?? "";
  const builtin = manifest.id === `org.xuelearn.display.${domain}`;
  return {
    domain,
    title: builtin
      ? (domains[domain]?.title ?? manifest.title ?? manifest.id)
      : (manifest.title ?? manifest.id),
    summary:
      manifest.description ||
      (builtin ? domains[domain]?.summary : "浏览这个插件提供的展示组件。"),
    symbol: domains[domain]?.symbol ?? "◇",
  };
}
export function displayComponentInfo(component: DisplayComponentManifest) {
  const known = components[component.kind];
  return {
    title: known?.[0] ?? component.kind.split(":").at(-1) ?? component.kind,
    summary:
      known?.[1] ?? component.description ?? "在课程和视频中展示这个组件。",
  };
}
export const displaySelection = (
  manifest: DisplayPluginManifest,
  component: DisplayComponentManifest,
): DisplayPluginSelection => ({
  pluginId: manifest.id,
  pluginVersion: manifest.version,
  kind: component.kind,
  componentVersion: component.version,
});

const items = [
  { id: "observe", label: "观察", detail: "从现象出发，找到要解释的问题。" },
  { id: "model", label: "建模", detail: "选择合适的量，描述它们之间的关系。" },
  { id: "verify", label: "验证", detail: "把预测与观测结果进行比较。" },
];
const formula = {
  equations: [
    { id: "kinetic", latex: "E_k=\\frac{1}{2}mv^2", label: "动能" },
    { id: "work", latex: "W=\\Delta E_k", label: "功与动能变化" },
  ],
  notes: [{ id: "note", text: "合外力做的功等于物体动能的变化。" }],
};
const score = {
  type: "music",
  version: 2,
  id: "preview-score",
  title: "C 大调的三个音",
  layout: "column",
  notes: [
    { id: "c", pitches: ["C4"], beats: 1 },
    { id: "e", pitches: ["E4"], beats: 1 },
    { id: "g", pitches: ["G4"], beats: 1 },
  ],
  views: [
    {
      id: "staff",
      kind: "staff",
      label: "阅读乐谱",
      clef: "treble",
      notes: ["c", "e", "g"],
    },
    {
      id: "keys",
      kind: "keyboard",
      label: "音高与键盘",
      range: ["C4", "C5"],
      notes: ["c", "e", "g"],
    },
  ],
  clips: [
    {
      id: "phrase",
      label: "试听乐句",
      tempo: 80,
      instrument: "piano",
      events: [
        { notes: ["c"], beats: 1 },
        { notes: ["e"], beats: 1 },
        { notes: ["g"], beats: 1 },
      ],
    },
  ],
};
const teaching = (templateId: string, title: string, content: unknown) => ({
  block: {
    type: "teaching",
    version: 1,
    id: "preview-teaching",
    templateId,
    title,
    content,
  },
});
const derivation: TeachingDerivationDocumentV1 = {
  schemaVersion: 1,
  id: "preview-derivation",
  title: "分配律：每一项从哪里来",
  locale: "zh-Hans",
  teachingGoal: "理解括号展开时的对应关系。",
  givens: ["用分配律展开括号。"],
  status: "complete",
  revision: 2,
  steps: [
    {
      index: 0,
      board: [{ key: "work", title: "原式", latex: "2(x+1)", role: "primary" }],
      relation: "introduce",
      justification: "先观察括号内的两项。",
      narration: "二要分别乘括号里的每一项。",
      focusFormulaKey: "work",
    },
    {
      index: 1,
      board: [
        {
          key: "work",
          title: "展开",
          latex: "2x+2",
          role: "primary",
          change: "transform",
        },
      ],
      relation: "equivalence",
      justification: "外面的二分别乘 x 和一。",
      narration: "二乘 x 得到二 x，二乘一得到二。",
      focusFormulaKey: "work",
      targets: [
        { id: "source", formulaKey: "work", state: "before", latex: "2(x+1)" },
        { id: "result", formulaKey: "work", state: "after", latex: "2x+2" },
      ],
      cues: [
        { id: "notice", text: "先观察原式。", targetIds: ["source"] },
        {
          id: "expand",
          text: "把二分别乘进去。",
          targetIds: ["result"],
          startTransform: true,
        },
      ],
      intents: [{ kind: "expand", before: ["source"], after: ["result"] }],
    },
  ],
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1516" height="778" viewBox="0 0 1516 778"><rect width="1516" height="778" fill="#f4f1ec"/><path d="M160 570 Q440 90 750 350 T1350 170" fill="none" stroke="#5b8274" stroke-width="7"/><circle cx="750" cy="350" r="48" fill="#dc945d"/><path d="M750 350L920 350M902 337L920 350L902 363" fill="none" stroke="#3e5b50" stroke-width="6"/><text x="130" y="130" fill="#3e5148" font-family="sans-serif" font-size="46">观察轨迹与运动方向</text><text x="130" y="700" fill="#68776e" font-family="sans-serif" font-size="30">图像、标注和镜头一起辅助讲解</text></svg>`;
const example = (
  label: string,
  payload: unknown,
  extra: Partial<DisplayPreviewExample> = {},
): DisplayPreviewExample => ({ label, payload, ...extra });
const builtinExamples: Record<string, readonly DisplayPreviewExample[]> = {
  "general:composition": [
    example(
      "文字与公式组合",
      { layout: "row" },
      {
        children: [
          {
            id: "intro",
            kind: "general:text",
            version: 1,
            payload: {
              title: "从能量出发",
              text: "用功描述能量的转移，再比较初末状态。",
            },
          },
          { id: "formula", kind: "math:formula", version: 1, payload: formula },
        ],
      },
    ),
  ],
  "general:text": [
    example("课程讲解", {
      title: "为什么从能量出发？",
      text: "能量把不同形式的运动联系起来。比较初末状态，可以用更少的变量解释变化。",
    }),
  ],
  "general:callout": [
    example("重点定义", {
      block: {
        type: "callout",
        id: "definition",
        variant: "definition",
        title: "功与动能",
        body: "合外力做的功，等于物体动能的变化。\n\n速度翻倍时，动能变为原来的四倍。",
      },
    }, {targets: ["definition:detail-1", "definition:detail-2"], cues: [[], ["definition:detail-1"], ["definition:detail-2"], []]}),
  ],
  "general:conversation": [
    example("师生问答", {
      title: "速度翻倍后会怎样？",
      turns: [
        {
          id: "question",
          speaker: "老师",
          text: "速度翻倍，动能也只增加一倍吗？",
        },
        {
          id: "answer",
          speaker: "同学",
          text: "动能与速度的平方成正比，所以变成四倍。",
        },
      ],
    }, {targets: ["question", "answer"], cues: [[], ["question"], ["answer"], []]}),
  ],
  "general:title": [
    example("课程开场", {
      eyebrow: "从现象到模型",
      headline: "让知识看得见",
      subtitle: "观察、建模，再用证据验证。",
      keywords: items.map(({ id, label }) => ({ id, label })),
    }, {targets: items.map(item => item.id), cues: [[], ["observe"], ["model"], ["verify"], []]}),
  ],
  "general:cards": [
    example("三个学习步骤", { title: "从问题到理解", layout: "grid", items }, {targets: items.map(item => item.id), cues: [[], ["observe"], ["model"], ["verify"], []]}),
    example("纵向卡片", { title: "从问题到理解", layout: "stack", items }, {targets: items.map(item => item.id), cues: [[], ["observe"], ["model"], ["verify"], []]}),
  ],
  "general:compare": [
    example("两种思考方法", {
      left: {
        id: "force",
        label: "从力出发",
        points: [
          { id: "f", text: "关注每一时刻的运动变化。" },
          { id: "a", text: "求出加速度与运动轨迹。" },
        ],
      },
      right: {
        id: "energy",
        label: "从能量出发",
        points: [
          { id: "w", text: "关注过程中的能量转移。" },
          { id: "e", text: "比较初末状态的变化。" },
        ],
      },
    }, {targets: ["force", "energy", "f", "a", "w", "e"], cues: [[], ["force"], ["f"], ["energy"], ["e"], []]}),
  ],
  "general:process": [
    example("学习流程", { title: "从问题到理解", direction: "linear", steps: items }, {targets: items.map(item => item.id), cues: [[], ["observe"], ["model"], ["verify"], []]}),
    example("循环流程", { title: "让理解不断完善", direction: "cycle", steps: items }, {targets: items.map(item => item.id), cues: [[], ["observe"], ["model"], ["verify"], []]}),
  ],
  "general:concept-network": [
    example("概念之间的联系", {
      nodes: items,
      edges: [
        { id: "om", from: "observe", to: "model", label: "提出关系" },
        { id: "mv", from: "model", to: "verify", label: "检验预测" },
      ],
    }, {targets: [...items.map(item => item.id), "om", "mv"], cues: [[], ["observe"], ["om"], ["model"], ["mv"], ["verify"], []]}),
  ],
  "general:teaching": [
    example(
      "知识层次",
      teaching("general-layers", "从现象到模型", {
        layers: [
          { title: "现象", detail: "观察发生了什么。" },
          { title: "关系", detail: "找到量之间的联系。" },
          { title: "模型", detail: "用关系解释并预测。" },
        ],
      }),
    ),
    example(
      "循环流程",
      teaching("general-flow", "观察、建模、验证", {
        nodes: ["观察", "建模", "验证"],
        caption: "用证据不断修正我们的理解。",
      }),
    ),
  ],
  "general:visual": [
    example("能量数据", {
      block: {
        type: "visual",
        id: "energy-bars",
        kind: "bars",
        title: "初末动能比较",
        unit: "J",
        items: [
          { id: "a", label: "初始", detail: "初始状态", value: 25 },
          { id: "b", label: "最终", detail: "外力做功之后", value: 70 },
        ],
      },
    }),
    ...(["layers", "process", "cycle"] as const).map(kind => example(
      kind === "layers" ? "知识层次" : kind === "process" ? "连续过程" : "循环过程",
      {block: {type: "visual", id: "learning-flow", kind, title: "从问题到理解", items}},
      {targets: items.map(item => `visual:learning-flow:${item.id}`), cues: [[], ...items.map(item => [`visual:learning-flow:${item.id}`]), []]},
    )),
  ],
  "math:formula": [example("功与动能", formula)],
  "math:chart": [
    example("柱状图", {
      chart: "bar",
      unit: "J",
      categories: [
        { id: "a", label: "初始" },
        { id: "b", label: "最终" },
      ],
      series: [{ id: "energy", label: "动能", values: [25, 70] }],
    }),
    example("折线图", {
      chart: "line",
      unit: "m",
      categories: [
        { id: "a", label: "1 s" },
        { id: "b", label: "2 s" },
        { id: "c", label: "3 s" },
      ],
      series: [{ id: "distance", label: "位移", values: [2, 8, 18] }],
    }),
  ],
  "math:derivation": [example("展开括号", { document: derivation })],
  "math:formal-derivation": [
    example("公式结构", {
      document: {
        schemaVersion: 1,
        id: "formal-preview",
        title: "等式两边",
        locale: "zh-Hans",
        revision: 0,
        status: "draft",
        requirement: { text: "观察等式的结构。" },
        initialFormulas: [
          {
            id: "equation",
            label: "等式",
            tree: {
              kind: "operator",
              token: "=",
              operands: [
                {
                  node: {
                    kind: "operator",
                    token: "+",
                    operands: [
                      { node: { kind: "token", value: "x" } },
                      { node: { kind: "token", value: 1 } },
                    ],
                  },
                },
                { node: { kind: "token", value: 3 } },
              ],
            },
          },
        ],
        steps: [],
      },
      fromStep: 0,
      toStep: 0,
    }),
  ],
  "math:teaching": [
    example(
      "勾股定理",
      teaching("math-pythagoras", "边长与面积的关系", { a: 3, b: 4 }),
    ),
    example(
      "切线与斜率",
      teaching("math-tangent", "从割线到切线", {
        coefficient: 1,
        power: 2,
        at: 2,
        startDx: 1.5,
        xmax: 4,
      }),
    ),
  ],
  "music:score": [example("三音乐句", { block: score })],
  "music:teaching": [
    example(
      "和弦进行",
      teaching("music-harmony", "从和弦到和声进行", {
        id: "triad",
        title: "C 大调 · I — IV — V — I",
        groups: [
          ["C4", "E4", "G4"],
          ["C4", "F4", "A4"],
          ["B3", "D4", "G4"],
          ["C4", "E4", "G4"],
        ],
        labels: ["I", "IV", "V", "I"],
        beats: 2,
        range: ["B3", "C5"],
        tempo: 80,
      }),
    ),
  ],
  "physics:teaching": [
    example(
      "力与运动",
      teaching("physics-forces", "力怎样改变运动", {
        mass: 2,
        drive: 8,
        resistance: 2,
        duration: 6,
      }),
    ),
    example(
      "波的叠加",
      teaching("physics-waves", "两个波相遇", {
        amplitude1: 1,
        amplitude2: 0.8,
        cycles1: 2,
        cycles2: 2,
        phase2: Math.PI / 2,
      }),
    ),
  ],
  "physics:presentation": [
    example("力、运动与能量", {
      scenePlan: {
        sceneId: "relationships",
        componentId: "concept-network.v1",
        props: {
          nodes: [
            { id: "force", label: "力", detail: "描述物体间的相互作用。" },
            { id: "motion", label: "运动", detail: "用位置和速度描述变化。" },
            { id: "energy", label: "能量", detail: "通过做功联系初末状态。" },
          ],
          edges: [
            { from: "force", to: "motion", label: "改变" },
            { from: "force", to: "energy", label: "做功" },
          ],
        },
        cues: [],
      },
      timeline: {
        durationTicks: 576000,
        scenes: [{ id: "relationships", startTick: 0, endTick: 576000 }],
        tracks: [],
      },
    }),
  ],
  "physics:spatial-assembly": [
    example("基本几何体", {
      layout: "row",
      caption: "观察组成空间结构的三个部件",
      parts: [
        { id: "box", label: "立方体", primitive: "box", tone: "primary" },
        { id: "sphere", label: "球体", primitive: "sphere", tone: "secondary" },
        { id: "cone", label: "圆锥", primitive: "cone", tone: "accent" },
      ],
    }),
  ],
  "physics:motion-scene": [
    example(
      "平移与转动",
      {
        description: "物体先向右移动，再保持位置转动。",
        objects: [
          {
            id: "box",
            kind: "shape",
            shape: "rect",
            x: 180,
            y: 250,
            width: 120,
            height: 80,
          },
          {
            id: "label",
            kind: "text",
            text: "同一个物体",
            anchorId: "box",
            x: 0,
            y: -72,
            width: 180,
            height: 40,
          },
        ],
        stages: [
          {
            id: "move",
            description: "向右平移",
            tracks: [{ targetId: "box", to: { x: 600 } }],
          },
          {
            id: "rotate",
            description: "保持位置，再转动",
            tracks: [{ targetId: "box", to: { rotation: 90 } }],
          },
        ],
      },
      {
        targets: ["box", "label", "move", "rotate"],
        cues: [["move"], ["rotate"]],
      },
    ),
  ],
  "physics:occlusion-lab": [
    example(
      "观测与透视",
      {
        cells: 7,
        wall: { from: 2, to: 4 },
        moveBy: 1,
        cases: [
          { id: "a", label: "初始位置 2", initialCell: 2 },
          { id: "b", label: "初始位置 4", initialCell: 4 },
        ],
        stages: [
          {
            id: "observe",
            label: "先观察遮挡",
            view: "observation",
            moved: false,
          },
          {
            id: "inspect",
            label: "打开教学透视",
            view: "cutaway",
            moved: false,
          },
          {
            id: "move",
            label: "施加同一个动作",
            view: "observation",
            moved: true,
          },
        ],
      },
      {
        targets: ["observe", "inspect", "move"],
        cues: [["observe"], ["inspect"], ["move"]],
      },
    ),
  ],
  "computing:code": [
    example(
      "求和函数",
      {
        language: "python",
        code: "def total(values):\n    result = 0\n    for value in values:\n        result += value\n    return result",
        highlights: [
          { id: "init", label: "初始化", startLine: 2, endLine: 2 },
          { id: "loop", label: "累加", startLine: 3, endLine: 4 },
          { id: "return", label: "返回结果", startLine: 5, endLine: 5 },
        ],
      },
      {
        targets: ["init", "loop", "return"],
        cues: [["init"], ["loop"], ["return"]],
      },
    ),
  ],
  "computing:evaluation-lab": [
    example(
      "比较两个实现",
      {
        caption: "相同样例，逐项验证",
        cases: [
          { id: "normal", label: "普通输入" },
          { id: "empty", label: "空列表" },
          { id: "negative", label: "负数" },
        ],
        runs: [
          {
            id: "first",
            label: "实现 A",
            outcomes: [
              { caseId: "normal", verdict: "pass", note: "得到正确结果。" },
              {
                caseId: "empty",
                verdict: "critical",
                note: "空列表触发异常。",
              },
              { caseId: "negative", verdict: "pass", note: "负数正确累加。" },
            ],
          },
          {
            id: "second",
            label: "实现 B",
            outcomes: [
              { caseId: "normal", verdict: "pass", note: "得到正确结果。" },
              { caseId: "empty", verdict: "pass", note: "空列表返回零。" },
              { caseId: "negative", verdict: "pass", note: "负数正确累加。" },
            ],
          },
        ],
      },
      { targets: ["first", "second"], cues: [["first"], ["second"]] },
    ),
  ],
  "media:image": [
    example("轨迹示意图", {
      id: "trajectory",
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      alt: "弯曲轨迹上的物体与运动方向箭头",
      caption: "观察轨迹与方向",
      motion: "still",
      guidedImage: {
        sha256: "0".repeat(64), width: 1516, height: 778,
        segmentation: {geometryVersion: "simple-shapes-v1", missingPartIds: [], imageIssues: [],
          regions: [
            {id: "object", label: "运动中的物体", x: 690, y: 290, width: 120, height: 120},
            {id: "direction", label: "运动方向", x: 810, y: 320, width: 125, height: 60},
          ].map(({id, label, x, y, width, height}) => ({id, partId: id, label, observedDescription: label,
            polygons: [{holes: [], outer: [{x: x / 1516, y: y / 778}, {x: (x + width) / 1516, y: y / 778},
              {x: (x + width) / 1516, y: (y + height) / 778}, {x: x / 1516, y: (y + height) / 778}]}]}))},
      },
    }, {targets: ["object", "direction"], cues: [[], ["object"], ["direction"], ["object", "direction"], []]}),
  ],
  "media:lottie": [
    example("信号流", {
      preset: "signal-flow",
      items,
      caption: "信息如何经过每一个环节",
    }),
    example("循环关系", {
      preset: "orbit-cycle",
      items,
      caption: "观察、建模、验证形成循环",
    }),
  ],
};

/** Imported examples take precedence; unknown versions never borrow a built-in sample. */
export function displayPreviewExamples(
  manifest: DisplayPluginManifest,
  component: DisplayComponentManifest,
): readonly DisplayPreviewExample[] {
  if (component.examples?.length)
    return component.examples.map((payload, index) =>
      example(`示例 ${index + 1}`, payload),
    );
  if (
    component.version === 1 &&
    manifest.id.startsWith("org.xuelearn.display.")
  )
    return builtinExamples[component.kind] ?? [];
  // A static declarative composition needs no input data.
  if (
    component.composition &&
    !JSON.stringify(component.composition).includes('"$display"') &&
    !component.payloadSchema
  )
    return [example("组合预览", {})];
  return [];
}
export function createDisplayPreviewDocument(
  manifest: DisplayPluginManifest,
  component: DisplayComponentManifest,
  sample: DisplayPreviewExample,
): DisplayDocument {
  const root: DisplayNode = {
    id: "preview",
    kind: component.kind,
    version: component.version,
    payload: sample.payload,
    children: sample.children,
    targets: sample.targets,
  };
  const document =
    component.kind === "math:derivation" &&
    manifest.id === "org.xuelearn.display.math"
      ? derivationDisplayDocument({
          ...(sample.payload as { document: unknown }),
          id: root.id,
        })
      : displayDocumentForNode(root);
  const locks = new Map(
    [
      ...document.plugins,
      ...(manifest.dependencies ?? []),
      { id: manifest.id, version: manifest.version },
    ].map((lock) => [lock.id, lock]),
  );
  const cues = sample.cues?.map((targets, index) => ({
    id: `preview-cue-${index}`,
    startTick: Math.round(
      (index * DISPLAY_PREVIEW_SECONDS * 48000) / sample.cues!.length,
    ),
    durationTicks: Math.round(
      (DISPLAY_PREVIEW_SECONDS * 48000) / sample.cues!.length,
    ),
    targets: targets.length ? targets.map((target) => `${root.id}/${target}`) : [root.id],
  }));
  return {
    ...document,
    plugins: [...locks.values()],
    durationTicks: document.durationTicks ?? DISPLAY_PREVIEW_SECONDS * 48000,
    ...(cues ? { timeline: cues } : {}),
  };
}

export function readDisplayPluginSelection(
  params: URLSearchParams,
): DisplayPluginSelection | null {
  const pluginId = params.get("plugin"),
    pluginVersion = params.get("version"),
    kind = params.get("component"),
    componentVersion = Number(params.get("componentVersion"));
  return pluginId &&
    pluginVersion &&
    kind &&
    Number.isSafeInteger(componentVersion) &&
    componentVersion > 0
    ? { pluginId, pluginVersion, kind, componentVersion }
    : null;
}
export function writeDisplayPluginSelection(
  params: URLSearchParams,
  selection: DisplayPluginSelection | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ["plugin", "version", "component", "componentVersion"])
    next.delete(key);
  if (selection) {
    next.set("plugin", selection.pluginId);
    next.set("version", selection.pluginVersion);
    next.set("component", selection.kind);
    next.set("componentVersion", String(selection.componentVersion));
  }
  return next;
}
