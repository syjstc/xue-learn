import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AnalyticsMaintenanceRepository } from "../../../domain/src/index.js";
import { getEnv } from "../env.js";

const execFileAsync = promisify(execFile);

export type ObservabilityMaintenanceResult = {
  deletedApiLogs: number;
  deletedLlmLogs: number;
  deletedBackendErrorGroups: number;
  prunedBackendErrorGroups: number;
  compressedArtifacts: number;
  uploadedArtifacts: number;
  prunedLocalArtifacts: number;
};

async function walk(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return [full];
      }),
    );
    return files.flat();
  } catch {
    return [];
  }
}

async function compressPendingFiles(spoolDir: string): Promise<number> {
  const pendingDir = path.join(spoolDir, "pending");
  const files = (await walk(pendingDir)).filter((file) =>
    file.endsWith(".jsonl"),
  );
  let compressed = 0;

  for (const file of files) {
    const output = `${file}.zst`;
    try {
      await execFileAsync("zstd", ["-q", "-3", "-f", file, "-o", output], {
        timeout: 30_000,
      });
      await unlink(file);
      compressed += 1;
    } catch {
      // Leave the jsonl in place; a later run can retry once zstd is installed.
    }
  }

  return compressed;
}

function cosClient() {
  const env = getEnv();
  if (
    env.LOG_ARCHIVE_BACKEND !== "cos" ||
    !env.COS_SECRET_ID ||
    !env.COS_SECRET_KEY ||
    !env.COS_BUCKET ||
    !env.COS_REGION
  ) {
    return undefined;
  }
  try {
    const load = createRequire(__filename);
    const Cos = load("cos-nodejs-sdk-v5") as new (options: {
      SecretId: string;
      SecretKey: string;
    }) => {
      putObject(
        params: {
          Bucket: string;
          Region: string;
          Key: string;
          Body: NodeJS.ReadableStream;
        },
        cb: (err?: unknown, data?: unknown) => void,
      ): void;
    };
    return new Cos({
      SecretId: env.COS_SECRET_ID,
      SecretKey: env.COS_SECRET_KEY,
    });
  } catch {
    return undefined;
  }
}

async function uploadCompressedArtifacts(spoolDir: string): Promise<number> {
  const env = getEnv();
  const client = cosClient();
  if (!client || !env.COS_BUCKET || !env.COS_REGION) return 0;
  const pendingDir = path.join(spoolDir, "pending");
  const files = (await walk(pendingDir)).filter((file) =>
    file.endsWith(".zst"),
  );
  let uploaded = 0;

  for (const file of files) {
    const rel = path.relative(pendingDir, file).replace(/\\/g, "/");
    const key = `${env.COS_LOG_PREFIX}/${rel}`;
    try {
      await new Promise<void>((resolve, reject) => {
        client.putObject(
          {
            Bucket: env.COS_BUCKET!,
            Region: env.COS_REGION!,
            Key: key,
            Body: createReadStream(file),
          },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      await unlink(file);
      uploaded += 1;
    } catch {
      // Keep compressed file for retry.
    }
  }

  return uploaded;
}

async function pruneOldLocalArtifacts(
  spoolDir: string,
  retentionDays: number,
): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = await walk(spoolDir);
  let pruned = 0;
  for (const file of files) {
    try {
      const info = await stat(file);
      if (info.mtimeMs >= cutoff) continue;
      await unlink(file);
      pruned += 1;
    } catch {
      // Best-effort cleanup only.
    }
  }
  return pruned;
}

export async function runObservabilityMaintenance(
  repository: AnalyticsMaintenanceRepository,
): Promise<ObservabilityMaintenanceResult> {
  const env = getEnv();
  const now = Date.now();
  const apiCutoff = new Date(
    now - env.API_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const llmCutoff = new Date(
    now - env.LLM_LOG_DB_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const backendErrorCutoff = new Date(
    now - env.BACKEND_ERROR_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const database = await repository.pruneObservability({
    apiCutoff,
    llmCutoff,
    backendErrorCutoff,
    maxBackendErrorGroups: env.BACKEND_ERROR_MAX_GROUPS,
  });
  const compressedArtifacts = await compressPendingFiles(env.LOG_SPOOL_DIR);
  const uploadedArtifacts = await uploadCompressedArtifacts(env.LOG_SPOOL_DIR);
  const prunedLocalArtifacts = await pruneOldLocalArtifacts(
    env.LOG_SPOOL_DIR,
    env.LLM_PAYLOAD_RETENTION_DAYS,
  );

  return {
    ...database,
    compressedArtifacts,
    uploadedArtifacts,
    prunedLocalArtifacts,
  };
}
