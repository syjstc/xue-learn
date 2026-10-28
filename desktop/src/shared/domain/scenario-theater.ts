import { personalizeLearnerText } from "./learner-text.ts";

export type ScenarioTheaterTheme =
  "office" | "technical" | "conversation" | "field" | "generic";

/**
 * The model selects only a semantic setting. Asset paths, contrast treatment,
 * crop-safe composition, and stage layout remain presentation-owned so web and
 * native never infer image luminance or accept model-authored visual values.
 */
export const scenarioTheaterBackgrounds = {
  briefing: {
    assetStem: "briefing",
    tone: "dark",
    overlay: "dark",
    scrimStrength: "medium",
    characterLayout: "three_lane",
    wideFocus: "50% 45%",
    portraitFocus: "50% 42%",
    purpose: "presentation and facilitated teaching",
  },
  workspace: {
    assetStem: "workspace",
    tone: "dark",
    overlay: "dark",
    scrimStrength: "medium",
    characterLayout: "three_lane",
    wideFocus: "50% 48%",
    portraitFocus: "50% 44%",
    purpose: "focused desk work and collaboration",
  },
  conversation: {
    assetStem: "conversation",
    tone: "light",
    overlay: "light",
    scrimStrength: "soft",
    characterLayout: "two_lane",
    wideFocus: "50% 48%",
    portraitFocus: "50% 44%",
    purpose: "neutral one-to-one or small-group dialogue",
  },
  incident: {
    assetStem: "incident",
    tone: "dark",
    overlay: "dark",
    scrimStrength: "strong",
    characterLayout: "three_lane",
    wideFocus: "50% 44%",
    portraitFocus: "50% 40%",
    purpose: "time-sensitive operations and response",
  },
  outcome: {
    assetStem: "outcome",
    tone: "light",
    overlay: "light",
    scrimStrength: "soft",
    characterLayout: "two_lane",
    wideFocus: "50% 46%",
    portraitFocus: "50% 42%",
    purpose: "reflection, resolution, and debrief",
  },
  technical_lab: {
    assetStem: "technical_lab",
    tone: "dark",
    overlay: "dark",
    scrimStrength: "strong",
    characterLayout: "three_lane",
    wideFocus: "50% 45%",
    portraitFocus: "50% 40%",
    purpose: "software, engineering, and technical investigation",
  },
  workshop: {
    assetStem: "workshop",
    tone: "light",
    overlay: "light",
    scrimStrength: "medium",
    characterLayout: "three_lane",
    wideFocus: "50% 48%",
    portraitFocus: "50% 43%",
    purpose: "hands-on making, cooking, repair, and demonstration",
  },
  meeting_room: {
    assetStem: "meeting_room",
    tone: "light",
    overlay: "light",
    scrimStrength: "soft",
    characterLayout: "three_lane",
    wideFocus: "50% 47%",
    portraitFocus: "50% 42%",
    purpose: "planning, review, and group decision-making",
  },
  field_site: {
    assetStem: "field_site",
    tone: "light",
    overlay: "light",
    scrimStrength: "medium",
    characterLayout: "three_lane",
    wideFocus: "50% 45%",
    portraitFocus: "50% 40%",
    purpose: "parks, outdoor conversations, community moments, and observation",
  },
  customer_lounge: {
    assetStem: "customer_lounge",
    tone: "light",
    overlay: "light",
    scrimStrength: "soft",
    characterLayout: "two_lane",
    wideFocus: "50% 47%",
    portraitFocus: "50% 42%",
    purpose: "client, service, and consultation conversations",
  },
} as const;

export type ScenarioTheaterBackground = keyof typeof scenarioTheaterBackgrounds;
export type ScenarioTheaterEffect =
  "none" | "fade" | "pulse" | "shake" | "success";

