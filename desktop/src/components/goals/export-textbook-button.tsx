"use client";
import { useT, translateCurrent } from "@xue-learn/core/i18n";

import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Download, Monitor, Smartphone } from "lucide-react";
import { apiFetch } from "@/shared/api-client";
import { Button } from "@xue-learn/core/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@xue-learn/core/utils";
import { supportsGoalTextbookExport } from "@xue-learn/core/client-runtime";

type PdfExportLayout = "desktop" | "mobile";

/** Binary download — uses apiFetch directly since the response is a PDF blob. */
async function downloadTextbookPdf(
  goalId: string,
  goalTitle: string,
  layout: PdfExportLayout,
) {
  const params = new URLSearchParams({ layout });
  const res = await apiFetch(`/api/goals/${goalId}/export/pdf?${params}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ??
        translateCurrent("desktop.i18n.exportFailed", { status: res.status }),
    );
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  let filename = `${goalTitle}-textbook.pdf`;
  const utfMatch = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    filename = decodeURIComponent(utfMatch[1]);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportTextbookButton({
  goalId,
  goalTitle,
  className,
}: {
  goalId: string;
  goalTitle: string;
  className?: string;
}) {
  const t = useT();
  const exportMutation = useMutation({
    mutationFn: (layout: PdfExportLayout) =>
      downloadTextbookPdf(goalId, goalTitle, layout),
  });
  const isPending = exportMutation.isPending;

  if (!supportsGoalTextbookExport()) return null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              className="w-full gap-1.5"
            />
          }
        >
          <Download className="h-4 w-4" aria-hidden />
          {isPending
            ? t("desktop.ui.exportTextbookButton.preparingPdf")
            : t("desktop.ui.exportTextbookButton.exportCourseAsPdf")}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onClick={() => exportMutation.mutate("desktop")}>
            <Monitor className="h-4 w-4" aria-hidden />
            {t("desktop.ui.exportTextbookButton.desktopLayout")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportMutation.mutate("mobile")}>
            <Smartphone className="h-4 w-4" aria-hidden />
            {t("desktop.ui.exportTextbookButton.mobileLayout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {exportMutation.error && (
        <p className="text-xs text-red-600" role="alert">
          {exportMutation.error.message || t("lessonPerformance.exportFailed")}
        </p>
      )}
    </div>
  );
}
