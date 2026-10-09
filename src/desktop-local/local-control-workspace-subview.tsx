import { NavLink } from "react-router-dom";
import { WorkspaceSidebarBackButton } from "@/components/layout/workspace-sidebar-back-button";
import type { WorkspaceSidebarViewRegistration } from "@/components/layout/workspace-sidebar-view-registry";
import { LOCAL_CONTROL_SECTIONS } from "@/desktop-local/local-control-sections";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

export function LocalControlWorkspaceSubview() {
  const t = useT();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pt-3 pb-2">
        <WorkspaceSidebarBackButton fallbackTo="/spaces" />
      </div>

      <div className="px-3 pb-3">
        <p className="truncate text-sm font-semibold text-[var(--text-800)]">
          {t("desktop.deviceSettings.title")}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-400)]">
          {t("desktop.deviceSettings.description")}
        </p>
      </div>

      <nav
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t border-[var(--border-200)] px-2.5 py-2"
        aria-label={t("desktop.deviceSettings.sectionsLabel")}
      >
        {LOCAL_CONTROL_SECTIONS.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors",
                isActive
                  ? "bg-[var(--brand-50)] font-medium text-[var(--brand-700)]"
                  : "text-[var(--text-500)] hover:bg-[var(--bg-200)] hover:text-[var(--text-800)]",
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export const LOCAL_CONTROL_SIDEBAR_VIEW: WorkspaceSidebarViewRegistration = {
  id: "local-control",
  resolve: ({ pathname }) =>
    pathname.startsWith("/local/")
      ? {
          id: "local-control",
          locksSidebarOpen: true,
          render: () => <LocalControlWorkspaceSubview />,
        }
      : null,
};
