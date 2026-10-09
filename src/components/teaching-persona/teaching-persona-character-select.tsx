import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import type { TeachingPersona } from "@/hooks/api/use-teaching-personas";
import {
  groupTeachingPersonas,
  preferredPersonaForGroup,
} from "@/shared/domain/teaching-persona-selection";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import {
  teachingPersonaAvatarSrc,
  teachingPersonaStandingSrc,
} from "@/shared/teaching-persona-avatar";
import {
  localizeTeachingPersonaContent,
  localizeTeachingPersonaName,
} from "@/shared/teaching-persona-i18n";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

type Props = {
  personas: TeachingPersona[];
  activeRef?: string | null;
  onConfirm: (persona: TeachingPersona) => Promise<void>;
  onCustomize?: (persona: TeachingPersona) => void;
  onDelete?: (persona: TeachingPersona) => void;
  compact?: boolean;
  className?: string;
};

export function TeachingPersonaCharacterSelect({
  personas,
  activeRef,
  onConfirm,
  onCustomize,
  onDelete,
  compact = false,
  className,
}: Props) {
  const t = useT();
  const groups = useMemo(() => groupTeachingPersonas(personas), [personas]);
  const initial = useMemo(
    () => personas.find((persona) => persona.ref === activeRef) ?? personas[0],
    [activeRef, personas],
  );
  const [focusedRef, setFocusedRef] = useState(initial?.ref ?? "");
  const [preferredVariants, setPreferredVariants] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [railEdges, setRailEdges] = useState({ left: true, right: false });
  const railRef = useRef<HTMLDivElement>(null);

  const updateRailEdges = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const maxScrollLeft = rail.scrollWidth - rail.clientWidth;
    setRailEdges({
      left: rail.scrollLeft <= 2,
      right: maxScrollLeft <= 2 || rail.scrollLeft >= maxScrollLeft - 2,
    });
  }, []);

  useEffect(() => {
    if (!personas.some((persona) => persona.ref === focusedRef)) {
      setFocusedRef(initial?.ref ?? "");
    }
  }, [focusedRef, initial?.ref, personas]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    updateRailEdges();
    const observer = new ResizeObserver(updateRailEdges);
    observer.observe(rail);
    rail.addEventListener("scroll", updateRailEdges, { passive: true });
    return () => {
      observer.disconnect();
      rail.removeEventListener("scroll", updateRailEdges);
    };
  }, [groups.length, updateRailEdges]);

  const focused =
    personas.find((persona) => persona.ref === focusedRef) ?? initial;
  if (!focused) return null;
  const focusedGroup = groups.find((group) =>
    group.personas.some((persona) => persona.ref === focused.ref),
  );
  const localized = localizeTeachingPersonaContent(focused, t);
  const isCurrent = focused.ref === activeRef;

  function focusGroup(index: number) {
    const group = groups[index];
    if (!group) return;
    const persona = preferredPersonaForGroup(
      group,
      preferredVariants[group.key],
      activeRef,
    );
    setFocusedRef(persona.ref);
    setError("");
    requestAnimationFrame(() => {
      const option = railRef.current?.querySelector<HTMLButtonElement>(
        `[data-persona-group="${index}"]`,
      );
      option?.focus();
      option?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });
  }

  function scrollRail(direction: -1 | 1) {
    railRef.current?.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(240, railRef.current.clientWidth * 0.72),
    });
  }

  async function confirm() {
    if (isCurrent || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(focused);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("onboarding.ai.teacherPickerError"),
      );
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-row gap-2">
        <Button
          className="min-h-10 min-w-0 flex-1 sm:min-h-11"
          disabled={isCurrent || busy}
          onClick={() => void confirm()}
        >
          {busy ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : isCurrent ? (
            <Check className="mr-2 h-4 w-4" />
          ) : null}
          {isCurrent
            ? t("settings.persona.current")
            : t("settings.persona.chooseThis", {
                name: localized.name,
              })}
        </Button>
        {onCustomize ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-10 shrink-0 px-3 sm:min-h-11 sm:px-4"
            disabled={busy}
            onClick={() => onCustomize(focused)}
          >
            {focused.kind === "builtin" ? (
              <SlidersHorizontal className="mr-2 h-4 w-4" />
            ) : (
              <Pencil className="mr-2 h-4 w-4" />
            )}
            {focused.kind === "builtin"
              ? t("settings.persona.customize")
              : t("settings.persona.edit")}
          </Button>
        ) : null}
        {onDelete && focused.kind === "custom" ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="min-h-10 min-w-10 text-destructive sm:min-h-11 sm:min-w-11"
            disabled={busy}
            aria-label={t("common.delete")}
            onClick={() => onDelete(focused)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </>
  );

  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-border bg-card sm:rounded-[2rem]",
        className,
      )}
    >
      <div
        className={cn(
          "grid lg:grid-cols-[minmax(0,1.12fr)_minmax(19rem,0.88fr)]",
          compact ? "lg:min-h-[30rem]" : "lg:min-h-[34rem]",
        )}
      >
        <div className="relative flex min-h-[13.5rem] items-end justify-center overflow-hidden bg-primary/[0.055] px-3 pt-3 sm:min-h-[24rem] sm:px-4 sm:pt-6 lg:min-h-0">
          <div className="absolute left-3 top-3 rounded-full border border-primary/15 bg-background/90 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-primary sm:left-4 sm:top-4 sm:px-3 sm:text-[11px] sm:tracking-[0.18em]">
            {t("settings.persona.characterSelect")}
          </div>
          <img
            key={focused.avatarCode}
            src={teachingPersonaStandingSrc(focused.avatarCode)}
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = teachingPersonaAvatarSrc(
                focused.avatarCode,
              );
              event.currentTarget.classList.add("object-contain", "p-12");
            }}
            alt={t("settings.persona.standingAlt", {
              name: localizeTeachingPersonaName(focused, t),
            })}
            className={cn(
              "onboarding-avatar-enter absolute inset-x-0 -bottom-[18.5rem] mx-auto h-[32rem] w-full max-w-[30rem] object-contain object-bottom sm:-bottom-[13rem] sm:h-[37rem] lg:bottom-0 lg:h-[92%] lg:max-w-[26rem]",
              compact && "lg:h-[88%]",
            )}
          />
          {focusedGroup && focusedGroup.personas.length > 1 ? (
            <div className="absolute right-3 top-3 z-10 flex gap-0.5 rounded-full border border-border/80 bg-background/90 p-0.5 shadow-sm backdrop-blur-sm sm:right-5 sm:top-5 sm:gap-1 sm:p-1">
              {focusedGroup.personas.map((variant) => {
                const selected = variant.ref === focused.ref;
                const gender =
                  variant.gender === "female"
                    ? t("settings.persona.female")
                    : t("settings.persona.male");
                return (
                  <button
                    key={variant.ref}
                    type="button"
                    aria-pressed={selected}
                    aria-label={t("settings.persona.avatarVariantAria", {
                      name: localizeTeachingPersonaName(variant, t),
                      gender,
                    })}
                    title={gender}
                    onClick={() => {
                      setPreferredVariants((current) => ({
                        ...current,
                        [focusedGroup.key]: variant.ref,
                      }));
                      setFocusedRef(variant.ref);
                      setError("");
                    }}
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-primary sm:h-10 sm:w-10",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-transparent text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <img
                      src={teachingPersonaAvatarSrc(variant.avatarCode)}
                      alt=""
                      className="h-7 w-7 rounded-full object-cover sm:h-8 sm:w-8"
                    />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col p-4 sm:p-7 lg:p-8">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="hidden text-xs font-semibold text-primary sm:block">
                {focused.kind === "builtin"
                  ? focused.archetypeCode === "ruiyan_shadow"
                    ? t("settings.persona.desktopHidden")
                    : t("settings.persona.official")
                  : t("settings.persona.mine")}
              </p>
              <div className="flex min-w-0 items-baseline gap-2 sm:block">
                <h3 className="shrink-0 text-xl font-bold tracking-tight sm:mt-1 sm:text-3xl">
                  {localized.name}
                </h3>
                <p className="min-w-0 truncate text-sm font-medium text-primary sm:mt-1 sm:text-base">
                  {localized.tagline}
                </p>
              </div>
            </div>
            {activeRef === focused.ref ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary sm:px-2.5 sm:text-xs">
                <Check className="h-3.5 w-3.5" />
                {t("settings.persona.current")}
              </span>
            ) : null}
          </div>

          <p className="mt-3 line-clamp-2 text-sm leading-5 text-muted-foreground sm:mt-5 sm:text-base sm:leading-6">
            {localized.introduction}
          </p>
          <div className="mt-4 hidden flex-wrap gap-2 sm:flex">
            {localized.traits.slice(0, 3).map((trait) => (
              <span
                key={trait}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:px-3 sm:py-1.5 sm:text-xs"
              >
                {trait}
              </span>
            ))}
          </div>

          <div className="mt-auto hidden pt-6 lg:block">{actions}</div>
        </div>
      </div>

      <div className="relative border-t border-border bg-background/70 p-2 sm:p-4">
        <button
          type="button"
          aria-label={t("settings.persona.previousStyle")}
          disabled={railEdges.left}
          onClick={() => scrollRail(-1)}
          className="absolute left-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/95 text-foreground shadow-md transition hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-0 sm:left-2 sm:h-10 sm:w-10"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div
          ref={railRef}
          role="listbox"
          aria-label={t("settings.persona.chooseAvatar")}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const currentIndex = groups.findIndex((group) =>
              group.personas.some((persona) => persona.ref === focused.ref),
            );
            const delta = event.key === "ArrowRight" ? 1 : -1;
            focusGroup((currentIndex + delta + groups.length) % groups.length);
          }}
          className="flex snap-x gap-1.5 overflow-x-auto px-8 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-primary sm:gap-2 sm:px-9"
        >
          {groups.map((group, index) => {
            const persona = preferredPersonaForGroup(
              group,
              preferredVariants[group.key],
              activeRef,
            );
            const selected = group.personas.some(
              (item) => item.ref === focused.ref,
            );
            const active = group.personas.some(
              (item) => item.ref === activeRef,
            );
            return (
              <button
                key={group.key}
                data-persona-group={index}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => focusGroup(index)}
                className={cn(
                  "relative flex min-w-[4.5rem] snap-start flex-col items-center gap-0.5 rounded-xl border px-1 py-1 text-center outline-none transition sm:min-w-[6rem] sm:gap-1 sm:rounded-2xl sm:px-2 sm:py-2",
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50",
                )}
              >
                <img
                  src={teachingPersonaAvatarSrc(persona.avatarCode)}
                  alt=""
                  className="h-9 w-9 rounded-lg object-cover sm:h-14 sm:w-14 sm:rounded-xl"
                />
                <span className="max-w-full truncate text-[10px] font-semibold sm:text-xs">
                  {localizeTeachingPersonaName(persona, t)}
                </span>
                {active ? (
                  <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-primary text-primary-foreground sm:right-1 sm:top-1 sm:h-4 sm:w-4">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-label={t("settings.persona.nextStyle")}
          disabled={railEdges.right}
          onClick={() => scrollRail(1)}
          className="absolute right-1 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/95 text-foreground shadow-md transition hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-0 sm:right-2 sm:h-10 sm:w-10"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="sticky bottom-0 z-20 border-t border-border bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))] lg:hidden">
        {actions}
      </div>
    </section>
  );
}
