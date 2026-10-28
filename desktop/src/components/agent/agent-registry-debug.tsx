"use client";

import { useState } from "react";

type LiveAgentCard = {
  agentId: string;
  displayName: string;
  status: string;
  subagent?: string;
  phase?: string;
  latestMessage?: string;
  summary?: string;
};

type AgentRegistry = {
  activeAgentId?: string;
  agents?: Record<string, LiveAgentCard>;
  lastHandoff?: {
    from: string;
    to: string;
    question: string;
    reason: string;
  };
  handoffHistory?: Array<{
    from: string;
    to: string;
    question: string;
    reason: string;
  }>;
};

export function AgentRegistryDebug({
  registry,
}: {
  registry: Record<string, unknown> | null;
}) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (!import.meta.env.DEV) return null;
  if (!registry) return null;

  const typed = registry as AgentRegistry;
  const cards = Object.values(typed.agents ?? {});

  return (
    <div className="mb-2 rounded border border-dashed border-amber-400/60 bg-amber-50/80 text-xs dark:bg-amber-950/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left font-mono text-amber-900 dark:text-amber-200"
      >
        <span>Agent Registry (dev)</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-amber-400/40 px-2 py-2 font-mono text-amber-950 dark:text-amber-100">
          <div>
            active: <strong>{typed.activeAgentId ?? "—"}</strong>
          </div>
          {typed.handoffHistory?.length ? (
            <div className="space-y-1 rounded bg-amber-100/60 p-1.5 dark:bg-amber-900/40">
              <div>handoff history ({typed.handoffHistory.length}):</div>
              {typed.handoffHistory.map((handoff, index) => (
                <div key={`${handoff.from}-${handoff.to}-${index}`}>
                  {index + 1}. {handoff.from} → {handoff.to} ({handoff.reason})
                  {handoff.question ? ` "${handoff.question}"` : ""}
                </div>
              ))}
            </div>
          ) : typed.lastHandoff ? (
            <div className="rounded bg-amber-100/60 p-1.5 dark:bg-amber-900/40">
              handoff: {typed.lastHandoff.from} → {typed.lastHandoff.to} (
              {typed.lastHandoff.reason}) &quot;{typed.lastHandoff.question}
              &quot;
            </div>
          ) : null}
          {cards.map((card) => (
            <div
              key={card.agentId}
              className="rounded border border-amber-300/50 bg-white/60 p-1.5 dark:bg-black/20"
            >
              <div>
                <strong>{card.displayName}</strong> ({card.status}
                {card.subagent ? ` · ${card.subagent}` : ""})
              </div>
              {card.summary ? (
                <div className="mt-0.5 whitespace-pre-wrap opacity-80">
                  {card.summary}
                </div>
              ) : null}
              {card.latestMessage ? (
                <div className="mt-0.5 truncate opacity-70">
                  latest: {card.latestMessage}
                </div>
              ) : null}
            </div>
          ))}
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
            />
            raw JSON
          </label>
          {showRaw ? (
            <pre className="max-h-40 overflow-auto rounded bg-black/5 p-1.5 text-[10px] dark:bg-black/40">
              {JSON.stringify(typed, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
