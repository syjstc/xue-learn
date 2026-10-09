import {
  CheckCircle2,
  Clock3,
  FileClock,
  FileUp,
  HelpCircle,
  History,
  Link2,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSubmitProjectMilestoneAttempt } from "@/hooks/api";
import { useT } from "@xue-learn/core/i18n";
import {
  COGNITIVE_LABELS,
  type CognitiveDimension,
} from "@/shared/domain/cognitive-model";
import {
  ProjectSubmissionError,
  createProjectSubmissionIdempotencyKey,
  projectArtifactVersionRef,
  projectAttemptStatusLabel,
  projectDefinitionDescription,
  projectDefinitionKey,
  projectDefinitionLabel,
  type ProjectArtifactDraft,
  type ProjectAssistanceDraft,
  type ProjectAttemptResponse,
  type ProjectMilestoneDetail,
  type ProjectProcessDraft,
} from "@/shared/domain/projects";

const fieldClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50";

type ArtifactFormRow = ProjectArtifactDraft & { label: string };

function safeArtifactId(milestone: ProjectMilestoneDetail, key: string) {
  const milestoneKey = projectDefinitionKey(
    { stableKey: milestone.stableKey },
    milestone.milestoneOrder,
  );
  return `artifact:${milestoneKey}:${key}`.slice(0, 128);
}

function initialArtifacts(
  milestone: ProjectMilestoneDetail,
  fallbackDefinitions: Record<string, unknown>[],
): ArtifactFormRow[] {
  const definitions = milestone.deliverableDefinitions.length
    ? milestone.deliverableDefinitions
    : fallbackDefinitions;
  const previous = milestone.latestAttempt?.artifactVersionRefs ?? [];
  return definitions.map((definition, index) => {
    const deliverableKey = projectDefinitionKey(definition, index);
    const lastVersion = [...previous]
      .filter((item) => item.deliverableKey === deliverableKey)
      .sort((a, b) => b.version - a.version)[0];
    return {
      label: projectDefinitionLabel(definition, index),
      artifactId:
        lastVersion?.artifactId ?? safeArtifactId(milestone, deliverableKey),
      deliverableKey,
      version: (lastVersion?.version ?? 0) + 1,
      uri: "",
      mediaType: lastVersion?.mediaType ?? "",
    };
  });
}

