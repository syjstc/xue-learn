import {installLearningExtensionPreservationGuards} from "@cognilearn/desktop-persistence/extension-preservation";
import {ELECTRON_LEARNING_SCHEMA_TABLES} from "@cognilearn/desktop-persistence/learning-schema";
import {validatedLegacyLearningExtensionTables} from "@cognilearn/desktop-persistence/learning-schema";
import {WorkspaceServiceLifecycle} from "./workspace-service-lifecycle.ts";
import {workspaceBackgroundTaskCount} from "@cognilearn/desktop-persistence/workspace-retention";
import {createWorkspaceLearningPort} from "@cognilearn/desktop-persistence/workspace-learning";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {DisplayWorkspaceService} from "@xue-learn/core/server/display-workspace";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { resolve } from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import {
  DESKTOP_LOCAL_CAPABILITIES,
  DESKTOP_LOCAL_DATABASE_FILENAME,
  LOCAL_OWNER_ID,
  localCredentialSnapshotSchema,
  runtimeDescriptorSchema,
  validLocalProviderBaseUrl,
  type LocalCredentialSnapshot,
} from "@xue-learn/core/runtime-contracts";
import {
  bindPersonalSyncCaptureToConnection,
  configurePersonalSyncCapture,
  installPersonalSyncCaptureTriggers,
  registerPersonalSyncSqliteFunctions,
} from "@cognilearn/desktop-persistence/personal-sync/capture";
import { runWithPersonalSyncApply } from "@xue-learn/core/server/personal-sync";
import { resetEnvCache } from "@xue-learn/core/server/env";
import {
  AllExceptionsFilter,
  configureLocaleContext,
  configureRequestContext,
  configureUserContext,
} from "@xue-learn/core/common";
import { openReferencePersistenceRuntime } from "@cognilearn/desktop-persistence/reference/runtime";
import {
  resolvePersistenceMigrationsGlob,
  resolvePersistenceMigrationsPath,
} from "@cognilearn/desktop-persistence/migration-paths";
import { migratePersistenceOrm } from "@cognilearn/desktop-persistence/schema-safety";
import { provideBootstrappedPersistenceRuntime } from "@cognilearn/desktop-persistence/learning-space-orm.provider";
import { recoverInterruptedGenerationRuns } from "@xue-learn/core/server/generation/run-recovery";
import { createLocalIngressMiddleware } from "./local-ingress.ts";
import type { LocalSidecarStartMessage } from "./runtime-types.ts";
import { DesktopLocalModule } from "./desktop-local.module.ts";
import { validateLocalEmbeddingModel } from "./local-embedding-model.ts";
import {
  configureLocalPersonalSyncRuntime,
} from "@cognilearn/desktop-persistence/personal-sync/runtime";
import { isPersonalSyncRuntimeReadOnly, hasPersonalSyncRuntimeLease } from "@cognilearn/desktop-persistence/personal-sync/ingress";
import { compactOversizedLocalApiRequestLog } from "./local-api-log-compaction.ts";
import { WorkspaceServiceOwner } from "./workspace-service-owner.ts";
import { WorkspaceServiceSessions } from "./workspace-service-sessions.ts";
import { CourseSourceRepository } from "@cognilearn/desktop-persistence/course-source.repository";
import {courseTeachingBodyParser} from './course-teaching-ingress.ts';
import {CourseTeachingContentService} from '@xue-learn/core/server/course-teaching';
import {ReadingWorkspaceService, readingGenerators} from "@xue-learn/core/server/reading";
import {ensureUnitSectionPlan, generateUnitSectionMaterial} from '@xue-learn/core/server/sections';
import { readRawUnitImage } from "@xue-learn/core/server/images/storage";

