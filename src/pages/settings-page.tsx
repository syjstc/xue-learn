"use client";

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AgendaSettingsForm } from "@/components/settings/agenda-settings-form";
import { LearnerProfileSettingsForm } from "@/components/settings/learner-profile-settings-form";
import { LearnerStateSummary } from "@/components/settings/learner-state-summary";
import { LanguageSettingsForm } from "@/components/settings/language-settings-form";
import { LlmSettingsForm } from "@/components/settings/llm-settings-form";
import { LearningViewSettingsForm } from "@/components/settings/learning-view-settings-form";
import { MemorySettingsForm } from "@/components/settings/memory-settings-form";
import { TeachingPersonaSettings } from "@/components/settings/teaching-persona-settings";
import { ThemeSettingsForm } from "@/components/settings/theme-settings-form";
import { DesktopShortcutSettings } from "@/components/settings/desktop-shortcut-settings";
import {
  LOCAL_SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  resolveSettingsSection,
  type SettingsSectionId,
} from "@/components/settings/settings-sections";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useT } from "@xue-learn/core/i18n";
import { isDev } from "@xue-learn/core/dev";
import { cn } from "@xue-learn/core/utils";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";

function SettingsCard({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || description);

  return (
    <Card>
      {hasHeader ? (
        <CardHeader className="border-b border-border/70 pb-4">
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function LearningExperienceSettings() {
  const t = useT();
  const localRuntime = isDesktopLocalRuntime();

  return (
    <div className="space-y-4">
      <SettingsCard
        title={t("settings.learningView.title")}
        description={t("settings.learningView.description")}
      >
        <LearningViewSettingsForm />
      </SettingsCard>

      {!localRuntime ? (
        <SettingsCard
          title={t("settings.experience.model")}
          description={t("settings.experience.modelDescription")}
        >
          <LlmSettingsForm productMode lite autoSave showSaveFooter={false} />
        </SettingsCard>
      ) : null}

      <SettingsCard
        title={t("settings.experience.agenda")}
        description={t("settings.experience.agendaDescription")}
      >
        <AgendaSettingsForm />
      </SettingsCard>
    </div>
  );
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const localRuntime = isDesktopLocalRuntime();
  const visibleSections = localRuntime
    ? SETTINGS_SECTIONS.filter((section) =>
        LOCAL_SETTINGS_SECTION_IDS.includes(section.id),
      )
    : SETTINGS_SECTIONS;
  const resolvedSection = resolveSettingsSection(requestedTab);
  const activeSection = visibleSections.some(
    (section) => section.id === resolvedSection,
  )
    ? resolvedSection
    : "profile";
  const t = useT();
  const activeMeta =
    visibleSections.find((section) => section.id === activeSection) ??
    visibleSections[0];

  useEffect(() => {
    if (!requestedTab) return;
    if (requestedTab !== activeSection) {
      setSearchParams(
        activeSection === "profile" ? {} : { tab: activeSection },
        { replace: true },
      );
    }
  }, [activeSection, requestedTab, setSearchParams]);

  function selectSection(next: SettingsSectionId) {
    setSearchParams(next === "profile" ? {} : { tab: next });
  }

  function renderContent() {
    switch (activeSection) {
      case "profile":
        return (
          <SettingsCard
            title={t("settings.profile.cardTitle")}
            description={t("settings.profile.cardDescription")}
          >
            <LearnerProfileSettingsForm />
          </SettingsCard>
        );
      case "state":
        return (
          <SettingsCard title={t("learningState.sectionTitle")}>
            <LearnerStateSummary hideSectionHeader />
          </SettingsCard>
        );
      case "persona":
        return <TeachingPersonaSettings />;
      case "memory":
        return (
          <SettingsCard description={t("settings.memory.description")}>
            <MemorySettingsForm />
          </SettingsCard>
        );
      case "experience":
        return <LearningExperienceSettings />;
      case "appearance":
        return (
          <div className="space-y-4">
            <SettingsCard
              title={t("theme.appearanceTheme")}
              description={t("theme.appearanceDescription")}
            >
              <ThemeSettingsForm compact />
            </SettingsCard>
            {isDev() || isDesktopLocalRuntime() ? (
              <SettingsCard
                title={t("i18n.uiLanguage")}
                description={t("i18n.uiLanguageDescription")}
              >
                <LanguageSettingsForm compact />
              </SettingsCard>
            ) : null}
            {isDesktopLocalRuntime() ? (
              <SettingsCard
                title={t("settings.shortcuts.title")}
                description={t("settings.shortcuts.description")}
              >
                <DesktopShortcutSettings />
              </SettingsCard>
            ) : null}
          </div>
        );
      case "account":
        return null;
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 sm:space-y-5">
      <div className="space-y-2 lg:hidden">
        <nav
          aria-label={t("settings.categoryAria")}
          className="grid grid-cols-2 gap-2"
        >
          {visibleSections.map(({ id, labelKey, icon: Icon }) => {
            const active = activeSection === id;

            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => selectSection(id)}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </button>
            );
          })}
        </nav>
        <p className="px-1 text-sm leading-6 text-muted-foreground">
          {t(activeMeta.descriptionKey)}
        </p>
      </div>

      <main className="min-w-0 space-y-4">
        {activeSection !== "persona" ? (
          <div>
            <h1 className="sr-only lg:not-sr-only lg:text-2xl lg:font-semibold lg:tracking-tight">
              {t(activeMeta.labelKey)}
            </h1>
            <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
              {t(activeMeta.descriptionKey)}
            </p>
          </div>
        ) : null}
        {renderContent()}
      </main>
    </div>
  );
}
