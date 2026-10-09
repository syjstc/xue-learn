"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsDownUp, ChevronsUpDown, Copy } from "lucide-react";
import {
  expandCompactLogPayload,
  formatLogJson,
} from "@/components/dev/llm-log-display";
import { Button } from "@xue-learn/core/ui/button";
import { cn } from "@xue-learn/core/utils";
import { copyTextToClipboard } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

const LONG_STRING_CHARS = 240;
const DEFAULT_EXPAND_DEPTH = 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entryCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isPlainObject(value)) return Object.keys(value).length;
  return 0;
}

function previewLabel(value: unknown): string {
  if (Array.isArray(value)) {
    const n = value.length;
    return n === 0 ? "[]" : `[${n}]`;
  }
  if (isPlainObject(value)) {
    const n = Object.keys(value).length;
    return n === 0 ? "{}" : `{${n}}`;
  }
  return "";
}

function JsonPrimitiveValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-sky-300">null</span>;
  }
  if (value === undefined) {
    return <span className="text-sky-300">undefined</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-sky-300">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-emerald-300">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return <JsonStringValue value={value} />;
  }
  return <span className="text-slate-300">{String(value)}</span>;
}

function JsonStringValue({ value }: { value: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const needsToggle = value.length > LONG_STRING_CHARS;
  const shown =
    needsToggle && !expanded
      ? `${value.slice(0, LONG_STRING_CHARS)}…`
      : value;

  return (
    <span className="text-amber-200">
      <span className="whitespace-pre-wrap wrap-break-word">
        &quot;{shown}&quot;
      </span>
      {needsToggle ? (
        <button
          type="button"
          className="ml-2 text-[10px] font-medium text-slate-400 hover:text-slate-200"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("devLogs.json.collapse") : t("devLogs.json.expand")}
        </button>
      ) : null}
    </span>
  );
}

