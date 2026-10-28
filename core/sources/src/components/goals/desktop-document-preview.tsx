import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ProseMarkdown } from "../markdown/prose-markdown.js";
import { Button } from "../ui/button.js";
import { useT } from "../../shared/i18n/index.js";

export type PreviewDocument = {
  url: string;
  title: string;
  contentType: string | null;
};

export type DesktopCompanionTab = "document" | "assistant" | "editor";

type DesktopDocumentPreviewContextValue = {
  document: PreviewDocument | null;
  activeView: DesktopCompanionTab;
  openDocument: (document: PreviewDocument) => void;
  closeDocument: () => void;
  showDocument: () => void;
  showAssistant: () => void;
  showEditor: () => void;
};

const DesktopDocumentPreviewContext =
  createContext<DesktopDocumentPreviewContextValue | null>(null);

type LoadedPreview =
  | { kind: "pdf"; document: PDFDocumentProxy }
  | { kind: "markdown"; content: string }
  | { kind: "text"; content: string }
  | { kind: "docx"; html: string }
  | { kind: "unsupported" };

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function sanitizeDocumentHtml(raw: string): string {
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const allowedTags = new Set([
    "P",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "UL",
    "OL",
    "LI",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "BLOCKQUOTE",
    "PRE",
    "CODE",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TH",
    "TD",
    "BR",
    "IMG",
  ]);

  for (const element of [...parsed.body.querySelectorAll("*")]) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const keepImageAttribute =
        element.tagName === "IMG" &&
        (attribute.name === "alt" ||
          (attribute.name === "src" &&
            attribute.value.startsWith("data:image/")));
      if (!keepImageAttribute) element.removeAttribute(attribute.name);
    }
  }
  return parsed.body.innerHTML;
}

async function loadPreview(input: PreviewDocument): Promise<LoadedPreview> {
  const response = await fetch(input.url, { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(`Preview request failed (${response.status})`);
  const contentType = (
    input.contentType ||
    response.headers.get("content-type") ||
    ""
  )
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (contentType === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      kind: "pdf",
      document: await pdfjs.getDocument({ data: bytes }).promise,
    };
  }
  if (contentType === DOCX_CONTENT_TYPE) {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.convertToHtml({
      arrayBuffer: await response.arrayBuffer(),
    });
    return { kind: "docx", html: sanitizeDocumentHtml(result.value) };
  }
  if (contentType === "text/markdown") {
    return { kind: "markdown", content: await response.text() };
  }
  if (contentType.startsWith("text/")) {
    return { kind: "text", content: await response.text() };
  }
  return { kind: "unsupported" };
}

function PdfPage({ page, zoom }: { page: PDFPageProxy; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewport = page.getViewport({ scale: zoom });
    const outputScale = window.devicePixelRatio || 1;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const task = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform:
        outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    });
    void task.promise.catch(() => undefined);
    return () => task.cancel();
  }, [page, zoom]);

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full bg-white shadow-[0_8px_28px_color-mix(in_srgb,var(--text-900)_12%,transparent)]"
    />
  );
}

function PdfPreview({ document }: { document: PDFDocumentProxy }) {
  const t = useT();
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let current = true;
    setPage(null);
    void document.getPage(pageNumber).then((nextPage) => {
      if (current) setPage(nextPage);
    });
    return () => {
      current = false;
    };
  }, [document, pageNumber]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border-200)] bg-[var(--bg-50)] px-4">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pageNumber === 1}
            aria-label={t("goalDocuments.previewPreviousPage")}
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-20 text-center text-xs tabular-nums text-[var(--text-500)]">
            {pageNumber} / {document.numPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pageNumber === document.numPages}
            aria-label={t("goalDocuments.previewNextPage")}
            onClick={() =>
              setPageNumber((value) => Math.min(document.numPages, value + 1))
            }
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={zoom <= 0.75}
            aria-label={t("goalDocuments.previewZoomOut")}
            onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-12 text-center text-xs tabular-nums text-[var(--text-500)]">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={zoom >= 1.5}
            aria-label={t("goalDocuments.previewZoomIn")}
            onClick={() => setZoom((value) => Math.min(1.5, value + 0.25))}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-[var(--bg-200)] p-6">
        {page ? (
          <PdfPage page={page} zoom={zoom} />
        ) : (
          <Loader2 className="mt-10 size-5 animate-spin text-[var(--text-400)]" />
        )}
      </div>
    </div>
  );
}