function formatDate(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function AttemptHistory({ milestone }: { milestone: ProjectMilestoneDetail }) {
  const t = useT();
  const processLabels: Record<ProjectProcessDraft["kind"], string> = {
    decision: t("projectDetail.workbench.process.decision"), action: t("projectDetail.workbench.process.action"), verification: t("projectDetail.workbench.process.verification"), revision: t("projectDetail.workbench.process.revision"), note: t("projectDetail.workbench.process.note"),
  };
  const sourceLabels: Record<ProjectAssistanceDraft["source"], string> = { ai: t("projectDetail.workbench.assistance.source.ai"), human: t("projectDetail.workbench.assistance.source.human"), system: t("projectDetail.workbench.assistance.source.system") };
  const kindLabels: Record<ProjectAssistanceDraft["kind"], string> = { hint: t("projectDetail.workbench.assistance.kind.hint"), question: t("projectDetail.workbench.assistance.kind.question"), example: t("projectDetail.workbench.assistance.kind.example"), feedback: t("projectDetail.workbench.assistance.kind.feedback"), answer: t("projectDetail.workbench.assistance.kind.answer") };
  const levelLabels: Record<ProjectAssistanceDraft["level"], string> = { independent: t("projectDetail.workbench.assistance.level.independent"), light_hint: t("projectDetail.workbench.assistance.level.lightHint"), guided: t("projectDetail.workbench.assistance.level.guided"), worked_example: t("projectDetail.workbench.assistance.level.workedExample"), answer_revealed: t("projectDetail.workbench.assistance.level.answerRevealed") };
  const attempt = milestone.latestAttempt;
  if (!attempt) {
    return (
      <Card className="border-dashed p-5 text-sm text-[var(--text-500)]">
        {t("projectDetail.workbench.history.empty")}
      </Card>
    );
  }
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--brand-600)]">
            {t("projectDetail.workbench.history.latest", { number: attempt.attemptNumber })}
          </p>
          <CardTitle className="mt-1 text-base">
            {projectAttemptStatusLabel(attempt.status)}
          </CardTitle>
        </div>
        <Badge variant="outline">{t("projectDetail.workbench.history.submittedAt", { date: formatDate(attempt.submittedAt, t("projectDetail.workbench.notRecorded")) })}</Badge>
      </div>

      <section>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-600)]">
          <FileClock aria-hidden className="size-3.5" />
          {t("projectDetail.workbench.artifacts.title")}
        </h4>
        {attempt.artifactVersionRefs.length ? (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {attempt.artifactVersionRefs.map((artifact) => (
              <li
                className="rounded-lg border border-[var(--border-200)] bg-[var(--bg-100)] p-3 text-sm"
                key={`${artifact.artifactId}:${artifact.version}`}
              >
                <p className="font-medium text-[var(--text-800)]">
                  {artifact.deliverableKey} · {t("projectDetail.workbench.artifacts.versionValue", { version: artifact.version })}
                </p>
                <p className="mt-1 text-xs text-[var(--text-400)]">
                  {formatDate(artifact.createdAt, t("projectDetail.workbench.notRecorded"))}
                </p>
                {artifact.uri ? (
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand-700)] hover:underline"
                    href={artifact.uri}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Link2 aria-hidden className="size-3" /> {t("projectDetail.workbench.artifacts.view")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-500)]">{t("projectDetail.workbench.artifacts.noneReferenced")}</p>
        )}
      </section>

      <section>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-600)]">
          <History aria-hidden className="size-3.5" />
          {t("projectDetail.workbench.process.title")}
        </h4>
        <ol className="mt-2 space-y-2">
          {attempt.processLog.map((entry) => (
            <li
              className="flex gap-3 rounded-lg bg-[var(--bg-200)] p-3 text-sm"
              key={entry.sequence}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-50)] text-xs font-semibold text-[var(--brand-600)]">
                {entry.sequence}
              </span>
              <span>
                <span className="font-medium text-[var(--text-700)]">
                  {processLabels[entry.kind]}
                </span>
                <span className="ml-2 text-[var(--text-600)]">{entry.summary}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-600)]">
          <HelpCircle aria-hidden className="size-3.5" />
          {t("projectDetail.workbench.assistance.title")}
        </h4>
        {attempt.assistanceTrace.length ? (
          <ul className="mt-2 space-y-2">
            {attempt.assistanceTrace.map((entry) => (
              <li
                className="rounded-lg border border-[var(--border-200)] p-3 text-sm text-[var(--text-600)]"
                key={entry.sequence}
              >
                {sourceLabels[entry.source]} · {kindLabels[entry.kind]} · {levelLabels[entry.level]}
                {entry.contentRef ? ` · ${entry.contentRef}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-500)]">{t("projectDetail.workbench.assistance.none")}</p>
        )}
      </section>
    </Card>
  );
}

export function ProjectMilestoneWorkbench({
  projectId,
  milestone,
  fallbackDeliverables,
}: {
  projectId: string;
  milestone: ProjectMilestoneDetail;
  fallbackDeliverables: Record<string, unknown>[];
}) {
  const t = useT();
  const difficultyLabels = { easy: t("projectDetail.workbench.difficulty.easy"), medium: t("projectDetail.workbench.difficulty.medium"), hard: t("projectDetail.workbench.difficulty.hard") } as const;
  const processLabels: Record<ProjectProcessDraft["kind"], string> = { decision: t("projectDetail.workbench.process.decision"), action: t("projectDetail.workbench.process.action"), verification: t("projectDetail.workbench.process.verification"), revision: t("projectDetail.workbench.process.revision"), note: t("projectDetail.workbench.process.note") };
  const sourceLabels: Record<ProjectAssistanceDraft["source"], string> = { ai: t("projectDetail.workbench.assistance.source.ai"), human: t("projectDetail.workbench.assistance.source.human"), system: t("projectDetail.workbench.assistance.source.system") };
  const kindLabels: Record<ProjectAssistanceDraft["kind"], string> = { hint: t("projectDetail.workbench.assistance.kind.hint"), question: t("projectDetail.workbench.assistance.kind.question"), example: t("projectDetail.workbench.assistance.kind.example"), feedback: t("projectDetail.workbench.assistance.kind.feedback"), answer: t("projectDetail.workbench.assistance.kind.answer") };
  const levelLabels: Record<ProjectAssistanceDraft["level"], string> = { independent: t("projectDetail.workbench.assistance.level.independent"), light_hint: t("projectDetail.workbench.assistance.level.lightHint"), guided: t("projectDetail.workbench.assistance.level.guided"), worked_example: t("projectDetail.workbench.assistance.level.workedExample"), answer_revealed: t("projectDetail.workbench.assistance.level.answerRevealed") };
  const submitAttempt = useSubmitProjectMilestoneAttempt(projectId);
  const startedAtRef = useRef(Date.now());
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createProjectSubmissionIdempotencyKey(projectId, milestone.id),
  );
  const [artifacts, setArtifacts] = useState<ArtifactFormRow[]>(() =>
    initialArtifacts(milestone, fallbackDeliverables),
  );
  const [process, setProcess] = useState<ProjectProcessDraft[]>([
    { kind: "action", summary: "" },
  ]);
  const [assistance, setAssistance] = useState<ProjectAssistanceDraft[]>([]);
  const [localError, setLocalError] = useState("");
  const [submitted, setSubmitted] = useState<ProjectAttemptResponse | null>(null);

  const declaredDeliverables = milestone.deliverableDefinitions.length
    ? milestone.deliverableDefinitions
    : fallbackDeliverables;
  const nextMissingDeliverable = declaredDeliverables
    .map((definition, index) => ({
      definition,
      index,
      key: projectDefinitionKey(definition, index),
    }))
    .find(({ key }) => !artifacts.some((artifact) => artifact.deliverableKey === key));

  const artifactVersionRefs = useMemo(
    () =>
      artifacts.map(
        (artifact) =>
          projectArtifactVersionRef(
            artifact.artifactId,
            Number(artifact.version) || 1,
          ),
      ),
    [artifacts],
  );

  function prepareNextVersion() {
    setArtifacts((current) =>
      current.map((artifact) => ({
        ...artifact,
        version: Number(artifact.version) + 1,
        uri: "",
      })),
    );
    setProcess([{ kind: "revision", summary: "" }]);
    setAssistance([]);
    setIdempotencyKey(
      createProjectSubmissionIdempotencyKey(projectId, milestone.id),
    );
    startedAtRef.current = Date.now();
    setSubmitted(null);
    setLocalError("");
    submitAttempt.reset();
  }

  async function submit() {
    setLocalError("");
    try {
      const response = await submitAttempt.mutateAsync({
        milestoneId: milestone.id,
        draft: {
          idempotencyKey,
          artifacts: artifacts.map(({ label: _label, ...artifact }) => artifact),
          process: process.map((entry, index) =>
            index === 0 && artifactVersionRefs.length
              ? { ...entry, artifactVersionRefs }
              : entry,
          ),
          assistance,
          durationMs: Math.max(1, Date.now() - startedAtRef.current),
        },
      });
      setSubmitted(response);
    } catch (cause) {
      setLocalError(
        cause instanceof ProjectSubmissionError || cause instanceof Error
          ? cause.message
          : t("projectDetail.workbench.submit.failedRetry"),
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {t("projectDetail.workbench.milestone", { number: milestone.milestoneOrder + 1 })}
            </Badge>
            <Badge variant="outline">
              {difficultyLabels[milestone.difficulty]}
            </Badge>
            <Badge variant="outline">
              {projectAttemptStatusLabel(milestone.latestAttempt?.status)}
            </Badge>
          </div>
          <h2 className="mt-2 text-xl font-bold text-[var(--text-800)]">
            {milestone.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-600)]">
            {milestone.instructions}
          </p>
        </div>
      </div>

      {milestone.requirements.length ? (
        <Card className="p-5">
          <CardTitle className="text-base">{t("projectDetail.workbench.requirements.title")}</CardTitle>
          <p className="mt-1 text-sm text-[var(--text-500)]">
            {t("projectDetail.workbench.requirements.description")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {milestone.requirements.map((requirement) => (
              <Badge key={requirement.id} variant="outline">
                {requirement.cognitiveEntity.title} · {COGNITIVE_LABELS.dimensions[requirement.dimension as CognitiveDimension]}
                {requirement.role === "primary" ? ` · ${t("projectDetail.workbench.requirements.primary")}` : ` · ${t("projectDetail.workbench.requirements.supporting")}`}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      <AttemptHistory milestone={milestone} />

      <Card className="space-y-6 p-5">
        <div>
          <CardTitle className="text-base">{t("projectDetail.workbench.submit.title")}</CardTitle>
          <p className="mt-1 text-sm leading-6 text-[var(--text-500)]">
            {t("projectDetail.workbench.submit.description")}
          </p>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-700)]">
              <FileUp aria-hidden className="size-4 text-[var(--brand-600)]" />
              {t("projectDetail.workbench.artifacts.title")}
            </h3>
            <Button
              onClick={() =>
                setArtifacts((current) => {
                  if (!nextMissingDeliverable) return current;
                  const { definition, index, key: deliverableKey } =
                    nextMissingDeliverable;
                  return [
                    ...current,
                    {
                      label: projectDefinitionLabel(definition, index),
                      artifactId: safeArtifactId(milestone, deliverableKey),
                      deliverableKey,
                      version: 1,
                      uri: "",
                      mediaType: "",
                    },
                  ];
                })
              }
              disabled={!nextMissingDeliverable}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus aria-hidden className="size-3.5" /> {t("projectDetail.workbench.artifacts.add")}
            </Button>
          </div>
          {artifacts.length ? (
            <div className="space-y-3">
              {artifacts.map((artifact, index) => (
                <div
                  className="rounded-xl border border-[var(--border-200)] bg-[var(--bg-100)] p-4"
                  key={`${artifact.deliverableKey}-${index}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--text-800)]">
                        {artifact.label}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--text-400)]">
                        {t("projectDetail.workbench.artifacts.id", { id: artifact.artifactId })}
                      </p>
                    </div>
                    <Button
                      aria-label={t("projectDetail.workbench.artifacts.remove", { label: artifact.label })}
                      onClick={() =>
                        setArtifacts((current) =>
                          current.filter((_, rowIndex) => rowIndex !== index),
                        )
                      }
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[110px_1fr_180px]">
                    <label className="text-xs text-[var(--text-500)]">
                      {t("projectDetail.workbench.artifacts.version")}
                      <Input
                        className="mt-1"
                        min={1}
                        onChange={(event) =>
                          setArtifacts((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, version: event.target.value }
                                : row,
                            ),
                          )
                        }
                        type="number"
                        value={artifact.version}
                      />
                    </label>
                    <label className="text-xs text-[var(--text-500)]">
                      {t("projectDetail.workbench.artifacts.linkOptional")}
                      <Input
                        className="mt-1"
                        onChange={(event) =>
                          setArtifacts((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, uri: event.target.value }
                                : row,
                            ),
                          )
                        }
                        placeholder="https://…"
                        type="url"
                        value={artifact.uri ?? ""}
                      />
                    </label>
                    <label className="text-xs text-[var(--text-500)]">
                      {t("projectDetail.workbench.artifacts.mediaTypeOptional")}
                      <Input
                        className="mt-1"
                        onChange={(event) =>
                          setArtifacts((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, mediaType: event.target.value }
                                : row,
                            ),
                          )
                        }
                        placeholder={t("projectDetail.workbench.artifacts.mediaTypeExample")}
                        value={artifact.mediaType ?? ""}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-sm text-[var(--text-500)]">
              {t("projectDetail.workbench.artifacts.optionalHint")}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-700)]">
              <History aria-hidden className="size-4 text-[var(--brand-600)]" />
              {t("projectDetail.workbench.process.title")}
            </h3>
            <Button
              onClick={() =>
                setProcess((current) => [
                  ...current,
                  { kind: "action", summary: "" },
                ])
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus aria-hidden className="size-3.5" /> {t("projectDetail.workbench.process.add")}
            </Button>
          </div>
          {process.map((entry, index) => (
            <div
              className="grid gap-2 rounded-xl border border-[var(--border-200)] p-3 sm:grid-cols-[150px_1fr_auto]"
              key={index}
            >
              <select
                aria-label={t("projectDetail.workbench.process.typeAria", { number: index + 1 })}
                className={fieldClass}
                onChange={(event) =>
                  setProcess((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? {
                            ...row,
                            kind: event.target.value as ProjectProcessDraft["kind"],
                          }
                        : row,
                    ),
                  )
                }
                value={entry.kind}
              >
                {Object.entries(processLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Input
                aria-label={t("projectDetail.workbench.process.descriptionAria", { number: index + 1 })}
                onChange={(event) =>
                  setProcess((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, summary: event.target.value }
                        : row,
                    ),
                  )
                }
                placeholder={t("projectDetail.workbench.process.placeholder")}
                value={entry.summary}
              />
              <Button
                aria-label={t("projectDetail.workbench.process.removeAria", { number: index + 1 })}
                disabled={process.length === 1}
                onClick={() =>
                  setProcess((current) =>
                    current.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          ))}
          {artifactVersionRefs.length ? (
            <p className="text-xs text-[var(--text-400)]">
              {t("projectDetail.workbench.process.linkedArtifacts", { count: artifactVersionRefs.length })}
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-700)]">
                <HelpCircle aria-hidden className="size-4 text-[var(--brand-600)]" />
                {t("projectDetail.workbench.assistance.title")}
              </h3>
              <p className="mt-1 text-xs text-[var(--text-400)]">
                {t("projectDetail.workbench.assistance.description")}
              </p>
            </div>
            <Button
              onClick={() =>
                setAssistance((current) => [
                  ...current,
                  {
                    source: "ai",
                    kind: "hint",
                    level: "light_hint",
                    contentRef: "",
                  },
                ])
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus aria-hidden className="size-3.5" /> {t("projectDetail.workbench.assistance.add")}
            </Button>
          </div>
          {assistance.map((entry, index) => (
            <div
              className="grid gap-2 rounded-xl border border-[var(--border-200)] p-3 sm:grid-cols-3"
              key={index}
            >
              <select
                aria-label={t("projectDetail.workbench.assistance.sourceAria", { number: index + 1 })}
                className={fieldClass}
                onChange={(event) =>
                  setAssistance((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? {
                            ...row,
                            source: event.target.value as ProjectAssistanceDraft["source"],
                          }
                        : row,
                    ),
                  )
                }
                value={entry.source}
              >
                {Object.entries(sourceLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
              <select
                aria-label={t("projectDetail.workbench.assistance.kindAria", { number: index + 1 })}
                className={fieldClass}
                onChange={(event) =>
                  setAssistance((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? {
                            ...row,
                            kind: event.target.value as ProjectAssistanceDraft["kind"],
                          }
                        : row,
                    ),
                  )
                }
                value={entry.kind}
              >
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("projectDetail.workbench.assistance.levelAria", { number: index + 1 })}
                className={fieldClass}
                onChange={(event) =>
                  setAssistance((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? {
                            ...row,
                            level: event.target.value as ProjectAssistanceDraft["level"],
                          }
                        : row,
                    ),
                  )
                }
                value={entry.level}
              >
                {Object.entries(levelLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
              <Input
                aria-label={t("projectDetail.workbench.assistance.noteAria", { number: index + 1 })}
                className="sm:col-span-2"
                onChange={(event) =>
                  setAssistance((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, contentRef: event.target.value }
                        : row,
                    ),
                  )
                }
                placeholder={t("projectDetail.workbench.assistance.notePlaceholder")}
                value={entry.contentRef ?? ""}
              />
              <Button
                onClick={() =>
                  setAssistance((current) =>
                    current.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden className="size-4" /> {t("projectDetail.workbench.remove")}
              </Button>
            </div>
          ))}
        </section>

        {localError || submitAttempt.error ? (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {localError || submitAttempt.error?.message || t("projectDetail.workbench.submit.failed")}
          </p>
        ) : null}

        {submitted ? (
          <div className="flex flex-col gap-3 rounded-xl border border-[color-mix(in_srgb,var(--success)_45%,var(--border))] bg-[var(--success-soft)] p-4 sm:flex-row sm:items-center">
            <CheckCircle2 aria-hidden className="size-5 shrink-0 text-[var(--success)]" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[var(--text-800)]">
                {submitted.replayed ? t("projectDetail.workbench.submit.replayed") : t("projectDetail.workbench.submit.awaitingEvaluation")}
              </p>
              <p className="mt-1 text-xs text-[var(--text-500)]">
                {t("projectDetail.workbench.submit.attempt", { number: submitted.attempt.attemptNumber })} · {projectAttemptStatusLabel(submitted.attempt.status)}
              </p>
            </div>
            <Button onClick={prepareNextVersion} type="button" variant="outline">
              <RotateCcw aria-hidden className="size-4" /> {t("projectDetail.workbench.submit.prepareNext")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-[var(--border-200)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-xs text-[var(--text-400)]">
              <Clock3 aria-hidden className="size-3.5" />
              {t("projectDetail.workbench.submit.durationHint")}
            </p>
            <Button
              disabled={submitAttempt.isPending}
              onClick={() => void submit()}
              type="button"
            >
              {submitAttempt.isPending ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Send aria-hidden className="size-4" />
              )}
              {submitAttempt.isPending ? t("projectDetail.workbench.submit.pending") : t("projectDetail.workbench.submit.button")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ProjectDefinitionList({
  definitions,
  fallback,
}: {
  definitions: Record<string, unknown>[];
  fallback: string;
}) {
  if (!definitions.length) {
    return <p className="text-sm text-[var(--text-500)]">{fallback}</p>;
  }
  return (
    <ul className="space-y-2">
      {definitions.map((definition, index) => (
        <li
          className="rounded-lg border border-[var(--border-200)] bg-[var(--bg-100)] p-3"
          key={projectDefinitionKey(definition, index)}
        >
          <p className="text-sm font-medium text-[var(--text-800)]">
            {projectDefinitionLabel(definition, index)}
          </p>
          {projectDefinitionDescription(definition) ? (
            <p className="mt-1 text-xs leading-5 text-[var(--text-500)]">
              {projectDefinitionDescription(definition)}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
