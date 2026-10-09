import { LAGRANGE_FIXTURE_ID, LAGRANGE_REQUIREMENT } from "./lagrange.js";

export type FormalDerivationPromptCase = {
  id: string;
  title: string;
  locale: string;
  summary: string;
  text: string;
  assumptions: string[];
  target: string;
  fixtureId?: typeof LAGRANGE_FIXTURE_ID;
};

const TEACHING_REQUIREMENTS = `教学要求：
1. 通则：若本步是对已有公式的改写（展开、合并、两边同除、移项、代入、约分等），必须保留同一 formulaId 并用 formula.transform；禁止再开平行公式块。两个已有因子、项或分子/分母部分只是交换位置时必须用 swap_subtrees，并保留两棵子树的 id；只有真实代入才用 substitute。内容或结构确实改写时才用 replace_subtree，其 replacement 根 id 应省略或与 target.id 相同，禁止把目标从 cand 逐步改名成 cand2、cand3；未变化的子表达式复用 inspect 得到的 id。board 各行是独立动画范围，禁止复用 id 把节点从一行移动到另一行。
2. 需要同时看见多行相关内容时，优先一棵大树：根是无语义的 board 容器（renderer "board"，layout stack），子槽是已知条件、工作式或平行过程；平行代入（例如 y=3x 在 x=3 与 x=5）放在同一 board 的兄弟槽里分别变形，不要拆成两张公式卡片。board 表示同时空间，不是竖向历史；不得随时间步追加“候选 / 求导 / 代入 / 化简”等新行。board 一旦建立，后续变形保持行数不变，只替换当前工作子树，让学习者看到同一公式变形。已经稳定的已知或结论可以钉在旁轨，或仍留在 board 里。只有真正新的定义、定理陈述或独立结论才 formula.add；
3. 每条公式用简洁中文 caption 说明它在讲什么；讲解里不要出现内部标识符；
4. 每一步用教师口吻写中文讲解（现在在看什么、这一步做什么、为什么可以这样做），可用 $...$；不要写成标题或电报式标签；并设置 focus/highlight，且 narration.related 指向讲解的表达式（乘积 g(x)·h(y) 指向乘积节点，不要只点 ·，也不要高亮未改写的另一侧）；若使用 dimOthers，必须对要强调的公式设置 focus 或 highlight；幂写成 token "^" 的底数与指数，不要用 renderer/token "sup" 表示上标；
5. 可以插入只讲解或只切换高亮的历史步骤；
6. 乘积中的和差必须写成括号分组；函数作用必须写成 f(u)、f(g(x))，参数用 surround 括号分组，不要写成 f g x；除法使用三槽分数容器（分子 / ― / 分母），不要写成线性斜杠；dy/dx 写成微分的分数，不要用 token "dy/dx" 当函数名；平方根用 renderer "radical" 且 layout surround 的 symbol 为 √，不要把 √ 放在 left/right；积分使用 renderer "integral"；
7. 若需要分情况，用 branch.split / case / join 标记逻辑分支；时间轴仍按顺序一种情况写完再写下一种，不要做成并行 DAG。
8. 每一步只做一次代数或记号改写：summary 与讲解都只说这一次操作。两边同乘与改写成微分、开方与讨论定义域，必须分成两步。`;

function caseText(body: string): string {
  return `${body.trim()}\n\n${TEACHING_REQUIREMENTS}`;
}

