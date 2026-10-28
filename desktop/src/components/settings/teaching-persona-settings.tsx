"use client";

import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  MessageCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { TeachingPersonaCharacterSelect } from "@/components/teaching-persona/teaching-persona-character-select";
import { Button } from "@xue-learn/core/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateTeachingPersona,
  useDeleteTeachingPersona,
  usePreviewTeachingPersona,
  useSelectTeachingPersona,
  useTeachingPersonas,
  useUpdateTeachingPersona,
  type TeachingPersona,
  type TeachingPersonaPreview,
} from "@/hooks/api/use-teaching-personas";
import { groupTeachingPersonas } from "@/shared/domain/teaching-persona-selection";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";
import {
  localizeTeachingPersonaContent,
  localizeTeachingPersonaName,
} from "@/shared/teaching-persona-i18n";

const avatarOptions = [
  "xiaohui_female",
  "xiaohui",
  "zhiheng_female",
  "zhiheng",
  "lixing_female",
  "lixing",
  "tuoye_female",
  "tuoye",
  "quzhi_female",
  "quzhi",
  "ruiyan_female",
  "ruiyan",
] as const;

function Avatar({
  persona,
  size = "md",
  className,
}: {
  persona: Pick<TeachingPersona, "avatarCode" | "name" | "ref" | "kind">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const t = useT();
  const name = localizeTeachingPersonaName(persona, t);
  return (
    <img
      src={teachingPersonaAvatarSrc(persona.avatarCode)}
      alt={t("settings.persona.avatarAlt", { name })}
      className={cn(
        "shrink-0 rounded-2xl object-cover ring-1 ring-black/5",
        size === "sm" && "h-10 w-10 rounded-xl",
        size === "md" && "h-16 w-16",
        size === "lg" && "h-36 w-36 rounded-[2rem] shadow-lg shadow-black/10",
        className,
      )}
    />
  );
}

type PreviewScene = "course" | "assessment" | "follow_up";

function TeachingPersonaHeader() {
  const t = useT();

  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          {t("settings.persona.badge")}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("settings.persona.title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t("settings.persona.description")}
        </p>
      </div>
    </div>
  );
}

function PersonaInstructionEditor({
  draft,
  onChange,
  previewSamples,
  previewIsStale,
  previewError,
  previewPending,
  previewingScene,
  onPreview,
}: {
  draft: TeachingPersona;
  onChange: (draft: TeachingPersona) => void;
  previewSamples: TeachingPersonaPreview["samples"] | null;
  previewIsStale: boolean;
  previewError: boolean;
  previewPending: boolean;
  previewingScene: "all" | PreviewScene | null;
  onPreview: (scene?: PreviewScene) => Promise<void>;
}) {
  const t = useT();
  const instructionScenes = [
    {
      key: "course",
      label: t("settings.persona.scene.course"),
      description: t("settings.persona.scene.courseDescription"),
      placeholder: t("settings.persona.scene.coursePlaceholder"),
    },
    {
      key: "assessment",
      label: t("settings.persona.scene.assessment"),
      description: t("settings.persona.scene.assessmentDescription"),
      placeholder: t("settings.persona.scene.assessmentPlaceholder"),
    },
    {
      key: "followUp",
      label: t("settings.persona.scene.followUp"),
      description: t("settings.persona.scene.followUpDescription"),
      placeholder: t("settings.persona.scene.followUpPlaceholder"),
    },
  ] as const;
  const previewScenes = [
    {
      key: "course",
      icon: BookOpen,
      label: t("settings.persona.preview.course"),
      prompt: t("settings.persona.preview.coursePrompt"),
    },
    {
      key: "assessment",
      icon: RefreshCw,
      label: t("settings.persona.preview.assessment"),
      prompt: t("settings.persona.preview.assessmentPrompt"),
    },
    {
      key: "follow_up",
      icon: MessageCircle,
      label: t("settings.persona.preview.followUp"),
      prompt: t("settings.persona.preview.followUpPrompt"),
    },
  ] as const;

  return (
    <>
      <section className="border-t pt-6">
        <div className="space-y-2">
          <Label
            htmlFor="persona-core-instruction"
            className="text-sm font-semibold"
          >
            {t("settings.persona.coreInstruction")}
          </Label>
          <p
            id="persona-core-instruction-help"
            className="text-xs leading-5 text-muted-foreground"
          >
            {t("settings.persona.coreInstructionDescription")}
          </p>
          <Textarea
            id="persona-core-instruction"
            aria-describedby="persona-core-instruction-help persona-core-instruction-count"
            className="min-h-40 rounded-2xl bg-primary/[0.025] text-sm leading-6"
            maxLength={1600}
            placeholder={t("settings.persona.coreInstructionPlaceholder")}
            value={draft.instructions.base}
            onChange={(event) =>
              onChange({
                ...draft,
                instructions: {
                  ...draft.instructions,
                  base: event.target.value,
                },
              })
            }
          />
          <span
            id="persona-core-instruction-count"
            className="block text-right text-xs text-muted-foreground"
          >
            {draft.instructions.base.length}/1600
          </span>
        </div>
      </section>

      <details className="group rounded-2xl border bg-muted/20">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
          <span>
            <span className="block text-sm font-semibold">
              {t("settings.persona.sceneInstructions")}
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {t("settings.persona.sceneInstructionsDescription")}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {t("settings.persona.optional")}
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="space-y-5 border-t p-4">
          {instructionScenes.map((scene) => (
            <div key={scene.key} className="space-y-2">
              <Label
                htmlFor={`persona-scene-${scene.key}`}
                className="text-sm font-medium"
              >
                {scene.label}
              </Label>
              <p className="text-xs leading-5 text-muted-foreground">
                {scene.description}
              </p>
              <Textarea
                id={`persona-scene-${scene.key}`}
                className="min-h-24 rounded-xl"
                maxLength={1200}
                placeholder={scene.placeholder}
                value={draft.instructions[scene.key] ?? ""}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    instructions: {
                      ...draft.instructions,
                      [scene.key]: event.target.value || undefined,
                    },
                  })
                }
              />
              <span className="block text-right text-xs text-muted-foreground">
                {draft.instructions[scene.key]?.length ?? 0}/1200
              </span>
            </div>
          ))}
        </div>
      </details>

      <section className="space-y-4 border-t pt-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h4 className="text-sm font-semibold">
              {t("settings.persona.tryTeacher")}
            </h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("settings.persona.tryTeacherDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={previewPending || !draft.instructions.base.trim()}
            onClick={() => void onPreview()}
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            {previewingScene === "all"
              ? t("settings.persona.previewing")
              : t("settings.persona.generatePreview")}
          </Button>
        </div>
        {previewIsStale && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            {t("settings.persona.previewStale")}
          </p>
        )}
        {previewError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {t("settings.persona.previewFailed")}
          </p>
        )}
        <div className="grid gap-3 lg:grid-cols-3">
          {previewScenes.map((scene) => {
            const sample = previewSamples?.[scene.key];
            const Icon = scene.icon;
            return (
              <article
                key={scene.key}
                className="flex min-h-48 flex-col rounded-2xl border bg-background p-4"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  {scene.label}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {scene.prompt}
                </p>
                <div
                  className="mt-3 flex-1 text-sm leading-6"
                  aria-live="polite"
                >
                  {previewingScene === scene.key ||
                  (previewingScene === "all" && !sample)
                    ? t("settings.persona.previewing")
                    : sample?.status === "success"
                      ? sample.text
                      : sample?.status === "error"
                        ? sample.message
                        : t("settings.persona.previewEmpty")}
                </div>
                {sample && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-2 self-start px-0 text-xs"
                    disabled={previewPending}
                    onClick={() => void onPreview(scene.key)}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    {t("settings.persona.retryPreview")}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

export function TeachingPersonaSettings() {
  const t = useT();
  const query = useTeachingPersonas();
  const select = useSelectTeachingPersona();
  const create = useCreateTeachingPersona();
  const update = useUpdateTeachingPersona();
  const preview = usePreviewTeachingPersona();
  const remove = useDeleteTeachingPersona();
  const [editing, setEditing] = useState<TeachingPersona | null>(null);
  const [draft, setDraft] = useState<TeachingPersona | null>(null);
  const [previewSamples, setPreviewSamples] = useState<
    TeachingPersonaPreview["samples"] | null
  >(null);
  const [previewFingerprint, setPreviewFingerprint] = useState("");
  const [previewingScene, setPreviewingScene] = useState<
    "all" | "course" | "assessment" | "follow_up" | null
  >(null);

  if (query.isPending)
    return (
      <div className="space-y-8">
        <TeachingPersonaHeader />
        <p className="text-sm text-muted-foreground">
          {t("settings.persona.loading")}
        </p>
      </div>
    );
  if (!query.data)
    return (
      <div className="space-y-8">
        <TeachingPersonaHeader />
        <p className="text-sm text-destructive">
          {t("settings.persona.loadFailed")}
        </p>
      </div>
    );

  const closeEditor = () => {
    setEditing(null);
    setDraft(null);
    setPreviewSamples(null);
    setPreviewFingerprint("");
    setPreviewingScene(null);
    preview.reset();
  };
  const begin = (persona: TeachingPersona) => {
    const localized = localizeTeachingPersonaContent(persona, t);
    setEditing(persona);
    setDraft({
      ...persona,
      instructions: { ...persona.instructions },
      ref: persona.kind === "builtin" ? "" : persona.ref,
      kind: "custom",
      name:
        persona.kind === "builtin"
          ? t("settings.persona.myAssistantName", {
              name: localizeTeachingPersonaName(persona, t),
            })
          : persona.name,
      tagline: localized.tagline,
    });
    setPreviewSamples(null);
    setPreviewFingerprint("");
    setPreviewingScene(null);
    preview.reset();
  };
  const buildDraftBody = (value: TeachingPersona) => ({
    name: value.name,
    avatarCode: value.avatarCode,
    tagline: value.tagline,
    learnerAddress: value.learnerAddress,
    instructions: value.instructions,
  });
  const save = async () => {
    if (!draft || !editing) return;
    const body = buildDraftBody(draft);
    if (editing.kind === "builtin") await create.mutateAsync(body);
    else await update.mutateAsync({ id: editing.code, body });
    closeEditor();
  };

  const currentPreviewFingerprint = draft
    ? JSON.stringify({
        name: draft.name,
        learnerAddress: draft.learnerAddress,
        instructions: draft.instructions,
      })
    : "";
  const previewIsStale = Boolean(
    previewSamples && previewFingerprint !== currentPreviewFingerprint,
  );
  const runPreview = async (scene?: "course" | "assessment" | "follow_up") => {
    if (!draft) return;
    setPreviewingScene(scene ?? "all");
    try {
      const result = await preview.mutateAsync({
        ...buildDraftBody(draft),
        ...(scene ? { previewScenes: [scene] } : {}),
      });
      setPreviewSamples((current) =>
        scene && current ? { ...current, ...result.samples } : result.samples,
      );
      setPreviewFingerprint(currentPreviewFingerprint);
    } catch {
      // The mutation exposes the localized error state in the editor.
    } finally {
      setPreviewingScene(null);
    }
  };

  return (
    <div className="space-y-8">
      <TeachingPersonaHeader />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">{t("settings.persona.official")}</h3>
          <span className="text-xs text-muted-foreground">
            {t("settings.persona.catalogSummary", {
              styles: groupTeachingPersonas(query.data.builtin).length,
              count: query.data.builtin.length,
            })}
          </span>
        </div>
        <TeachingPersonaCharacterSelect
          personas={[...query.data.builtin, ...query.data.custom]}
          activeRef={query.data.globalRef}
          onConfirm={async (persona) => {
            await select.mutateAsync(persona.ref);
          }}
          onCustomize={begin}
          onDelete={(persona) => {
            if (window.confirm(t("settings.persona.deleteConfirm"))) {
              remove.mutate(persona.code);
            }
          }}
        />
        {!query.data.custom.length ? (
          <button
            type="button"
            onClick={() => begin(query.data.builtin[0])}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed p-5 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-primary/[0.025] hover:text-foreground"
          >
            <Sparkles className="h-4 w-4" />
            {t("settings.persona.createFromOfficial")}
          </button>
        ) : null}
      </section>

      <Dialog
        open={Boolean(draft && editing)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        {draft && editing && (
          <DialogContent
            className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-none grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl p-0 sm:w-[calc(100vw-2rem)] sm:max-w-[1120px] sm:rounded-3xl"
            showCloseButton
            closeButtonClassName="top-4 right-4"
          >
            <div className="grid min-h-0 xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="hidden overflow-y-auto border-r bg-muted/35 p-6 xl:block">
                <div className="flex flex-col items-center text-center">
                  <Avatar persona={draft} size="lg" />
                  <p className="mt-4 text-xl font-bold">
                    {draft.name || t("settings.persona.unnamed")}
                  </p>
                  <p className="mt-1 text-sm text-primary">
                    {draft.tagline || t("settings.persona.personalPartner")}
                  </p>
                </div>
                <div className="mt-7">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("settings.persona.chooseAvatar")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {avatarOptions.map((code) => {
                      const variant = query.data.builtin.find(
                        (item) => item.avatarCode === code,
                      );
                      const name = variant
                        ? localizeTeachingPersonaName(variant, t)
                        : code;
                      const gender = code.endsWith("_female")
                        ? t("settings.persona.female")
                        : t("settings.persona.male");
                      const selected = draft.avatarCode === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() =>
                            setDraft({ ...draft, avatarCode: code })
                          }
                          className={cn(
                            "flex items-center gap-2 rounded-xl border p-2 text-left transition",
                            selected
                              ? "border-primary bg-primary/5 ring-2 ring-primary/10"
                              : "border-transparent bg-background/70 hover:border-border",
                          )}
                        >
                          <img
                            src={teachingPersonaAvatarSrc(code)}
                            alt=""
                            className="h-9 w-9 rounded-lg object-cover"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {name}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {t("settings.persona.genderAvatar", { gender })}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </aside>

              <div className="min-h-0 overflow-y-auto">
                <DialogHeader className="border-b px-6 py-5 pr-14">
                  <DialogTitle className="text-xl font-bold">
                    {editing.kind === "builtin"
                      ? t("settings.persona.createTitle")
                      : t("settings.persona.editTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("settings.persona.editorDescription")}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-7 p-6">
                  <section className="xl:hidden">
                    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-muted/45 p-3">
                      <Avatar persona={draft} size="md" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {draft.name || t("settings.persona.unnamed")}
                        </p>
                        <p className="truncate text-sm text-primary">
                          {draft.tagline ||
                            t("settings.persona.personalPartner")}
                        </p>
                      </div>
                    </div>
                    <h4 className="mb-3 text-sm font-semibold">
                      {t("settings.persona.chooseAvatar")}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {avatarOptions.map((code) => {
                        const variant = query.data.builtin.find(
                          (item) => item.avatarCode === code,
                        );
                        const name = variant
                          ? localizeTeachingPersonaName(variant, t)
                          : code;
                        const selected = draft.avatarCode === code;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() =>
                              setDraft({ ...draft, avatarCode: code })
                            }
                            className={cn(
                              "flex min-w-0 items-center gap-2 rounded-xl border p-2 text-left",
                              selected
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border bg-background",
                            )}
                          >
                            <img
                              src={teachingPersonaAvatarSrc(code)}
                              alt=""
                              className="h-9 w-9 shrink-0 rounded-lg object-cover"
                            />
                            <span className="truncate text-sm font-medium">
                              {name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-3 text-sm font-semibold">
                      {t("settings.persona.basicInfo")}
                    </h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-muted-foreground">
                          {t("settings.persona.name")}
                        </Label>
                        <Input
                          className="h-11 rounded-xl"
                          maxLength={24}
                          value={draft.name}
                          onChange={(event) =>
                            setDraft({ ...draft, name: event.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-muted-foreground">
                          {t("settings.persona.learnerAddress")}
                        </Label>
                        <Input
                          className="h-11 rounded-xl"
                          maxLength={16}
                          value={draft.learnerAddress}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              learnerAddress: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label className="text-sm font-medium text-muted-foreground">
                          {t("settings.persona.tagline")}
                        </Label>
                        <Input
                          className="h-11 rounded-xl"
                          maxLength={60}
                          value={draft.tagline}
                          onChange={(event) =>
                            setDraft({ ...draft, tagline: event.target.value })
                          }
                        />
                      </div>
                    </div>
                  </section>

                  <PersonaInstructionEditor
                    draft={draft}
                    onChange={setDraft}
                    previewSamples={previewSamples}
                    previewIsStale={previewIsStale}
                    previewError={preview.isError}
                    previewPending={preview.isPending}
                    previewingScene={previewingScene}
                    onPreview={runPreview}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="m-0 rounded-none px-6 py-4">
              <Button variant="ghost" onClick={closeEditor}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={
                  !draft.name.trim() ||
                  !draft.instructions.base.trim() ||
                  create.isPending ||
                  update.isPending
                }
                onClick={() => void save()}
              >
                {create.isPending || update.isPending
                  ? t("common.saving")
                  : t("settings.persona.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
