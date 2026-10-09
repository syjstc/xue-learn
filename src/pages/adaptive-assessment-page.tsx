import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, BrainCircuit, Clock3 } from "lucide-react";
import { apiGet } from "@/shared/api/http";
import { consumeSsePost } from "@/shared/client/consume-sse";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { canUseBrowserPersistentStorage } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import {
  readLocalClientPreference,
  writeLocalClientPreference,
} from "@/shared/runtime/local-client-preferences";

type AssessmentItem = {
  id: string;
  taskId: string | null;
  type:
    | "selected_response"
    | "constructed_response"
    | "performance_case"
    | "integrated_challenge"
    | "synthesis_challenge"
    | "delayed_retention";
  evidencePurpose: string;
  estimatedMinutes: number;
  responseType: "selected" | "text" | "structured";
  prompt: string;
  sections?: Array<"decision" | "output" | "verification" | "reflection">;
  generationRequired?: boolean;
  availableNow: boolean;
};

type AssessmentPlan = {
  purpose: "mastery" | "readiness";
  rolloutMode: "off" | "shadow" | "internal" | "production";
  evidenceWritesEnabled: boolean;
  blueprint: {
    timeBudgetMinutes: number;
    estimatedMinutes: number;
    deferredSlots: unknown[];
  };
  items: AssessmentItem[];
};

