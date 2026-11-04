import {useLayoutEffect, useRef, useState} from "react";
import {Expand, ZoomIn, ZoomOut} from "lucide-react";
import type {ReadingComponentArtifact} from "@xue-learn/core/domain/reading-document";
import {readingProseMarkdown} from "@xue-learn/core/domain/reading-document";
import {useT} from "@xue-learn/core/i18n";
import {Button} from "@xue-learn/core/ui/button";
import {Dialog, DialogContent, DialogTitle, DialogDescription} from "@xue-learn/core/ui/dialog";
import {prepareStageSvgMarkup, StageStaticSvg} from "@xue-learn/core/display/course-board-media";
import {ProseMarkdown} from "@xue-learn/core/components/markdown/prose-markdown";

type Figure = Extract<ReadingComponentArtifact, {type: "svg" | "image"}>;
const canvasPadding = 24;

export function ReadingFigure({artifact, title}: {artifact: Figure; title?: string}) {
  const t = useT();
  const measure = useRef<HTMLDivElement>(null);
  const inlineViewport = useRef<HTMLDivElement>(null);
  const [expandedViewport, setExpandedViewport] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [expandedZoom, setExpandedZoom] = useState<number | null>(null);
  const [geometry, setGeometry] = useState({readableWidth: 960, ratio: 16 / 9});
  const [expandedSize, setExpandedSize] = useState({width: 960, height: 640});
  const source = artifact.type === "svg" ? artifact.svg : artifact.imageUrl;

  useLayoutEffect(() => {
    setZoom(null);
    setExpandedZoom(null);
    const svg = measure.current?.querySelector("svg");
    const img = measure.current?.querySelector("img");
    const update = () => {
      if (svg) {
        const {width, height} = svg.viewBox.baseVal;
        if (!(width > 0 && height > 0)) return;
        const sizes = [...svg.querySelectorAll("text")].filter(node => node.textContent?.trim())
          .map(node => Number.parseFloat(getComputedStyle(node).fontSize)).filter(size => size > 0);
        // Readable size remains an explicit option for older, dense figures.
        // The initial view always shows the whole diagram across the page.
        setGeometry({ratio: width / height,
          readableWidth: Math.ceil(Math.min(2400, width * Math.max(1, 18 / Math.min(...sizes, 18)) + canvasPadding))});
      } else if (img?.naturalWidth && img.naturalHeight) {
        setGeometry({ratio: img.naturalWidth / img.naturalHeight,
          readableWidth: Math.min(2400, img.naturalWidth + canvasPadding)});
      }
    };
    update();
    img?.addEventListener("load", update);
    return () => img?.removeEventListener("load", update);
  }, [source]);

  useLayoutEffect(() => {
    const viewport = expandedViewport;
    if (!open || !viewport) return;
    const update = () => setExpandedSize({width: viewport.clientWidth, height: viewport.clientHeight});
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [open, expandedViewport]);

  const expandedFitWidth = Math.max(canvasPadding, Math.min(expandedSize.width,
    (expandedSize.height - canvasPadding) * geometry.ratio + canvasPadding));
  const inlineFitWidth = Math.min(geometry.readableWidth, 640 * geometry.ratio + canvasPadding);
  const media = () => artifact.type === "svg"
    ? <StageStaticSvg markup={prepareStageSvgMarkup(artifact.svg)} alt={artifact.alt} stage={false} />
    : <img src={artifact.imageUrl} alt={artifact.caption} loading="lazy" />;
  const controls = (modal = false) => {
    const value = modal ? expandedZoom : zoom;
    const setValue = modal ? setExpandedZoom : setZoom;
    const changeZoom = (factor: number) => setValue(current => {
      const fitWidth = modal ? expandedFitWidth : Math.min(inlineViewport.current?.clientWidth ?? geometry.readableWidth, inlineFitWidth);
      return Math.min(3, Math.max(.05, (current ?? fitWidth / geometry.readableWidth) * factor));
    });
    return <div className="reading-figure-controls reading-no-print">
      <Button size="sm" variant="ghost" onClick={() => setValue(null)} aria-pressed={value === null}>{t("reading.fitFigure")}</Button>
      <Button size="sm" variant="ghost" onClick={() => setValue(1)} aria-pressed={value === 1}>{t("reading.readableFigure")}</Button>
      <Button size="icon" variant="ghost" aria-label={t("reading.zoomOut")} disabled={value !== null && value <= .05}
        onClick={() => changeZoom(.8)}><ZoomOut className="size-4" /></Button>
      <span className="reading-zoom-value">{value === null ? t("reading.fitFigure") : `${Math.round(value * 100)}%`}</span>
      <Button size="icon" variant="ghost" aria-label={t("reading.zoomIn")} disabled={value !== null && value >= 3}
        onClick={() => changeZoom(1.25)}><ZoomIn className="size-4" /></Button>
    </div>;
  };
  const canvas = (modal = false) => {
    const value = modal ? expandedZoom : zoom;
    return <div className={`reading-figure-viewport${modal ? " reading-figure-viewport-expanded" : ""}`}
      ref={modal ? setExpandedViewport : inlineViewport} data-zoomed={value !== null}
      tabIndex={0} role="region" aria-label={title || t("reading.figure")}>
      <div className="reading-figure-canvas" ref={modal ? undefined : measure}
        style={{width: value === null ? modal ? `${expandedFitWidth}px` : `min(100%, ${inlineFitWidth}px)` : `${geometry.readableWidth * value}px`}}>{media()}</div>
    </div>;
  };
  return <figure className="reading-figure" data-reading-figure-type={artifact.type}>
    <div className="reading-figure-toolbar">
      {controls()}
      <Button size="sm" variant="outline" className="reading-no-print" onClick={() => {setExpandedZoom(null); setOpen(true);}}>
        <Expand className="size-4" />{t("reading.expandFigure")}
      </Button>
    </div>
    {canvas()}
    <p className="reading-figure-hint reading-no-print">{t("reading.figureNavigation")}</p>
    <figcaption><ProseMarkdown content={readingProseMarkdown(artifact.caption)} /></figcaption>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="reading-workspace reading-figure-dialog">
        <DialogTitle>{title || t("reading.figure")}</DialogTitle>
        <DialogDescription className="reading-figure-hint">{t("reading.figureNavigation")}</DialogDescription>
        {controls(true)}
        {canvas(true)}
      </DialogContent>
    </Dialog>
  </figure>;
}
