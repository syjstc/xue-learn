import { useLocation } from "react-router-dom";
import { isGoalContext, isPublicCoursePath } from "@/shared/routing/routes";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const isLanding = pathname === "/";
  const isAuthPage = pathname === "/login" || pathname === "/register";
  const inGoal = isGoalContext(pathname);
  const isPublicCourse = isPublicCoursePath(pathname);
  const isUnitPage = /\/goals\/[^/]+\/units\/[^/]+$/.test(pathname);
  const isSettingsPage = pathname === "/settings";
  const isLocalControlPage = pathname.startsWith("/local/");
  const isRemotionTemplatesPage = pathname === "/local/remotion-templates";

  if (pathname === "/onboarding") return <>{children}</>;

  if (inGoal || isPublicCourse) {
    return <>{children}</>;
  }

  return (
    <main
      data-settings-main-wrapper={
        isSettingsPage || isLocalControlPage || undefined
      }
      className={
        isLanding
          ? ""
          : isAuthPage
            ? "mx-auto min-w-0 max-w-5xl px-4 py-4 sm:px-6"
            : isUnitPage
              ? "mx-auto w-full min-w-0 max-w-7xl px-4 py-4 sm:px-6"
              : isRemotionTemplatesPage
                ? "mx-auto w-full min-w-0 max-w-[100rem] px-4 py-4 sm:px-6"
                : isSettingsPage || isLocalControlPage
                  ? "mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-6 sm:py-10"
                  : "mx-auto min-w-0 max-w-5xl px-4 py-8 sm:px-6 sm:py-10"
      }
    >
      {children}
    </main>
  );
}