export function AdaptiveAssessmentPage() {
  const t = useT();
  const { goalId = "", moduleId = "", unitId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const purpose =
    moduleId && searchParams.get("purpose") === "readiness"
      ? "readiness"
      : "mastery";
  const queryClient = useQueryClient();
  const assessmentStartedAt = useRef(performance.now());
  const submissionKey = useRef(crypto.randomUUID());
  const endpoint = moduleId
    ? `/api/goals/${goalId}/modules/${moduleId}/adaptive-assessment?purpose=${purpose}`
    : unitId
      ? `/api/units/${unitId}/adaptive-assessment`
      : `/api/goals/${goalId}/adaptive-assessment`;
  const backTo = moduleId
    ? `/goals/${goalId}/modules/${moduleId}`
    : unitId
      ? `/goals/${goalId}/units/${unitId}`
      : `/goals/${goalId}`;
  const diagnosticTo = moduleId
    ? `/goals/${goalId}/modules/${moduleId}/diagnostic`
    : unitId
      ? `/goals/${goalId}/units/${unitId}/diagnostic`
      : null;
  const [plan, setPlan] = useState<AssessmentPlan | null>(null);
  const [response, setResponse] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{
    score: number;
    rationale?: string;
    bridgeUnitId?: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const item = useMemo(
    () => plan?.items.find((candidate) => candidate.availableNow) ?? null,
    [plan],
  );

  useEffect(() => {
    void apiGet<AssessmentPlan>(endpoint)
      .then((next) => {
        setPlan(next);
        const first = next.items.find((candidate) => candidate.availableNow);
        if (first?.taskId) {
          const key = `xue-learn.adaptive-draft.${first.taskId}`;
          const draft = canUseBrowserPersistentStorage()
            ? localStorage.getItem(key)
            : readLocalClientPreference<string | null>(key, null);
          if (draft) {
            try {
              setResponse(JSON.parse(draft) as Record<string, string>);
            } catch {
              if (canUseBrowserPersistentStorage())
                localStorage.removeItem(key);
              else writeLocalClientPreference(key, null);
            }
          }
        }
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : t("assessment.loadError"),
        ),
      )
      .finally(() => setLoading(false));
  }, [endpoint]);

  function updateResponse(key: string, value: string) {
    setResponse((current) => {
      const next = { ...current, [key]: value };
      if (item?.taskId) {
        const key = `xue-learn.adaptive-draft.${item.taskId}`;
        const value = JSON.stringify(next);
        if (canUseBrowserPersistentStorage()) localStorage.setItem(key, value);
        else writeLocalClientPreference(key, value);
      }
      return next;
    });
  }

  async function submit() {
    if (!item?.taskId) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const done = await consumeSsePost(
        `/api/assessments/${encodeURIComponent(item.taskId)}/submit/stream`,
        {
          response,
          durationMs: Math.max(
            1,
            Math.min(
              7_200_000,
              Math.round(performance.now() - assessmentStartedAt.current),
            ),
          ),
          idempotencyKey: submissionKey.current,
          assistanceTrace: [],
        },
        (event) => {
          const row = event as { type: string; message?: string };
          if (row.type === "status" && row.message) setStatus(row.message);
        },
      );
      const payload = done as unknown as {
        score: number;
        rationale?: string;
        bridgeUnitId?: string | null;
      };
      setResult(payload);
      const draftKey = `xue-learn.adaptive-draft.${item.taskId}`;
      if (canUseBrowserPersistentStorage()) localStorage.removeItem(draftKey);
      else writeLocalClientPreference(draftKey, null);
      void queryClient.invalidateQueries({
        queryKey: ["profile", "learning-state"],
      });
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey.includes("mastery") ||
          (moduleId ? query.queryKey.includes(moduleId) : false),
      });
      setStatus("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("assessment.submitError"),
      );
    } finally {
      setLoading(false);
    }
  }

  const complete =
    item?.responseType === "structured"
      ? (item.sections ?? []).every((section) => response[section]?.trim())
      : Boolean(response.text?.trim());

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        to={backTo}
      >
        <ArrowLeft className="size-4" /> {t("assessment.back")}
      </Link>
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <BrainCircuit className="size-4" />{" "}
          {t(
            purpose === "readiness"
              ? "assessment.readinessLabel"
              : "assessment.masteryLabel",
          )}
        </div>
        <h1 className="mt-1 text-2xl font-bold">
          {t(
            purpose === "readiness"
              ? "assessment.readinessTitle"
              : "assessment.masteryTitle",
          )}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            purpose === "readiness"
              ? "assessment.readinessIntro"
              : "assessment.masteryIntro",
          )}
        </p>
      </div>
      {loading && !plan ? <p>{t("assessment.calculating")}</p> : null}
      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}
      {plan ? (
        <Card>
          <CardTitle>{t("assessment.planTitle")}</CardTitle>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3 className="size-4" />{" "}
            {t("assessment.timeEstimate", {
              estimated: plan.blueprint.estimatedMinutes,
              limit: plan.blueprint.timeBudgetMinutes,
            })}
          </p>
          {plan.blueprint.deferredSlots.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("assessment.deferred", {
                count: plan.blueprint.deferredSlots.length,
              })}
            </p>
          ) : null}
          {!plan.evidenceWritesEnabled ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {t("assessment.shadowMode")}
            </p>
          ) : null}
        </Card>
      ) : null}
      {item?.type === "selected_response" ? (
        <Card>
          <CardTitle>{item.evidencePurpose}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("assessment.selectedResponseIntro")}
          </p>
          {diagnosticTo ? (
            <Link className="mt-4 inline-block" to={diagnosticTo}>
              <Button>{t("assessment.startSelectedResponse")}</Button>
            </Link>
          ) : (
            <p className="mt-3 text-sm">{t("assessment.availableLater")}</p>
          )}
        </Card>
      ) : item ? (
        <Card>
          <CardTitle>{item.evidencePurpose}</CardTitle>
          <p className="mt-2 text-sm leading-6">{item.prompt}</p>
          <div className="mt-4 space-y-4">
            {item.responseType === "structured" ? (
              (item.sections ?? []).map((section) => (
                <label className="block" key={section}>
                  <span className="text-sm font-medium">
                    {t(`assessment.section.${section}`)}
                  </span>
                  <textarea
                    className="mt-1 min-h-28 w-full rounded-lg border bg-background p-3 text-sm"
                    onChange={(event) =>
                      updateResponse(section, event.target.value)
                    }
                    value={response[section] ?? ""}
                  />
                </label>
              ))
            ) : (
              <textarea
                className="min-h-52 w-full rounded-lg border bg-background p-3 text-sm"
                onChange={(event) => updateResponse("text", event.target.value)}
                value={response.text ?? ""}
              />
            )}
          </div>
          {status ? <p className="mt-3 text-sm">{status}</p> : null}
          <Button
            className="mt-4"
            disabled={!complete || loading || !plan?.evidenceWritesEnabled}
            onClick={() => void submit()}
          >
            {t(loading ? "assessment.verifying" : "assessment.submit")}
          </Button>
        </Card>
      ) : plan ? (
        <Card>
          <CardTitle>{t("assessment.noEvidenceTitle")}</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("assessment.noEvidenceBody")}
          </p>
        </Card>
      ) : null}
      {result ? (
        <Card className="border-green-300 bg-green-50">
          <CardTitle>{t("assessment.recorded")}</CardTitle>
          <p className="mt-2 text-sm">
            {t("assessment.score", { score: Math.round(result.score * 100) })}
          </p>
          {result.rationale ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {result.rationale}
            </p>
          ) : null}
          {purpose === "readiness" && result.bridgeUnitId ? (
            <Link
              className="mt-4 inline-block"
              to={`/goals/${goalId}/units/${result.bridgeUnitId}`}
            >
              <Button>{t("assessment.learnBridgeUnit")}</Button>
            </Link>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
