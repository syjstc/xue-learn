import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, BookOpen, Upload } from "lucide-react";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

type TeachingSkillSummary = {
  id: string;
  slug: string;
  source: "builtin" | "admin" | string;
  status: "active" | "archived" | string;
  currentPublishedVersion: null | {
    name: string;
    description: string;
    publishedAt: string | null;
  };
  versions: Array<{ id: string; name: string }>;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return body;
}

export function LocalTeachingSkillsPage() {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<TeachingSkillSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    const response = await fetch("/api/local/teaching-skills");
    setSkills(await responseJson<TeachingSkillSummary[]>(response));
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [load]);

  async function importSkill(file: File) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/local/teaching-skills/import", {
        method: "POST",
        body: form,
      });
      const skill = await responseJson<TeachingSkillSummary>(response);
      setNotice(t("desktop.teachingSkills.importedNotice", { slug: skill.slug }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function mutate(id: string, action: "publish" | "archive") {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(
        `/api/local/teaching-skills/${encodeURIComponent(id)}/${action}`,
        { method: "POST" },
      );
      await responseJson(response);
      setNotice(
        action === "publish"
          ? t("desktop.teachingSkills.publishedNotice")
          : t("desktop.teachingSkills.archivedNotice"),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-5"
      aria-labelledby="local-teaching-skills-title"
    >
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="local-teaching-skills-title"
              className="text-xl font-semibold"
            >
              {t("desktop.teachingSkills.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("desktop.teachingSkills.description")}
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 aria-disabled:pointer-events-none aria-disabled:opacity-50">
            <Upload className="size-4" aria-hidden />
            {t("desktop.teachingSkills.importZip")}
            <input
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importSkill(file);
              }}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("desktop.teachingSkills.packageHint")}
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3">
        {skills.map((skill) => {
          const draft = skill.versions[0];
          const builtin = skill.source === "builtin";
          return (
            <article
              key={skill.id}
              className="rounded-2xl border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <BookOpen className="size-4 text-primary" aria-hidden />
                    <h3 className="font-semibold">
                      {skill.currentPublishedVersion?.name ??
                        draft?.name ??
                        skill.slug}
                    </h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {builtin
                        ? t("desktop.teachingSkills.builtin")
                        : t("desktop.teachingSkills.local")}
                    </span>
                    {draft ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-800">
                        {t("desktop.teachingSkills.draft")}
                      </span>
                    ) : null}
                    {skill.status === "archived" ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {t("desktop.teachingSkills.archived")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {skill.currentPublishedVersion?.description ?? skill.slug}
                  </p>
                  <code className="mt-2 block text-xs text-muted-foreground">
                    {skill.slug}
                  </code>
                </div>
                <div className="flex shrink-0 gap-2">
                  {draft ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void mutate(skill.id, "publish")}
                      className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {t("desktop.teachingSkills.publish")}
                    </button>
                  ) : null}
                  {!builtin && skill.status !== "archived" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void mutate(skill.id, "archive")}
                      className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      <Archive className="size-4" aria-hidden />{" "}
                      {t("desktop.teachingSkills.archive")}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
