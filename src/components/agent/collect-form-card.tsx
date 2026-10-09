"use client";

import { useRef, useState, type DragEvent } from "react";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTENT_LANGUAGES,
  getContentLanguageLabel,
} from "@/shared/i18n/content-language";
import {
  DOCUMENT_UPLOAD_ACCEPT,
  DOCUMENT_UPLOAD_LABEL,
} from "@/shared/domain/document-formats";
import { normalizeCollectFormOption } from "@/shared/agent/collect-form-values";
import { cn } from "@xue-learn/core/utils";

const LEVEL_OPTIONS = [
  { value: "zero", label: "零基础" },
  { value: "basic", label: "有基础" },
  { value: "advanced", label: "进阶" },
];

const CONTENT_LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动（按对话语言）" },
  ...CONTENT_LANGUAGES.map((code) => ({
    value: code,
    label: getContentLanguageLabel(code),
  })),
];

type FormField =
  | "level"
  | "contentLanguage"
  | "generationOptions"
  | "isSmallCourse"
  | "documents";

function ChoicePills<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          disabled={disabled}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground ring-primary"
              : "bg-card text-foreground ring-border hover:bg-muted",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CollectFormCard({
  fields,
  defaults,
  labels,
  disabled,
  submitted,
  onSubmit,
}: {
  fields: FormField[];
  defaults?: Record<string, unknown>;
  labels?: Record<string, string>;
  disabled?: boolean;
  submitted?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>, files: File[]) => void;
}) {
  const locked = Boolean(submitted && Object.keys(submitted).length > 0);
  const source = locked ? submitted : defaults;
  const readOnly = disabled || locked;

  const [level, setLevel] = useState(
    normalizeCollectFormOption(source?.level, LEVEL_OPTIONS, "zero"),
  );
  const [contentLanguage, setContentLanguage] = useState(
    normalizeCollectFormOption(
      source?.contentLanguage,
      CONTENT_LANGUAGE_OPTIONS,
      "auto",
    ),
  );
  const [generationOptions, setGenerationOptions] = useState(
    String(source?.generationOptions ?? ""),
  );
  const [isSmallCourse, setIsSmallCourse] = useState(
    source?.isSmallCourse === true,
  );
  const submittedDocNames = Array.isArray(submitted?.documents)
    ? (submitted.documents as string[])
    : [];
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    setFiles([...(e.dataTransfer.files ?? [])]);
  }

  function buildValues(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    if (fields.includes("level")) values.level = level;
    if (fields.includes("contentLanguage"))
      values.contentLanguage = contentLanguage;
    if (fields.includes("generationOptions"))
      values.generationOptions = generationOptions;
    if (fields.includes("isSmallCourse")) values.isSmallCourse = isSmallCourse;
    if (fields.includes("documents") && files.length > 0) {
      values.hasDocuments = true;
      values.documents = files.map((f) => f.name);
    }
    return values;
  }

  return (
    <Card
      size="sm"
      className="w-full rounded-2xl border-[var(--border-200)] bg-[var(--bg-50)] shadow-sm"
    >
      <CardContent className="space-y-3">
        <p className="text-sm font-semibold text-foreground">确认学习设置</p>

        {fields.includes("level") && (
          <div className="space-y-1.5">
            <Label>{labels?.level ?? "基础水平"}</Label>
            <ChoicePills
              options={LEVEL_OPTIONS}
              value={level}
              onChange={setLevel}
              disabled={readOnly}
            />
          </div>
        )}

        {fields.includes("contentLanguage") && (
          <div className="space-y-1.5">
            <Label>{labels?.contentLanguage ?? "内容语言"}</Label>
            <Select
              items={CONTENT_LANGUAGE_OPTIONS}
              value={contentLanguage}
              itemToStringLabel={(value) => {
                const normalized = normalizeCollectFormOption(
                  value,
                  CONTENT_LANGUAGE_OPTIONS,
                  "auto",
                );
                return (
                  CONTENT_LANGUAGE_OPTIONS.find(
                    (option) => option.value === normalized,
                  )?.label ?? normalized
                );
              }}
              onValueChange={(value) => {
                setContentLanguage(
                  normalizeCollectFormOption(
                    value,
                    CONTENT_LANGUAGE_OPTIONS,
                    contentLanguage,
                  ),
                );
              }}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {fields.includes("isSmallCourse") && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <Label>{labels?.isSmallCourse ?? "学习类型"}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={readOnly}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  !isSmallCourse
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setIsSmallCourse(false)}
              >
                <span className="block text-sm font-semibold">学习目标</span>
                <span className="mt-0.5 block text-xs">
                  生成学习地图与详细规划
                </span>
              </button>
              <button
                type="button"
                disabled={readOnly}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  isSmallCourse
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setIsSmallCourse(true)}
              >
                <span className="block text-sm font-semibold">轻课</span>
                <span className="mt-0.5 block text-xs">
                  单单元快速了解，跳过地图与摘要，自动生成预习
                </span>
              </button>
            </div>
          </div>
        )}

        {fields.includes("generationOptions") && (
          <div className="space-y-1.5">
            <Label htmlFor="collect-generation-options">
              {labels?.generationOptions ?? "内容定制说明"}
            </Label>
            <Textarea
              id="collect-generation-options"
              className="min-h-[72px] max-h-40 resize-y overflow-y-auto [field-sizing:fixed]"
              value={generationOptions}
              disabled={readOnly}
              onChange={(e) => setGenerationOptions(e.target.value)}
            />
          </div>
        )}

        {fields.includes("documents") && (
          <div className="space-y-1.5">
            <Label>{labels?.documents ?? "学习资料（可选）"}</Label>
            <div
              role="button"
              tabIndex={0}
              onClick={() => !readOnly && fileInputRef.current?.click()}
              onDragOver={(e) => !readOnly && e.preventDefault()}
              onDragEnter={() => !readOnly && setIsDragging(true)}
              onDragLeave={() => !readOnly && setIsDragging(false)}
              onDrop={(e) => !readOnly && handleDrop(e)}
              className={cn(
                "cursor-pointer rounded-xl border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs transition hover:border-primary/40 hover:bg-muted/50",
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
              {locked && submittedDocNames.length > 0
                ? `已选 ${submittedDocNames.length} 个文件`
                : files.length > 0
                  ? `已选 ${files.length} 个文件`
                  : `拖拽或点击上传 ${DOCUMENT_UPLOAD_LABEL}（可选）`}
            </div>
          </div>
        )}

        {!locked ? (
          <Button
            type="button"
            size="sm"
            disabled={readOnly}
            onClick={() => onSubmit(buildValues(), files)}
          >
            确认
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
