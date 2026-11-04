import {apiFetch} from './api-client';

let preferences: Record<string, unknown> = {};
let writes = Promise.resolve();
export async function hydrateLocalClientPreferences() {
  const response = await apiFetch('/api/settings/client-preferences');
  if (!response.ok) throw Error('无法读取学习空间的界面设置。');
  preferences = await response.json();
}
export function readLocalClientPreference<T>(key: string, fallback: T): T {
  return key in preferences ? preferences[key] as T : fallback;
}
export function writeLocalClientPreference(key: string, value: unknown) {
  if (value === null) delete preferences[key];
  else preferences = {...preferences, [key]: value};
  writes = writes.catch(() => {}).then(async () => {
    const response = await apiFetch('/api/settings/client-preferences', {
      method: 'PATCH', body: JSON.stringify({patch: {[key]: value}}),
    });
    if (!response.ok) throw Error('无法保存学习空间的界面设置。');
  });
  void writes.catch(() => {});
}
