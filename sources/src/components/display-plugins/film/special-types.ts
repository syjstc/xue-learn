export type ConceptNetworkPresentationProps = Readonly<{
  nodes: readonly Readonly<{ id: string; label: string; detail?: string }>[];
  edges: readonly Readonly<{ from: string; to: string; label?: string }>[];
}>;

export type OcclusionComparePresentationProps = Readonly<{
  occluder: Readonly<{ from: 2; to: 4 }>;
  worlds: readonly Readonly<{ id: string; label: string; startCell: number }>[];
  moveBy: 1;
}>;

export type ConceptNetworkCueAction = "overview" | "focus" | "connect";
export type OcclusionCompareCueAction =
  | "overview" | "cutaway" | "observe" | "advance" | "result";

export type PresentationCueV1<Action extends string = string> = Readonly<{
  beatId: string;
  action: Action;
  targetIds: readonly string[];
}>;

export type PresentationSceneV1 =
  | Readonly<{
      sceneId: string;
      componentId: "concept-network.v1";
      props: ConceptNetworkPresentationProps;
      cues: readonly PresentationCueV1<ConceptNetworkCueAction>[];
    }>
  | Readonly<{
      sceneId: string;
      componentId: "occlusion-compare.v1";
      props: OcclusionComparePresentationProps;
      cues: readonly PresentationCueV1<OcclusionCompareCueAction>[];
    }>;
