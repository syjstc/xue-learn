import {createContext, useContext, useEffect, useState, type ReactNode} from 'react';
import {EmbeddedPortalContext} from './embedded-portal';
import {readLocalAppearancePreferences, writeLocalAppearancePreferences, type LocalTheme} from './appearance';
const Context = createContext({theme: 'system' as LocalTheme, resolvedTheme: 'light' as 'light' | 'dark',
  hydrated: false, setTheme: (_theme: LocalTheme) => {}, toggleTheme: () => {}});
export function ThemeProvider({children}: {children: ReactNode}) {
  const surface = useContext(EmbeddedPortalContext);
  const [theme, setValue] = useState<LocalTheme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {let active = true; void readLocalAppearancePreferences().then(value => {
    if (active && value?.theme) setValue(value.theme);
  }).catch(() => {}).finally(() => {if (active) setHydrated(true);}); return () => {active = false;};}, []);
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && system.matches);
      setResolvedTheme(dark ? 'dark' : 'light');
      surface?.classList.toggle('dark', dark);
      surface?.classList.toggle('xl-light', !dark);
    };
    apply(); system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [surface, theme]);
  const setTheme = (value: LocalTheme) => {setValue(value); writeLocalAppearancePreferences({theme: value});};
  return <Context.Provider value={{theme, resolvedTheme, hydrated, setTheme,
    toggleTheme() {setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');}}}>{children}</Context.Provider>;
}
export function useTheme() {return useContext(Context);}
