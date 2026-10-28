import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "@xue-learn/core/i18n";
import { canUseBrowserPersistentStorage } from "@xue-learn/core/client-runtime";

const RETURN_LOCATION_KEY = "xue-learn:settings-return-location";
let localReturnLocation: string | null = null;

export function isSettingsWorkspaceLocation(path: string) {
  const pathname = path.split(/[?#]/, 1)[0];
  return (
    pathname === "/settings" ||
    pathname === "/profile" ||
    pathname === "/local-settings" ||
    pathname === "/local" ||
    pathname.startsWith("/local/")
  );
}

export function rememberNonSettingsLocation(path: string) {
  if (!isSettingsWorkspaceLocation(path)) {
    if (canUseBrowserPersistentStorage()) {
      window.sessionStorage.setItem(RETURN_LOCATION_KEY, path);
    } else {
      localReturnLocation = path;
    }
  }
}

export function WorkspaceSidebarBackButton({
  fallbackTo,
}: {
  fallbackTo: string;
}) {
  const navigate = useNavigate();
  const t = useT();
  const label = t("uiChrome.workspaceSidebar.back");

  function goBack() {
    const returnTo = canUseBrowserPersistentStorage()
      ? window.sessionStorage.getItem(RETURN_LOCATION_KEY)
      : localReturnLocation;
    if (returnTo && !isSettingsWorkspaceLocation(returnTo)) {
      navigate(returnTo);
      return;
    }
    navigate(fallbackTo, { replace: true });
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-400)] transition-colors hover:bg-[var(--bg-200)] hover:text-[var(--text-700)]"
      aria-label={label}
    >
      <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