function JsonNode({
  name,
  value,
  path,
  depth,
  expandDepth,
  overrides,
  onToggle,
}: {
  name?: string;
  value: unknown;
  path: string;
  depth: number;
  expandDepth: number;
  overrides: Record<string, boolean>;
  onToggle: (path: string) => void;
}) {
  const t = useT();
  const isContainer = Array.isArray(value) || isPlainObject(value);
  const count = entryCount(value);
  const defaultExpanded = depth < expandDepth;
  const expanded = overrides[path] ?? defaultExpanded;
  const canExpand = isContainer && count > 0;

  if (!isContainer) {
    return (
      <div className="flex gap-1.5 font-mono text-xs leading-relaxed">
        {name !== undefined ? (
          <>
            <span className="shrink-0 text-violet-300">{name}</span>
            <span className="text-slate-500">:</span>
          </>
        ) : null}
        <JsonPrimitiveValue value={value} />
      </div>
    );
  }

  const openBracket = Array.isArray(value) ? "[" : "{";
  const closeBracket = Array.isArray(value) ? "]" : "}";
  const emptyLiteral = Array.isArray(value) ? "[]" : "{}";
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);

  if (!canExpand) {
    return (
      <div className="flex gap-1.5 font-mono text-xs leading-relaxed">
        <span className="inline-block size-4 shrink-0" />
        {name !== undefined ? (
          <>
            <span className="text-violet-300">{name}</span>
            <span className="text-slate-500">:</span>
          </>
        ) : null}
        <span className="text-slate-400">{emptyLiteral}</span>
      </div>
    );
  }

  return (
    <div className="font-mono text-xs leading-relaxed">
      <div className="flex items-start gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? t("devLogs.json.collapse") : t("devLogs.json.expand")}
          className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={() => onToggle(path)}
        >
          <span
            className={cn(
              "inline-block text-[10px] transition-transform",
              expanded ? "rotate-90" : "",
            )}
          >
            ▶
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="flex min-w-0 flex-wrap items-baseline gap-1 text-left cursor-pointer"
            onClick={() => onToggle(path)}
          >
            {name !== undefined ? (
              <>
                <span className="text-violet-300">{name}</span>
                <span className="text-slate-500">:</span>
              </>
            ) : null}
            {expanded ? (
              <span className="text-slate-400">{openBracket}</span>
            ) : (
              <span className="text-slate-400">{previewLabel(value)}</span>
            )}
          </button>
          {expanded ? (
            <div className="mt-0.5 space-y-0.5 border-l border-slate-700/80 pl-3">
              {entries.map(([key, child]) => (
                <JsonNode
                  key={`${path}.${key}`}
                  name={key}
                  value={child}
                  path={`${path}.${key}`}
                  depth={depth + 1}
                  expandDepth={expandDepth}
                  overrides={overrides}
                  onToggle={onToggle}
                />
              ))}
              <div className="text-slate-400">{closeBracket}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CollapsibleJsonView({
  value,
  className,
  defaultExpandDepth = DEFAULT_EXPAND_DEPTH,
}: {
  value: unknown;
  className?: string;
  /** Nodes with depth &lt; this are expanded by default (0 = all collapsed). */
  defaultExpandDepth?: number;
}) {
  const t = useT();
  const expanded = useMemo(() => expandCompactLogPayload(value), [value]);
  const truncatedChars =
    isPlainObject(expanded) &&
    typeof expanded._previewTruncatedChars === "number"
      ? expanded._previewTruncatedChars
      : undefined;
  const normalized = useMemo(() => {
    if (!isPlainObject(expanded)) return expanded;
    const {
      _previewTruncatedChars: _truncated,
      _payloadHash: _hash,
      ...rest
    } = expanded;
    return rest;
  }, [expanded]);
  const [expandDepth, setExpandDepth] = useState(defaultExpandDepth);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  // The keyed log detail remounts for a new selection. Keep expansion state
  // while this view receives updated or re-parsed JSON for the same log.
  const isContainer =
    Array.isArray(normalized) || isPlainObject(normalized);

  function togglePath(path: string) {
    setOverrides((prev) => {
      const current = prev[path] ?? path.split(".").length - 1 < expandDepth;
      return { ...prev, [path]: !current };
    });
  }

  function expandAll() {
    setExpandDepth(Number.POSITIVE_INFINITY);
    setOverrides({});
  }

  function collapseAll() {
    setExpandDepth(0);
    setOverrides({});
  }

  async function copyJson() {
    const text = formatLogJson(normalized);
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg bg-slate-950 text-slate-100",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-2 py-1.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="text-slate-300 hover:bg-slate-800 hover:text-white"
          onClick={expandAll}
          disabled={!isContainer}
        >
          <ChevronsUpDown className="size-3" />
          {t("devLogs.json.expandAll")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="text-slate-300 hover:bg-slate-800 hover:text-white"
          onClick={collapseAll}
          disabled={!isContainer}
        >
          <ChevronsDownUp className="size-3" />
          {t("devLogs.json.collapseAll")}
        </Button>
        {truncatedChars !== undefined ? (
          <span className="px-1 text-[10px] font-medium text-amber-300/90">
            {t("devLogs.json.truncated", { count: truncatedChars.toLocaleString() })}
          </span>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="ml-auto text-slate-300 hover:bg-slate-800 hover:text-white"
          onClick={() => void copyJson()}
        >
          {copied ? (
            <Check className="size-3 text-emerald-400" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? t("devLogs.common.copied") : t("devLogs.common.copy")}
        </Button>
      </div>
      <div className="max-h-[28rem] overflow-auto p-3">
        {!isContainer ? (
          typeof normalized === "string" ? (
            <pre className="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-amber-200">
              {normalized}
            </pre>
          ) : (
            <JsonPrimitiveValue value={normalized} />
          )
        ) : (
          <JsonNode
            value={normalized}
            path="root"
            depth={0}
            expandDepth={expandDepth}
            overrides={overrides}
            onToggle={togglePath}
          />
        )}
      </div>
    </div>
  );
}