export const FORMAL_DERIVATION_PROMPT_CASES: FormalDerivationPromptCase[] = [
  {
    id: "lagrange-mvt",
    title: LAGRANGE_REQUIREMENT.title,
    locale: LAGRANGE_REQUIREMENT.locale,
    summary: "构造辅助函数，用罗尔定理推出拉格朗日中值定理。",
    text: LAGRANGE_REQUIREMENT.text,
    assumptions: [...LAGRANGE_REQUIREMENT.assumptions],
    target: LAGRANGE_REQUIREMENT.target,
    fixtureId: LAGRANGE_FIXTURE_ID,
  },
  {
    id: "abs-cases",
    title: "绝对值的分段定义",
    locale: "zh-Hans",
    summary: "按 x 的符号分情况，再汇总成分段定义。",
    text: caseText(`请生成一段面向高中或大学一年级学习者的绝对值定义推导。

已知：x 为实数。
目标：得到 |x| 在 x>0、x=0、x<0 三种情况下的分段表达式，并汇总成一条定义。

结构建议：
1. 先用 branch.role=split 声明三种情况，不要把三种情形写成三条并行时间轴；
2. 按声明顺序写完一种情况再写下一种（branch.role=case），每种情况用独立 working 公式；
3. 进入下一情况时隐藏上一情况的工作式；
4. 最后 branch.role=join，引入一条分段结论公式。`),
    assumptions: ["x 为实数"],
    target: "|x| 按 x>0、x=0、x<0 分段定义",
  },
  {
    id: "rolle-theorem",
    title: "罗尔定理",
    locale: "zh-Hans",
    summary: "端点函数值相等时，开区间内导数至少有一个零点。",
    text: caseText(`请生成一段面向大学一年级学习者的罗尔定理推导。

已知：f 在闭区间 [a,b] 上连续，在开区间 (a,b) 内可导，且 f(a)=f(b)。
目标：说明至少存在 ξ∈(a,b)，使 f'(ξ)=0。

结构建议：先单独写出端点条件，再说明连续可导如何保证极值，最后得到导数零点。`),
    assumptions: [
      "f 在闭区间 [a,b] 上连续",
      "f 在开区间 (a,b) 内可导",
      "f(a)=f(b)",
    ],
    target: "至少存在 ξ∈(a,b)，使 f'(ξ)=0",
  },
  {
    id: "cauchy-mvt",
    title: "柯西中值定理",
    locale: "zh-Hans",
    summary: "对两个函数构造辅助函数，得到柯西中值形式。",
    text: caseText(`请生成一段面向大学一年级学习者的柯西中值定理推导。

已知：f,g 在 [a,b] 上连续，在 (a,b) 内可导，且 g'(x)≠0，a<b。
目标：至少存在 ξ∈(a,b)，使 (f(b)-f(a))/(g(b)-g(a))=f'(ξ)/g'(ξ)。

结构建议：先写出两个增量比，再引入辅助函数，应用罗尔定理后整理成目标等式。不要省略 g(b)≠g(a) 的说明。`),
    assumptions: [
      "f,g 在 [a,b] 上连续",
      "f,g 在 (a,b) 内可导",
      "g'(x)≠0",
      "a<b",
    ],
    target: "至少存在 ξ∈(a,b)，使 (f(b)-f(a))/(g(b)-g(a))=f'(ξ)/g'(ξ)",
  },
  {
    id: "chain-rule",
    title: "复合函数求导",
    locale: "zh-Hans",
    summary: "由增量比过渡到 (f∘g)' = f'(g)·g'。",
    text: caseText(`请生成一段面向大学一年级学习者的复合函数求导法则推导。

已知：y=f(u)，u=g(x)，且 f、g 在相应点可导。
目标：得到 (f(g(x)))'=f'(g(x))·g'(x)。

结构建议：先写 Δy/Δx = (Δy/Δu)·(Δu/Δx)，再在同一公式树上分别取极限得到结论。`),
    assumptions: ["y=f(u) 在 u=g(x) 处可导", "u=g(x) 在 x 处可导"],
    target: "(f(g(x)))'=f'(g(x))·g'(x)",
  },
  {
    id: "product-rule",
    title: "乘积求导法则",
    locale: "zh-Hans",
    summary: "用增量展开得到 (uv)'=u'v+uv'。",
    text: caseText(`请生成一段面向大学一年级学习者的乘积求导法则推导。

已知：u(x)、v(x) 在 x 处可导。
目标：得到 (u(x)v(x))'=u'(x)v(x)+u(x)v'(x)。

结构建议：先写出 Δ(uv) 定义，再在同一公式树上展开得到三项，再原地同除以 Δx，最后取极限得到结论公式，并说明交叉项趋于 0。不要为“展开”和“两边同除”各开一条新公式块。`),
    assumptions: ["u(x) 在 x 处可导", "v(x) 在 x 处可导"],
    target: "(uv)'=u'v+uv'",
  },
  {
    id: "limit-sinc",
    title: "重要极限 sin x / x",
    locale: "zh-Hans",
    summary: "用几何夹逼得到 lim_{x→0} sin x / x = 1。",
    text: caseText(`请生成一段面向大学一年级学习者的极限 lim_{x→0} (sin x)/x = 1 的推导。

已知：x 为弧度，且 0<|x|<π/2。
目标：用夹逼定理得到该极限为 1。

结构建议：先写出单位圆中的面积或线段不等式，整理成 sin、tan 与 x 的夹逼，再取极限。几何关系用独立公式表示。`),
    assumptions: ["x 以弧度为单位", "0<|x|<π/2"],
    target: "lim_{x→0} (sin x)/x = 1",
  },
  {
    id: "ivt",
    title: "介值定理",
    locale: "zh-Hans",
    summary: "连续函数在闭区间上取到端点值之间的每一个值。",
    text: caseText(`请生成一段面向大学一年级学习者的介值定理讲解推导。

已知：f 在 [a,b] 上连续，且 k 介于 f(a) 与 f(b) 之间。
目标：至少存在 ξ∈[a,b]，使 f(ξ)=k。

结构建议：可用辅助函数 φ(x)=f(x)-k，说明符号变化与零点存在。不要把零点定理和介值定理混成同一棵公式树。`),
    assumptions: ["f 在 [a,b] 上连续", "k 介于 f(a) 与 f(b) 之间"],
    target: "至少存在 ξ∈[a,b]，使 f(ξ)=k",
  },
  {
    id: "de-morgan",
    title: "命题逻辑的德摩根律",
    locale: "zh-Hans",
    summary: "从 ¬(P∧Q) 得到 ¬P∨¬Q，并写成等价。",
    text: caseText(`请生成一段面向逻辑学或离散数学学习者的德摩根律推导。

已知：命题 P、Q。
目标：得到 ¬(P∧Q) ⇔ ¬P∨¬Q。

结构建议：先写出合取，再在同一公式树上取否定并分配到两个命题。不要把 ¬(P∧Q) 和 ¬P∨¬Q 做成两张互不相关的卡片；最后可用 ⇔ 写在同一行。讲解用命题逻辑语言，不要引入真值表网格。`),
    assumptions: ["P、Q 为命题"],
    target: "¬(P∧Q) ⇔ ¬P∨¬Q",
  },
  {
    id: "modus-ponens",
    title: "肯定前件（多前提）",
    locale: "zh-Hans",
    summary: "已知 P⇒Q 与 P，推出 Q。",
    text: caseText(`请生成一段面向逻辑学学习者的肯定前件推理。

已知：P⇒Q，以及 P。
目标：得到 Q。

结构建议：用一棵 board 同时钉住两条已知，工作行从 ? 写成 P ⊢ Q 再落到 Q。不要把两条已知拆成随时间追加的历史行。`),
    assumptions: ["P⇒Q", "P"],
    target: "Q",
  },
  {
    id: "disjunctive-syllogism",
    title: "选言三段论的分情况",
    locale: "zh-Hans",
    summary: "已知 P∨Q 与 ¬P，按情况排除 P 后得到 Q。",
    text: caseText(`请生成一段面向逻辑学学习者的选言三段论。

已知：P∨Q，以及 ¬P。
目标：得到 Q。

结构建议：
1. 用 board 钉住两条已知，工作行做分情况；
2. 用 branch.split / case / join：先假设 P，与 ¬P 合取得到 ⊥，再假设 Q；
3. 时间轴仍按顺序一种情况写完再写下一种，不要做成并行 DAG。`),
    assumptions: ["P∨Q", "¬P"],
    target: "Q",
  },
  {
    id: "quantifier-order",
    title: "量词顺序 ∀∃ 与 ∃∀",
    locale: "zh-Hans",
    summary: "说明 ∀x∃y P(x,y) 与 ∃y∀x P(x,y) 不是同一句话。",
    text: caseText(`请生成一段面向谓词逻辑学习者的量词顺序讲解。

已知：二元谓词 P(x,y)。
目标：分别写出 ∀x∃y P(x,y) 与 ∃y∀x P(x,y)，并说明后者更强。

结构建议：先对 ∀x∃y 做示例性实例化（x 取 a，再取某个 y），然后另起工作式写 ∃y∀x，用同一个见证 b。不要把两种量词顺序写成可以互相改写的等价式。`),
    assumptions: ["P 为二元谓词"],
    target: "∀x∃y P(x,y) 与 ∃y∀x P(x,y) 强弱不同",
  },
  {
    id: "quadratic-formula",
    title: "配方法求一元二次方程的根",
    locale: "zh-Hans",
    summary: "从 ax²+bx+c=0 配方得到求根公式，这是解题过程而不是定理证明。",
    text: caseText(`请生成一段面向高中学习者的一元二次方程求解过程，而不是定理证明。

已知：a≠0，方程 ax²+bx+c=0。
目标：得到 x = (-b±√(b²-4ac))/(2a)。

结构建议：严格把原方程作为唯一的 working formulaId，并参考 debug 中“配方法求根”的原地节奏：两边同除 a → 移走常数项 → 两边同时补 (b/2a)² → 左边改写成完全平方 → 右边通分合并 → 开方 → 移走 b/(2a) → 合并为求根公式。每一步只做一个最小可见变化。纯交换用 swap_subtrees；真实代入用 substitute/substitute_many；项跨越等号或改变父运算符时用 relocate_subtree，并把移动项的原 node id 放进 moving 且在 replacement 中复用；只有局部内容真正改写时才对最小子树 replace_subtree。禁止为每一步 formula.add 新公式，也不要把求根公式提前当作定理钉住。`),
    assumptions: ["a≠0", "方程为 ax²+bx+c=0"],
    target: "x = (-b±√(b²-4ac))/(2a)",
  },
  {
    id: "uniform-acceleration",
    title: "匀变速直线运动位移",
    locale: "zh-Hans",
    summary: "从 v=v₀+at 整理得到 s=v₀t+½at²，作为物理计算过程。",
    text: caseText(`请生成一段面向高中物理学习者的匀变速直线运动位移求解过程。

已知：质点从静止或初速度 v₀ 做匀加速直线运动，加速度为恒定 a。
目标：得到位移 s=v₀t+½at²。

结构建议：先写出 v=v₀+at，再由平均速度或对时间积分在同一工作式上得到位移。不要把位移公式当作事先成立的定理。受力分析图不是本段的任务。`),
    assumptions: ["加速度 a 恒定", "初速度为 v₀"],
    target: "s=v₀t+½at²",
  },
  {
    id: "linear-substitution",
    title: "一次函数的平行代入",
    locale: "zh-Hans",
    summary: "已知 y=3x，在同一棵树上同时代入 x=3 与 x=5。",
    text: caseText(`请生成一段面向初中学习者的一次函数求值过程，而不是定理证明。

已知：y=3x。
目标：分别求出 x=3 和 x=5 时 y 的值。

结构建议：
1. 用一棵 board 树同时展示相关内容：根是 renderer "board" 的 stack 容器，不要为每一行公式各开一张卡片；
2. 一行是已知 y=3x；另外两行是平行代入过程（x=3 与 x=5），在各自子树上变形，例如 y=3·3 再到 y=9；
3. 已知式如果已经稳定，可以钉住分开展示，但两个代入过程必须留在同一 board 里，这样多行一起出现、动画只在改动的子树上发生。`),
    assumptions: ["y=3x"],
    target: "x=3 时 y=9；x=5 时 y=15",
  },
];

export function getFormalDerivationPromptCase(id: string) {
  return FORMAL_DERIVATION_PROMPT_CASES.find((item) => item.id === id) ?? null;
}
