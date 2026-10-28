/**
 * Certified, renderer-neutral chemistry experiments.
 *
 * Chemistry labs intentionally expose a small operation vocabulary.  The
 * renderer can present these operations as buttons, drag/drop, or native
 * controls, but it cannot invent substances, reactions, or calculations.
 */

export type ChemistryExperimentId =
  | "acid_base_indicator"
  | "acid_base_titration"
  | "precipitation_reaction"
  | "mass_conservation";

export type ChemistryStage = "middle_school" | "high_school" | "undergraduate";

export type ChemistrySubstanceId =
  | "water"
  | "hydrochloric_acid"
  | "sodium_hydroxide"
  | "phenolphthalein"
  | "methyl_orange"
  | "silver_nitrate"
  | "sodium_chloride"
  | "copper_sulfate"
  | "sodium_carbonate";

export const CHEMISTRY_SUBSTANCES: readonly ChemistrySubstanceId[] = [
  "water",
  "hydrochloric_acid",
  "sodium_hydroxide",
  "phenolphthalein",
  "methyl_orange",
  "silver_nitrate",
  "sodium_chloride",
  "copper_sulfate",
  "sodium_carbonate",
];

export type ChemistryVesselKind =
  | "beaker"
  | "conical_flask"
  | "test_tube"
  | "dropper"
  | "burette"
  | "graduated_cylinder"
  | "balance";

