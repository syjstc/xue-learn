import { randomUUID } from "node:crypto";

import {
  bootstrapSocraticCorrectionThread,
  ensureSocraticCorrectionThreads,
  graphStateWithSocraticCorrection,
  pickActiveSocraticCorrectionThread,
  processSocraticCorrectionTurn,
  replaceSocraticCorrectionThread,
  socraticCorrectionSessionPayload,
  type SocraticCorrectionState,
  type SocraticCorrectionMessage,
  type SocraticCorrectionThread,
  type SocraticCorrectionThreadSource,
} from "../unit-session/socratic-correction.js";

import { streamSocratic, type SocraticStreamSend } from "./socratic-runner.js";
import { parseSessionGraphState } from "./review-mode.js";

export type SocraticMessage = SocraticCorrectionMessage;
export type SocraticThreadSource = SocraticCorrectionThreadSource;
export type SocraticThread = SocraticCorrectionThread;

type GraphState = ReturnType<typeof parseSessionGraphState> & {
  socraticThreads?: SocraticThread[];
  activeSocraticThreadId?: string;
};

const environment = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
};

function portableState(graphState: GraphState): SocraticCorrectionState {
  return graphState as unknown as SocraticCorrectionState;
}

export function pickActiveSocraticThread(
  threads: SocraticThread[],
  activeId?: string,
): SocraticThread | undefined {
  return pickActiveSocraticCorrectionThread(threads, activeId);
}

export function ensureSocraticThreads(graphState: GraphState): {
  threads: SocraticThread[];
  activeThreadId: string;
} {
  return ensureSocraticCorrectionThreads(
    portableState(graphState),
    environment,
  );
}

export function replaceSocraticThread(
  threads: SocraticThread[],
  threadId: string,
  patch: Partial<SocraticThread>,
): SocraticThread[] {
  return replaceSocraticCorrectionThread(
    threads,
    threadId,
    patch,
    environment.now(),
  );
}

export type SocraticStreamOptions = {
  send?: SocraticStreamSend;
  signal?: AbortSignal;
};

export async function bootstrapSocraticThreadQuestion(params: {
  goalId: string;
  unitId?: string;
  unitTitle: string;
  graphState: GraphState;
  thread: SocraticThread;
  weakTags: string[];
  stream?: SocraticStreamOptions;
}) {
  return bootstrapSocraticCorrectionThread({
    unitTitle: params.unitTitle,
    graphState: portableState(params.graphState),
    thread: params.thread,
    weakTags: params.weakTags,
    environment,
    author: {
      authorSocraticTurn: (request) =>
        streamSocratic({
          goalId: params.goalId,
          unitId: params.unitId,
          ...request,
          send: params.stream?.send,
          signal: params.stream?.signal,
        }),
    },
  });
}

export async function processSocraticTurn(params: {
  goalId: string;
  unitId?: string;
  unitTitle: string;
  graphState: GraphState;
  thread: SocraticThread;
  answer: string;
  weakTags: string[];
  stream?: SocraticStreamOptions;
}) {
  return processSocraticCorrectionTurn({
    unitTitle: params.unitTitle,
    graphState: portableState(params.graphState),
    thread: params.thread,
    answer: params.answer,
    weakTags: params.weakTags,
    environment,
    author: {
      authorSocraticTurn: (request) =>
        streamSocratic({
          goalId: params.goalId,
          unitId: params.unitId,
          ...request,
          send: params.stream?.send,
          signal: params.stream?.signal,
        }),
    },
  });
}

export function socraticSessionPayload(
  threads: SocraticThread[],
  activeThreadId: string,
) {
  return socraticCorrectionSessionPayload(threads, activeThreadId);
}

export function graphStateWithSocraticThreads(
  graphState: GraphState,
  threads: SocraticThread[],
  activeThreadId: string,
): GraphState {
  return graphStateWithSocraticCorrection(
    portableState(graphState),
    threads,
    activeThreadId,
  ) as GraphState;
}