export type ScenarioTheaterCharacter = {
  id: string;
  name: string;
  role: string;
  avatar: "mentor" | "peer" | "client" | "expert" | "system";
  appearance?: {
    assetCode: string;
    gender: "male" | "female";
    ageGroup: "young_adult" | "middle_aged" | "older_adult";
  };
};

export type ScenarioTheaterChoice = {
  id: string;
  label: string;
  consequence: string;
  reflection: string;
  nextSceneId?: string;
  endingId?: string;
  effects: Array<{ meterId: string; delta: number }>;
};

export type ScenarioTheaterStoryBeat =
  | {
      kind: "dialogue";
      speakerId: string;
      text: string;
      addressee?: "learner";
    }
  | {
      kind: "narration";
      tone: "setup" | "observation" | "transition";
      text: string;
    };

export function personalizeScenarioTheaterText(
  text: string,
  learnerName?: string,
) {
  return personalizeLearnerText(text, learnerName);
}

type ScenarioTheaterDefinitionBase = {
  type: "scenario_theater";
  title: string;
  premise: string;
  learnerRole: string;
  objective: string;
  theme: ScenarioTheaterTheme;
  /** The canonical setting for a unit story. Legacy definitions use scene values. */
  background?: ScenarioTheaterBackground;
  coach?: {
    name: string;
    avatarCode: string;
  };
  characters: ScenarioTheaterCharacter[];
  meters: Array<{
    id: string;
    label: string;
    initial: number;
    min: number;
    max: number;
    tone: "positive" | "risk" | "neutral";
  }>;
  initialSceneId: string;
  endings: Array<{
    id: string;
    kind: "strong" | "mixed" | "setback";
    title: string;
    summary: string;
    coachDebrief: string;
  }>;
};

export type ScenarioTheaterDefinitionV1 = ScenarioTheaterDefinitionBase & {
  version: 1;
  scenes: Array<{
    id: string;
    act: number;
    title: string;
    speakerId?: string;
    body: string;
    background: ScenarioTheaterBackground;
    effect: ScenarioTheaterEffect;
    choices: ScenarioTheaterChoice[];
  }>;
};

export type ScenarioTheaterDefinitionV2 = ScenarioTheaterDefinitionBase & {
  version: 2;
  scenes: Array<{
    id: string;
    act: number;
    title: string;
    beats: ScenarioTheaterStoryBeat[];
    background: ScenarioTheaterBackground;
    effect: ScenarioTheaterEffect;
    choices: ScenarioTheaterChoice[];
  }>;
};

export type ScenarioTheaterDefinition =
  ScenarioTheaterDefinitionV1 | ScenarioTheaterDefinitionV2;
export type ScenarioTheaterScene = ScenarioTheaterDefinition["scenes"][number];
export type ScenarioTheaterEnding =
  ScenarioTheaterDefinition["endings"][number];

export function scenarioTheaterSceneBeats(
  scene: ScenarioTheaterScene,
): ScenarioTheaterStoryBeat[] {
  if ("beats" in scene) return scene.beats;
  return scene.speakerId
    ? [{ kind: "dialogue", speakerId: scene.speakerId, text: scene.body }]
    : [{ kind: "narration", tone: "setup", text: scene.body }];
}

export function scenarioTheaterTransitionBeats(params: {
  choice: ScenarioTheaterChoice;
  currentAct: number;
  nextAct?: number;
}): ScenarioTheaterStoryBeat[] {
  return [
    {
      kind: "narration",
      tone: "transition",
      text: params.choice.consequence,
    },
    ...(params.nextAct !== undefined && params.nextAct !== params.currentAct
      ? [
          {
            kind: "narration" as const,
            tone: "observation" as const,
            text: params.choice.reflection,
          },
        ]
      : []),
  ];
}

export type ScenarioTheaterDialogueHistorySegment = {
  sceneId: string;
  act: number;
  title: string;
  beats: ScenarioTheaterStoryBeat[];
};