export type ChemistryParameterSpec = {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type ChemistryObservation = {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  kind?: "scalar" | "text" | "state";
};

export type ChemistryVesselState = {
  id: string;
  kind: ChemistryVesselKind;
  label: string;
  volumeMl: number;
  contents: Partial<Record<ChemistrySubstanceId, number>>;
  color?: string;
  precipitateG?: number;
};

export type ChemistryLabSnapshot = {
  step: number;
  scaleZeroed: boolean;
  completed: boolean;
  pH?: number;
  indicatorColor?: string;
  titrantVolumeMl?: number;
  measuredVolumeMl?: number;
  precipitateG?: number;
  measuredMassG?: number;
  totalMassG?: number;
  observations: ChemistryObservation[];
  vessels: ChemistryVesselState[];
};

export type ChemistryLabDefinition = {
  type: "chemistry_lab";
  experimentId: ChemistryExperimentId;
  experimentVersion: 1;
  title: string;
  summary: string;
  stage: ChemistryStage;
  renderMode: "2d" | "3d";
  parameters: Record<string, number>;
  targetObservation?: string;
  controls?: string[];
  observations?: ChemistryObservation[];
  snapshot?: ChemistryLabSnapshot;
};

export type ChemistryOperation =
  | {
      kind: "add_reagent";
      vesselId: string;
      substance: ChemistrySubstanceId;
      amountMl: number;
    }
  | { kind: "mix"; vesselId: string }
  | { kind: "titrate"; vesselId: string; amountMl: number }
  | { kind: "measure_volume"; vesselId: string }
  | {
      kind: "transfer";
      sourceVesselId: string;
      targetVesselId: string;
      amountMl: number;
    }
  | { kind: "tare_scale" }
  | { kind: "measure_mass"; vesselId: string };

export type ChemistryOperationResult = {
  accepted: boolean;
  state: ChemistryLabSnapshot;
  message: string;
};

export type ChemistryExperiment = {
  id: ChemistryExperimentId;
  version: 1;
  title: string;
  summary: string;
  stages: readonly ChemistryStage[];
  renderMode: "2d" | "3d";
  parameters: readonly ChemistryParameterSpec[];
  controls: readonly string[];
  initial: (parameters: Record<string, number>) => ChemistryLabSnapshot;
  evaluate: (
    parameters: Record<string, number>,
    snapshot?: ChemistryLabSnapshot,
  ) => { observations: ChemistryObservation[]; snapshot: ChemistryLabSnapshot };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const round = (value: number, digits = 4) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const parameter = (
  id: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
): ChemistryParameterSpec => ({
  id,
  label,
  unit,
  min,
  max,
  step,
  default: defaultValue,
});
const obs = (
  id: string,
  label: string,
  value: number | string,
  unit?: string,
  kind?: ChemistryObservation["kind"],
): ChemistryObservation => ({
  id,
  label,
  value: typeof value === "number" ? round(value) : value,
  ...(unit ? { unit } : {}),
  ...(kind ? { kind } : {}),
});

function paramsOf(
  experiment: ChemistryExperiment,
  input?: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    experiment.parameters.map((spec) => [
      spec.id,
      clamp(input?.[spec.id] ?? spec.default, spec.min, spec.max),
    ]),
  );
}

function validSnapshot(
  experiment: ChemistryExperiment,
  parameters: Record<string, number>,
  snapshot: ChemistryLabSnapshot,
): boolean {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    typeof snapshot.scaleZeroed !== "boolean" ||
    typeof snapshot.completed !== "boolean" ||
    !Array.isArray(snapshot.observations) ||
    !Array.isArray(snapshot.vessels)
  )
    return false;
  if (
    !Number.isInteger(snapshot.step) ||
    snapshot.step < 0 ||
    snapshot.step > 100
  )
    return false;
  if (
    snapshot.pH !== undefined &&
    (!Number.isFinite(snapshot.pH) || snapshot.pH < 0 || snapshot.pH > 14)
  )
    return false;
  for (const value of [
    snapshot.titrantVolumeMl,
    snapshot.measuredVolumeMl,
    snapshot.precipitateG,
    snapshot.measuredMassG,
    snapshot.totalMassG,
  ]) {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 1_000)
    )
      return false;
  }
  const expected = experiment.initial(parameters).vessels;
  if (snapshot.vessels.length !== expected.length) return false;
  return snapshot.vessels.every((item) => {
    if (!item || typeof item !== "object") return false;
    const template = expected.find((candidate) => candidate.id === item.id);
    if (
      !template ||
      item.kind !== template.kind ||
      typeof item.label !== "string" ||
      !item.label.trim() ||
      typeof item.contents !== "object" ||
      item.contents === null ||
      Array.isArray(item.contents)
    )
      return false;
    if (
      !Number.isFinite(item.volumeMl) ||
      item.volumeMl < 0 ||
      item.volumeMl > 1_000
    )
      return false;
    if (
      item.color !== undefined &&
      (typeof item.color !== "string" || item.color.length > 40)
    )
      return false;
    if (
      item.precipitateG !== undefined &&
      (!Number.isFinite(item.precipitateG) ||
        item.precipitateG < 0 ||
        item.precipitateG > 1_000)
    )
      return false;
    return Object.entries(item.contents).every(
      ([substance, amount]) =>
        CHEMISTRY_SUBSTANCES.includes(substance as ChemistrySubstanceId) &&
        Number.isFinite(amount) &&
        amount >= 0 &&
        amount <= 1_000,
    );
  });
}

function vessel(
  id: string,
  kind: ChemistryVesselKind,
  label: string,
  contents: Partial<Record<ChemistrySubstanceId, number>> = {},
): ChemistryVesselState {
  return { id, kind, label, volumeMl: 0, contents };
}

function baseSnapshot(vessels: ChemistryVesselState[]): ChemistryLabSnapshot {
  return {
    step: 0,
    scaleZeroed: false,
    completed: false,
    observations: [],
    vessels,
  };
}

function indicatorColor(pH: number, indicator: number): string {
  if (indicator < 0.5) {
    if (pH < 8.2) return "无色";
    if (pH < 10) return "浅粉色";
    return "粉红色";
  }
  if (pH < 3.1) return "红色";
  if (pH < 4.4) return "橙色";
  return "黄色";
}

function pHForTitration(
  analyteConcentration: number,
  analyteVolumeMl: number,
  titrantConcentration: number,
  titrantVolumeMl: number,
): number {
  const acidMoles = analyteConcentration * (analyteVolumeMl / 1_000);
  const baseMoles = titrantConcentration * (titrantVolumeMl / 1_000);
  const totalVolume = (analyteVolumeMl + titrantVolumeMl) / 1_000;
  if (totalVolume <= 0) return 7;
  const excess = acidMoles - baseMoles;
  if (Math.abs(excess) < 1e-9) return 7;
  if (excess > 0) return clamp(-Math.log10(excess / totalVolume), 0, 14);
  return clamp(14 + Math.log10(-excess / totalVolume), 0, 14);
}

