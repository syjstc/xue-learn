import { Link, useSearchParams } from "react-router-dom";
import { WorkspaceSidebarBackButton } from "@/components/layout/workspace-sidebar-back-button";
import {
  LOCAL_SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  resolveSettingsSection,
  settingsSectionPath,
} from "@/components/settings/settings-sections";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

export function SettingsWorkspaceSubview() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const visibleSections = isDesktopLocalRuntime()
    ? SETTINGS_SECTIONS.filter((section) =>
        LOCAL_SETTINGS_SECTION_IDS.includes(section.id),
      )
    : SETTINGS_SECTIONS;
  const requestedSection = resolveSettingsSection(searchParams.get("tab"));
  const activeSection = visibleSections.some(
    (section) => section.id === requestedSection,
  )
    ? requestedSection
    : "profile";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pt-3 pb-2">
        <WorkspaceSidebarBackButton fallbackTo="/spaces" />
      </div>

      <div className="px-3 pb-3">
        <p className="truncate text-sm font-semibold text-[var(--text-800)]">
          {t("settings.pageTitle")}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-400)]">
          {t("settings.pageDescription")}
        </p>
      </div>

      <nav
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t border-[var(--border-200)] px-2.5 py-2"
        aria-label={t("settings.categoryAria")}
      >
        {visibleSections.map(({ id, labelKey, icon: Icon }) => {
          const active = id === activeSection;
          return (
            <Link
              key={id}
              to={settingsSectionPath(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors",
                active
                  ? "bg-[var(--brand-50)] font-medium text-[var(--brand-700)]"
                  : "text-[var(--text-500)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t(labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
