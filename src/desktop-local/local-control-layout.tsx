import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LOCAL_CONTROL_SECTIONS } from "./local-control-sections.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

export function LocalControlLayout() {
  const t = useT();
  const location = useLocation();
  const usesWideDataLayout = location.pathname === "/local/token-usage";
  const isRemotionTemplatesPage = location.pathname === "/local/remotion-templates";

  return (
    <div
      className={cn(
        "mx-auto w-full min-w-0 pb-6 sm:pb-8",
        isRemotionTemplatesPage ? "max-w-[100rem]" : "px-4 sm:px-6",
        !isRemotionTemplatesPage && (usesWideDataLayout ? "max-w-[100rem]" : "max-w-7xl"),
      )}
    >
      <nav
        aria-label={t("desktop.deviceSettings.sectionsLabel")}
        className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-muted/35 p-1 md:hidden"
      >
        {LOCAL_CONTROL_SECTIONS.map(({ to, labelKey, icon: Icon }) => (
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
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
