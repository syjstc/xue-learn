import type {
  LocalCredentialSnapshot,
  OperatingSystem,
} from "@xue-learn/core/runtime-contracts";

export type LocalSidecarStartMessage = {
  type: "xuelearn.local.start";
  schemaVersion: 2;
  token: string;
  instanceId: string;
  appVersion: string;
  os: OperatingSystem;
  arch: string;
  dataPath: string;
  listenPort?: number;
  clientPermissionsPath?: string;
  rendererPath: string;
  resourceRoot: string;
  embeddingModelRoot: string;
  embeddingModelManifestPath: string;
  credentials: LocalCredentialSnapshot;
  workspaceId: string;
  syncEnabled: boolean;
  syncWorkspaceKey: string | null;
};

export type LocalSidecarReadyMessage = {
  type: "xuelearn.local.ready";
  schemaVersion: 1;
  instanceId: string;
  port: number;
};

export type LocalSidecarFatalMessage = {
  type: "xuelearn.local.fatal";
  message: string;
};
