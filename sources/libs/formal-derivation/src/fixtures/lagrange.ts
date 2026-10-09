import { DERIVATION_SCHEMA_VERSION } from "../limits.js";
import { commitDerivationStep, compileInitialFormulas } from "../materialize.js";
import { seedFactsFromRequirement } from "../rules.js";
import type {
  CommitDerivationStepArgsV1,
  DerivationDocumentV1,
  DerivationPresentationV1,
} from "../types.js";
import { eq, frac, fn, group, minus, times, tok } from "../authoring.js";

export const LAGRANGE_FIXTURE_ID = "lagrange-mvt" as const;

export const LAGRANGE_REQUIREMENT = {
  title: "拉格朗日中值定理",
  locale: "zh-Hans",
  text: `请生成一段面向大学一年级学习者的拉格朗日中值定理推导。

已知：f 在闭区间 [a,b] 上连续，在开区间 (a,b) 内可导，且 a<b。
目标：通过构造辅助函数并使用罗尔定理，得到至少存在 ξ∈(a,b)，使
f'(ξ)=(f(b)-f(a))/(b-a)。

教学要求：
1. 通则：若本步是对已有公式的改写，必须在同一棵树上 formula.transform，不要再开平行公式块；只有真正新的定义、辅助函数、定理陈述或独立结论才 formula.add；
2. 先单独介绍割线斜率公式；
3. 再引入辅助函数 φ(x)，它是另一棵公式树，不要伪装成上一公式的节点变换；
4. 分别解释 φ(a) 与 φ(b)，必要时让两个端点公式同时存在；
5. 应用罗尔定理前明确指出三个前提；
6. 求导和代回结论分成可理解的步骤；
7. 每一步提供简洁中文讲解并设置 focus/highlight；
8. 可以插入只讲解或只切换高亮的历史步骤；
9. 不省略 b-a≠0 这一约分条件。`,
  assumptions: ["f 在闭区间 [a,b] 上连续", "f 在开区间 (a,b) 内可导", "a<b"],
  target: "至少存在 ξ∈(a,b)，使 f'(ξ)=(f(b)-f(a))/(b-a)",
};

function slopeFrac(prefix: string) {
  return frac(
    minus(
      fn("f", tok("b", `${prefix}-fb`)),
      fn("f", tok("a", `${prefix}-fa`)),
      `${prefix}-num`,
    ),
    minus(
      tok("b", `${prefix}-den-b`),
      tok("a", `${prefix}-den-a`),
      `${prefix}-den`,
    ),
    `${prefix}-frac`,
  );
}

function narration(
  id: string,
  text: string,
  related?: DerivationPresentationV1["focus"],
): DerivationPresentationV1["narration"] {
  return [{ id, text, related }];
}

function subject(formulaId: string, nodeId: string) {
  return {
    type: "subject" as const,
    formulaId,
    subject: { type: "node" as const, id: nodeId },
  };
}

