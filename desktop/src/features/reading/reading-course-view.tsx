import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Check, ChevronRight, Loader2, RefreshCw, Square, Printer } from "lucide-react";
import type { ReadingBlock, ReadingComponentArtifact, ReadingCourse, ReadingDerivation,
  ReadingDocument, ReadingSnapshot } from "@xue-learn/core/domain/reading-document";
import { readingPlotScene, readingPremiseMarkdown, readingProseMarkdown, readingResultParts } from "@xue-learn/core/domain/reading-document";
import { readingDerivationToTeaching } from "@xue-learn/core/teaching-derivation/reading";
import { useT } from "@xue-learn/core/i18n";
import { Button } from "@xue-learn/core/ui/button";
import { Dialog, DialogTrigger } from "@xue-learn/core/ui/dialog";
import { ProseMarkdown } from "@xue-learn/core/components/markdown/prose-markdown";
import { MathLatex } from "@xue-learn/core/components/markdown/math-latex";
import { apiGet, apiPost } from "@/shared/api";
import { apiFetch, apiUrl } from "@/shared/api-client";
import { MathSceneView } from "@/components/math/math-scene";
import { SelectionFollowUpToolbar } from "@/components/wizard/inline-follow-up-popup";
import {ReadingFigure} from "./reading-figure";
import {ReadingDerivationPresentation} from "./reading-derivation-presentation";
import {useReadingFollowUp} from "./use-reading-follow-up";
import "./reading.css";

const busy = (status?: string) => status === "pending" || status === "running";
const hasActiveReading = (course?: ReadingCourse) => course?.sections.some(
  section => busy(section.reading?.status) || (section.reading?.pendingComponents ?? 0) > 0,
) ?? false;
function Text({children}: {children: string}) {
  return <div className="reading-prose"><ProseMarkdown content={readingProseMarkdown(children)} variant="default" /></div>;
}

function ReadingCheck({block, storageKey}: {
  block: Extract<ReadingBlock, {type: "check"}>; storageKey: string;
}) {
  const t = useT();
  const [answer, setAnswer] = useState<number | null>(() => {
    try {const saved = localStorage.getItem(storageKey); return saved !== null ? Number(saved) : null;}
    catch {return null;}
  });
  return <fieldset className="reading-check">
    <legend>{t("reading.check")}</legend>
    <Text>{block.question}</Text>
    <div className="reading-options">
      {block.options.map((option, index) => <label key={index} data-selected={answer === index}>
        <input type="radio" name={storageKey} checked={answer === index} onChange={() => {
          setAnswer(index);
          try {localStorage.setItem(storageKey, String(index));} catch { /* Reading remains usable without storage. */ }
        }} />
        <span><Text>{option}</Text></span>
      </label>)}
    </div>
    {answer !== null && <div className="reading-answer" role="status">
      <strong>{answer === block.correctIndex ? t("reading.correct") : t("reading.tryAgain")}</strong>
      <Text>{block.explanation}</Text>
    </div>}
  </fieldset>;
}

