"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  List,
  MessageCircle,
} from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/ui/sheet";
import {
  socraticThreadPreview,
  type SocraticThread,
} from "@/shared/graph/socratic-threads";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

const MOBILE_MAX_WIDTH = 1023;

function useIsMobile(breakpoint = MOBILE_MAX_WIDTH) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return mobile;
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function ThreadStatusBadge({ thread }: { thread: SocraticThread }) {
  if (thread.done) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--brand-600)]">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        已完成
      </span>
    );
  }
  const turns = thread.messages.filter((m) => m.role === "user").length;
  if (turns > 0) {
    return (
      <span className="text-[10px] text-[var(--text-400)]">{turns} 轮回答</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--text-400)]">
      <Circle className="h-2.5 w-2.5" aria-hidden />
      待开始
    </span>
  );
}

function SocraticThreadList({
  threads,
  activeThreadId,
  onSelect,
}: {
  threads: SocraticThread[];
  activeThreadId?: string | null;
  onSelect: (thread: SocraticThread) => void;
}) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <MessageCircle
          className="h-8 w-8 text-[var(--text-400)]/50"
          aria-hidden
        />
        <p className="text-sm text-[var(--text-400)]">还没有错题可修正</p>
        <p className="max-w-[14rem] text-xs text-[var(--text-400)]/80">
          完成测验后，每道错题会出现在这里
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-1" aria-label="错题列表">
      {threads.map((thread) => {
        const active = thread.id === activeThreadId;
        return (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => onSelect(thread)}
              className={cn(
                "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-[var(--brand-300)] bg-[var(--brand-50)]"
                  : "border-transparent hover:border-[var(--border-200)] hover:bg-[var(--bg-300)]",
              )}
              aria-current={active ? "true" : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-medium leading-snug text-[var(--brand-700)]">
                  {thread.label}
                </p>
                <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-400)]">
                  {formatUpdatedAt(thread.updatedAt)}
                </span>
              </div>
              {thread.mistakeHint && (
                <p className="mt-0.5 line-clamp-1 text-[10px] text-[var(--text-400)]">
                  {thread.mistakeHint}
                </p>
              )}
              {thread.messages.length > 0 && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-800)]/80">
                  {socraticThreadPreview(thread)}
                </p>
              )}
              <div className="mt-1">
                <ThreadStatusBadge thread={thread} />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function activeThreadLabel(
  threads: SocraticThread[],
  activeThreadId?: string | null,
): string {
  if (!activeThreadId || threads.length === 0) {
    return threads.length > 0 ? `错题列表 (${threads.length})` : "错题列表";
  }
  const thread = threads.find((t) => t.id === activeThreadId);
  return thread?.label ?? "错题列表";
}

function SocraticThreadTrigger({
  label,
  doneCount,
  totalCount,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
  doneCount?: number;
  totalCount?: number;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("min-w-0 max-w-full gap-1.5", className)}
      {...props}
    >
      <List className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {totalCount != null && totalCount > 0 && (
        <span className="hidden truncate text-muted-foreground sm:inline">
          · {doneCount ?? 0}/{totalCount} 已完成
        </span>
      )}
      <ChevronDown
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Button>
  );
}

export function SocraticThreadDrawer({
  threads,
  activeThreadId,
  initializing,
  onSelect,
  className,
}: {
  threads: SocraticThread[];
  activeThreadId?: string | null;
  initializing?: boolean;
  onSelect: (threadId: string) => void;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const label = activeThreadLabel(threads, activeThreadId);
  const doneCount = threads.filter((t) => t.done).length;

  const handleSelect = (thread: SocraticThread) => {
    onSelect(thread.id);
    setOpen(false);
  };

  const list = initializing ? (
    <p className="px-2 py-4 text-xs text-[var(--text-400)]">
      {t("generation.socratic.reviewing")}
    </p>
  ) : (
    <SocraticThreadList
      threads={threads}
      activeThreadId={activeThreadId}
      onSelect={handleSelect}
    />
  );

  if (isMobile) {
    return (
      <>
        <SocraticThreadTrigger
          label={label}
          doneCount={doneCount}
          totalCount={threads.length}
          className={className}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="h-[100dvh] max-h-[100dvh] w-full max-w-none gap-0 rounded-none border-0 p-0"
          >
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle>错题列表</SheetTitle>
              <SheetDescription className="sr-only">
                选择要修正的错题对话
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">{list}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={className}
        render={
          <SocraticThreadTrigger
            label={label}
            doneCount={doneCount}
            totalCount={threads.length}
            aria-haspopup="listbox"
            aria-expanded={open}
          />
        }
      />
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 max-h-[min(24rem,var(--available-height))] overflow-y-auto p-2"
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}