const acidBaseIndicator: ChemistryExperiment = {
  id: "acid_base_indicator",
  version: 1,
  title: "酸碱指示剂",
  summary: "向样品中加入酸碱并滴加指示剂，观察 pH 与颜色的关系。",
  stages: ["middle_school", "high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [
    parameter("initialPh", "初始 pH", "", 0, 14, 0.1, 7),
    parameter("indicator", "指示剂", "", 0, 1, 1, 0),
    parameter("sampleVolumeMl", "样品体积", "mL", 1, 100, 1, 20),
  ],
  controls: ["add_reagent", "mix"],
  initial: (p) =>
    baseSnapshot([
      {
        ...vessel("sample", "beaker", "待测样品", { water: p.sampleVolumeMl }),
        volumeMl: p.sampleVolumeMl,
      },
      vessel("dropper", "dropper", "指示剂滴管", { phenolphthalein: 1 }),
    ]),
  evaluate: (p, input) => {
    const snapshot = input ?? acidBaseIndicator.initial(p);
    const sample = snapshot.vessels.find((item) => item.id === "sample");
    const pH = clamp(snapshot.pH ?? p.initialPh, 0, 14);
    const color = snapshot.indicatorColor ?? "未加指示剂";
    const observations = [
      obs("ph", "样品 pH", pH),
      obs("indicator_color", "指示剂颜色", color, undefined, "state"),
      obs(
        "status",
        "实验状态",
        snapshot.completed ? "已完成" : "可继续操作",
        undefined,
        "state",
      ),
      ...(sample
        ? [obs("sample_volume", "样品体积", sample.volumeMl, "mL")]
        : []),
    ];
    return { observations, snapshot: { ...snapshot, observations } };
  },
};

const acidBaseTitration: ChemistryExperiment = {
  id: "acid_base_titration",
  version: 1,
  title: "酸碱滴定",
  summary: "用标准碱液滴定酸样品，观察当量点附近 pH 的突变。",
  stages: ["high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [
    parameter(
      "analyteConcentration",
      "待测酸浓度",
      "mol/L",
      0.01,
      1,
      0.01,
      0.1,
    ),
    parameter(
      "titrantConcentration",
      "标准碱浓度",
      "mol/L",
      0.01,
      1,
      0.01,
      0.1,
    ),
    parameter("analyteVolumeMl", "待测酸体积", "mL", 5, 100, 1, 25),
  ],
  controls: ["titrate", "mix"],
  initial: (p) =>
    baseSnapshot([
      {
        ...vessel("flask", "conical_flask", "待测酸样品", {
          hydrochloric_acid: p.analyteConcentration,
        }),
        volumeMl: p.analyteVolumeMl,
      },
      vessel("burette", "burette", "标准碱液", {
        sodium_hydroxide: p.titrantConcentration,
      }),
    ]),
  evaluate: (p, input) => {
    const snapshot = input ?? acidBaseTitration.initial(p);
    const volume = snapshot.titrantVolumeMl ?? 0;
    const equivalence =
      (p.analyteConcentration * p.analyteVolumeMl) / p.titrantConcentration;
    const pH = pHForTitration(
      p.analyteConcentration,
      p.analyteVolumeMl,
      p.titrantConcentration,
      volume,
    );
    const reached =
      Math.abs(volume - equivalence) <= Math.max(0.2, equivalence * 0.01);
    const observations = [
      obs("titrant_volume", "已加入标准碱体积", volume, "mL"),
      obs("equivalence_volume", "理论当量体积", equivalence, "mL"),
      obs("ph", "混合液 pH", pH),
      obs(
        "endpoint",
        "终点判断",
        reached ? "接近当量点" : "继续滴定并充分振荡",
        undefined,
        "state",
      ),
    ];
    return {
      observations,
      snapshot: { ...snapshot, pH, completed: reached, observations },
    };
  },
};

