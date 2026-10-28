/**
 * Renderer-neutral physics lab contracts and deterministic reference models.
 *
 * Lab definitions are intentionally data-only.  The registry below is the
 * authority for experiment ids, parameters and scientific calculations; a
 * renderer may only consume the returned observations/series/scene hints.
 */

export type PhysicsBranch =
  | "mechanics"
  | "waves"
  | "thermodynamics"
  | "electromagnetism"
  | "optics"
  | "modern_physics";

export type PhysicsStage = "middle_school" | "high_school" | "undergraduate" | "graduate";
export type PhysicsRenderMode = "2d" | "3d" | "hybrid";

export type PhysicsExperimentId =
  | "inclined_plane_friction"
  | "collision_1d"
  | "simple_pendulum"
  | "driven_damped_spring"
  | "projectile_motion"
  | "wave_interference"
  | "ideal_gas_process"
  | "electrostatic_field"
  | "electromagnetic_induction"
  | "thin_lens_imaging"
  | "double_slit_interference"
  | "quantum_tunneling_1d";

export type PhysicsParameterSpec = {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type PhysicsObservation = {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  kind?: "scalar" | "vector" | "text";
};

export type PhysicsSeries = {
  id: string;
  label: string;
  unit?: string;
  x: number[];
  y: number[];
};

export type PhysicsLabDefinition = {
  type: "physics_lab";
  experimentId: PhysicsExperimentId;
  experimentVersion: 2;
  title: string;
  summary: string;
  branch: PhysicsBranch;
  stage: PhysicsStage;
  renderMode: PhysicsRenderMode;
  parameters: Record<string, number>;
  targetObservation?: string;
  controls?: string[];
  observations?: PhysicsObservation[];
  series?: PhysicsSeries[];
  /** Reserved for a future report/assessment lane; disabled in v2. */
  analysis?: { enabled: false };
};

export type PhysicsExperiment = {
  id: PhysicsExperimentId;
  version: 2;
  title: string;
  summary: string;
  branch: PhysicsBranch;
  stages: readonly PhysicsStage[];
  renderMode: PhysicsRenderMode;
  parameters: readonly PhysicsParameterSpec[];
  assumptions: readonly string[];
  controls: readonly string[];
  evaluate: (parameters: Record<string, number>, time?: number) => {
    observations: PhysicsObservation[];
    series?: PhysicsSeries[];
  };
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
): PhysicsParameterSpec => ({ id, label, unit, min, max, step, default: defaultValue });
const obs = (id: string, label: string, value: number | string, unit?: string): PhysicsObservation => ({
  id,
  label,
  value: typeof value === "number" ? round(value) : value,
  unit,
});
const linspace = (min: number, max: number, count = 80) =>
  Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));

function paramsOf(experiment: PhysicsExperiment, input?: Record<string, number>) {
  const result: Record<string, number> = {};
  for (const spec of experiment.parameters) {
    result[spec.id] = clamp(input?.[spec.id] ?? spec.default, spec.min, spec.max);
  }
  return result;
}

