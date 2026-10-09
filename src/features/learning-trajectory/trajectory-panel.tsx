import { useReturnCompletion } from "./use-return-completion.ts";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Footprints, Settings2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { apiGet, apiPost } from "@/shared/api";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import type {
  LearningGuidancePreferences,
  LearningTrajectoryEvent,
  LearningTrajectorySnapshot,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { LearningBranchCard } from "./branch-card.tsx";
import { useLearningTrajectory } from "./use-learning-trajectory.ts";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { useAssistant } from "@/components/agent/assistant-provider";

export function LearningTrajectoryPanel({
  unitId,
  goalId,
}: {
  unitId: string;
  goalId: string;
}) {
  const returned = useReturnCompletion(unitId);
  const assistant = useAssistant();
  const t = useT(),
    query = useLearningTrajectory(unitId);
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState(false),
    [older, setOlder] = useState<LearningTrajectoryEvent[]>([]),
    [cursor, setCursor] = useState<string | null | undefined>(undefined),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const prefs = useQuery({
    queryKey: ["learning-guidance-preferences"],
    queryFn: () =>
      apiGet<LearningGuidancePreferences>(
        "/api/learning-trajectory/preferences",
      ),
    enabled: isDesktopLocalRuntime() && settings,
  });
  if (!isDesktopLocalRuntime()) return null;
  const active = query.data?.visits.find((v) => v.state !== "returned");
  const changePreference = async (
    key: keyof LearningGuidancePreferences,
    value: boolean,
  ) => {
    setBusy(true);
    try {
      await apiPost("/api/learning-trajectory/preferences", { [key]: value });
      await prefs.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const more = async () => {
    const next = cursor === undefined ? query.data?.nextCursor : cursor;
    if (!next) return;
    setBusy(true);
    try {
      const page = await apiGet<LearningTrajectorySnapshot>(
        `/api/learning-trajectory?unitId=${encodeURIComponent(unitId)}&cursor=${encodeURIComponent(next)}`,
      );
      setOlder((v) => [...v, ...page.events]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const events = [...(query.data?.events ?? []), ...older].filter(
    (e, i, a) => a.findIndex((v) => v.id === e.id) === i,
  );
  return (
    <section
      className="shrink-0 rounded-xl border border-border bg-card px-3 py-2"
      aria-label={t("trajectory.footprints")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Footprints className="size-4" />
          {t("trajectory.footprints")}
          {(query.data?.branches.length ?? 0) > 0
            ? ` · ${query.data!.branches.length}`
            : ""}
        </Button>
        <div className="flex items-center gap-2">
          {active && (
            <Link
              className="text-sm text-primary underline-offset-4 hover:underline"
              to={`/goals/${goalId}/units/${unitId}/supplements/${active.branchId}?learningVisit=${active.id}`}
            >
              {t("trajectory.continueSupplement")}
            </Link>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("trajectory.settings")}
            aria-expanded={settings}
            onClick={() => setSettings(!settings)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>
      {returned.adjusted && (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          {t("trajectory.positionAdjusted")}
        </p>
      )}
      {returned.bridge && (
        <p role="status" className="py-2 text-sm">
          {t("trajectory.bridge", {
            title: returned.bridge.title,
            returnGoal: returned.bridge.returnGoal,
          })}
          <Button size="sm" variant="ghost" onClick={returned.dismissBridge}>
            ×
          </Button>
        </p>
      )}
      {settings && (
        <div className="space-y-2 border-t border-border py-3">
          {(["autoSaveSupplements", "proactiveGuidance"] as const).map(
            (key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.data?.[key] ?? true}
                  disabled={busy || !prefs.data}
                  onChange={(e) => void changePreference(key, e.target.checked)}
                />
                {t(`trajectory.preference.${key}`)}
              </label>
            ),
          )}
        </div>
      )}
      {open && (
        <div className="max-h-[60vh] space-y-4 overflow-auto border-t border-border py-3">
          {query.isError && <ApiErrorNotice error={query.error} />}
          <div className="grid gap-3">
            {query.data?.branches
              .filter((b) => b.status !== "dismissed")
              .map((b) => (
                <LearningBranchCard key={b.id} branchId={b.id} compact />
              ))}
          </div>
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-border pl-3 text-sm">
                <div className="flex flex-wrap gap-x-3">
                  <strong className="font-medium">
                    {t(`trajectory.event.${e.kind}`)}
                  </strong>
                  <time className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </time>
                </div>
                {e.text && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {e.text}
                  </p>
                )}
                {e.threadId && (
                  <button
                    type="button"
                    className="text-xs text-primary"
                    onClick={() =>
                      assistant.openUnitFollowUp(
                        unitId,
                        `trajectory:${unitId}`,
                        {
                          goalId,
                          threadId: e.threadId!,
                          learningPosition: e.position ?? undefined,
                          anchor: {
                            scope:
                              e.position?.blockIndex == null
                                ? "introduction"
                                : "block",
                            sectionId: e.position?.sectionId,
                            blockIndex: e.position?.blockIndex,
                          },
                        },
                      )
                    }
                  >
                    {t("trajectory.viewQuestion")}
                  </button>
                )}
              </li>
            ))}
          </ol>
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("trajectory.empty")}
            </p>
          )}
          {(cursor === undefined ? query.data?.nextCursor : cursor) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void more()}
            >
              {t("trajectory.more")}
            </Button>
          )}
        </div>
      )}
      {error ? <ApiErrorNotice error={error} /> : null}
    </section>
  );
}