export function ReadingDerivationView({document, id, language = "zh-Hans"}: {
  document: ReadingDerivation; id: string; language?: string;
}) {
  const t = useT();
  const [demonstrate, setDemonstrate] = useState(false);
  const [cursor, setCursor] = useState({id, ordinal: 1});
  const ordinal = Math.max(1, Math.min(document.steps.length, cursor.id === id ? cursor.ordinal : 1));
  const teaching = useMemo(() => demonstrate ? readingDerivationToTeaching(document, {id, locale: language}) : undefined,
    [demonstrate, document, id, language]);
  return <Dialog open={demonstrate} onOpenChange={setDemonstrate}>
  <section className="reading-derivation" data-reading-derivation-mode={demonstrate ? "presentation" : "reading"}>
    <div className="reading-component-heading">
      <h3>{document.title}</h3>
      <DialogTrigger render={<Button size="sm" variant="outline" className="reading-no-print" />}>
        {t("reading.showDerivation")}
      </DialogTrigger>
    </div>
    {!demonstrate && <div className="reading-derivation-text">
    {document.premises.length > 0 && <details className="reading-premises" open>
      <summary>{t("reading.premises")}</summary>
      <ul>{document.premises.map(p => <li key={p.id} id={`${id}-${p.id}`}><Text>{readingPremiseMarkdown(p.text)}</Text></li>)}</ul>
    </details>}
    <ol className="reading-steps">
      {document.steps.map((step, index) => <li key={step.id} id={`${id}-${step.id}`}>
        <div className="reading-step-number">{index + 1}</div>
        <div className="reading-step-content">
          <div className="reading-formula">{readingResultParts(step.result).map((part, index) => part.kind === "math"
            ? <MathLatex key={index} latex={part.value} display />
            : <div className="reading-formula-note" key={index}><Text>{part.value}</Text></div>)}</div>
          <div className="reading-reason"><Text>{step.reason}</Text></div>
          {step.condition && <div className="reading-condition"><span>{t("reading.condition")}</span><Text>{step.condition}</Text></div>}
          {step.dependsOn.length > 0 && <div className="reading-dependencies">
            <span>{t("reading.dependsOn")}</span>
            {step.dependsOn.map(dependency => {
              const premise = document.premises.findIndex(p => p.id === dependency);
              const prior = document.steps.findIndex(s => s.id === dependency);
              return <a key={dependency} href={`#${id}-${dependency}`}>
                {premise >= 0 ? `${t("reading.premise")} ${premise + 1}` : `${t("reading.step")} ${prior + 1}`}
              </a>;
            })}
          </div>}
        </div>
      </li>)}
    </ol>
    </div>}
    {teaching && <ReadingDerivationPresentation key={id} document={teaching} ordinal={ordinal}
      onOrdinalChange={ordinal => setCursor({id, ordinal})} />}
  </section>
  </Dialog>;
}

export function ReadingArtifactView({artifact, id, language, title}: {
  artifact: ReadingComponentArtifact; id: string; language?: string; title?: string;
}) {
  switch (artifact.type) {
    case "derivation": return <ReadingDerivationView document={artifact.document} id={id} language={language} />;
    case "plot": return <MathSceneView scene={readingPlotScene(artifact.plot) as Parameters<typeof MathSceneView>[0]["scene"]} />;
    case "svg": case "image": return <ReadingFigure artifact={artifact} title={title} />;
  }
}

function ReadingBlockView({block, documentKey, language, retry, pending}: {
  block: ReadingDocument["blocks"][number]; documentKey: string; language: string;
  retry: (id: string) => void; pending: boolean;
}) {
  const t = useT();
  switch (block.type) {
    case "heading": return <h2>{block.text}</h2>;
    case "paragraph": return <Text>{block.text}</Text>;
    case "callout": return <aside className="reading-callout" data-variant={block.variant}>
        <h3>{block.title}</h3><Text>{block.body}</Text>
      </aside>;
    case "accordion": return <details className="reading-accordion">
      <summary>{block.title}</summary><Text>{block.body}</Text>
    </details>;
    case "steps": return <section className="reading-method">
      <h3>{block.title}</h3><ol>{block.items.map((item, index) => <li key={index}>
        <span className="reading-method-number" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
        <div><h4>{item.title}</h4><Text>{item.body}</Text></div>
      </li>)}</ol>
    </section>;
    case "comparison": return <section className="reading-comparison">
      <h3>{block.title}</h3><div className="reading-comparison-grid">{block.items.map((item, index) => <div key={index}>
        <h4>{item.title}</h4><Text>{item.body}</Text>
      </div>)}</div>
    </section>;
    case "concept_grid": return <section className="reading-concepts">
      <h3>{block.title}</h3><dl>{block.items.map((item, index) => <div key={index}>
        <dt>{item.term}</dt><dd><Text>{item.definition}</Text></dd>
      </div>)}</dl>
    </section>;
    case "summary": return <aside className="reading-summary">
      <h3>{block.title}</h3><ul>{block.items.map((item, index) => <li key={index}>
        <Check className="size-4" aria-hidden /><Text>{item}</Text>
      </li>)}</ul>
    </aside>;
    case "check": return <ReadingCheck block={block} storageKey={`reading-answer:${documentKey}:${block.id}`} />;
    case "component_slot": {
      const component = block.component;
      if (component?.status === "ready" && component.artifact)
        return <ReadingArtifactView artifact={component.artifact} id={`${documentKey}-${block.id}`} language={language} title={block.title} />;
      const loading = !component || busy(component.status);
      return <section className="reading-placeholder" data-reading-placeholder={block.id} aria-busy={loading}>
        <div className="reading-component-heading">
          <h3>{block.title}</h3>
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> :
            <Button size="sm" variant="outline" disabled={pending} onClick={() => retry(block.id)}>
              <RefreshCw className="size-3.5" />{t("reading.retryComponent")}
            </Button>}
        </div>
        <p>{loading ? t("reading.componentPending") : t("reading.componentFailed")}</p>
        <details><summary>{t("reading.componentAbout")}</summary><Text>{block.description}</Text></details>
      </section>;
    }
  }
}

