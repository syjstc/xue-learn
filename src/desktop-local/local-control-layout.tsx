import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LOCAL_CONTROL_SECTIONS } from "./local-control-sections.ts";
import { useI18n } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

export function LocalControlLayout() {
  const { t, locale } = useI18n();
  const location = useLocation();
  const usesWideDataLayout = location.pathname === "/local/token-usage";
  const isRemotionTemplatesPage =
    location.pathname === "/local/remotion-templates";

  return (
    <div
      className={cn(
        "mx-auto w-full min-w-0 pb-6 sm:pb-8",
        isRemotionTemplatesPage ? "max-w-[100rem]" : "px-4 sm:px-6",
        !isRemotionTemplatesPage &&
          (usesWideDataLayout ? "max-w-[100rem]" : "max-w-7xl"),
      )}
    >
      <nav
        aria-label={t("desktop.deviceSettings.sectionsLabel")}
        className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-muted/35 p-1 md:hidden"
      >
        {LOCAL_CONTROL_SECTIONS.map((section) => {
          const { to, icon: Icon } = section;
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {"label" in section ? section.label(locale) : t(section.labelKey)}
            </NavLink>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
