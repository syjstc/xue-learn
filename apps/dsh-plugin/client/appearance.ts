import {apiFetch} from './api-client';
export type LocalTheme = 'light' | 'dark' | 'system';
export type LocalUiLocale = 'zh-Hans' | 'zh-Hant' | 'en' | 'system';
export type LocalAppearancePreferences = {theme: LocalTheme; uiLocale: LocalUiLocale};
export async function readLocalAppearancePreferences(): Promise<LocalAppearancePreferences | null> {
  const response = await apiFetch('/api/settings/appearance');
  return response.ok ? response.json() : null;
}
export function writeLocalAppearancePreferences(patch: Partial<LocalAppearancePreferences>) {
  void apiFetch('/api/settings/appearance', {method: 'PATCH', body: JSON.stringify(patch)}).catch(() => {});
}
