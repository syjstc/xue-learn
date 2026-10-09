import { z } from "zod";
import {
  operatingSystemSchema,
  workspaceIdSchema,
} from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";

export const sidecarReadyMessageSchema = z.object({
  type: z.literal("xuelearn.local.ready"),
  instanceId: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  schemaVersion: z.literal(1),
});

export const sidecarFatalMessageSchema = z.object({
  type: z.literal("xuelearn.local.fatal"),
  message: z.string().min(1),
});

export const sidecarCodexAuthRequestSchema = z.object({
  type: z.literal("xuelearn.codex.auth.request"),
  requestId: z.string().uuid(),
  forceRefresh: z.boolean().optional(),
});
export type SidecarCodexAuthRequest = z.infer<
  typeof sidecarCodexAuthRequestSchema
>;

export const sidecarMessageSchema = z.discriminatedUnion("type", [
  sidecarReadyMessageSchema,
  sidecarFatalMessageSchema,
  sidecarCodexAuthRequestSchema,
]);
export type SidecarMessage = z.infer<typeof sidecarMessageSchema>;

export const sidecarBootstrapSchema = z
  .object({
    type: z.literal("xuelearn.local.start"),
    schemaVersion: z.literal(2),
    token: z.string().regex(/^[a-f0-9]{64}$/i),
    instanceId: z.string().uuid(),
    appVersion: z.string().min(1),
    os: operatingSystemSchema,
    arch: z.string().min(1),
    dataPath: z.string().min(1),
    listenPort: z.number().int().min(0).max(65535).optional(),
    clientPermissionsPath: z.string().min(1).optional(),
    rendererPath: z.string().min(1),
    resourceRoot: z.string().min(1),
    embeddingModelRoot: z.string().min(1),
    embeddingModelManifestPath: z.string().min(1),
    credentials: z.record(z.string(), z.record(z.string(), z.string().min(1))),
    workspaceId: workspaceIdSchema,
    syncEnabled: z.boolean(),
    syncWorkspaceKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/).nullable(),
  })
  .strict();
export type SidecarBootstrap = z.infer<typeof sidecarBootstrapSchema>;

export interface SidecarProcess {
  readonly pid: number | undefined;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  sendBootstrap(bootstrap: SidecarBootstrap): void;
  sendMessage(message: unknown): void;
  /** Resolves only after the operating-system process has actually exited. */
  kill(): Promise<void>;
}

export type SidecarProcessFactory = () => SidecarProcess;
