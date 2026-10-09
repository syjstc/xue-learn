"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileUp, Sparkles, XIcon } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImeSafeForm } from "@/components/ui/ime-safe-form";
import { LlmLoadingStatus } from "@/components/ai/llm-loading-status";
import {
  DOCUMENT_UPLOAD_ACCEPT,
  DOCUMENT_UPLOAD_LABEL,
} from "@/shared/domain/document-formats";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";
import { supportsGoalInstantMicroGeneration } from "@xue-learn/core/client-runtime";

export type MicroCreationMode = "guided" | "instant";

export type GoalTopicPromptSubmit = {
  topic: string;
  files: File[];
  urls: string[];
  isSmallCourse?: boolean;
  microMode?: MicroCreationMode;
};

export function GoalTopicPromptDialog({
  open,
  initialTopic,
  initialIsSmallCourse = false,
  onClose,
  onSubmit,
  loading = false,
  loadingStatus = "",
}: {
  open: boolean;
  initialTopic?: string;
  initialIsSmallCourse?: boolean;
  onClose: () => void;
  onSubmit: (input: GoalTopicPromptSubmit) => void;
  loading?: boolean;
  loadingStatus?: string;
}) {
  const t = useT();
  const [topic, setTopic] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [urlsText, setUrlsText] = useState("");
  const [isSmallCourse, setIsSmallCourse] = useState(initialIsSmallCourse);
  const [microMode, setMicroMode] = useState<MicroCreationMode>("guided");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const instantMicroEnabled = supportsGoalInstantMicroGeneration();

  useEffect(() => {
    if (!open) {
      setTopic("");
      setFiles([]);
      setUrlsText("");
      setIsSmallCourse(false);
      setMicroMode("guided");
      return;
    }
    setTopic(initialTopic?.trim() ?? "");
    setIsSmallCourse(initialIsSmallCourse);
    if (!instantMicroEnabled) setMicroMode("guided");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, initialTopic, initialIsSmallCourse, instantMicroEnabled]);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = [...(e.dataTransfer.files ?? [])];
    if (dropped.length > 0) setFiles(dropped);
  }

  function submit() {
    const isInstant = isSmallCourse && microMode === "instant";
    const detected = topic.match(/https?:\/\/[^\s]+/g) ?? [];
    const urls = isInstant
      ? []
      : [
          ...new Set(
            [...urlsText.split(/\s+/), ...detected]
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ].slice(0, 10);
    const trimmed = topic.replace(/https?:\/\/[^\s]+/g, "").trim();
    if (!trimmed && files.length === 0 && urls.length === 0) return;
    onSubmit({
      topic: trimmed,
      files,
      urls,
      isSmallCourse: isSmallCourse || undefined,
      microMode: isSmallCourse
        ? instantMicroEnabled
          ? microMode
          : "guided"
        : undefined,
    });
  }

  const isInstantMicro =
    instantMicroEnabled && isSmallCourse && microMode === "instant";
  const canSubmit =
    topic.trim().length > 0 || files.length > 0 || urlsText.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(92dvh,calc(100dvh-1rem))] w-[calc(100%-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0 gap-2 border-b border-border/60 px-4 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {isSmallCourse
                ? t("assistant.goalPrompt.newMicroCourse")
                : t("assistant.goalPrompt.newGoal")}
            </div>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                />
              }
            >
              <XIcon />
              <span className="sr-only">{t("common.close")}</span>
            </DialogClose>
          </div>
          <DialogTitle className="text-lg sm:text-xl">
            {isSmallCourse
              ? t("assistant.goalPrompt.microTitle")
              : t("assistant.goalPrompt.goalTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {isInstantMicro
              ? t("assistant.goalPrompt.instantDescription")
              : isSmallCourse
                ? t("assistant.goalPrompt.microDescription")
                : t("assistant.goalPrompt.goalDescription")}
          </DialogDescription>
        </DialogHeader>

        <ImeSafeForm
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:space-y-4 sm:px-6">
            <div className="space-y-2">
              <Label>{t("assistant.goalPrompt.typeLabel")}</Label>
              <div className="grid grid-cols-1 gap-2 min-[22rem]:grid-cols-2">
                <button
                  type="button"
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-colors",
                    !isSmallCourse
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => setIsSmallCourse(false)}
                >
                  <span className="block text-sm font-semibold">
                    {t("assistant.confirmation.fullGoal")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5">
                    {t("assistant.confirmation.fullGoalDescription")}
                  </span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-colors",
                    isSmallCourse
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => setIsSmallCourse(true)}
                >
                  <span className="block text-sm font-semibold">
                    {t("assistant.confirmation.microCourse")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5">
                    {t("assistant.confirmation.microCourseDescription")}
                  </span>
                </button>
              </div>
            </div>

            {isSmallCourse ? (
              <div className="space-y-2">
                <Label>{t("assistant.goalPrompt.creationMethod")}</Label>
                <div className="grid grid-cols-1 gap-2 min-[22rem]:grid-cols-2">
                  <button
                    type="button"
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      microMode === "guided"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                    onClick={() => setMicroMode("guided")}
                  >
                    <span className="block text-sm font-semibold">
                      {t("assistant.goalPrompt.guided")}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5">
                      {t("assistant.goalPrompt.guidedDescription")}
                    </span>
                  </button>
                  {instantMicroEnabled ? (
                    <button
                      type="button"
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left transition-colors",
                        microMode === "instant"
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() => setMicroMode("instant")}
                    >
                      <span className="block text-sm font-semibold">
                        {t("assistant.goalPrompt.instant")}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5">
                        {t("assistant.goalPrompt.instantCreationDescription")}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="goal-topic">
                {isSmallCourse
                  ? t("assistant.goalPrompt.topicLabel")
                  : t("assistant.goalPrompt.goalLabel")}
              </Label>
              <Textarea
                id="goal-topic"
                ref={inputRef}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                rows={5}
                className="min-h-28 max-h-48 resize-y overflow-y-auto [field-sizing:fixed] sm:min-h-32 sm:max-h-56"
                placeholder={
                  isSmallCourse
                    ? t("assistant.goalPrompt.topicPlaceholder")
                    : t("assistant.goalPrompt.goalPlaceholder")
                }
              />
            </div>

            {!isInstantMicro ? (
              <div className="space-y-2">
                <Label htmlFor="goal-urls">
                  {t("assistant.goalPrompt.urlsLabel")}
                </Label>
                <Textarea
                  id="goal-urls"
                  value={urlsText}
                  onChange={(event) => setUrlsText(event.target.value)}
                  rows={2}
                  className="min-h-16 max-h-28 resize-y overflow-y-auto [field-sizing:fixed]"
                  placeholder={t("assistant.goalPrompt.urlsPlaceholder")}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>
                {t("assistant.goalPrompt.materialsLabel")}
                {isSmallCourse ? t("assistant.goalPrompt.optionalSuffix") : ""}
              </Label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDragEnter={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "cursor-pointer rounded-xl border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs transition hover:border-primary/40 hover:bg-muted/50 sm:py-5",
                  isDragging && "border-primary bg-primary/5",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                  multiple
                  className="sr-only"
                  onChange={(e) => setFiles([...(e.target.files ?? [])])}
                />
                <FileUp className="mx-auto mb-2 size-5 text-muted-foreground" />
                {files.length > 0
                  ? t("assistant.goalPrompt.filesSelected", {
                      count: files.length,
                    })
                  : t("assistant.goalPrompt.uploadDocuments", {
                      formats: DOCUMENT_UPLOAD_LABEL,
                    })}
              </div>
            </div>

            {loadingStatus ? (
              loading ? (
                <LlmLoadingStatus className="text-sm text-muted-foreground">
                  {loadingStatus}
                </LlmLoadingStatus>
              ) : (
                <p className="text-sm text-destructive" role="alert">
                  {loadingStatus}
                </p>
              )
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={onClose}
              disabled={loading}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={!canSubmit || loading}
            >
              {isInstantMicro
                ? loading
                  ? t("assistant.goalPrompt.creating")
                  : t("assistant.goalPrompt.startNow")
                : isSmallCourse
                  ? t("assistant.goalPrompt.createMicroCourse")
                  : t("assistant.goalPrompt.startPlanning")}
            </Button>
          </div>
        </ImeSafeForm>
      </DialogContent>
    </Dialog>
  );
}
