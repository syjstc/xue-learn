import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAssistant } from "@/components/agent/assistant-provider";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useGoals } from "@/hooks/api";
import {
  useLearnerProfile,
  useSaveLearnerProfile,
} from "@/hooks/api/use-learner-profile";
import {
  useTeachingPersonas,
  type TeachingPersona,
} from "@/hooks/api/use-teaching-personas";
import { getAuthUser } from "@/shared/auth";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

type GuideStep = "profile" | "topic" | "preferences";
type GoalLevel = "zero" | "basic" | "advanced";
type OnboardingPersona = Pick<
  TeachingPersona,
  "ref" | "kind" | "name" | "avatarCode" | "tagline"
>;

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/goals";
}

function teachingPersonaStandingSrc(avatarCode: string) {
  return `/scenario-theater/coaches/${avatarCode}-standing.png`;
}

export function OnboardingPage({
  onProfileSaved,
}: {
  onProfileSaved?: () => void | Promise<void>;
} = {}) {
  const t = useT();
  const fallbackPersona: OnboardingPersona = {
    ref: "builtin:xiaohui_female",
    kind: "builtin",
    name: t("onboarding.fallbackPersonaName"),
    avatarCode: "xiaohui_female",
    tagline: t("onboarding.fallbackPersonaTagline"),
  };
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = safeNext(searchParams.get("next"));
  const goals = useGoals();
  const learnerProfile = useLearnerProfile();
  const saveProfile = useSaveLearnerProfile();
  // The local sidecar serves the same hosted-shaped catalog from SQLite, so
  // onboarding can use the shared persona identity instead of a stale local
  // fallback. Query errors still fall back to the built-in copy below.
  const personas = useTeachingPersonas();
  const { openGoalCreation } = useAssistant();
  const user = getAuthUser();
  const heroTopic = searchParams.get("topic")?.trim() ?? "";
  const [step, setStep] = useState<GuideStep>("profile");
  const [topic, setTopic] = useState(heroTopic);
  const [nickname, setNickname] = useState(
    user?.name?.trim() || user?.email?.split("@")[0]?.trim() || "",
  );
  const [majorOrField, setMajorOrField] = useState("");
  const [generalSkills, setGeneralSkills] = useState("");
  const [customInfo, setCustomInfo] = useState("");
  const [backgroundExpanded, setBackgroundExpanded] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [level, setLevel] = useState<GoalLevel>("zero");
  const [skipError, setSkipError] = useState("");
  const currentPersona = personas.data?.current ?? fallbackPersona;
  const currentPersonaName = localizeTeachingPersonaName(currentPersona, t);
  const assistantAvatarSrc = teachingPersonaAvatarSrc(
    currentPersona.avatarCode,
  );

  const checkingEligibility = goals.isPending || learnerProfile.isPending;
  const shouldBypass =
    !checkingEligibility &&
    (Boolean(learnerProfile.data?.profile.onboardingCompleted) ||
      (goals.data?.length ?? 0) > 0);

  useEffect(() => {
    if (shouldBypass) navigate(nextPath, { replace: true });
  }, [navigate, nextPath, shouldBypass]);

  useEffect(() => {
    const profile = learnerProfile.data?.profile;
    if (!profile) return;
    setNickname(
      (current) =>
        current ||
        profile.nickname ||
        user?.name?.trim() ||
        user?.email?.split("@")[0]?.trim() ||
        "",
    );
    setMajorOrField((current) => current || profile.majorOrField || "");
    setGeneralSkills((current) =>
      current
        ? current
        : profile.generalSkills.length > 0
          ? profile.generalSkills.join("，")
          : "",
    );
    setCustomInfo((current) => current || profile.customInfo || "");
  }, [learnerProfile.data?.profile, user?.email, user?.name]);

  async function exploreFirst() {
    setSkipError("");
    try {
      await saveProfile.mutateAsync({
        onboardingCompleted: true,
        ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
      });
      await onProfileSaved?.();
      navigate(nextPath, { replace: true });
    } catch (error) {
      setSkipError(
        error instanceof Error ? error.message : t("onboarding.ai.skipError"),
      );
    }
  }

  async function saveSimpleProfile() {
    const cleanNickname = nickname.trim();
    if (!cleanNickname) {
      setProfileError(t("onboarding.profile.nicknameRequired"));
      return;
    }
    setProfileError("");
    try {
      await saveProfile.mutateAsync({
        nickname: cleanNickname,
        majorOrField: majorOrField.trim(),
        generalSkills: generalSkills
          .split(/[，,\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
        customInfo: customInfo.trim(),
      });
      await onProfileSaved?.();
      setStep("topic");
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : t("onboarding.profile.saveFailed"),
      );
    }
  }

  async function startLiveGoalCreation() {
    const cleanTopic = topic.trim();
    if (!cleanTopic) return;
    setSkipError("");
    try {
      await saveProfile.mutateAsync({ onboardingCompleted: true });
      await onProfileSaved?.();
      openGoalCreation({
        topic: cleanTopic,
        files: [],
        urls: [],
        goalDraft: { topic: cleanTopic, level },
      });
      navigate("/goals", { replace: true });
    } catch (error) {
      setSkipError(
        error instanceof Error ? error.message : t("onboarding.ai.skipError"),
      );
    }
  }

  if (checkingEligibility || shouldBypass) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center text-sm text-muted-foreground">
        {t("onboarding.ai.loading")}
      </div>
    );
  }

  const stepNumber = step === "profile" ? 1 : step === "topic" ? 2 : 3;
  const sceneCopy =
    step === "profile"
      ? {
          eyebrow: t("onboarding.scene.profileEyebrow"),
          title: t("onboarding.scene.profileTitle"),
          body: t("onboarding.scene.profileBody"),
          mobileBody: t("onboarding.scene.profileMobileBody"),
        }
      : step === "topic"
        ? {
            eyebrow: t("onboarding.scene.topicEyebrow"),
            title: t("onboarding.scene.topicTitle", {
              name: nickname.trim() || t("onboarding.scene.defaultGreeting"),
            }),
            body: t("onboarding.scene.topicBody"),
            mobileBody: t("onboarding.scene.topicMobileBody"),
          }
        : {
            eyebrow: t("onboarding.scene.preferencesEyebrow"),
            title: t("onboarding.scene.preferencesTitle"),
            body: t("onboarding.scene.preferencesBody"),
            mobileBody: t("onboarding.scene.preferencesMobileBody"),
          };

  return (
    <div className="onboarding-page bg-[var(--bg-50)] px-4 py-4 sm:px-6 sm:py-6">
      <main className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-2xl border border-[var(--border-200)] bg-[var(--bg-100)] shadow-lg sm:rounded-[2rem] lg:min-h-[720px] lg:grid-cols-[minmax(300px,0.78fr)_minmax(0,1.22fr)] lg:shadow-xl">
        <section className="relative hidden min-h-0 flex-col overflow-hidden border-r border-[var(--border-200)] bg-[var(--bg-100)] px-8 pt-8 lg:flex">
          <div className="relative z-10 flex items-start justify-between">
            <div className="flex items-center gap-3 p-1.5 text-left">
              <span className="relative">
                <img
                  src={assistantAvatarSrc}
                  alt=""
                  className="size-11 rounded-xl object-cover"
                />
              </span>
              <span>
                <span className="block text-sm font-semibold">
                  {currentPersonaName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {currentPersona.tagline}
                </span>
              </span>
            </div>
            <span className="rounded-full border border-[var(--border-200)] px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {stepNumber} / 3
            </span>
          </div>

          <div className="relative z-10 mt-5 max-w-sm rounded-2xl rounded-bl-md border border-[var(--border-200)] bg-[var(--bg-50)] px-4 py-3 shadow-sm lg:mt-10 lg:px-5 lg:py-4">
            <p className="text-xs font-semibold text-primary">
              {sceneCopy.eyebrow}
            </p>
            <h1 className="mt-1.5 text-xl font-bold leading-tight lg:text-2xl">
              {sceneCopy.title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {sceneCopy.body}
            </p>
          </div>

          <div className="pointer-events-none relative mt-auto flex min-h-28 justify-center lg:min-h-0 lg:flex-1 lg:items-end">
            <img
              key={currentPersona.avatarCode}
              src={teachingPersonaStandingSrc(currentPersona.avatarCode)}
              alt=""
              className="onboarding-avatar-enter absolute bottom-0 h-44 max-w-none object-contain object-bottom lg:h-[440px]"
            />
          </div>
        </section>

        <section className="flex min-w-0 flex-col px-4 py-4 sm:px-8 sm:py-8 lg:px-12 lg:py-10">
          <div className="flex items-start gap-3 lg:hidden">
            <div className="relative shrink-0 rounded-xl">
              <img
                src={assistantAvatarSrc}
                alt={t("onboarding.ai.assistantAlt", {
                  name: currentPersonaName,
                })}
                className="size-12 rounded-xl object-cover"
              />
            </div>
            <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-[var(--border-200)] bg-[var(--bg-50)] px-3.5 py-2.5">
              <p className="text-xs font-semibold text-primary">
                {currentPersonaName}
              </p>
              <p className="mt-0.5 text-sm leading-5 text-foreground">
                {sceneCopy.mobileBody}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--border-200)] px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {stepNumber}/3
            </span>
          </div>

          <div className="mt-4 flex items-center gap-4 lg:mt-0">
            <div
              className="grid min-w-0 flex-1 grid-cols-3 gap-2"
              aria-label={t("onboarding.progressLabel")}
            >
              {[1, 2, 3].map((item) => (
                <span
                  key={item}
                  className={cn(
                    "h-1.5 rounded-full transition-colors",
                    item <= stepNumber
                      ? "bg-primary"
                      : "bg-[var(--border-200)]",
                  )}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={saveProfile.isPending}
              onClick={() => void exploreFirst()}
              className="-my-2 -mr-2 shrink-0"
            >
              {t("onboarding.ai.explore")}
            </Button>
          </div>

          <div className="onboarding-message-enter my-auto py-6 sm:py-8 lg:py-10">
            {step === "profile" ? (
              <div className="mx-auto max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  {t("onboarding.profile.stepLabel")}
                </p>
                <h2 className="mt-1.5 text-2xl font-bold tracking-tight sm:mt-2 sm:text-3xl">
                  {t("onboarding.profile.title")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("onboarding.profile.description")}
                </p>

                <div className="mt-5 space-y-2.5 sm:mt-7 sm:space-y-3">
                  <label
                    htmlFor="onboarding-nickname"
                    className="text-sm font-semibold"
                  >
                    {t("onboarding.profile.nicknameLabel")}
                  </label>
                  <Input
                    id="onboarding-nickname"
                    autoFocus
                    value={nickname}
                    maxLength={40}
                    placeholder={t("onboarding.profile.nicknamePlaceholder")}
                    onChange={(event) =>
                      setNickname(event.target.value.slice(0, 40))
                    }
                    className="h-12 rounded-xl bg-[var(--bg-50)] px-4 text-base"
                  />
                </div>

                <button
                  type="button"
                  aria-expanded={backgroundExpanded}
                  onClick={() => setBackgroundExpanded((value) => !value)}
                  className="mt-4 flex w-full items-center justify-between rounded-xl border border-[var(--border-200)] px-4 py-3 text-left text-sm font-medium transition hover:border-primary/40 hover:bg-primary/5 sm:mt-5"
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal
                      className="size-4 text-primary"
                      aria-hidden
                    />
                    {t("onboarding.profile.backgroundTitle")}
                    <span className="font-normal text-muted-foreground">
                      {t("onboarding.profile.optional")}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {backgroundExpanded
                      ? t("onboarding.profile.collapse")
                      : t("onboarding.profile.fillIn")}
                  </span>
                </button>

                {backgroundExpanded ? (
                  <div className="mt-3 space-y-3 rounded-2xl bg-[var(--bg-50)] p-4">
                    <Input
                      value={majorOrField}
                      maxLength={400}
                      placeholder={t("onboarding.profile.fieldPlaceholder")}
                      onChange={(event) => setMajorOrField(event.target.value)}
                    />
                    <Input
                      value={generalSkills}
                      placeholder={t("onboarding.profile.skillsPlaceholder")}
                      onChange={(event) => setGeneralSkills(event.target.value)}
                    />
                    <Textarea
                      value={customInfo}
                      maxLength={500}
                      placeholder={t(
                        "onboarding.profile.customInfoPlaceholder",
                      )}
                      onChange={(event) =>
                        setCustomInfo(event.target.value.slice(0, 500))
                      }
                      className="min-h-20"
                    />
                  </div>
                ) : null}

                {profileError ? (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    {profileError}
                  </p>
                ) : null}

                <Button
                  type="button"
                  size="lg"
                  className="mt-5 w-full rounded-xl sm:mt-7"
                  disabled={saveProfile.isPending || !nickname.trim()}
                  onClick={() => void saveSimpleProfile()}
                >
                  {saveProfile.isPending
                    ? t("onboarding.profile.saving")
                    : t("onboarding.ai.continue")}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            ) : step === "topic" ? (
              <div className="mx-auto max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  {t("onboarding.topic.stepLabel")}
                </p>
                <h2 className="mt-1.5 text-2xl font-bold tracking-tight sm:mt-2 sm:text-3xl">
                  {t("onboarding.topic.title")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("onboarding.topic.description")}
                </p>

                <label
                  htmlFor="onboarding-topic"
                  className="mt-5 block text-sm font-semibold sm:mt-7"
                >
                  {t("onboarding.topic.goalLabel")}
                </label>
                <Textarea
                  id="onboarding-topic"
                  autoFocus
                  value={topic}
                  maxLength={500}
                  placeholder={t("onboarding.topic.goalPlaceholder")}
                  onChange={(event) => setTopic(event.target.value)}
                  className="mt-3 min-h-32 resize-none rounded-xl bg-[var(--bg-50)] p-4 text-base leading-7"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    t("onboarding.topic.examplePython"),
                    t("onboarding.topic.exampleEnglishMeetings"),
                    t("onboarding.topic.exampleWebsite"),
                  ].map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setTopic(example)}
                      className="rounded-full border border-[var(--border-200)] px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                    >
                      {example}
                    </button>
                  ))}
                </div>

                <div className="mt-5 flex gap-3 sm:mt-7">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="rounded-xl"
                    onClick={() => setStep("profile")}
                  >
                    <ChevronLeft className="size-4" />
                    {t("onboarding.previous")}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    className="flex-1 rounded-xl"
                    disabled={!topic.trim()}
                    onClick={() => setStep("preferences")}
                  >
                    {t("onboarding.ai.continue")}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  {t("onboarding.preferences.stepLabel")}
                </p>
                <h2 className="mt-1.5 text-2xl font-bold tracking-tight sm:mt-2 sm:text-3xl">
                  {t("onboarding.preferences.title")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("onboarding.preferences.description")}
                </p>

                <div className="mt-5 grid gap-3 sm:mt-7">
                  {(
                    [
                      [
                        "zero",
                        t("onboarding.preferences.zeroTitle"),
                        t("onboarding.preferences.zeroDescription"),
                      ],
                      [
                        "basic",
                        t("onboarding.preferences.basicTitle"),
                        t("onboarding.preferences.basicDescription"),
                      ],
                      [
                        "advanced",
                        t("onboarding.preferences.advancedTitle"),
                        t("onboarding.preferences.advancedDescription"),
                      ],
                    ] as const
                  ).map(([item, title, description]) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={level === item}
                      onClick={() => setLevel(item)}
                      className={cn(
                        "flex min-h-20 items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-primary",
                        level === item
                          ? "border-primary bg-primary/8"
                          : "border-[var(--border-200)] bg-[var(--bg-50)] hover:border-primary/50",
                      )}
                    >
                      <span>
                        <span className="block font-semibold">{title}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {description}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full border",
                          level === item
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-[var(--border-200)]",
                        )}
                      >
                        {level === item ? (
                          <Check className="size-3.5" aria-hidden />
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-5 rounded-2xl bg-[var(--bg-50)] p-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("onboarding.preferences.creatingLabel")}
                  </p>
                  <p className="mt-1 line-clamp-2 font-semibold">{topic}</p>
                </div>

                <div className="mt-5 flex gap-3 sm:mt-7">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="rounded-xl"
                    onClick={() => setStep("topic")}
                  >
                    <ChevronLeft className="size-4" />
                    {t("onboarding.previous")}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    className="flex-1 rounded-xl"
                    disabled={saveProfile.isPending}
                    onClick={() => void startLiveGoalCreation()}
                  >
                    <Sparkles className="size-4" />
                    {t("onboarding.ai.buildGoal")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {skipError ? (
            <p
              className="mx-auto w-full max-w-xl text-sm text-destructive"
              role="alert"
            >
              {skipError}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