/** Only the chapter body differs; the surrounding journey owns navigation and progress. */
export function ReadingSectionBody({unitId, sectionId, goalId, active = true, onContinue, continueLabel, continuing = false}: {
  unitId: string; sectionId: string; goalId?: string; active?: boolean;
  onContinue?: () => void; continueLabel?: string; continuing?: boolean;
}) {
  const t = useT();
  const client = useQueryClient();
  const [pdfLayout, setPdfLayout] = useState<"mobile" | "desktop">("mobile");
  const queryKey = ["reading-course", unitId];
  const path = `/api/units/${encodeURIComponent(unitId)}/reading`;
  const query = useQuery<ReadingCourse>({
    queryKey, queryFn: () => apiGet(path),
    // SSE paints saved JIT blocks immediately. Poll only as a reconnect fallback.
    refetchInterval: query => hasActiveReading(query.state.data) ? 5000 : false,
  });
  const streaming = hasActiveReading(query.data);
  useEffect(() => {
    if (!streaming) return;
    const events = new EventSource(apiUrl(`${path}/events`));
    events.onmessage = event => {
      try {
        const course = JSON.parse(event.data) as ReadingCourse;
        if (course.unitId === unitId) client.setQueryData(["reading-course", unitId], course);
      } catch { /* The durable GET snapshot remains the reconnect fallback. */ }
    };
    return () => events.close();
  }, [streaming, path, unitId, client]);
  const section = query.data?.sections.find(s => s.id === sectionId);
  const reading = section?.reading;
  const mutate = useMutation({
    mutationFn: async (command: {generate?: boolean; regenerate?: boolean; action?: "retry" | "cancel"; componentId?: string}) => {
      if (!section) throw Error("阅读章节不存在。");
      const endpoint = `${path}/sections/${encodeURIComponent(section.id)}`;
      return command.generate
        ? apiPost<ReadingSnapshot>(`${endpoint}/generate`, {regenerate: Boolean(command.regenerate)})
        : apiPost<ReadingSnapshot>(`${endpoint}/jobs`, {jobId: reading?.jobId, action: command.action, componentId: command.componentId});
    },
    onSuccess: () => client.invalidateQueries({queryKey}),
  });
  const bodyBusy = busy(reading?.status);
  const currentDocument = reading?.document;
  const canContinue = reading?.status === "ready";
  const selection = useReadingFollowUp({unitId, sectionId, goalId,
    documentId: reading?.jobId, enabled: active && Boolean(currentDocument)});
  const pdf = useMutation({
    mutationFn: async () => {
      const bridge = window.xueLearnDesktop?.readingPdf;
      if (!bridge) throw Error(t("reading.exportFailed"));
      const response = await apiFetch(`${path}/sections/${encodeURIComponent(section!.id)}/print?layout=${pdfLayout}`);
      if (!response.ok) throw Error(t("reading.exportFailed"));
      const bytes = await bridge.render({html: await response.text(), layout: pdfLayout});
      const blob = new Blob([new Uint8Array(bytes)], {type: "application/pdf"});
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${currentDocument!.title.replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  });
  if (query.isPending) return <p className="reading-loading"><Loader2 className="size-4 animate-spin" />{t("reading.loading")}</p>;
  if (query.error && !query.data) return <div role="alert"><p>{query.error.message}</p><Button onClick={() => void query.refetch()}>{t("reading.retry")}</Button></div>;
  return <div className="reading-workspace" data-reading-workspace data-reading-section={sectionId}>
    <div className="reading-content">
    <div className="reading-toolbar reading-no-print">
      <span className="reading-status" role="status">
        {bodyBusy ? t("reading.generating") : reading?.status === "ready"
          ? reading.pendingComponents ? t("reading.bodyReady") : t("reading.ready") : t("reading.description")}
      </span>
      <div className="reading-actions">
        {bodyBusy ? <Button size="sm" variant="outline" disabled={mutate.isPending} onClick={() => mutate.mutate({action: "cancel"})}>
          <Square className="size-3.5" />{t("reading.stop")}
        </Button> : <Button size="sm" disabled={mutate.isPending || !section} onClick={() => mutate.mutate({
          generate: !reading || reading.status === "ready", regenerate: reading?.status === "ready",
          action: "retry",
        })}>
          {mutate.isPending ? <Loader2 className="size-4 animate-spin" /> : <BookOpenText className="size-4" />}
          {reading?.status === "ready" ? t("reading.regenerate") : reading ? t("reading.continue") : t("reading.generate")}
        </Button>}
        {currentDocument && <>
          <select className="reading-pdf-layout" aria-label={t("reading.pdfLayout")} value={pdfLayout}
            onChange={event => setPdfLayout(event.target.value as "mobile" | "desktop")}>
            <option value="mobile">{t("reading.pdfMobile")}</option><option value="desktop">{t("reading.pdfDesktop")}</option>
          </select>
          <Button size="sm" variant="outline" disabled={pdf.isPending} onClick={() => pdf.mutate()}>
            {pdf.isPending ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}{t("reading.print")}
          </Button>
        </>}
      </div>
    </div>
    {(mutate.error || reading?.status === "failed") && <p className="reading-error" role="alert">
      {mutate.error?.message ?? reading?.error}
    </p>}
    {pdf.error && <p className="reading-error" role="alert">{pdf.error.message}</p>}
    <article ref={selection.containerRef} className="reading-paper" key={`${unitId}:${section?.id}`} data-reading-document>
      <h1>{currentDocument?.title ?? section?.title}</h1>
      {currentDocument ? currentDocument.blocks.map(block => <div key={`${reading!.jobId}:${block.id}`} className="reading-block" data-reading-block={block.id} data-reading-block-type={block.type}>
        <ReadingBlockView block={block} documentKey={reading!.jobId} language={query.data!.language}
          pending={mutate.isPending} retry={componentId => mutate.mutate({action: "retry", componentId})} />
      </div>) : bodyBusy ? <p className="reading-loading"><Loader2 className="size-4 animate-spin" />{t("reading.generating")}</p> :
        <div className="reading-empty"><Text>{section?.scope || t("reading.description")}</Text><p>{t("reading.empty")}</p></div>}
      {currentDocument && bodyBusy && <p className="reading-loading" role="status">
        <Loader2 className="size-4 animate-spin" />{t("reading.generating")}
      </p>}
    </article>
    {selection.anchor && <SelectionFollowUpToolbar getAnchorRect={selection.getAnchorRect}
      onAsk={selection.ask} onDismiss={selection.clear} />}
    {onContinue && <div className="reading-continue reading-no-print">
      <Button disabled={!canContinue || continuing} onClick={onContinue}>
        {continuing && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {continueLabel ?? t("wizard.section.continue")}<ChevronRight aria-hidden />
      </Button>
    </div>}
    </div>
  </div>;
}
