import { mkdir, appendFile, statfs } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../env.js";

export type PayloadArchiveResult = {
  backend: string;
  key: string;
};

type ArchiveInput = {
  logId: string;
  status: string;
  traceId?: string | null;
  operation: string;
  kind: string;
  record: Record<string, unknown>;
};

function shouldSample(rate: number, id: string): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash / 0xffffffff < rate;
}

export function shouldArchivePayload(input: {
  logId: string;
  status: string;
}): boolean {
  const env = getEnv();
  if (env.LLM_PAYLOAD_LOG_MODE === "off") return false;
  if (env.LLM_PAYLOAD_LOG_MODE === "all") return true;
  const isError = input.status === "error";
  if (env.LLM_PAYLOAD_LOG_MODE === "errors") return isError;
  const sampled = shouldSample(env.LLM_PAYLOAD_SAMPLE_RATE, input.logId);
  if (env.LLM_PAYLOAD_LOG_MODE === "sampled") return sampled;
  return isError || sampled;
}

async function spoolDiskIsCritical(dir: string): Promise<boolean> {
  try {
    const env = getEnv();
    const stats = await statfs(dir);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (total <= 0) return false;
    return ((total - free) / total) * 100 >= env.LOG_DISK_CRITICAL_PERCENT;
  } catch {
    return false;
  }
}

export async function archivePayload(input: ArchiveInput): Promise<PayloadArchiveResult | undefined> {
  if (!shouldArchivePayload({ logId: input.logId, status: input.status })) {
    return undefined;
  }

  const env = getEnv();
  if (await spoolDiskIsCritical(env.LOG_SPOOL_DIR)) return undefined;

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const dir = path.join(env.LOG_SPOOL_DIR, "pending", yyyy, mm, dd, `hour=${hh}`);
  const key = `llm-payload/${yyyy}/${mm}/${dd}/hour=${hh}/${input.logId}.jsonl`;
  await mkdir(dir, { recursive: true });
  await appendFile(
    path.join(dir, `${input.logId}.jsonl`),
    `${JSON.stringify({
      archivedAt: now.toISOString(),
      logId: input.logId,
      traceId: input.traceId,
      operation: input.operation,
      kind: input.kind,
      status: input.status,
      record: input.record,
    })}\n`,
    "utf8",
  );

  return {
    backend: env.LOG_ARCHIVE_BACKEND,
    key,
  };
}
