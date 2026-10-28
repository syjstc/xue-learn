import type {
  LocalSidecarFatalMessage,
  LocalSidecarReadyMessage,
  LocalSidecarStartMessage,
} from "./runtime-types.ts";
import { startLocalRuntime } from "./bootstrap.ts";
import { setCodexAccessTokenProvider } from "@xue-learn/core/server/providers/llm/vendors/codex/runtime";
import { randomUUID } from "node:crypto";

type ParentPort = {
  once(
    event: "message",
    listener: (event: { data: unknown; ports?: BootstrapPort[] }) => void,
  ): void;
  postMessage(message: unknown): void;
  on(
    event: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
};

type BootstrapPort = {
  once(event: "message", listener: (event: { data: unknown }) => void): void;
  start(): void;
  close(): void;
};

const parentPort = (process as typeof process & { parentPort?: ParentPort })
  .parentPort;
const pendingCodexRequests = new Map<
  string,
  { resolve: (token: string) => void; reject: (error: Error) => void }
>();

function requestCodexAccessToken(
  request?: { forceRefresh?: boolean },
): Promise<string> {
  if (!parentPort) return Promise.reject(new Error("Codex host is unavailable"));
  const requestId = randomUUID();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<string>((resolve, reject) => {
    timeout = setTimeout(() => {
      pendingCodexRequests.delete(requestId);
      reject(new Error("Codex authentication host timed out"));
    }, 30_000);
    pendingCodexRequests.set(requestId, {
      resolve: (token) => {
        if (timeout) clearTimeout(timeout);
        resolve(token);
      },
      reject: (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      },
    });
  });
  try {
    parentPort.postMessage({
      type: "xuelearn.codex.auth.request",
      requestId,
      ...(request?.forceRefresh ? { forceRefresh: true } : {}),
    });
  } catch (error) {
    pendingCodexRequests.delete(requestId);
    if (timeout) clearTimeout(timeout);
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  return promise;
}

if (parentPort) {
  parentPort.on("message", ({ data }) => {
    const response = data as {
      type?: unknown;
      requestId?: unknown;
      accessToken?: unknown;
      error?: unknown;
    };
    if (
      response.type !== "xuelearn.codex.auth.response" ||
      typeof response.requestId !== "string"
    )
      return;
    const pending = pendingCodexRequests.get(response.requestId);
    if (!pending) return;
    pendingCodexRequests.delete(response.requestId);
    if (typeof response.accessToken === "string" && response.accessToken) {
      pending.resolve(response.accessToken);
    } else {
      pending.reject(
        new Error(
          typeof response.error === "string"
            ? response.error
            : "Codex authentication is unavailable",
        ),
      );
    }
  });
  setCodexAccessTokenProvider(requestCodexAccessToken);
}
export { startLocalRuntime };

if (parentPort)
  parentPort.once("message", ({ data, ports }) => {
    if (
      (data as { type?: unknown })?.type !== "bootstrap-port" ||
      !ports?.[0]
    ) {
      throw new Error("Local runtime requires a transferred bootstrap port");
    }
    const bootstrapPort = ports[0];
    bootstrapPort.once("message", async ({ data: bootstrapData }) => {
      try {
        const message = bootstrapData as LocalSidecarStartMessage;
        const { port } = await startLocalRuntime(message);
        const ready: LocalSidecarReadyMessage = {
          type: "xuelearn.local.ready",
          schemaVersion: 1,
          instanceId: message.instanceId,
          port,
        };
        parentPort.postMessage(ready);
      } catch (error) {
        if (
          process.env.XUELEARN_DESKTOP_E2E_LOG_SIDECAR === "1" ||
          process.env.XUELEARN_DESKTOP_DEV === "1"
        ) {
          const detail =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          const safe = detail
            .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
            .replace(/[A-Fa-f0-9]{48,}/g, "[redacted]");
          process.stderr.write(`[sidecar-fatal] ${safe}\n`);
        }
        const fatal: LocalSidecarFatalMessage = {
          type: "xuelearn.local.fatal",
          message: error instanceof Error ? error.message : String(error),
        };
        parentPort.postMessage(fatal);
      } finally {
        bootstrapPort.close();
      }
    });
    bootstrapPort.start();
  });
