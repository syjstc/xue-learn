import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  Eye,
  FileText,
  Globe,
  Link,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useDeleteGoalDocument,
  useUploadGoalDocuments,
  useIngestGoalUrls,
} from "@/hooks/api";
import { useConfirm } from "@/hooks/use-confirm";
import type { UploadedGoalDocument } from "@/shared/api";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@xue-learn/core/utils";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/shared/domain/document-formats";
import { useI18n, useT } from "@xue-learn/core/i18n";
import { supportsGoalDocumentUrls } from "@xue-learn/core/client-runtime";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
import { useDesktopDocumentPreview } from "@xue-learn/core/components/goals/desktop-document-preview";
import { GoalWebKnowledgePanel } from "./goal-web-knowledge-panel.tsx";

const WEB_SEARCH_REFERENCE_FILENAME = "网页搜索参考.md";

function formatUploadedAt(iso: string, locale: string) {
  const dateLocale =
    locale === "en" ? "en-US" : locale === "zh-Hant" ? "zh-TW" : "zh-CN";
  return new Date(iso).toLocaleDateString(dateLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isUserUploadedDocument(document: UploadedGoalDocument) {
  return document.filename !== WEB_SEARCH_REFERENCE_FILENAME;
}

export function GoalDocumentsPanel({
  goalId,
  documents,
  webResourcesEnabled = true,
}: {
  goalId: string;
  documents: UploadedGoalDocument[];
  webResourcesEnabled?: boolean;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadDocuments = useUploadGoalDocuments();
  const deleteDocument = useDeleteGoalDocument();
  const ingestUrls = useIngestGoalUrls();
  const { confirm, alert } = useConfirm();
  const t = useT();
  const { locale } = useI18n();
  const documentUrlsEnabled = supportsGoalDocumentUrls();
  const documentPreview = useDesktopDocumentPreview();
  const [uploadError, setUploadError] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || uploadDocuments.isPending) return;
    setUploadError("");
    setUploadProgress(t("goalDocuments.uploadingEllipsis"));
    try {
      await uploadDocuments.mutateAsync({
        goalId,
        files,
        onProgress: setUploadProgress,
      });
      setUploadProgress("");
    } catch (err) {
      setUploadProgress("");
      setUploadError(
        err instanceof Error ? err.message : t("goalDocuments.uploadFailed"),
      );
    }
  }

  function handleUploadResources(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void uploadFiles(files);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setIsDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  async function handleDelete(document: UploadedGoalDocument) {
    const ok = await confirm({
      title: t("goalDocuments.deleteTitle"),
      description: t("goalDocuments.deleteDescription", {
        filename: document.filename,
      }),
      variant: "destructive",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;

    setDeletingId(document.id);
    try {
      await deleteDocument.mutateAsync({ goalId, documentId: document.id });
    } catch (err) {
      await alert({
        title: t("goalDocuments.deleteFailed"),
        description:
          err instanceof Error ? err.message : t("goalDocuments.deleteFailed"),
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function addUrls() {
    const urls = [
      ...new Set(
        urlInput
          .split(/\s+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].slice(0, 10);
    if (urls.length === 0) return;
    setUploadError("");
    try {
      const result = await ingestUrls.mutateAsync({ goalId, urls });
      const errors = result.results
        .filter((item) => item.status === "error")
        .map((item) => item.error)
        .filter(Boolean);
      setUploadError(errors.join("；"));
      if (result.results.some((item) => item.status === "success"))
        setUrlInput("");
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : t("goalDocuments.urlReadFailed"),
      );
    }
  }

  async function refreshUrl(document: UploadedGoalDocument) {
    if (!document.sourceUrl) return;
    try {
      await ingestUrls.mutateAsync({
        goalId,
        urls: [document.sourceUrl],
        refresh: true,
      });
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : t("goalDocuments.sourceRefreshFailed"),
      );
    }
  }

  function openNativePreview(document: UploadedGoalDocument) {
    if (!window.xueLearnDesktop || !document.storageKey || !documentPreview)
      return;
    setUploadError("");
    documentPreview.openDocument({
      url: new URL(
        `/api/rag/documents/${encodeURIComponent(document.id)}/content?goalId=${encodeURIComponent(goalId)}`,
        window.location.origin,
      ).toString(),
      title: document.filename,
      contentType: document.contentType ?? null,
    });
  }

  return (
    <Card className="border-[var(--border-200)] bg-[var(--bg-50)]">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <CardTitle
            className="text-base"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {t("goalDocuments.title")}
          </CardTitle>
          <p className="mt-0.5 text-sm text-[var(--text-400)]">
            {t("goalDocuments.description")}
          </p>
        </div>
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          accept={DOCUMENT_UPLOAD_ACCEPT}
          onChange={handleUploadResources}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploadDocuments.isPending}
          onClick={() => uploadInputRef.current?.click()}
          className="rounded-lg"
        >
          {uploadDocuments.isPending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 size-4" />
          )}
          {uploadDocuments.isPending
            ? t("goalDocuments.uploading")
            : t("goalDocuments.upload")}
        </Button>
      </div>

      {documentUrlsEnabled ? (
        <div className="flex gap-2 px-5 pb-4">
          <input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder={t("goalDocuments.urlPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border-200)] bg-background px-3 py-2 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ingestUrls.isPending || !urlInput.trim()}
            onClick={() => void addUrls()}
          >
            {ingestUrls.isPending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Link className="mr-1.5 size-4" />
            )}
            {t("goalDocuments.addUrl")}
          </Button>
        </div>
      ) : null}

      {uploadError ? (
        <div className="px-5 pb-3">
          <p className="text-sm text-[var(--error-500)]">{uploadError}</p>
        </div>
      ) : null}

      {uploadDocuments.isPending && uploadProgress ? (
        <div className="px-5 pb-4" role="status" aria-live="polite">
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-[var(--text-600)]">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            <span>{uploadProgress}</span>
          </div>
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div
          className={cn(
            "border-t border-[var(--border-200)] px-5 py-3 transition-colors",
            isDragging && "border-primary bg-primary/5",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploadDocuments.isPending) setIsDragging(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!uploadDocuments.isPending) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <ul className="divide-y divide-[var(--border-200)]">
            {documents.map((document) => {
              const isUrl = Boolean(document.sourceUrl);
              const isWebSearch = !isUrl && !isUserUploadedDocument(document);
              const isDeleting = deletingId === document.id;
              const hasNativeOriginal =
                isDesktopLocalRuntime() &&
                document.hasOriginal === true &&
                Boolean(document.storageKey) &&
                Boolean(window.xueLearnDesktop?.resources);
              const canInlinePreview = hasNativeOriginal;

              return (
                <li
                  key={document.id}
                  className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  {isWebSearch || isUrl ? (
                    <Globe className="size-4 shrink-0 text-[var(--text-400)]" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-[var(--text-400)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--text-700)]">
                        {document.filename}
                      </p>
                      {isWebSearch ? (
                        <span className="shrink-0 rounded-full bg-[var(--bg-200)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-500)]">
                          {t("goalDocuments.webSearch")}
                        </span>
                      ) : isUrl ? (
                        <span className="shrink-0 rounded-full bg-[var(--bg-200)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-500)]">
                          {t("goalDocuments.webPage")}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--text-400)]">
                      {t("goalDocuments.itemMeta", {
                        action: isWebSearch
                          ? t("goalDocuments.autoSaved")
                          : isUrl
                            ? t("goalDocuments.read")
                            : t("goalDocuments.uploaded"),
                        date: formatUploadedAt(document.createdAt, locale),
                      })}
                    </p>
                    {document.warning ? (
                      <p className="text-xs text-amber-600">
                        {document.warning}
                      </p>
                    ) : null}
                  </div>
                  {isUrl ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        aria-label={t("goalDocuments.openAria", {
                          filename: document.filename,
                        })}
                        onClick={() =>
                          window.open(
                            document.canonicalUrl || document.sourceUrl || "",
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        <Link className="size-4" />
                      </Button>
                      {documentUrlsEnabled ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0"
                          disabled={ingestUrls.isPending}
                          aria-label={t("goalDocuments.refreshAria", {
                            filename: document.filename,
                          })}
                          onClick={() => void refreshUrl(document)}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {canInlinePreview ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-8 p-0"
                      aria-label={t("goalDocuments.previewAria", {
                        filename: document.filename,
                      })}
                      onClick={() => openNativePreview(document)}
                    >
                      <Eye className="size-4" />
                    </Button>
                  ) : null}
                  {!isWebSearch ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isDeleting || deleteDocument.isPending}
                      className="size-8 shrink-0 rounded-lg p-0 text-[var(--text-400)] hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t("goalDocuments.deleteAria", {
                        filename: document.filename,
                      })}
                      onClick={() => void handleDelete(document)}
                    >
                      {isDeleting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className={cn(
            "mx-5 mb-5 cursor-pointer rounded-xl border border-dashed px-5 py-6 text-center transition",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-[var(--border-200)] hover:border-primary/40 hover:bg-muted/30",
          )}
          onClick={() =>
            !uploadDocuments.isPending && uploadInputRef.current?.click()
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              uploadInputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploadDocuments.isPending) setIsDragging(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!uploadDocuments.isPending) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="mx-auto mb-2 size-5 text-[var(--text-400)]" />
          <p className="text-sm text-[var(--text-500)]">
            {uploadDocuments.isPending
              ? t("goalDocuments.uploadingEllipsis")
              : isDragging
                ? t("goalDocuments.dropToUpload")
                : t("goalDocuments.uploadPrompt")}
          </p>
          <p className="mt-1 text-xs text-[var(--text-400)]">
            {t("goalDocuments.emptyDescription")}
          </p>
        </div>
      )}
      {webResourcesEnabled ? <GoalWebKnowledgePanel goalId={goalId} /> : null}
    </Card>
  );
}
