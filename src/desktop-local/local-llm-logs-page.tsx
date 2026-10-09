import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { LlmLogsViewer } from "@/components/dev/llm-logs-viewer";
import { apiGet } from "@/shared/api";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

const API_BASE = "/api/local/logs/llm";

export function LocalLlmLogsPage() {
  const t = useT();
  const logs = useQuery({
    queryKey: ["desktop-local", "logs", "llm", "initial"],
    queryFn: () => apiGet<unknown>(`${API_BASE}?limit=50&page=1`),
    staleTime: 0,
  });

  return (
    <section className="space-y-5" aria-labelledby="local-llm-logs-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-[var(--brand-50)] p-2.5 text-[var(--brand-700)]">
          <ScrollText className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="local-llm-logs-title" className="text-xl font-semibold">
            {t("desktop.llmLogs.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("desktop.llmLogs.description")}
          </p>
        </div>
      </div>
      {logs.isPending ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          {t("desktop.llmLogs.loading")}
        </p>
      ) : logs.isError ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {logs.error instanceof Error
            ? logs.error.message
            : t("desktop.llmLogs.loadError")}
        </p>
      ) : (
        <LlmLogsViewer
          initial={logs.data as Parameters<typeof LlmLogsViewer>[0]["initial"]}
          apiBasePath={API_BASE}
        />
      )}
    </section>
  );
}