const precipitationReaction: ChemistryExperiment = {
  id: "precipitation_reaction",
  version: 1,
  title: "沉淀反应",
  summary: "混合硝酸银和氯化钠溶液，观察氯化银沉淀及限量关系。",
  stages: ["middle_school", "high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [
    parameter(
      "silverNitrateConcentration",
      "硝酸银浓度",
      "mol/L",
      0.01,
      1,
      0.01,
      0.1,
    ),
    parameter(
      "sodiumChlorideConcentration",
      "氯化钠浓度",
      "mol/L",
      0.01,
      1,
      0.01,
      0.1,
    ),
    parameter("volumeMl", "各溶液体积", "mL", 1, 100, 1, 10),
  ],
  controls: ["add_reagent", "mix"],
  initial: (p) =>
    baseSnapshot([
      { ...vessel("mixing", "beaker", "混合烧杯"), volumeMl: 0 },
      {
        ...vessel("silver", "test_tube", "硝酸银", {
          silver_nitrate: p.silverNitrateConcentration,
        }),
        volumeMl: p.volumeMl,
      },
      {
        ...vessel("chloride", "test_tube", "氯化钠", {
          sodium_chloride: p.sodiumChlorideConcentration,
        }),
        volumeMl: p.volumeMl,
      },
    ]),
  evaluate: (p, input) => {
    const snapshot = input ?? precipitationReaction.initial(p);
    const silverMoles = p.silverNitrateConcentration * (p.volumeMl / 1_000);
    const chlorideMoles = p.sodiumChlorideConcentration * (p.volumeMl / 1_000);
    const precipitateMoles =
      snapshot.precipitateG != null ? snapshot.precipitateG / 143.32 : 0;
    const mass = round(Math.min(silverMoles, chlorideMoles) * 143.32, 4);
    const observedMass = snapshot.precipitateG ?? 0;
    const observations = [
      obs("precipitate_mass", "氯化银沉淀质量", observedMass, "g"),
      obs("theoretical_mass", "理论沉淀质量", mass, "g"),
      obs(
        "appearance",
        "现象",
        observedMass > 0 ? "生成白色沉淀" : "尚未混合",
        undefined,
        "state",
      ),
      obs(
        "conservation",
        "银离子与氯离子计量",
        precipitateMoles > 0 ? "按 1:1 消耗" : "等待混合",
        undefined,
        "state",
      ),
    ];
    return {
      observations,
      snapshot: { ...snapshot, observations, completed: observedMass > 0 },
    };
  },
};

const massConservation: ChemistryExperiment = {
  id: "mass_conservation",
  version: 1,
  title: "质量守恒",
  summary: "称量密闭容器中两种安全溶液混合前后的质量，验证质量守恒。",
  stages: ["middle_school", "high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [
    parameter("massA", "溶液 A 质量", "g", 1, 200, 1, 20),
    parameter("massB", "溶液 B 质量", "g", 1, 200, 1, 20),
  ],
  controls: ["tare_scale", "measure_mass", "mix"],
  initial: (p) =>
    baseSnapshot([
      {
        ...vessel("closed", "beaker", "密闭反应容器", {
          water: p.massA + p.massB,
        }),
        volumeMl: 40,
      },
    ]),
  evaluate: (p, input) => {
    const snapshot = input ?? massConservation.initial(p);
    const expected = p.massA + p.massB;
    const measured = snapshot.measuredMassG;
    const observations = [
      obs("before_mass", "混合前总质量", expected, "g"),
      obs("total_mass", "系统总质量", expected, "g"),
      obs(
        "measured_mass",
        "称得总质量",
        measured ?? "未称量",
        measured == null ? undefined : "g",
      ),
      obs(
        "difference",
        "质量差",
        measured == null ? "—" : Math.abs(measured - expected),
        measured == null ? undefined : "g",
      ),
      obs(
        "status",
        "实验状态",
        snapshot.completed ? "守恒验证通过" : "先归零再称量并混合",
        undefined,
        "state",
      ),
    ];
    return {
      observations,
      snapshot: { ...snapshot, totalMassG: expected, observations },
    };
  },
};

