"use client";

export function AssistantWaitingPlaceholder({
  label,
  avatarSrc,
  avatarAlt = "",
}: {
  label: string;
  avatarSrc?: string;
  avatarAlt?: string;
}) {
  return (
    <div
      className="flex w-full min-w-0 items-start gap-2.5"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt={avatarAlt}
          className="size-9 shrink-0 rounded-xl object-cover shadow-sm"
        />
      ) : null}
      <div className="inline-flex max-w-[min(88%,40rem)] items-center gap-2 rounded-[18px] bg-[var(--bg-100)] px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
        <span className="inline-flex gap-1" aria-hidden="true">
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current" />
        </span>
        <span>{label}</span>
      </div>
    </div>
  );
}