export function lagrangeCommitScript(): CommitDerivationStepArgsV1[] {
  return [
    {
      baseRevision: 0,
      summary: "明确拉格朗日中值定理的最终目标",
      actions: [],
      presentation: {
        narration: narration(
          "n1",
          "最终目标显示在讲解区；它现在只是待证明的目标，还不是已建立的定理或结论。",
        ),
      },
    },
    {
      baseRevision: 1,
      summary: "讲解目标等式中的割线斜率",
      actions: [],
      presentation: {
        narration: narration(
          "n2",
          "右边的分子是函数值差 f(b)-f(a)，分母是区间长度 b-a，合起来就是割线斜率。",
        ),
      },
    },
    {
      baseRevision: 2,
      summary: "独立引入割线斜率定义",
      ruleIds: ["define_secant_slope"],
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "slope_definition",
            label: "割线斜率",
            display: { role: "definition", caption: "割线斜率 m" },
            tree: eq(tok("m", "slope-m"), slopeFrac("slope"), "slope-eq"),
          },
        },
      ],
      presentation: {
        narration: narration(
          "n3",
          "把割线斜率定义为独立公式 m=(f(b)-f(a))/(b-a)。",
          [{ type: "formula", formulaId: "slope_definition" }],
        ),
        focus: [{ type: "formula", formulaId: "slope_definition" }],
        highlight: [
          {
            subject: { type: "formula", formulaId: "slope_definition" },
            tone: "primary",
            emphasis: "strong",
          },
        ],
      },
    },
    {
      baseRevision: 3,
      summary: "分别讲解斜率定义的分子与分母",
      actions: [],
      presentation: {
        narration: narration(
          "n4",
          "m 的分子、分母各自有几何意义，这一步不改公式结构。",
          [
            subject("slope_definition", "slope-num"),
            subject("slope_definition", "slope-den"),
          ],
        ),
        focus: [subject("slope_definition", "slope-m")],
        highlight: [
          {
            subject: subject("slope_definition", "slope-num"),
            tone: "primary",
            emphasis: "soft",
          },
          {
            subject: subject("slope_definition", "slope-den"),
            tone: "muted",
            emphasis: "soft",
          },
        ],
      },
    },
    {
      baseRevision: 4,
      summary: "引入独立的辅助函数 φ(x)",
      ruleIds: ["define_auxiliary_function"],
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "auxiliary_definition",
            label: "辅助函数",
            display: { role: "working", caption: "辅助函数 φ(x)" },
            tree: eq(
              fn("φ", tok("x", "phi-x"), "phi-left"),
              minus(
                fn("f", tok("x", "phi-fx"), "phi-f"),
                times(
                  tok("m", "phi-m"),
                  group(
                    minus(tok("x", "phi-xa-x"), tok("a", "phi-xa-a"), "phi-xa"),
                    "phi-xa-grp",
                  ),
                  "phi-mxa",
                ),
                "phi-right",
              ),
              "phi-eq",
            ),
          },
        },
      ],
      presentation: {
        narration: narration(
          "n5",
          "辅助函数 φ(x)=f(x)-m(x-a) 是另一棵公式树，不是把斜率公式就地改写。",
          [{ type: "formula", formulaId: "auxiliary_definition" }],
        ),
        focus: [{ type: "formula", formulaId: "auxiliary_definition" }],
        highlight: [
          {
            subject: { type: "formula", formulaId: "auxiliary_definition" },
            tone: "success",
            emphasis: "strong",
          },
        ],
      },
    },
    {
      baseRevision: 5,
      summary: "同时对照斜率定义与辅助函数",
      actions: [],
      presentation: {
        narration: narration(
          "n6",
          "斜率公式和辅助函数同时保留，便于对照 m 在 φ 中的角色。",
          [
            { type: "formula", formulaId: "slope_definition" },
            { type: "formula", formulaId: "auxiliary_definition" },
          ],
        ),
        focus: [
          { type: "formula", formulaId: "slope_definition" },
          { type: "formula", formulaId: "auxiliary_definition" },
        ],
        highlight: [
          {
            subject: { type: "formula", formulaId: "slope_definition" },
            tone: "primary",
            emphasis: "soft",
          },
          {
            subject: { type: "formula", formulaId: "auxiliary_definition" },
            tone: "success",
            emphasis: "soft",
          },
        ],
      },
    },
    {
      baseRevision: 6,
      summary: "由辅助函数得到 φ(a)=f(a)",
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "phi_at_a",
            label: "左端点",
            display: { role: "working", caption: "φ(a)" },
            tree: eq(
              fn("φ", tok("a", "phia-a"), "phia-left"),
              fn("f", tok("a", "phia-fa"), "phia-right"),
              "phia-eq",
            ),
          },
          provenance: {
            derivedFromFormulaId: "auxiliary_definition",
            kind: "specialize",
          },
        },
      ],
      presentation: {
        narration: narration(
          "n7",
          "把 x=a 代入辅助函数：a-a=0，于是 φ(a)=f(a)。",
          [{ type: "formula", formulaId: "phi_at_a" }],
        ),
        focus: [{ type: "formula", formulaId: "phi_at_a" }],
        highlight: [
          {
            subject: { type: "formula", formulaId: "phi_at_a" },
            tone: "primary",
            emphasis: "strong",
          },
        ],
      },
    },
    {
      baseRevision: 7,
      summary: "代入 x=b 得到尚未化简的 φ(b)",
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "phi_at_b_raw",
            label: "右端点（代入）",
            display: { role: "working", caption: "φ(b) 代入" },
            tree: eq(
              fn("φ", tok("b", "phib-b"), "phib-left"),
              minus(
                fn("f", tok("b", "phib-fb"), "phib-f"),
                times(
                  tok("m", "phib-m"),
                  group(
                    minus(
                      tok("b", "phib-ba-b"),
                      tok("a", "phib-ba-a"),
                      "phib-ba",
                    ),
                    "phib-ba-grp",
                  ),
                  "phib-mba",
                ),
                "phib-right",
              ),
              "phib-eq",
            ),
          },
          provenance: {
            derivedFromFormulaId: "auxiliary_definition",
            kind: "specialize",
          },
        },
      ],
      presentation: {
        narration: narration(
          "n8",
          "右端点先写成 φ(b)=f(b)-m(b-a)，下一步再代回斜率定义。",
          [{ type: "formula", formulaId: "phi_at_b_raw" }],
        ),
        focus: [{ type: "formula", formulaId: "phi_at_b_raw" }],
      },
    },
    {
      baseRevision: 8,
      summary: "标明 b-a≠0 才能约分",
      actions: [
        {
          type: "subject.set_attribute",
          formulaId: "phi_at_b_raw",
          baseFormulaRevision: 1,
          subject: { type: "node", id: "phib-ba" },
          key: "nonzero",
          value: true,
        },
      ],
      presentation: {
        narration: narration(
          "n9",
          "因为 a<b，所以 b-a≠0，后面才能把这段因子约去。",
          [subject("phi_at_b_raw", "phib-ba")],
        ),
        focus: [subject("phi_at_b_raw", "phib-ba")],
        highlight: [
          {
            subject: subject("phi_at_b_raw", "phib-ba"),
            tone: "warning",
            emphasis: "strong",
          },
        ],
      },
    },
    {
      baseRevision: 9,
      summary: "代回斜率并化简得到 φ(b)=f(a)",
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "phi_at_b",
            label: "右端点",
            display: { role: "working", caption: "φ(b)" },
            tree: eq(
              fn("φ", tok("b", "phibb-b"), "phibb-left"),
              fn("f", tok("a", "phibb-fa"), "phibb-right"),
              "phibb-eq",
            ),
          },
          provenance: {
            derivedFromFormulaId: "phi_at_b_raw",
            kind: "consequence",
          },
        },
      ],
      presentation: {
        narration: narration(
          "n10",
          "把 m 代回并约去非零因子 b-a 后，φ(b)=f(a)。",
          [{ type: "formula", formulaId: "phi_at_b" }],
        ),
        focus: [{ type: "formula", formulaId: "phi_at_b" }],
      },
    },
    {
      baseRevision: 10,
      summary: "指出两端点函数值相等",
      actions: [],
      presentation: {
        narration: narration(
          "n11",
          "现在 φ(a) 与 φ(b) 都等于 f(a)，两端点函数值相同。",
          [
            { type: "formula", formulaId: "phi_at_a" },
            { type: "formula", formulaId: "phi_at_b" },
          ],
        ),
        focus: [
          { type: "formula", formulaId: "phi_at_a" },
          { type: "formula", formulaId: "phi_at_b" },
        ],
        highlight: [
          {
            subject: { type: "formula", formulaId: "phi_at_a" },
            tone: "success",
            emphasis: "strong",
          },
          {
            subject: { type: "formula", formulaId: "phi_at_b" },
            tone: "success",
            emphasis: "strong",
          },
        ],
      },
    },
    {
      baseRevision: 11,
      summary: "应用罗尔定理",
      ruleIds: ["rolle_theorem"],
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "rolle_result",
            label: "罗尔定理",
            display: { role: "theorem", caption: "存在 ξ 使 φ'(ξ)=0" },
            tree: eq(
              fn("φ'", tok("ξ", "rolle-xi"), "rolle-left"),
              tok("0", "rolle-zero"),
              "rolle-eq",
            ),
          },
          provenance: {
            derivedFromFormulaId: "auxiliary_definition",
            kind: "consequence",
          },
        },
      ],
      presentation: {
        narration: narration(
          "n12",
          "φ 在 [a,b] 连续、(a,b) 可导，且 φ(a)=φ(b)，罗尔定理给出存在 ξ∈(a,b) 使 φ'(ξ)=0。",
          [{ type: "formula", formulaId: "rolle_result" }],
        ),
        focus: [{ type: "formula", formulaId: "rolle_result" }],
      },
    },
    {
      baseRevision: 12,
      summary: "对辅助函数求导",
      ruleIds: ["differentiate_difference"],
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "phi_derivative",
            label: "导数",
            display: { role: "working", caption: "φ'(x)" },
            tree: eq(
              fn("φ'", tok("x", "dphi-x"), "dphi-left"),
              minus(
                fn("f'", tok("x", "dphi-fx"), "dphi-f"),
                tok("m", "dphi-m"),
                "dphi-right",
              ),
              "dphi-eq",
            ),
          },
          provenance: {
            derivedFromFormulaId: "auxiliary_definition",
            kind: "consequence",
          },
        },
      ],
      presentation: {
        narration: narration("n13", "φ'(x)=f'(x)-m，求导后 m 作为常数留下。", [
          { type: "formula", formulaId: "phi_derivative" },
        ]),
        focus: [{ type: "formula", formulaId: "phi_derivative" }],
      },
    },
    {
      baseRevision: 13,
      summary: "在 ξ 处结合罗尔结论",
      ruleIds: ["solve_linear_equality"],
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "phi_derivative_at_xi",
            label: "在 ξ 处",
            display: { role: "working", caption: "φ'(ξ)=f'(ξ)-m" },
            tree: eq(
              fn("φ'", tok("ξ", "dphixi-xi"), "dphixi-left"),
              minus(
                fn("f'", tok("ξ", "dphixi-arg"), "dphixi-fprime"),
                tok("m", "dphixi-m"),
                "dphixi-right",
              ),
              "dphixi-eq",
            ),
          },
          provenance: {
            derivedFromFormulaId: "phi_derivative",
            kind: "specialize",
          },
        },
      ],
      presentation: {
        narration: narration(
          "n14",
          "把 x=ξ 代入导数式，再与 φ'(ξ)=0 联立得到 f'(ξ)=m。",
          [
            { type: "formula", formulaId: "phi_derivative_at_xi" },
            { type: "formula", formulaId: "rolle_result" },
          ],
        ),
        focus: [{ type: "formula", formulaId: "phi_derivative_at_xi" }],
      },
    },
    {
      baseRevision: 14,
      summary: "代回斜率定义得到结论",
      actions: [
        {
          type: "formula.add",
          formula: {
            id: "conclusion",
            label: "结论",
            display: { role: "result", caption: "拉格朗日中值定理" },
            tree: eq(
              fn("f'", tok("ξ", "conc-xi"), "conc-left"),
              slopeFrac("conc"),
              "conc-eq",
            ),
          },
          provenance: {
            derivedFromFormulaId: "phi_derivative_at_xi",
            kind: "consequence",
          },
        },
      ],
      presentation: {
        narration: narration("n15", "把 m 代回割线斜率，就得到要证明的等式。", [
          { type: "formula", formulaId: "conclusion" },
        ]),
        focus: [{ type: "formula", formulaId: "conclusion" }],
        highlight: [
          {
            subject: { type: "formula", formulaId: "conclusion" },
            tone: "success",
            emphasis: "strong",
          },
        ],
      },
    },
    {
      baseRevision: 15,
      summary: "收束：突出结论并弱化中间公式",
      kind: "summary",
      actions: [],
      presentation: {
        narration: narration(
          "n16",
          "中间的工作公式可以退到背景，结论单独强调。",
          [{ type: "formula", formulaId: "conclusion" }],
        ),
        focus: [{ type: "formula", formulaId: "conclusion" }],
        highlight: [
          {
            subject: { type: "formula", formulaId: "conclusion" },
            tone: "success",
            emphasis: "strong",
          },
        ],
        dimOthers: true,
        formulaVisibility: [
          { formulaId: "phi_at_b_raw", state: "hidden" },
          { formulaId: "phi_derivative_at_xi", state: "hidden" },
        ],
      },
    },
  ];
}