export const CHEMISTRY_EXPERIMENTS: readonly ChemistryExperiment[] = [
  acidBaseIndicator,
  acidBaseTitration,
  precipitationReaction,
  massConservation,
];

export const CHEMISTRY_EXPERIMENT_REGISTRY: ReadonlyMap<
  ChemistryExperimentId,
  ChemistryExperiment
> = new Map(
  CHEMISTRY_EXPERIMENTS.map((experiment) => [experiment.id, experiment]),
);

export function getChemistryExperiment(
  id: string,
  version = 1,
): ChemistryExperiment | null {
  return (
    CHEMISTRY_EXPERIMENTS.find(
      (item) => item.id === id && item.version === version,
    ) ?? null
  );
}

export function normalizeChemistryLabDefinition(input: {
  experimentId: string;
  experimentVersion?: number;
  title?: string;
  summary?: string;
  stage?: ChemistryStage;
  targetObservation?: string;
  parameters?: Record<string, number>;
  snapshot?: ChemistryLabSnapshot;
  /** Server callers can reject authored values instead of repairing them. */
  strictParameters?: boolean;
}): ChemistryLabDefinition | null {
  const experiment = getChemistryExperiment(
    input.experimentId,
    input.experimentVersion ?? 1,
  );
  if (!experiment) return null;
  if (
    input.strictParameters &&
    !experiment.parameters.every((spec) => {
      const value = input.parameters?.[spec.id];
      return (
        value === undefined ||
        (Number.isFinite(value) && value >= spec.min && value <= spec.max)
      );
    })
  ) {
    return null;
  }
  const parameters = paramsOf(experiment, input.parameters);
  const snapshot = input.snapshot
    ? validSnapshot(experiment, parameters, input.snapshot)
      ? input.snapshot
      : null
    : experiment.initial(parameters);
  if (!snapshot) return null;
  const evaluated = experiment.evaluate(parameters, snapshot);
  return {
    type: "chemistry_lab",
    experimentId: experiment.id,
    experimentVersion: 1,
    title: input.title?.trim().slice(0, 120) || experiment.title,
    summary: input.summary?.trim().slice(0, 500) || experiment.summary,
    stage:
      input.stage && experiment.stages.includes(input.stage)
        ? input.stage
        : experiment.stages[0]!,
    renderMode: experiment.renderMode,
    parameters,
    targetObservation: input.targetObservation?.trim().slice(0, 240),
    controls: [...experiment.controls],
    observations: evaluated.observations,
    snapshot: evaluated.snapshot,
  };
}

function cloneSnapshot(snapshot: ChemistryLabSnapshot): ChemistryLabSnapshot {
  return {
    ...snapshot,
    observations: [...snapshot.observations],
    vessels: snapshot.vessels.map((item) => ({
      ...item,
      contents: { ...item.contents },
    })),
  };
}

