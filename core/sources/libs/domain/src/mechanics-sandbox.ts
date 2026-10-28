export type MechanicsSandboxType =
  | "collision_1d"
  | "inclined_plane"
  | "pendulum"
  | "spring_oscillator";

export type MechanicsParameter = {
  id: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type MechanicsObject = {
  id: string;
  name: string;
  mass: number; // in kg
  color?: string;
  radius?: number; // for ball in meters or px
  width?: number; // for block
  height?: number;
  initialPosition?: number; // x or angle
  initialVelocity?: number; // v or angular velocity
};

export type MechanicsSandbox = {
  type: "mechanics_sandbox";
  title: string;
  summary: string;
  sandboxType: MechanicsSandboxType;
  parameters?: MechanicsParameter[];
  objects: MechanicsObject[];
  showVectors?: boolean;
  showEnergyChart?: boolean;
  targetObservation?: string;
};

export type Collision1DResult = {
  v1Final: number;
  v2Final: number;
  initialMomentum: number;
  finalMomentum: number;
  initialKineticEnergy: number;
  finalKineticEnergy: number;
  energyLoss: number;
  isElastic: boolean;
};

/**
 * Calculates 1D collision final velocities, momentum and kinetic energy conservation.
 * e: coefficient of restitution (1 = perfectly elastic, 0 = perfectly inelastic).
 */
export function calculate1DCollision(
  m1: number,
  v1: number,
  m2: number,
  v2: number,
  e = 1,
): Collision1DResult {
  const safeM1 = Math.max(0.001, m1);
  const safeM2 = Math.max(0.001, m2);
  const safeE = Math.max(0, Math.min(1, e));

  const totalMass = safeM1 + safeM2;
  const v1Final =
    ((safeM1 - safeE * safeM2) * v1 + (1 + safeE) * safeM2 * v2) / totalMass;
  const v2Final =
    ((1 + safeE) * safeM1 * v1 + (safeM2 - safeE * safeM1) * v2) / totalMass;

  const initialMomentum = safeM1 * v1 + safeM2 * v2;
  const finalMomentum = safeM1 * v1Final + safeM2 * v2Final;

  const initialKineticEnergy =
    0.5 * safeM1 * v1 * v1 + 0.5 * safeM2 * v2 * v2;
  const finalKineticEnergy =
    0.5 * safeM1 * v1Final * v1Final + 0.5 * safeM2 * v2Final * v2Final;

  const energyLoss = Math.max(0, initialKineticEnergy - finalKineticEnergy);

  return {
    v1Final: Math.round(v1Final * 1000) / 1000,
    v2Final: Math.round(v2Final * 1000) / 1000,
    initialMomentum: Math.round(initialMomentum * 1000) / 1000,
    finalMomentum: Math.round(finalMomentum * 1000) / 1000,
    initialKineticEnergy: Math.round(initialKineticEnergy * 1000) / 1000,
    finalKineticEnergy: Math.round(finalKineticEnergy * 1000) / 1000,
    energyLoss: Math.round(energyLoss * 1000) / 1000,
    isElastic: safeE >= 0.999,
  };
}

export type InclinedPlaneState = {
  acceleration: number;
  normalForce: number;
  frictionForce: number;
  gravityParallel: number;
  velocityAtTime: (t: number) => number;
  positionAtTime: (t: number) => number;
};

/**
 * Calculates forces, acceleration, and kinematic motion on an inclined plane.
 * angleDeg: inclination angle in degrees (0..90).
 * mu: friction coefficient.
 * g: gravitational acceleration (default 9.8 m/s^2).
 */
export function calculateInclinedPlane(
  mass: number,
  angleDeg: number,
  mu = 0,
  g = 9.8,
): InclinedPlaneState {
  const safeM = Math.max(0.001, mass);
  const rad = (angleDeg * Math.PI) / 180;
  const normalForce = safeM * g * Math.cos(rad);
  const maxStaticFriction = mu * normalForce;
  const gravityParallel = safeM * g * Math.sin(rad);

  let acceleration = 0;
  let frictionForce = 0;

  if (gravityParallel > maxStaticFriction) {
    frictionForce = mu * normalForce;
    acceleration = (gravityParallel - frictionForce) / safeM;
  } else {
    frictionForce = gravityParallel;
    acceleration = 0;
  }

  return {
    acceleration: Math.round(acceleration * 100) / 100,
    normalForce: Math.round(normalForce * 100) / 100,
    frictionForce: Math.round(frictionForce * 100) / 100,
    gravityParallel: Math.round(gravityParallel * 100) / 100,
    velocityAtTime: (t: number) => Math.max(0, acceleration * Math.max(0, t)),
    positionAtTime: (t: number) =>
      0.5 * acceleration * Math.max(0, t) * Math.max(0, t),
  };
}

export type PendulumState = {
  period: number; // in seconds
  frequency: number; // in Hz
  angularFrequency: number; // omega
  angleAtTime: (t: number) => number; // in radians
  kineticEnergyAtTime: (t: number) => number;
  potentialEnergyAtTime: (t: number) => number;
};

/**
 * Calculates small-angle simple pendulum harmonic motion.
 * length: rope length in meters.
 * initialAngleDeg: initial release angle in degrees.
 */
export function calculateSimplePendulum(
  mass: number,
  length: number,
  initialAngleDeg = 15,
  g = 9.8,
): PendulumState {
  const safeM = Math.max(0.001, mass);
  const safeL = Math.max(0.01, length);
  const theta0 = (initialAngleDeg * Math.PI) / 180;
  const omega = Math.sqrt(g / safeL);
  const period = 2 * Math.PI * Math.sqrt(safeL / g);
  const frequency = 1 / period;

  return {
    period: Math.round(period * 100) / 100,
    frequency: Math.round(frequency * 100) / 100,
    angularFrequency: Math.round(omega * 100) / 100,
    angleAtTime: (t: number) => theta0 * Math.cos(omega * t),
    kineticEnergyAtTime: (t: number) => {
      const v = safeL * -theta0 * omega * Math.sin(omega * t);
      return 0.5 * safeM * v * v;
    },
    potentialEnergyAtTime: (t: number) => {
      const theta = theta0 * Math.cos(omega * t);
      const h = safeL * (1 - Math.cos(theta));
      return safeM * g * h;
    },
  };
}
