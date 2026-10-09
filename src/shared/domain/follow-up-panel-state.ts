export type FollowUpPanelState<TAnchor, TStream> = {
  panelOpen: boolean;
  activeAnchor: TAnchor | null;
  streamState: TStream | null;
};

export type FollowUpPanelAction<TAnchor, TStream> =
  | { type: "show" }
  | { type: "hide" }
  | { type: "open-anchor"; anchor: TAnchor }
  | { type: "set-stream"; streamState: TStream | null }
  | {
      type: "update-stream";
      update: (streamState: TStream | null) => TStream | null;
    }
  | { type: "reset-context"; panelOpen?: boolean };

export function createFollowUpPanelState<
  TAnchor,
  TStream,
>(): FollowUpPanelState<TAnchor, TStream> {
  return {
    panelOpen: false,
    activeAnchor: null,
    streamState: null,
  };
}

/**
 * Re-clicking the active highlight collapses only when the companion is still
 * visible. Closing via X leaves `panelOpen` true until synced, so a lone
 * `panelOpen` check would require a second click to reopen.
 */
export function shouldCollapseActiveFollowUpHighlight(options: {
  panelOpen: boolean;
  assistantOpen: boolean;
}): boolean {
  return options.panelOpen && options.assistantOpen;
}

export function reduceFollowUpPanelState<TAnchor, TStream>(
  state: FollowUpPanelState<TAnchor, TStream>,
  action: FollowUpPanelAction<TAnchor, TStream>,
): FollowUpPanelState<TAnchor, TStream> {
  switch (action.type) {
    case "show":
      return { ...state, panelOpen: true };
    case "hide":
      return { ...state, panelOpen: false };
    case "open-anchor":
      return {
        panelOpen: true,
        activeAnchor: action.anchor,
        streamState: null,
      };
    case "set-stream":
      return { ...state, streamState: action.streamState };
    case "update-stream":
      return { ...state, streamState: action.update(state.streamState) };
    case "reset-context":
      return {
        panelOpen: action.panelOpen ?? state.panelOpen,
        activeAnchor: null,
        streamState: null,
      };
  }
}

export type FollowUpRequestLifecycle = {
  register: (controller: AbortController) => void;
  release: (controller: AbortController) => void;
  abortActive: () => void;
};

/** Keeps visibility changes independent from the request lifetime. */
export function createFollowUpRequestLifecycle(): FollowUpRequestLifecycle {
  let activeController: AbortController | null = null;

  return {
    register(controller) {
      activeController = controller;
    },
    release(controller) {
      if (activeController === controller) activeController = null;
    },
    abortActive() {
      activeController?.abort();
      activeController = null;
    },
  };
}