export function DesktopDocumentPreviewView({
  document,
  active,
  onClose,
}: {
  document: PreviewDocument;
  active: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [preview, setPreview] = useState<LoadedPreview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setPreview(null);
    setError("");
    void loadPreview(document)
      .then((result) => {
        if (current) setPreview(result);
      })
      .catch(() => {
        if (current) setError(t("goalDocuments.resourceOpenFailed"));
      });
    return () => {
      current = false;
    };
  }, [document, t]);

  useEffect(
    () => () => {
      if (preview?.kind === "pdf") void preview.document.destroy();
    },
    [preview],
  );

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);

  return (
    <div
      id="desktop-document-preview-surface"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <header className="flex min-h-12 items-center gap-2 border-b border-[var(--border-200)] px-4 text-left">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileText className="size-4 shrink-0 text-[var(--text-400)]" />
          <h2 className="truncate text-sm font-medium text-[var(--text-800)]">
            {document.title}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      {!preview && !error ? (
        <div className="grid min-h-0 flex-1 place-items-center bg-[var(--bg-100)]">
          <Loader2 className="size-5 animate-spin text-[var(--text-400)]" />
        </div>
      ) : error ? (
        <div className="grid min-h-0 flex-1 place-items-center bg-[var(--bg-100)] p-8 text-center text-sm text-[var(--text-500)]">
          {error}
        </div>
      ) : preview?.kind === "pdf" ? (
        <PdfPreview document={preview.document} />
      ) : preview?.kind === "unsupported" ? (
        <div className="grid min-h-0 flex-1 place-items-center bg-[var(--bg-100)] p-8 text-center text-sm text-[var(--text-500)]">
          {t("goalDocuments.previewUnsupported")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--bg-100)] p-6">
          <article className="mx-auto min-h-full max-w-3xl rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] p-6 text-[var(--text-700)] shadow-sm sm:p-8">
            {preview?.kind === "markdown" ? (
              <ProseMarkdown content={preview.content} />
            ) : preview?.kind === "text" ? (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-7">
                {preview.content}
              </pre>
            ) : preview?.kind === "docx" ? (
              <div
                className="text-sm leading-7 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-300)] [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-[var(--bg-200)] [&_code]:px-1 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-4 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-3 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:my-5 [&_img]:max-w-full [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-[var(--bg-200)] [&_pre]:p-4 [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--border-200)] [&_td]:p-2 [&_th]:border [&_th]:border-[var(--border-200)] [&_th]:bg-[var(--bg-200)] [&_th]:p-2 [&_th]:text-left [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            ) : null}
          </article>
        </div>
      )}
    </div>
  );
}

export function DesktopDocumentPreviewProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [document, setDocument] = useState<PreviewDocument | null>(null);
  const [activeView, setActiveView] = useState<DesktopCompanionTab>("document");
  const closeDocument = useCallback(() => setDocument(null), []);
  const openDocument = useCallback((nextDocument: PreviewDocument) => {
    setActiveView("document");
    setDocument(nextDocument);
  }, []);
  const showDocument = useCallback(() => setActiveView("document"), []);
  const showAssistant = useCallback(() => setActiveView("assistant"), []);
  const showEditor = useCallback(() => setActiveView("editor"), []);

  return (
    <DesktopDocumentPreviewContext.Provider
      value={{
        document,
        activeView,
        openDocument,
        closeDocument,
        showDocument,
        showAssistant,
        showEditor,
      }}
    >
      {children}
    </DesktopDocumentPreviewContext.Provider>
  );
}

export function useDesktopDocumentPreview() {
  return useContext(DesktopDocumentPreviewContext);
}
