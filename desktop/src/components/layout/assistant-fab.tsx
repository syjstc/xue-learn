import { useLocation } from "react-router-dom";
import { useAssistant } from "@/components/agent/assistant-provider";
import { Button } from "@xue-learn/core/ui/button";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import { useGlobalBriefing } from "@/hooks/use-agent-thread";
import { getGoalIdFromPath } from "@/shared/routing/routes";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

export function AssistantFab() {
  const t = useT();
  const { companionOpen, responseReady, openAssistant } = useAssistant();
  const { pathname } = useLocation();
  const goalId = getGoalIdFromPath(pathname);
  const personas = useTeachingPersonas({ goalId: goalId ?? undefined });
  const persona = personas.data?.current;
  const personaName = localizeTeachingPersonaName(persona, t);
  const avatarSrc = teachingPersonaAvatarSrc(
    persona?.avatarCode ?? "xiaohui_female",
  );
  const briefing = useGlobalBriefing();
  const dueCount = briefing.data?.dueCount ?? 0;
  const flashcardDueCount = briefing.data?.flashcardDueCount ?? 0;
  const pendingCount = dueCount + flashcardDueCount;

  return (
    <Button
      id="assistant-companion-launcher"
      type="button"
      variant="ghost"
      size="icon-lg"
      onClick={() => openAssistant()}
      className={cn(
        "group relative size-14 overflow-visible rounded-full border-2 border-background bg-background p-0 shadow-[0_10px_28px_color-mix(in_srgb,var(--text-900)_20%,transparent)] ring-1 ring-border transition-[opacity,transform,box-shadow] hover:-translate-y-0.5 hover:bg-background hover:shadow-[0_14px_34px_color-mix(in_srgb,var(--text-900)_24%,transparent)]",
        companionOpen && "pointer-events-none scale-90 opacity-0",
      )}
      aria-label={
        responseReady
          ? t("uiChrome.assistant.openWithReply", { name: personaName })
          : t("uiChrome.assistant.open", { name: personaName })
      }
      aria-expanded={companionOpen}
      aria-controls="assistant-companion-surface"
      title={t("uiChrome.assistant.title", { name: personaName })}
    >
      <span
        className="pointer-events-none absolute right-full mr-3 hidden whitespace-nowrap rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground opacity-0 shadow-md backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block"
        aria-hidden="true"
      >
        {t("uiChrome.assistant.ask", { name: personaName })}
      </span>
      <span className="size-full overflow-hidden rounded-full">
        <img
          src={avatarSrc}
          alt=""
          className="size-full rounded-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
        />
      </span>
      {responseReady ? (
        <span
          className="absolute -top-0.5 -left-0.5 size-3 rounded-full border-2 border-background bg-[var(--success-500)]"
          aria-hidden="true"
        />
      ) : null}
      {pendingCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
          {pendingCount > 99 ? "99+" : pendingCount}
        </span>
      ) : null}
    </Button>
  );
}
