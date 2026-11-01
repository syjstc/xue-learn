import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ScrollRestoration } from "@/components/routing/scroll-restoration";
import { queryClient } from "@/shared/api";
import { configureDesktopLocalQueryClient } from "@/shared/api/query-client";
import {
  I18nProvider,
  applyUiLocale,
  resolveUiLocale,
  getSystemUiLocale,
  translateForLocale,
} from "@xue-learn/core/i18n";
import { readLocalAppearancePreferences } from "@xue-learn/core/shared/runtime/local-preferences";
import { configureClientRuntime } from "@xue-learn/core/client-runtime";
import { hydrateLocalClientPreferences } from "@/shared/runtime/local-client-preferences";
import { DesktopLocalApp } from "./desktop-local-app.tsx";
import { bootstrapDesktopRuntime } from "./runtime.ts";
import "../fonts.css";
import "../globals.css";
import "@xue-learn/core/display/runtime.css";
import "@xue-learn/core/display/plugins.css";
import "@xue-learn/core/display/workspace.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Desktop renderer root is missing");

function renderFatal(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  createRoot(rootElement!).render(
    <main role="alert" className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">
        {translateForLocale(
          getSystemUiLocale(),
          "desktop.i18n.bootstrapFailed",
        )}
      </h1>
      <p className="mt-3 text-muted-foreground">{message}</p>
    </main>,
  );
}

void bootstrapDesktopRuntime()
  .then(async (runtime) => {
    configureClientRuntime(runtime);
    const [appearance] = await Promise.all([
      readLocalAppearancePreferences(),
      hydrateLocalClientPreferences(),
    ]);
    const initialLocalePreference = appearance?.uiLocale ?? "system";
    applyUiLocale(resolveUiLocale(initialLocalePreference));
    configureDesktopLocalQueryClient();
    document.documentElement.dataset.desktopPlatform = runtime.os;
    rootElement.replaceChildren();
    createRoot(rootElement).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ScrollRestoration />
            <ThemeProvider>
              <I18nProvider initialLocalePreference={initialLocalePreference}>
                <DesktopLocalApp />
              </I18nProvider>
            </ThemeProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
  })
  .catch(renderFatal);