/** Apply one allowlisted operation. Rejected operations return the original state. */
export function applyChemistryOperation(
  definition: ChemistryLabDefinition,
  operation: ChemistryOperation,
): ChemistryOperationResult {
  const experiment = getChemistryExperiment(
    definition.experimentId,
    definition.experimentVersion,
  );
  if (!experiment)
    return {
      accepted: false,
      state: definition.snapshot!,
      message: "该实验版本暂不可用。",
    };
  const current =
    definition.snapshot ?? experiment.initial(definition.parameters);
  const next = cloneSnapshot(current);
  const fail = (message: string): ChemistryOperationResult => ({
    accepted: false,
    state: current,
    message,
  });
  const accept = (message: string): ChemistryOperationResult => {
    const evaluated = experiment.evaluate(definition.parameters, next);
    return { accepted: true, state: evaluated.snapshot, message };
  };
  const amount = "amountMl" in operation ? operation.amountMl : 0;
  if (
    "amountMl" in operation &&
    (!Number.isFinite(amount) || amount <= 0 || amount > 100)
  ) {
    return fail("用量必须在 0 到 100 mL 之间。操作未执行。");
  }

  if (operation.kind === "tare_scale") {
    if (experiment.id !== "mass_conservation") {
      return fail("当前实验不需要天平归零。操作未执行。");
    }
    next.scaleZeroed = true;
    next.step += 1;
    return accept("天平已归零，可以开始称量。");
  }
  if (operation.kind === "measure_mass") {
    if (experiment.id !== "mass_conservation") {
      return fail("当前实验不支持称量操作。");
    }
    if (!next.scaleZeroed) return fail("请先将天平归零，再进行称量。");
    if (operation.vesselId !== "closed") {
      return fail("质量守恒实验只能称量密闭反应容器。");
    }
    const vessel = next.vessels.find((item) => item.id === operation.vesselId);
    if (!vessel) return fail("找不到指定容器。操作未执行。");
    const p = definition.parameters;
    next.measuredMassG =
      experiment.id === "mass_conservation"
        ? (p.massA ?? 0) + (p.massB ?? 0)
        : vessel.volumeMl;
    if (experiment.id === "mass_conservation") {
      next.totalMassG = next.measuredMassG;
    }
    next.step += 1;
    return accept("称量完成，读数已记录。");
  }
  if (operation.kind === "measure_volume") {
    const vessel = next.vessels.find((item) => item.id === operation.vesselId);
    if (!vessel) return fail("找不到指定容器。操作未执行。");
    next.measuredVolumeMl = vessel.volumeMl;
    next.step += 1;
    return accept("已读取刻度并记录体积。");
  }
  if (operation.kind === "transfer") {
    if (operation.sourceVesselId === operation.targetVesselId) {
      return fail("转移的来源和目标容器必须不同。");
    }
    const source = next.vessels.find(
      (item) => item.id === operation.sourceVesselId,
    );
    const target = next.vessels.find(
      (item) => item.id === operation.targetVesselId,
    );
    if (!source || !target) return fail("找不到指定容器。操作未执行。");
    if (amount > source.volumeMl) {
      return fail("转移体积超过来源容器当前液体体积。");
    }
    const ratio = source.volumeMl > 0 ? amount / source.volumeMl : 0;
    for (const [substance, quantity] of Object.entries(source.contents)) {
      const moved = (quantity ?? 0) * ratio;
      source.contents[substance as ChemistrySubstanceId] = Math.max(
        0,
        (quantity ?? 0) - moved,
      );
      target.contents[substance as ChemistrySubstanceId] =
        (target.contents[substance as ChemistrySubstanceId] ?? 0) + moved;
    }
    source.volumeMl -= amount;
    target.volumeMl += amount;
    next.step += 1;
    return accept(`已将 ${amount} mL 液体转移到${target.label}。`);
  }
  if (operation.kind === "mix") {
    const vessel = next.vessels.find((item) => item.id === operation.vesselId);
    if (!vessel) return fail("找不到指定容器。操作未执行。");
    if (experiment.id === "acid_base_indicator") {
      if (operation.vesselId !== "sample") {
        return fail("指示剂实验只能在待测样品中混匀。");
      }
      const pH = next.pH ?? definition.parameters.initialPh ?? 7;
      if (!next.indicatorColor) return fail("请先加入指示剂，再振荡混匀。");
      next.indicatorColor = indicatorColor(
        pH,
        definition.parameters.indicator ?? 0,
      );
    } else if (experiment.id === "precipitation_reaction") {
      if (operation.vesselId !== "mixing") {
        return fail("沉淀实验只能在混合烧杯中混匀。");
      }
      const hasSilver = (vessel.contents.silver_nitrate ?? 0) > 0;
      const hasChloride = (vessel.contents.sodium_chloride ?? 0) > 0;
      if (!hasSilver || !hasChloride) {
        return fail("请先把硝酸银和氯化钠溶液都转移到混合烧杯。");
      }
      const silver =
        ((vessel.contents.silver_nitrate ?? 0) *
          definition.parameters.volumeMl!) /
        1_000;
      const chloride =
        ((vessel.contents.sodium_chloride ?? 0) *
          definition.parameters.volumeMl!) /
        1_000;
      next.precipitateG = round(Math.min(silver, chloride) * 143.32, 4);
    } else if (experiment.id === "acid_base_titration") {
      if (operation.vesselId !== "flask") {
        return fail("滴定实验只能在锥形瓶中振荡混匀。");
      }
      if ((next.titrantVolumeMl ?? 0) <= 0) {
        return fail("请先从滴定管滴加标准碱液，再振荡观察。");
      }
    } else if (experiment.id === "mass_conservation") {
      if (operation.vesselId !== "closed") {
        return fail("质量守恒实验只能在密闭反应容器中混合。");
      }
      if (next.measuredMassG === undefined) {
        return fail("请先归零并记录混合前质量，再进行混合。");
      }
      next.completed = true;
    }
    next.step += 1;
    return accept("已混合并充分振荡，现象已更新。");
  }
  if (operation.kind === "titrate") {
    if (experiment.id !== "acid_base_titration")
      return fail("当前实验不支持滴定操作。");
    if (operation.vesselId !== "burette") {
      return fail("滴定操作必须从标准碱液滴定管进行。");
    }
    const previous = next.titrantVolumeMl ?? 0;
    if (previous + amount > 100)
      return fail("滴定体积超过安全上限，操作未执行。");
    next.titrantVolumeMl = previous + amount;
    next.step += 1;
    return accept(`已滴加 ${amount} mL 标准碱液。`);
  }
  if (operation.kind === "add_reagent") {
    const vessel = next.vessels.find((item) => item.id === operation.vesselId);
    if (!vessel) return fail("找不到指定容器。操作未执行。");
    if (experiment.id === "acid_base_indicator") {
      if (operation.vesselId !== "sample") {
        return fail("指示剂实验只能向待测样品中加入认证试剂。");
      }
      if (
        operation.substance === "phenolphthalein" ||
        operation.substance === "methyl_orange"
      ) {
        next.indicatorColor = "已加入指示剂（待混匀）";
      } else if (operation.substance === "hydrochloric_acid") {
        next.pH = clamp(
          (next.pH ?? definition.parameters.initialPh ?? 7) - amount * 0.2,
          0,
          14,
        );
      } else if (operation.substance === "sodium_hydroxide") {
        next.pH = clamp(
          (next.pH ?? definition.parameters.initialPh ?? 7) + amount * 0.2,
          0,
          14,
        );
      } else return fail("该实验不允许加入此物质。");
      if (vessel.volumeMl + amount > 100) {
        return fail("样品体积超过 100 mL 安全上限。操作未执行。");
      }
      vessel.contents[operation.substance] =
        (vessel.contents[operation.substance] ?? 0) + amount;
      vessel.volumeMl += amount;
    } else if (experiment.id === "precipitation_reaction") {
      if (operation.vesselId !== "mixing") {
        return fail("沉淀实验的认证试剂只能加入混合烧杯。");
      }
      if (
        operation.substance !== "silver_nitrate" &&
        operation.substance !== "sodium_chloride"
      ) {
        return fail("沉淀实验只允许使用认证的两种溶液。");
      }
      if (vessel.volumeMl + amount > 100) {
        return fail("混合烧杯体积超过 100 mL 安全上限。操作未执行。");
      }
      const concentration =
        operation.substance === "silver_nitrate"
          ? (definition.parameters.silverNitrateConcentration ?? 0.1)
          : (definition.parameters.sodiumChlorideConcentration ?? 0.1);
      vessel.contents[operation.substance] =
        (vessel.contents[operation.substance] ?? 0) +
        (concentration * amount) / (definition.parameters.volumeMl ?? 100);
      vessel.volumeMl += amount;
    } else return fail("当前实验不支持自由加液，请使用实验规定的操作。");
    next.step += 1;
    return accept(`已向${vessel.label}加入 ${amount} mL 认证试剂。`);
  }
  return fail("未识别的实验操作。操作未执行。");
}