export function scenarioTheaterDialogueHistory(params: {
  definition: ScenarioTheaterDefinition;
  run: ScenarioTheaterRun;
  /** Beats revealed in the active scene; omit to include all authored beats. */
  activeSceneBeatCount?: number;
  /** Partial transition beats after the most recently completed scene. */
  pendingTransitionBeats?: ScenarioTheaterStoryBeat[];
  /** When false, omit the not-yet-started next scene during inter-scene transition. */
  includePendingScene?: boolean;
}): ScenarioTheaterDialogueHistorySegment[] {
  const {
    definition,
    run,
    activeSceneBeatCount,
    pendingTransitionBeats,
    includePendingScene = true,
  } = params;

  const sceneIds = run.path.map((entry) => entry.sceneId);
  if (
    includePendingScene &&
    run.currentSceneId &&
    sceneIds[sceneIds.length - 1] !== run.currentSceneId
  ) {
    sceneIds.push(run.currentSceneId);
  }
  if (sceneIds.length === 0 && run.currentSceneId) {
    sceneIds.push(run.currentSceneId);
  }

  const segments: ScenarioTheaterDialogueHistorySegment[] = [];

  for (let index = 0; index < sceneIds.length; index += 1) {
    const sceneId = sceneIds[index]!;
    const scene = definition.scenes.find((item) => item.id === sceneId);
    if (!scene) continue;

    const pathEntry = index < run.path.length ? run.path[index] : undefined;
    const isActiveScene = sceneId === run.currentSceneId;

    let beats = [...scenarioTheaterSceneBeats(scene)];
    if (isActiveScene && activeSceneBeatCount !== undefined) {
      beats = beats.slice(0, activeSceneBeatCount);
    }

    if (pathEntry) {
      const choice = scene.choices.find(
        (item) => item.id === pathEntry.choiceId,
      );
      const nextScene = choice?.nextSceneId
        ? definition.scenes.find((item) => item.id === choice.nextSceneId)
        : undefined;
      const isLatestCompleted = index === run.path.length - 1;
      const transitionBeats =
        isLatestCompleted && pendingTransitionBeats
          ? pendingTransitionBeats
          : scenarioTheaterTransitionBeats({
              choice: {
                id: pathEntry.choiceId,
                label: choice?.label ?? "",
                consequence: pathEntry.consequence,
                reflection: pathEntry.reflection,
                nextSceneId: choice?.nextSceneId,
                endingId: choice?.endingId,
                effects: pathEntry.effects,
              },
              currentAct: scene.act,
              nextAct: nextScene?.act,
            });
      beats = [...beats, ...transitionBeats];
    }

    if (beats.length === 0) continue;

    segments.push({
      sceneId,
      act: scene.act,
      title: scene.title,
      beats,
    });
  }

  return segments;
}

export type ScenarioTheaterRun = {
  id: string;
  theaterRevision: number;
  runVersion: number;
  status: "active" | "completed" | "abandoned";
  currentSceneId: string | null;
  meters: Record<string, number>;
  path: Array<{
    sceneId: string;
    choiceId: string;
    consequence: string;
    reflection: string;
    effects: Array<{ meterId: string; delta: number }>;
    chosenAt: string;
  }>;
  endingId: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type ScenarioTheaterContent = {
  status: "pending" | "preparing" | "prepared" | "ready" | "failed";
  recommended: boolean;
  recommendation: string;
  revision: number;
  definition: ScenarioTheaterDefinition | null;
  generationError?: string;
};

export type ScenarioTheaterPlayState = {
  definition: ScenarioTheaterDefinition;
  run: ScenarioTheaterRun;
  currentSceneStatus?: "pending" | "building" | "ready" | "fallback" | null;
  completedOnce?: boolean;
  consequence?: string;
  reflection?: string;
  effects?: Array<{ meterId: string; delta: number }>;
  ending?: ScenarioTheaterEnding | null;
};
