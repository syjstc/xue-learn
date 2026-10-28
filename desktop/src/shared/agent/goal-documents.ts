import { apiFetch } from "@/shared/api-client";
import { apiPost } from "@/shared/api";

export type DocumentGoalSeed = {
  topic: string;
  refinedTitle: string;
  intentAnalysis: string;
  documentSummary: string;
  filenames: string[];
};

function goalCreationResourceBase(threadId: string, sessionId?: string) {
  return sessionId
    ? `/api/agent/goal-creation-sessions/${encodeURIComponent(sessionId)}`
    : `/api/agent/threads/${encodeURIComponent(threadId)}`;
}

export async function uploadGoalCreationDocuments(
  threadId: string,
  files: File[],
  sessionId?: string,
): Promise<void> {
  if (files.length === 0) return;

  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }

  const res = await apiFetch(
    `${goalCreationResourceBase(threadId, sessionId)}/documents`,
    {
      method: "POST",
      body: form,
    },
  );

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    const domainMessage =
      (typeof payload?.message === "string" && payload.message.trim()) ||
      (typeof payload?.error === "string" &&
      payload.error.trim() &&
      !/^(NOT_FOUND|BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|INTERNAL_SERVER_ERROR|Not Found|Bad Request)$/i.test(
        payload.error.trim(),
      )
        ? payload.error.trim()
        : "");
    throw new Error(domainMessage || `资料上传失败（${res.status}）`);
  }
}

export async function analyzeGoalCreationDocuments(
  threadId: string,
  sessionId?: string,
): Promise<DocumentGoalSeed> {
  return apiPost<DocumentGoalSeed>(
    `${goalCreationResourceBase(threadId, sessionId)}/documents/analyze`,
    {},
  );
}

export type UrlIngestResult = {
  status: "success" | "error";
  url: string;
  title?: string;
  sourceType?: string;
  provider?: string;
  warning?: string;
  error?: string;
};

export async function uploadGoalCreationUrls(
  threadId: string,
  urls: string[],
  sessionId?: string,
): Promise<{ results: UrlIngestResult[] }> {
  return apiPost(`${goalCreationResourceBase(threadId, sessionId)}/urls`, {
    urls,
  });
}
