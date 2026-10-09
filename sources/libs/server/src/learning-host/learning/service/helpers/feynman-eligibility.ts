import {
  feynmanEligibility,
  type FeynmanEligibility,
} from "../../../../unit-session/application.js";

export type HostedFeynmanGoal = Readonly<{
  goalKind: string;
  learningMode?: string | null;
}>;

export function hostedFeynmanEligibility(
  goal: HostedFeynmanGoal,
  featureEnabled: boolean,
): FeynmanEligibility {
  return feynmanEligibility({
    featureEnabled,
    exploration:
      goal.goalKind === "micro" || goal.learningMode === "exploration",
  });
}