const inclinedPlane: PhysicsExperiment = {
  id: "inclined_plane_friction",
  version: 2,
  title: "斜面运动与摩擦",
  summary: "改变倾角、质量和摩擦系数，观察受力分解、滑动条件与能量变化。",
  branch: "mechanics",
  stages: ["middle_school", "high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [parameter("mass", "质量", "kg", 0.1, 20, 0.1, 1), parameter("angle", "倾角", "°", 0, 75, 1, 30), parameter("mu", "动摩擦因数", "", 0, 1, 0.01, 0.2), parameter("g", "重力加速度", "m/s²", 8, 12, 0.01, 9.8)],
  assumptions: ["刚体斜面", "库仑摩擦", "忽略空气阻力"],
  controls: ["mass", "angle", "mu", "g"],
  evaluate: (p) => {
    const mass = clamp(p.mass, 0.1, 20), angle = clamp(p.angle, 0, 75) * Math.PI / 180, mu = clamp(p.mu, 0, 1), g = clamp(p.g, 8, 12);
    const normal = mass * g * Math.cos(angle), parallel = mass * g * Math.sin(angle);
    const staticLimit = mu * normal, sliding = parallel > staticLimit;
    const friction = sliding ? staticLimit : parallel;
    const acceleration = sliding ? (parallel - friction) / mass : 0;
    return { observations: [obs("acceleration", "沿斜面加速度", acceleration, "m/s²"), obs("normal_force", "支持力", normal, "N"), obs("parallel_force", "重力沿面分力", parallel, "N"), obs("friction_force", "摩擦力", friction, "N"), obs("motion", "状态", sliding ? "发生滑动" : "静止") ] };
  },
};

const collision: PhysicsExperiment = {
  id: "collision_1d",
  version: 2,
  title: "一维碰撞",
  summary: "调节两个小车的质量、速度和恢复系数，比较碰撞前后的动量与动能。",
  branch: "mechanics",
  stages: ["middle_school", "high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [parameter("m1", "物体 A 质量", "kg", 0.1, 10, 0.1, 1), parameter("m2", "物体 B 质量", "kg", 0.1, 10, 0.1, 1), parameter("v1", "物体 A 初速度", "m/s", -10, 10, 0.1, 2), parameter("v2", "物体 B 初速度", "m/s", -10, 10, 0.1, 0), parameter("restitution", "恢复系数", "", 0, 1, 0.01, 1)],
  assumptions: ["一维瞬时碰撞", "系统无外力冲量"],
  controls: ["m1", "m2", "v1", "v2", "restitution"],
  evaluate: (p) => {
    const m1 = clamp(p.m1, 0.1, 10), m2 = clamp(p.m2, 0.1, 10), v1 = clamp(p.v1, -10, 10), v2 = clamp(p.v2, -10, 10), e = clamp(p.restitution, 0, 1);
    const v1f = ((m1 - e * m2) * v1 + (1 + e) * m2 * v2) / (m1 + m2);
    const v2f = ((1 + e) * m1 * v1 + (m2 - e * m1) * v2) / (m1 + m2);
    const p0 = m1 * v1 + m2 * v2, pf = m1 * v1f + m2 * v2f;
    const k0 = 0.5 * m1 * v1 ** 2 + 0.5 * m2 * v2 ** 2, kf = 0.5 * m1 * v1f ** 2 + 0.5 * m2 * v2f ** 2;
    return { observations: [obs("v1_final", "A 碰撞后速度", v1f, "m/s"), obs("v2_final", "B 碰撞后速度", v2f, "m/s"), obs("momentum_initial", "初始动量", p0, "kg·m/s"), obs("momentum_final", "末态动量", pf, "kg·m/s"), obs("energy_loss", "动能损失", Math.max(0, k0 - kf), "J") ] };
  },
};

const pendulum: PhysicsExperiment = {
  id: "simple_pendulum",
  version: 2,
  title: "单摆：小角近似与非线性",
  summary: "改变摆长和初始角度，比较小角近似周期与有限振幅周期。",
  branch: "mechanics",
  stages: ["middle_school", "high_school", "undergraduate", "graduate"],
  renderMode: "3d",
  parameters: [parameter("length", "摆长", "m", 0.1, 10, 0.01, 1), parameter("angle", "初始角度", "°", 1, 80, 1, 15), parameter("g", "重力加速度", "m/s²", 8, 12, 0.01, 9.8)],
  assumptions: ["无阻尼", "小角周期作为基准", "球形摆锤"],
  controls: ["length", "angle", "g"],
  evaluate: (p) => {
    const length = clamp(p.length, 0.1, 10), angle = clamp(p.angle, 1, 80) * Math.PI / 180, g = clamp(p.g, 8, 12);
    const small = 2 * Math.PI * Math.sqrt(length / g);
    const correction = 1 + angle ** 2 / 16 + 11 * angle ** 4 / 3072;
    return { observations: [obs("period_small_angle", "小角近似周期", small, "s"), obs("period_finite_angle", "有限振幅周期", small * correction, "s"), obs("relative_error", "近似相对误差", correction - 1, "") ] };
  },
};

const drivenSpring: PhysicsExperiment = {
  id: "driven_damped_spring",
  version: 2,
  title: "受迫阻尼弹簧与共振",
  summary: "改变驱动频率和阻尼，观察稳态振幅、相位差和共振峰。",
  branch: "mechanics",
  stages: ["high_school", "undergraduate", "graduate"],
  renderMode: "hybrid",
  parameters: [parameter("mass", "质量", "kg", 0.1, 10, 0.1, 1), parameter("spring", "劲度系数", "N/m", 1, 100, 1, 20), parameter("damping", "阻尼系数", "N·s/m", 0, 10, 0.01, 0.3), parameter("drive", "驱动频率", "Hz", 0.01, 10, 0.01, 0.7), parameter("force", "驱动力幅值", "N", 0.01, 10, 0.01, 1)],
  assumptions: ["线性回复力", "粘性阻尼", "稳态正弦驱动"],
  controls: ["mass", "spring", "damping", "drive", "force"],
  evaluate: (p) => {
    const m = clamp(p.mass, 0.1, 10), k = clamp(p.spring, 1, 100), c = clamp(p.damping, 0, 10), f = clamp(p.drive, 0.01, 10), F = clamp(p.force, 0.01, 10);
    const w = 2 * Math.PI * f, w0 = Math.sqrt(k / m), denominator = Math.sqrt((k - m * w ** 2) ** 2 + (c * w) ** 2);
    const amplitude = F / denominator, phase = Math.atan2(c * w, k - m * w ** 2);
    const responseX = linspace(0.01, Math.min(10, 2 * w0 / (2 * Math.PI)), 100);
    return { observations: [obs("natural_frequency", "固有频率", w0 / (2 * Math.PI), "Hz"), obs("amplitude", "稳态振幅", amplitude, "m"), obs("phase", "相位差", phase, "rad"), obs("quality_factor", "品质因数", Math.sqrt(m * k) / Math.max(c, 1e-9), "")], series: [{ id: "response", label: "频率-振幅响应", unit: "m", x: responseX, y: responseX.map((frequency) => { const angular = 2 * Math.PI * frequency; return F / Math.sqrt((k - m * angular ** 2) ** 2 + (c * angular) ** 2); }) }] };
  },
};

const projectile: PhysicsExperiment = {
  id: "projectile_motion",
  version: 2,
  title: "抛体运动",
  summary: "改变初速度、发射角和空气阻力，比较理想轨迹与阻力轨迹。",
  branch: "mechanics",
  stages: ["middle_school", "high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [parameter("speed", "初速度", "m/s", 0.1, 100, 0.1, 20), parameter("angle", "发射角", "°", 1, 89, 1, 45), parameter("height", "初始高度", "m", 0, 100, 0.1, 0), parameter("drag", "线性阻力系数", "1/s", 0, 2, 0.01, 0)],
  assumptions: ["二维运动", "重力恒定", "阻力采用线性近似"],
  controls: ["speed", "angle", "height", "drag"],
  evaluate: (p) => {
    const v = clamp(p.speed, 0.1, 100), a = clamp(p.angle, 1, 89) * Math.PI / 180, h = clamp(p.height, 0, 100), drag = clamp(p.drag, 0, 2), g = 9.8;
    const range = drag === 0 ? v * Math.cos(a) * (v * Math.sin(a) + Math.sqrt((v * Math.sin(a)) ** 2 + 2 * g * h)) / g : NaN;
    const maxHeight = h + (v * Math.sin(a)) ** 2 / (2 * g);
    const trajectoryX = linspace(0, Math.max(0, range || 10), 80);
    return { observations: [obs("range", "理论射程", Number.isFinite(range) ? range : "数值轨迹", "m"), obs("max_height", "最高点", maxHeight, "m"), obs("flight_time", "无阻力飞行时间", (v * Math.sin(a) + Math.sqrt((v * Math.sin(a)) ** 2 + 2 * g * h)) / g, "s")], series: [{ id: "trajectory", label: "运动轨迹", unit: "m", x: trajectoryX, y: trajectoryX.map((x) => h + x * Math.tan(a) - (g * x ** 2) / (2 * v ** 2 * Math.cos(a) ** 2)) }] };
  },
};

const wave: PhysicsExperiment = {
  id: "wave_interference",
  version: 2,
  title: "波的叠加与干涉",
  summary: "调节两列波的频率、相位和振幅，观察拍频、驻波与干涉条纹。",
  branch: "waves",
  stages: ["middle_school", "high_school", "undergraduate", "graduate"],
  renderMode: "3d",
  parameters: [parameter("frequency1", "波源 1 频率", "Hz", 0.1, 20, 0.1, 2), parameter("frequency2", "波源 2 频率", "Hz", 0.1, 20, 0.1, 2.2), parameter("amplitude", "振幅", "m", 0.01, 2, 0.01, 1), parameter("phase", "相位差", "rad", 0, 6.283, 0.01, 0)],
  assumptions: ["线性叠加", "同一传播介质", "忽略边界反射"],
  controls: ["frequency1", "frequency2", "amplitude", "phase"],
  evaluate: (p) => {
    const f1 = clamp(p.frequency1, 0.1, 20), f2 = clamp(p.frequency2, 0.1, 20), A = clamp(p.amplitude, 0.01, 2), phase = clamp(p.phase, 0, 6.283);
    const waveformX = linspace(0, 1 / Math.min(f1, f2), 120);
    return { observations: [obs("beat_frequency", "拍频", Math.abs(f1 - f2), "Hz"), obs("max_amplitude", "最大合振幅", 2 * A, "m"), obs("phase", "相位差", phase, "rad")], series: [{ id: "waveform", label: "合成波形", unit: "m", x: waveformX, y: waveformX.map((time) => A * Math.sin(2 * Math.PI * f1 * time) + A * Math.sin(2 * Math.PI * f2 * time + phase)) }] };
  },
};

const gas: PhysicsExperiment = {
  id: "ideal_gas_process",
  version: 2,
  title: "理想气体过程",
  summary: "在 PV 图中比较等温、等压、等容和绝热过程的状态变化与功。",
  branch: "thermodynamics",
  stages: ["high_school", "undergraduate", "graduate"],
  renderMode: "3d",
  parameters: [parameter("process", "过程类型", "", 0, 3, 1, 0), parameter("pressure", "初始压强", "kPa", 10, 500, 1, 101), parameter("volume", "初始体积", "L", 0.1, 100, 0.1, 1), parameter("temperature", "初始温度", "K", 100, 1000, 1, 300), parameter("gamma", "绝热指数", "", 1.1, 1.67, 0.01, 1.4)],
  assumptions: ["理想气体状态方程", "准静态过程", "绝热过程无热交换"],
  controls: ["process", "pressure", "volume", "temperature", "gamma"],
  evaluate: (p) => {
    const pressure = clamp(p.pressure, 10, 500), volume = clamp(p.volume, 0.1, 100), temperature = clamp(p.temperature, 100, 1000), gamma = clamp(p.gamma, 1.1, 1.67), process = Math.round(clamp(p.process, 0, 3));
    const labels = ["等温", "等压", "等容", "绝热"];
    const final = process === 0 ? { p: pressure, v: volume * 2, t: temperature } : process === 1 ? { p: pressure, v: volume * 2, t: temperature * 2 } : process === 2 ? { p: pressure * 2, v: volume, t: temperature * 2 } : { p: pressure / 2 ** gamma, v: volume * 2, t: temperature / 2 ** (gamma - 1) };
    return { observations: [obs("process", "过程", labels[process]), obs("final_pressure", "末态压强", final.p, "kPa"), obs("final_volume", "末态体积", final.v, "L"), obs("final_temperature", "末态温度", final.t, "K")], series: [{ id: "pv", label: "PV 路径", unit: "kPa·L", x: [volume, final.v], y: [pressure, final.p] }] };
  },
};

const electrostatic: PhysicsExperiment = {
  id: "electrostatic_field",
  version: 2,
  title: "静电场映射",
  summary: "移动点电荷和测试电荷，观察电势、等势线与电场方向。",
  branch: "electromagnetism",
  stages: ["high_school", "undergraduate", "graduate"],
  renderMode: "3d",
  parameters: [parameter("charge1", "电荷 q₁", "μC", -10, 10, 0.1, 1), parameter("charge2", "电荷 q₂", "μC", -10, 10, 0.1, -1), parameter("separation", "电荷间距", "m", 0.1, 10, 0.1, 2), parameter("probeX", "测试点 x", "m", -10, 10, 0.1, 0), parameter("probeY", "测试点 y", "m", -10, 10, 0.1, 1)],
  assumptions: ["点电荷近似", "真空介电常数", "静电平衡"],
  controls: ["charge1", "charge2", "separation", "probeX", "probeY"],
  evaluate: (p) => {
    const q1 = clamp(p.charge1, -10, 10) * 1e-6, q2 = clamp(p.charge2, -10, 10) * 1e-6, d = clamp(p.separation, 0.1, 10), x = clamp(p.probeX, -10, 10), y = clamp(p.probeY, -10, 10), k = 8.9875517923e9;
    const r1 = Math.max(1e-6, Math.hypot(x + d / 2, y)), r2 = Math.max(1e-6, Math.hypot(x - d / 2, y));
    const potential = k * (q1 / r1 + q2 / r2), ex = k * (q1 * (x + d / 2) / r1 ** 3 + q2 * (x - d / 2) / r2 ** 3), ey = k * (q1 * y / r1 ** 3 + q2 * y / r2 ** 3);
    return { observations: [obs("potential", "测试点电势", potential, "V"), obs("field_x", "电场 x 分量", ex, "N/C"), obs("field_y", "电场 y 分量", ey, "N/C"), obs("field_magnitude", "电场强度", Math.hypot(ex, ey), "N/C")] };
  },
};

const induction: PhysicsExperiment = {
  id: "electromagnetic_induction",
  version: 2,
  title: "电磁感应",
  summary: "改变磁场、线圈面积和匝数，观察磁通、感应电动势与楞次定律。",
  branch: "electromagnetism",
  stages: ["high_school", "undergraduate", "graduate"],
  renderMode: "hybrid",
  parameters: [parameter("turns", "线圈匝数", "匝", 1, 1000, 1, 100), parameter("area", "线圈面积", "m²", 0.0001, 10, 0.0001, 0.1), parameter("field", "磁场强度", "T", 0, 5, 0.01, 0.5), parameter("frequency", "变化频率", "Hz", 0.01, 20, 0.01, 1), parameter("angle", "磁场与法线夹角", "°", 0, 90, 1, 0)],
  assumptions: ["法拉第定律", "均匀磁场", "线圈刚性不变"],
  controls: ["turns", "area", "field", "frequency", "angle"],
  evaluate: (p) => {
    const N = clamp(p.turns, 1, 1000), A = clamp(p.area, 0.0001, 10), B = clamp(p.field, 0, 5), f = clamp(p.frequency, 0.01, 20), angle = clamp(p.angle, 0, 90) * Math.PI / 180;
    const flux = N * B * A * Math.cos(angle), emfPeak = N * B * A * 2 * Math.PI * f * Math.cos(angle);
    return { observations: [obs("flux", "磁通量", flux, "Wb"), obs("emf_peak", "感应电动势峰值", emfPeak, "V"), obs("direction", "楞次定律方向", "反抗磁通变化")] };
  },
};

const lens: PhysicsExperiment = {
  id: "thin_lens_imaging",
  version: 2,
  title: "薄透镜成像",
  summary: "调节物距与焦距，观察光线追迹、像距、放大率和成像性质。",
  branch: "optics",
  stages: ["middle_school", "high_school", "undergraduate"],
  renderMode: "3d",
  parameters: [parameter("focalLength", "焦距", "cm", 1, 100, 0.1, 10), parameter("objectDistance", "物距", "cm", 1, 200, 0.1, 30), parameter("objectHeight", "物高", "cm", 0.1, 100, 0.1, 5)],
  assumptions: ["薄透镜近轴光线", "忽略色差和球差"],
  controls: ["focalLength", "objectDistance", "objectHeight"],
  evaluate: (p) => {
    const f = clamp(p.focalLength, 1, 100), u = clamp(p.objectDistance, 1, 200), h = clamp(p.objectHeight, 0.1, 100), denominator = u - f;
    const imageDistance = Math.abs(denominator) < 1e-6 ? Infinity : f * u / denominator, magnification = Math.abs(denominator) < 1e-6 ? Infinity : -imageDistance / u;
    return { observations: [obs("image_distance", "像距", Number.isFinite(imageDistance) ? imageDistance : "无穷远", "cm"), obs("magnification", "放大率", Number.isFinite(magnification) ? magnification : "无穷大", ""), obs("image_type", "像的性质", u > f ? "实像、倒立" : "虚像、正立"), obs("image_height", "像高", Number.isFinite(magnification) ? magnification * h : "无穷大", "cm")] };
  },
};

const doubleSlit: PhysicsExperiment = {
  id: "double_slit_interference",
  version: 2,
  title: "双缝干涉",
  summary: "改变波长、缝距和屏距，观察干涉强度分布与条纹间距。",
  branch: "optics",
  stages: ["high_school", "undergraduate", "graduate"],
  renderMode: "3d",
  parameters: [parameter("wavelength", "波长", "nm", 380, 750, 1, 550), parameter("slitSeparation", "缝距", "mm", 0.01, 2, 0.01, 0.2), parameter("screenDistance", "屏距", "m", 0.1, 20, 0.1, 2), parameter("coherence", "相干度", "", 0, 1, 0.01, 1)],
  assumptions: ["远场近似", "窄缝相干光源", "忽略单缝包络"],
  controls: ["wavelength", "slitSeparation", "screenDistance", "coherence"],
  evaluate: (p) => {
    const lambda = clamp(p.wavelength, 380, 750) * 1e-9, d = clamp(p.slitSeparation, 0.01, 2) * 1e-3, L = clamp(p.screenDistance, 0.1, 20), coherence = clamp(p.coherence, 0, 1);
    const spacing = lambda * L / d;
    const intensityX = linspace(-5 * spacing, 5 * spacing, 160);
    return { observations: [obs("fringe_spacing", "条纹间距", spacing * 1000, "mm"), obs("bright_order_spacing", "相邻亮纹间距", spacing * 1000, "mm"), obs("visibility", "条纹可见度", coherence, "")], series: [{ id: "intensity", label: "屏上光强", unit: "相对强度", x: intensityX, y: intensityX.map((position) => (1 + coherence * Math.cos(2 * Math.PI * position / spacing)) / 2) }] };
  },
};

const tunneling: PhysicsExperiment = {
  id: "quantum_tunneling_1d",
  version: 2,
  title: "一维量子隧穿",
  summary: "改变粒子能量和势垒宽高，观察透射率与概率密度的指数衰减。",
  branch: "modern_physics",
  stages: ["undergraduate", "graduate"],
  renderMode: "3d",
  parameters: [parameter("energy", "粒子能量", "eV", 0.01, 20, 0.01, 1), parameter("barrierHeight", "势垒高度", "eV", 0.02, 30, 0.01, 5), parameter("barrierWidth", "势垒宽度", "nm", 0.01, 10, 0.01, 1), parameter("mass", "相对电子质量", "mₑ", 0.1, 10, 0.1, 1)],
  assumptions: ["一维矩形势垒", "非相对论薛定谔方程", "入射波归一化"],
  controls: ["energy", "barrierHeight", "barrierWidth", "mass"],
  evaluate: (p) => {
    const E = clamp(p.energy, 0.01, 20), V = clamp(p.barrierHeight, 0.02, 30), width = clamp(p.barrierWidth, 0.01, 10) * 1e-9, mass = clamp(p.mass, 0.1, 10);
    const hbar = 1.054571817e-34, electronVolt = 1.602176634e-19, electronMass = 9.1093837e-31;
    const T = E >= V ? 1 : Math.exp(-2 * width * Math.sqrt(2 * mass * electronMass * (V - E) * electronVolt) / hbar);
    return { observations: [obs("transmission", "透射率", T, ""), obs("reflection", "反射率", 1 - T, ""), obs("decay_length", "势垒内衰减长度", E >= V ? Infinity : hbar / Math.sqrt(2 * mass * electronMass * (V - E) * electronVolt), "m")] };
  },
};

export const PHYSICS_EXPERIMENTS: readonly PhysicsExperiment[] = [inclinedPlane, collision, pendulum, drivenSpring, projectile, wave, gas, electrostatic, induction, lens, doubleSlit, tunneling];

export const PHYSICS_EXPERIMENT_REGISTRY: ReadonlyMap<PhysicsExperimentId, PhysicsExperiment> = new Map(PHYSICS_EXPERIMENTS.map((experiment) => [experiment.id, experiment]));

export function getPhysicsExperiment(id: string, version = 2): PhysicsExperiment | null {
  const experiment = PHYSICS_EXPERIMENT_REGISTRY.get(id as PhysicsExperimentId);
  return experiment?.version === version ? experiment : null;
}

export function normalizePhysicsLabDefinition(input: Partial<PhysicsLabDefinition> & { experimentId: string }): PhysicsLabDefinition | null {
  const experiment = getPhysicsExperiment(input.experimentId, input.experimentVersion ?? 2);
  if (!experiment) return null;
  const parameters = paramsOf(experiment, input.parameters);
  const evaluated = experiment.evaluate(parameters);
  return {
    type: "physics_lab",
    experimentId: experiment.id,
    experimentVersion: experiment.version,
    title: String(input.title ?? experiment.title).trim().slice(0, 120) || experiment.title,
    summary: String(input.summary ?? experiment.summary).trim().slice(0, 500) || experiment.summary,
    branch: experiment.branch,
    stage: input.stage && experiment.stages.includes(input.stage) ? input.stage : experiment.stages[0],
    renderMode: experiment.renderMode,
    parameters,
    targetObservation: typeof input.targetObservation === "string" ? input.targetObservation.trim().slice(0, 240) : undefined,
    controls: [...experiment.controls],
    observations: evaluated.observations,
    series: evaluated.series,
    analysis: { enabled: false },
  };
}

/** Compatibility conversion for persisted legacy mechanics blocks. */
export function physicsLabFromLegacyMechanics(block: {
  type: "mechanics_sandbox";
  title: string;
  summary: string;
  sandboxType: "collision_1d" | "inclined_plane" | "pendulum" | "spring_oscillator";
  targetObservation?: string;
  objects?: Array<{ mass: number; initialVelocity?: number }>;
  parameters?: Array<{ id: string; default: number }>;
}): PhysicsLabDefinition | null {
  const experimentId: PhysicsExperimentId = block.sandboxType === "inclined_plane" ? "inclined_plane_friction" : block.sandboxType === "collision_1d" ? "collision_1d" : block.sandboxType === "pendulum" ? "simple_pendulum" : "driven_damped_spring";
  const values = Object.fromEntries((block.parameters ?? []).map((item) => [item.id, item.default]));
  if (experimentId === "collision_1d") Object.assign(values, { m1: block.objects?.[0]?.mass, m2: block.objects?.[1]?.mass, v1: block.objects?.[0]?.initialVelocity, v2: block.objects?.[1]?.initialVelocity });
  if (experimentId === "inclined_plane_friction") Object.assign(values, { mass: block.objects?.[0]?.mass });
  return normalizePhysicsLabDefinition({ experimentId, title: block.title, summary: block.summary, targetObservation: block.targetObservation, parameters: values });
}