/** Bridge the Electron vault contract into the shared provider environment. */
function configureLocalProviderCredentials(
  credentials: LocalCredentialSnapshot,
): void {
  const values = localCredentialSnapshotSchema.parse(credentials);
  const envByProvider: Record<string, Record<string, string>> = {
    custom: {
      CUSTOM_OPENAI_API_KEY: values.custom?.apiKey ?? "",
      CUSTOM_OPENAI_BASE_URL:
        validLocalProviderBaseUrl(values.custom?.baseUrl) ?? "",
    },
    custom_embedding: {
      CUSTOM_EMBEDDING_API_KEY: values.custom_embedding?.apiKey ?? "",
      CUSTOM_EMBEDDING_BASE_URL:
        validLocalProviderBaseUrl(values.custom_embedding?.baseUrl) ?? "",
    },
    minimax: {
      MINIMAX_API_KEY: values.minimax?.apiKey ?? "",
      MINIMAX_GROUP_ID: values.minimax?.groupId ?? "",
      MINIMAX_EMBEDDING_API_KEY: values.minimax?.embeddingApiKey ?? "",
    },
    openai: { OPENAI_API_KEY: values.openai?.apiKey ?? "" },
    deepseek: { DEEPSEEK_API_KEY: values.deepseek?.apiKey ?? "" },
    fireworks: { FIREWORKS_API_KEY: values.fireworks?.apiKey ?? "" },
    doubao: {
      DOUBAO_API_KEY: values.doubao?.apiKey ?? "",
      DOUBAO_SEARCH_API_KEY: values.doubao?.searchApiKey ?? "",
      DOUBAO_SPEECH_API_KEY: values.doubao?.speechApiKey ?? "",
    },
    bigmodel: { BIGMODEL_API_KEY: values.bigmodel?.apiKey ?? "" },
    qwen: {
      DASHSCOPE_API_KEY: values.qwen?.apiKey ?? "",
      DASHSCOPE_BASE_URL:
        validLocalProviderBaseUrl(values.qwen?.baseUrl) ?? "",
      DASHSCOPE_AUDIO_BASE_URL:
        validLocalProviderBaseUrl(values.qwen?.baseUrl) ?? "",
    },
    cartesia: { CARTESIA_API_KEY: values.cartesia?.apiKey ?? "" },
    tavily: { TAVILY_API_KEY: values.tavily?.apiKey ?? "" },
    anysearch: { ANYSEARCH_API_KEY: values.anysearch?.apiKey ?? "" },
    apimart: { APIMART_API_KEY: values.apimart?.apiKey ?? "" },
    krill: {
      KRILL_API_KEY: values.krill?.apiKey ?? "",
      KRILL_IMAGE_BASE_URL: "https://api.krill-code.net/v1",
    },
  };
  for (const provider of Object.values(envByProvider)) {
    for (const [key, value] of Object.entries(provider)) {
      if (value) process.env[key] = value;
      else delete process.env[key];
    }
  }
  resetEnvCache();
}