export function buildLagrangeDerivationDocument(
  id = "lagrange-mvt-fixture",
): DerivationDocumentV1 {
  const facts = seedFactsFromRequirement(
    LAGRANGE_REQUIREMENT.text,
    LAGRANGE_REQUIREMENT.assumptions,
  );
  let state = compileInitialFormulas([], facts);
  const steps = [];
  for (const args of lagrangeCommitScript()) {
    const committed = commitDerivationStep(state, {
      ...args,
      source: "admin",
    });
    steps.push(committed.step);
    state = committed.state;
  }
  return {
    schemaVersion: DERIVATION_SCHEMA_VERSION,
    id,
    title: LAGRANGE_REQUIREMENT.title,
    locale: LAGRANGE_REQUIREMENT.locale,
    revision: state.derivationRevision,
    status: "draft",
    requirement: {
      text: LAGRANGE_REQUIREMENT.text,
      assumptions: LAGRANGE_REQUIREMENT.assumptions,
      target: LAGRANGE_REQUIREMENT.target,
    },
    initialFormulas: [],
    steps,
  };
}

export function emptyDerivationDocument(input: {
  id: string;
  title: string;
  locale: string;
  requirement: DerivationDocumentV1["requirement"];
}): DerivationDocumentV1 {
  return {
    schemaVersion: DERIVATION_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    locale: input.locale,
    revision: 0,
    status: "draft",
    requirement: input.requirement,
    initialFormulas: [],
    steps: [],
  };
}
