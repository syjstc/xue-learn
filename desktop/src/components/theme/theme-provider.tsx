"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  DEFAULT_THEME,
  getSystemTheme,
  readTheme,
  resolveTheme,
  writeTheme,
  type ResolvedTheme,
  type Theme,
} from "@/shared/theme";
import {
  readLocalAppearancePreferences,
  writeLocalAppearancePreferences,
} from "@xue-learn/core/shared/runtime/local-preferences";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  hydrated: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    const stored = readTheme();
    setThemeState(stored);
    setResolvedTheme(resolveTheme(stored));
    applyTheme(stored);
    void readLocalAppearancePreferences().then((preferences) => {
      if (!active) return;
      if (preferences) {
        setThemeState(preferences.theme);
        setResolvedTheme(resolveTheme(preferences.theme));
        applyTheme(preferences.theme);
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setResolvedTheme(getSystemTheme());
      applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [hydrated, theme]);

  const setTheme = useCallback((next: Theme | ((prev: Theme) => Theme)) => {
    setThemeState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      writeTheme(resolved);
      writeLocalAppearancePreferences({ theme: resolved });
      applyTheme(resolved);
      setResolvedTheme(resolveTheme(resolved));
      return resolved;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      if (prev === "light") return "dark";
      if (prev === "dark") return "system";
      return "light";
    });
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme, hydrated }),
    [theme, resolvedTheme, setTheme, toggleTheme, hydrated],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
