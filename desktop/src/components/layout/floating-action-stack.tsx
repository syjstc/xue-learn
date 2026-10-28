import { useLocation } from "react-router-dom";
import { isPublicCoursePath } from "@/shared/routing/routes";
import { cn } from "@xue-learn/core/utils";

export function FloatingActionStack({
  children,
}: {
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const inUnit = /^\/goals\/[^/]+\/units\/[^/]+/.test(pathname);

  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/onboarding" ||
    isPublicCoursePath(pathname)
  )
    return null;

  return (
    <div
      data-floating-action-stack
      className={cn(
        "fixed right-4 z-fab flex flex-col items-end justify-end gap-3 sm:right-6",
        inUnit
          ? "bottom-6"
          : "bottom-[calc(4.75rem+env(safe-area-inset-bottom,0))] md:bottom-6",
      )}
    >
      {children}
    </div>
  );
}
