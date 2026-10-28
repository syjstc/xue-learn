import { z } from "zod";

export const CLOUDKIT_BRIDGE_COMMAND_CHANNEL =
  "desktop:internal:cloudkit-bridge:command";
export const CLOUDKIT_BRIDGE_RESPONSE_CHANNEL =
  "desktop:internal:cloudkit-bridge:response";
export const CLOUDKIT_BRIDGE_READY_CHANNEL =
  "desktop:internal:cloudkit-bridge:ready";

export const cloudKitBridgeCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("configure"),
    containerIdentifier: z.string().regex(/^iCloud\.[A-Za-z0-9.-]+$/),
    apiToken: z.string().min(8),
    environment: z.enum(["development", "production"]),
  }).strict(),
  z.object({ operation: z.literal("authenticate") }).strict(),
  z.object({ operation: z.literal("listWorkspaceDirectories") }).strict(),
  z.object({
    operation: z.literal("saveWorkspaceDirectory"),
    recordName: z.string().regex(/^workspace_[a-f0-9]{32}$/),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  }).strict(),
  z.object({
    operation: z.literal("saveDevice"),
    zoneName: z.string().regex(/^xuelearn_[a-f0-9]{32}$/),
    recordName: z.string().regex(/^device_[a-f0-9]{32}$/),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  }).strict(),
  z.object({
    operation: z.literal("ensureZone"),
    zoneName: z.string().regex(/^xuelearn_[a-f0-9]{32}$/),
  }).strict(),
  z.object({
    operation: z.literal("saveCommit"),
    zoneName: z.string().regex(/^xuelearn_[a-f0-9]{32}$/),
    recordName: z.string().uuid(),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  }).strict(),
  z.object({
    operation: z.literal("saveLeasedCommit"),
    zoneName: z.string().regex(/^xuelearn_[a-f0-9]{32}$/),
    recordName: z.string().uuid(),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    leaseRecordName: z.string().min(1).max(255),
    leaseRecordChangeTag: z.string().min(1),
    leaseFields: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.null()]),
    ),
  }).strict(),
  z.object({
    operation: z.literal("fetchChanges"),
    zoneName: z.string().regex(/^xuelearn_[a-f0-9]{32}$/),
    syncToken: z.string().nullable(),
  }).strict(),
  z.object({
    operation: z.literal("saveLease"),
    zoneName: z.string().regex(/^xuelearn_[a-f0-9]{32}$/),
    recordName: z.string().min(1).max(255),
    recordChangeTag: z.string().min(1).nullable(),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  }).strict(),
  z.object({
    operation: z.literal("fetchLease"),
    zoneName: z.string().regex(/^xuelearn_[a-f0-9]{32}$/),
    recordName: z.string().min(1).max(255),
  }).strict(),
]);
export type CloudKitBridgeCommand = z.infer<typeof cloudKitBridgeCommandSchema>;

export const cloudKitBridgeResponseSchema = z.object({
  requestId: z.string().uuid(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(2_000).optional(),
});
export type CloudKitBridgeResponse = z.infer<typeof cloudKitBridgeResponseSchema>;
