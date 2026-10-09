import { z } from "zod";
import {
  LAB_PROTOCOL_VERSION,
  labManifestSchema,
  type LabManifestV1,
} from "./manifest.js";

export const LAB_HANDSHAKE_TYPE = "xuelearn.lab.handshake" as const;
export const LAB_HELLO_TYPE = "xuelearn.lab.hello" as const;
export const LAB_PROTOCOL_NAME = "xuelearn.lab" as const;

export type LabHandshake = {
  type: typeof LAB_HANDSHAKE_TYPE;
  protocol: typeof LAB_PROTOCOL_NAME;
  version: typeof LAB_PROTOCOL_VERSION;
  sessionId: string;
  nonce: string;
};

export const labHandshakeSchema = z
  .object({
    type: z.literal(LAB_HANDSHAKE_TYPE),
    protocol: z.literal(LAB_PROTOCOL_NAME),
    version: z.literal(LAB_PROTOCOL_VERSION),
    sessionId: z.string().min(1).max(160),
    nonce: z.string().min(1).max(160),
  })
  .strict();

const baseCommandSchema = z.object({ type: z.string() });
export const hostCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("loadManifest"), manifest: labManifestSchema }),
  z.object({ type: z.literal("play") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("setParameter"), id: z.string().min(1), value: z.union([z.number().finite(), z.string(), z.boolean()]) }),
  z.object({ type: z.literal("performAction"), actionId: z.string().min(1), value: z.unknown().optional() }),
  z.object({ type: z.literal("setLocale"), locale: z.string().min(1).max(32) }),
  z.object({ type: z.literal("setTheme"), theme: z.enum(["light", "dark", "system"]) }),
  z.object({ type: z.literal("requestState") }),
  z.object({ type: z.literal("destroy") }),
]);
export type LabHostCommand = z.infer<typeof hostCommandSchema>;

export const labEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), capabilities: z.array(z.string()) }),
  z.object({ type: z.literal("manifest.loaded"), experimentId: z.string() }),
  z.object({ type: z.literal("runtime.started") }),
  z.object({ type: z.literal("runtime.paused") }),
  z.object({ type: z.literal("runtime.reset") }),
  z.object({ type: z.literal("parameter.changed"), id: z.string(), value: z.union([z.number().finite(), z.string(), z.boolean()]) }),
  z.object({ type: z.literal("action.applied"), actionId: z.string(), observationIds: z.array(z.string()) }),
  z.object({ type: z.literal("action.rejected"), actionId: z.string(), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("observation.changed"), id: z.string(), value: z.union([z.number().finite(), z.string(), z.boolean()]), unit: z.string().optional() }),
  z.object({ type: z.literal("selection.changed"), componentId: z.string().nullable() }),
  z.object({ type: z.literal("finish.requested"), reason: z.string().optional() }),
  z.object({ type: z.literal("runtime.warning"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("runtime.failed"), code: z.string(), message: z.string(), recoverable: z.boolean() }),
]);
export type LabEvent = z.infer<typeof labEventSchema>;

export const LAB_ERROR_CODES = [
  "invalid_command",
  "invalid_manifest",
  "incompatible_experiment",
  "unknown_action",
  "unsupported_action",
  "invalid_parameter",
  "unknown_parameter",
  "parameter_out_of_bounds",
  "operation_rejected",
  "experiment_unavailable",
  "not_loaded",
  "timeout",
  "destroyed",
  "internal",
] as const;

export const labAckSchema = z.object({
  type: z.literal("ack"),
  accepted: z.boolean(),
  error: z.object({ code: z.enum(LAB_ERROR_CODES), message: z.string() }).optional(),
});

export const labStateSchema = z.object({
  experimentId: z.string(),
  running: z.boolean(),
  elapsedSeconds: z.number().finite().nonnegative(),
  parameters: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean()])),
  observations: z.array(z.object({ id: z.string(), value: z.union([z.number().finite(), z.string(), z.boolean()]), unit: z.string().optional() })),
});
export type LabState = z.infer<typeof labStateSchema>;

export const labEnvelopeSchema = z.object({
  protocol: z.literal(LAB_PROTOCOL_NAME),
  version: z.literal(LAB_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  kind: z.enum(["command", "event", "ack", "state"]),
  payload: z.unknown(),
});
export type LabEnvelope = z.infer<typeof labEnvelopeSchema>;

export type LabAck = {
  type: "ack";
  accepted: boolean;
  error?: { code: string; message: string };
};

export type LabStatePayload = { type: "state"; state: LabState };
export type LabMessage = LabEnvelope & { payload: LabHostCommand | LabEvent | LabAck | LabStatePayload | LabManifestV1 };

export function createLabEnvelope<T extends LabEnvelope["payload"]>(
  sessionId: string,
  id: string,
  sequence: number,
  kind: LabEnvelope["kind"],
  payload: T,
): LabEnvelope & { payload: T } {
  return {
    protocol: LAB_PROTOCOL_NAME,
    version: LAB_PROTOCOL_VERSION,
    sessionId,
    id,
    sequence,
    kind,
    payload,
  };
}

export function parseLabEnvelope(input: unknown): LabEnvelope | null {
  const parsed = labEnvelopeSchema.safeParse(input);
  if (!parsed.success) return null;
  const payload = parsed.data.payload;
  const valid =
    parsed.data.kind === "command"
      ? hostCommandSchema.safeParse(payload).success
      : parsed.data.kind === "event"
        ? labEventSchema.safeParse(payload).success
        : parsed.data.kind === "ack"
          ? labAckSchema.safeParse(payload).success
          : payload && typeof payload === "object" && (payload as { type?: unknown }).type === "state" && labStateSchema.safeParse((payload as { state?: unknown }).state).success;
  return valid ? parsed.data : null;
}

export function isLabHandshake(input: unknown): input is LabHandshake {
  return labHandshakeSchema.safeParse(input).success;
}

export type LabHello = {
  type: typeof LAB_HELLO_TYPE;
  protocol: typeof LAB_PROTOCOL_NAME;
  version: typeof LAB_PROTOCOL_VERSION;
  nonce: string;
};

export function isLabHello(input: unknown): input is LabHello {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    value.type === LAB_HELLO_TYPE &&
    value.protocol === LAB_PROTOCOL_NAME &&
    value.version === LAB_PROTOCOL_VERSION &&
    typeof value.nonce === "string" &&
    value.nonce.length > 0 &&
    value.nonce.length <= 160
  );
}