async function runStartupPhase<T>(
  phase: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Local service startup failed during ${phase}: ${message}`,
      {
        cause: error,
      },
    );
  }
}

export async function startLocalRuntime(message: LocalSidecarStartMessage) {
  if (message.type !== "xuelearn.local.start" || message.schemaVersion !== 2 || !/^[a-f0-9]{64}$/i.test(message.token))
    throw new Error("Unsupported local sidecar start message");
  const ownership = await WorkspaceServiceOwner.acquire({dataPath: message.dataPath, workspaceId: message.workspaceId, instanceId: message.instanceId});
  const release = () => ownership.release();
  process.once("exit", release);
  let cleanup: (() => Promise<void>) | undefined;
  try { return await startOwnedLocalRuntime(message, ownership, work => { cleanup = work; }); }
  catch (error) {
    try { await cleanup?.(); }
    finally { process.removeListener("exit", release); await release(); }
    throw error;
  }
}

async function startOwnedLocalRuntime(message: LocalSidecarStartMessage, ownership: WorkspaceServiceOwner, setCleanup: (work: () => Promise<void>) => void) {
  if (message.type !== "xuelearn.local.start" || message.schemaVersion !== 2) {
    throw new Error("Unsupported local sidecar start message");
  }
  if (!/^[a-f0-9]{64}$/i.test(message.token)) {
    throw new Error("Local sidecar token must be a 256-bit hexadecimal value");
  }

  const descriptor = runtimeDescriptorSchema.parse({
    schemaVersion: 1,
    kind: "desktop-local",
    os: message.os,
    arch: message.arch,
    appVersion: message.appVersion,
    capabilities: DESKTOP_LOCAL_CAPABILITIES,
  });
  const startedAt = Date.now();
  process.env.XUELEARN_DESKTOP_LOCAL = "1";
  try {
    await validateLocalEmbeddingModel({
      modelRoot: message.embeddingModelRoot,
      manifestPath: message.embeddingModelManifestPath,
    });
    process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ROOT = resolve(
      message.embeddingModelRoot,
    );
    delete process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR;
  } catch (error) {
    delete process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ROOT;
    process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR =
      error instanceof Error ? error.message : String(error);
    // The local database and lexical retrieval remain usable. The durable
    // embedding-index state exposes this actionable failure and supports retry
    // after the reviewed download is installed or repaired.
    console.error(
      `[local-runtime] Built-in embeddings unavailable: ${process.env.XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR}`,
    );
  }
  configureLocalProviderCredentials(message.credentials);
  process.env.API_LOG_DB_ENABLED = "false";
  resetEnvCache();
  // Preserve retired files for controlled import/rollback. This host owns the explicit current database only.
  const databasePath = resolve(
    message.dataPath,
    DESKTOP_LOCAL_DATABASE_FILENAME,
  );
  mkdirSync(resolve(message.dataPath), { recursive: true });
  process.env.XUELEARN_LOCAL_RESOURCE_ROOT = resolve(
    message.dataPath,
    "resources",
    "objects",
  );
  process.env.PERSISTENCE_DATABASE_KIND = "sqlite";
  process.env.PERSISTENCE_DATABASE_PATH = databasePath;
  process.env.LOG_SPOOL_DIR = resolve(message.dataPath, "log-spool");
  process.env.AUDIO_STORAGE_DIR = resolve(message.dataPath, "audio");
  process.env.IMAGE_STORAGE_DIR = resolve(message.dataPath, "unit-images");
  resetEnvCache();
  // SQLite configuration and credentials are owned by this local host.
  delete process.env.DATABASE_URL;
  const packagedMigrationsPath = resolve(__dirname, "migrations", "sqlite");
  const migrationsPath = existsSync(packagedMigrationsPath)
    ? packagedMigrationsPath
    : resolvePersistenceMigrationsPath("sqlite");
  process.env.PERSISTENCE_MIGRATIONS_PATH = migrationsPath;
  const migrationsGlob = existsSync(packagedMigrationsPath)
    ? "*.js"
    : resolvePersistenceMigrationsGlob("sqlite");
  process.env.PERSISTENCE_MIGRATIONS_GLOB = migrationsGlob;
  // The learning-only gate creates a fresh schema or validates legacy provenance
  // before adopting it. Every module reuses this one migrated runtime.
  const migrationRuntime = await runStartupPhase("opening SQLite", () =>
    openReferencePersistenceRuntime({
      kind: "sqlite",
      databasePath,
      migrationsPath,
      migrationsGlob,
      skipSchemaSafety: true,
    }),
  );
  setCleanup(() => migrationRuntime.close());
  configurePersonalSyncCapture(Boolean(message.syncWorkspaceKey), {
    rejectUnscoped:
      process.env.NODE_ENV === "test" ||
      process.env.XUELEARN_DESKTOP_DEV === "1",
  });
  registerPersonalSyncSqliteFunctions(migrationRuntime.orm.em);
  bindPersonalSyncCaptureToConnection(migrationRuntime.orm.em);
  await runStartupPhase("database migration", () =>
    migratePersistenceOrm(migrationRuntime.orm),
  );
  const legacyExtensionTables = await validatedLegacyLearningExtensionTables(migrationRuntime.orm.em);
  const extensionPreservation = await runStartupPhase("protecting retained extension data", () =>
    migrationRuntime.runInTransaction(() => installLearningExtensionPreservationGuards(
      migrationRuntime.orm.em.getContext(false), ELECTRON_LEARNING_SCHEMA_TABLES, legacyExtensionTables)));
  configurePersonalSyncCapture(Boolean(message.syncWorkspaceKey), {
    rejectUnscoped: process.env.NODE_ENV === "test" || process.env.XUELEARN_DESKTOP_DEV === "1",
    validatedLegacyTables: legacyExtensionTables,
  });
  await runStartupPhase("recovering interrupted generation runs", async () => {
    const recovered = await recoverInterruptedGenerationRuns(
      migrationRuntime.repositories.aiGenerationRun,
    );
    if (recovered.runs > 0 || recovered.llmLogs > 0) {
      console.warn(
        `[local-runtime] recovered ${recovered.runs} interrupted runs and ${recovered.llmLogs} LLM logs after restart`,
      );
    }
  });
  await runStartupPhase("recovering interrupted LLM logs", async () => {
    // LLM rows are created before a provider stream starts. If the sidecar is
    // restarted while that stream is pending, there is no request handler left
    // to call finish(), so the row would otherwise remain `running` forever.
    await migrationRuntime.orm.em.getConnection().execute(
      `UPDATE "LlmRequestLog"
          SET "status" = 'error',
              "error" = ?,
              "structuredFailureCategory" = 'interrupted',
              "durationMs" = CAST(MAX(0, COALESCE(
                (julianday(CURRENT_TIMESTAMP) - CASE
                  WHEN CAST("createdAt" AS REAL) >= 100000000000
                    THEN julianday(CAST("createdAt" AS REAL) / 1000, 'unixepoch')
                  WHEN CAST("createdAt" AS REAL) >= 1000000000
                    THEN julianday(CAST("createdAt" AS REAL), 'unixepoch')
                  ELSE julianday("createdAt")
                END) * 86400000,
                0
              )) AS INTEGER)
        WHERE "status" = 'running'`,
      ["The local sidecar restarted before this LLM request completed"],
    );
  });
  await runStartupPhase("compacting local request telemetry", () =>
    runWithPersonalSyncApply(() =>
      compactOversizedLocalApiRequestLog(migrationRuntime.orm.em),
    ),
  );
  if (message.syncWorkspaceKey) {
    await runStartupPhase("personal sync capture", () =>
      installPersonalSyncCaptureTriggers(migrationRuntime.orm.em),
    );
  }
  configureLocalPersonalSyncRuntime({
    workspaceId: message.workspaceId,
    syncEnabled: message.syncEnabled,
    workspaceKey: message.syncWorkspaceKey
      ? Buffer.from(message.syncWorkspaceKey, "base64")
      : null,
    em: migrationRuntime.orm.em,
  });
  await runStartupPhase("local owner initialization", () =>
    runWithPersonalSyncApply(() =>
      migrationRuntime.orm.em.getConnection().execute(
        `INSERT INTO "User" ("id", "name", "email", "createdAt", "updatedAt")
         VALUES (?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT ("id") DO NOTHING`,
        [LOCAL_OWNER_ID, "Local learner"],
      ),
    ),
  );
  // Nest adopts this exact runtime. Keeping one SQLite connection for the
  // process avoids native statement finalizers from a throwaway migration
  // connection racing the live sidecar under newer Node runtimes.
  provideBootstrappedPersistenceRuntime(migrationRuntime);
  chmodSync(databasePath, 0o600);
  const sessions = new WorkspaceServiceSessions(message.workspaceId, LOCAL_OWNER_ID, message.instanceId, ownership.epoch);
  const courseSourceRepository = new CourseSourceRepository(migrationRuntime.orm.em, readRawUnitImage, undefined, undefined, work =>
    migrationRuntime.runInTransaction(() => work(migrationRuntime.orm.em.getContext(false))));
  const courseSourceContext = {workspaceId: message.workspaceId, repository: courseSourceRepository,
    teaching: new CourseTeachingContentService({
      readDraft: (ownerId, unitId) => courseSourceRepository.readTeachingDraft({workspaceId: message.workspaceId, ownerId, unitId}),
      readReady: (ownerId, unitId) => courseSourceRepository.readUnit({workspaceId: message.workspaceId, ownerId, unitId}),
      ensurePlan: ensureUnitSectionPlan,
      generateSection: generateUnitSectionMaterial,
      adopt: (ownerId, unitId, reuse) => courseSourceRepository.adoptTeachingMaterial({workspaceId: message.workspaceId, ownerId, unitId}, reuse),
    })};
  const lifecycle = new WorkspaceServiceLifecycle();
  const displayWorkspace = new DisplayWorkspaceService({directory: message.dataPath, ownerUserId: LOCAL_OWNER_ID});
  const readingWorkspace = new ReadingWorkspaceService({
    directory: message.dataPath, generators: readingGenerators,
    readSource: (ownerId, unitId) => courseSourceRepository.readReadingSource({ownerId, unitId}),
  });
  const backgroundTaskCount = async () => await migrationRuntime.runInTransaction(() => workspaceBackgroundTaskCount(migrationRuntime.orm.em.getContext(false))) + await displayWorkspace.backgroundTaskCount() + await readingWorkspace.backgroundTaskCount();
  const workspaceServiceContext = {sessions, lifecycle, storageOwnership: {canResetData: extensionPreservation.retainedExtensionTables === 0, hasLegacyExtensions: extensionPreservation.retainedExtensionTables > 0, retainedExtensionTables: extensionPreservation.retainedExtensionTables}, clientPermissionsPath:message.clientPermissionsPath, backgroundTaskCount,
    drain: () => migrationRuntime.runInTransaction(async () => lifecycle.commitDrain({clientSessions:sessions.activeCount,
      backgroundTasks:await workspaceBackgroundTaskCount(migrationRuntime.orm.em.getContext(false)) + await displayWorkspace.backgroundTaskCount() + await readingWorkspace.backgroundTaskCount()}))};
  const app = await runStartupPhase("Nest application creation", () =>
    NestFactory.create<NestExpressApplication>(
      DesktopLocalModule.register({
        instanceId: message.instanceId,
        startedAt,
        descriptor,
      }, courseSourceContext, workspaceServiceContext, createWorkspaceLearningPort(migrationRuntime), displayWorkspace, readingWorkspace),
      { bufferLogs: true },
    ),
  );
  setCleanup(() => app.close());
  // Ingress establishes the fixed local owner before request context captures
  // identity. No registration, JWT, or hosted authentication is involved.
  app.use(
    createLocalIngressMiddleware(
      message.token,
      isPersonalSyncRuntimeReadOnly,
      hasPersonalSyncRuntimeLease,
      sessions,
      lifecycle,
    ),
  );
  app.use(courseTeachingBodyParser());
  app.use((request: Request, response: Response, next: () => void) => {
    if (request.path.startsWith("/api")) {
      response.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate",
      );
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Expires", "0");
    }
    next();
  });
  configureRequestContext(app, { serviceName: "desktop-local" });
  configureUserContext(app);
  configureLocaleContext(app);
  // The desktop sidecar is loopback-only, bearer-protected, and serves one
  // fixed owner. Surface actionable backend diagnostics here while hosted
  // services keep the generic unexpected-error response.
  app.useGlobalFilters(
    new AllExceptionsFilter({ exposeUnexpectedErrors: true }),
  );
  const disableRendererCache = process.env.XUELEARN_DESKTOP_DEV === "1";
  app.useStaticAssets(resolve(message.rendererPath), {
    index: false,
    ...(disableRendererCache
      ? {
          etag: false,
          lastModified: false,
          setHeaders: (res: Response) => {
            res.setHeader("Cache-Control", "no-store");
          },
        }
      : {}),
  });
  // Express middleware is registered before Nest's terminal 404 handler. API
  // requests continue to the explicit local controller allowlist; all other GET
  // paths receive the BrowserRouter shell.
  app
    .getHttpAdapter()
    .getInstance()
    .use((req: Request, res: Response, next: () => void) => {
      if (req.path === "/api" || req.path.startsWith("/api/")) {
        next();
        return;
      }
      if (req.method === "GET") {
        if (disableRendererCache) res.setHeader("Cache-Control", "no-store");
        res.sendFile(resolve(message.rendererPath, "index.html"));
        return;
      }
      next();
    });
  await runStartupPhase("Nest application initialization", () => app.init());
  const requestedPort = Number.parseInt(
    process.env.XUELEARN_DESKTOP_SIDECAR_PORT ?? "",
    10,
  );
  const port = message.listenPort ??
    (Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 0);
  const listenAttempts = port === 0 ? 1 : 8;
  for (let attempt = 1; attempt <= listenAttempts; attempt += 1) {
    try {
      await app.listen(port, "127.0.0.1");
      break;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "EADDRINUSE" || attempt === listenAttempts) throw error;
      // Another workspace instance owns its port; never stop it to steal the listener.
      throw new Error("WORKSPACE_SERVICE_PORT_BUSY: The selected port is already owned; choose another port");
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") {
    await app.close();
    throw new Error("Local sidecar failed to bind a loopback TCP port");
  }
  ownership.publish({protocolVersion: 1, coreContractVersion: "course-source.v1", endpoint: `http://127.0.0.1:${address.port}`,
    capabilities: ["course.catalog.read", "course.content.read", "course.assets.read"], startedAt: new Date(startedAt).toISOString()});
  app.getHttpServer().once("close", () => ownership.release());
  return { app, port: address.port, descriptor, sessions };
}
