import { contextBridge, ipcRenderer } from "electron";
import {
  CLOUDKIT_BRIDGE_COMMAND_CHANNEL,
  CLOUDKIT_BRIDGE_READY_CHANNEL,
  CLOUDKIT_BRIDGE_RESPONSE_CHANNEL,
  cloudKitBridgeCommandSchema,
} from "./cloudkit-bridge-protocol.ts";

type Handler = (command: unknown) => Promise<unknown>;
let handler: Handler | null = null;

contextBridge.exposeInMainWorld(
  "xueLearnCloudKitBridgeHost",
  Object.freeze({
    registerHandler(candidate: Handler) {
      if (typeof candidate !== "function" || handler)
        throw new Error("CloudKit bridge handler is already registered");
      handler = candidate;
      ipcRenderer.send(CLOUDKIT_BRIDGE_READY_CHANNEL);
    },
  }),
);

ipcRenderer.on(CLOUDKIT_BRIDGE_COMMAND_CHANNEL, async (_event, raw) => {
  const requestId =
    typeof raw?.requestId === "string" ? raw.requestId : "invalid-request";
  try {
    if (!handler) throw new Error("CloudKit bridge is not ready");
    const command = cloudKitBridgeCommandSchema.parse(raw?.command);
    const result = await handler(command);
    ipcRenderer.send(CLOUDKIT_BRIDGE_RESPONSE_CHANNEL, {
      requestId,
      ok: true,
      result,
    });
  } catch (error) {
    ipcRenderer.send(CLOUDKIT_BRIDGE_RESPONSE_CHANNEL, {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

