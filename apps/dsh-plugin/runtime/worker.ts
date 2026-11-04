/** Standalone Node host: the Desktop learning composition, without Electron. */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { startLocalRuntime } from "../../../desktop/apps/local-runtime/src/bootstrap";
import { registerHostLlmProvider, createHostLlmProvider } from "@xue-learn/core/server/providers/llm";
import { createSharedEmbeddings } from "@xue-learn/core/server/providers/llm/shared-embeddings";
import { getEnv } from "@xue-learn/core/server/env";
import { modelChannel } from "./model-channel";
import {registerHostTeachingPersonaResolver} from '@xue-learn/core/server/teaching-personas';
import {learningAssistantPersona} from './assistant-persona';
import packageMetadata from '../package.json';

let app: {close(): Promise<void>} | undefined;
let starting = false;
let stopping = false;
let unregister: (() => void) | undefined;
let unregisterPersona: (() => void) | undefined;
const channel = modelChannel(message => process.send?.(message));
process.on("message", async (message: any) => {
  if (channel.receive(message)) return;
  if (message?.type !== "xuelearn.dsh.start" || starting) return;
  starting = true;
  try {
    process.env.XUELEARN_SVG_FONT_DIR = resolve(__dirname, "fonts");
    const rendererPath = resolve(__dirname, "shell");
    mkdirSync(rendererPath, {recursive: true});
    unregisterPersona = registerHostTeachingPersonaResolver(({locale}) => learningAssistantPersona(locale));
    unregister = registerHostLlmProvider(() => createHostLlmProvider({
      // This transport validates JSON in Core, without claiming native strict
      // DeepSeek API transport. The actual model is selected by DSH.
      id: "custom", stream: request => channel.stream(request),
      getEmbeddings: () => createSharedEmbeddings(getEnv(), "builtin"),
      getEmbeddingProviderId: () => "builtin",
    }));
    const runtime = await startLocalRuntime({
      type: "xuelearn.local.start", schemaVersion: 2,
      token: message.token, instanceId: randomUUID(), appVersion: `dsh-plugin-${packageMetadata.version}`,
      os: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux", arch: process.arch,
      dataPath: message.dataPath, workspaceId: message.workspaceId,
      rendererPath, resourceRoot: __dirname,
      embeddingModelRoot: message.embeddingModelRoot ?? resolve(message.dataPath, "models/embedding"),
      embeddingModelManifestPath: message.embeddingModelManifestPath ?? resolve(message.dataPath, "models/embedding/manifest.json"),
      credentials: {}, syncEnabled: false, syncWorkspaceKey: null,
    });
    app = runtime.app;
    process.send?.({type: "xuelearn.dsh.ready", port: runtime.port});
  } catch (error) {
    process.send?.({type: "xuelearn.dsh.fatal", message: error instanceof Error ? error.message : String(error)});
    await stop(1);
  }
});

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  channel.close();
  unregister?.();
  unregisterPersona?.();
  const deadline = setTimeout(() => process.exit(code), 8000);
  deadline.unref();
  try { await app?.close(); } finally { process.exit(code); }
}
process.on("disconnect", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
