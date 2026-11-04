import {Palette, Sparkles} from 'lucide-react';
import {useT} from '@xue-learn/core/i18n';

export function useSettingsSections() {
  const t = useT();
  return {ready: true, bridge: null, sections: [
    {id: 'experience', title: t('settings.sections.experience'), description: t('settings.learningView.description'), icon: Sparkles},
    {id: 'appearance', title: t('settings.sections.appearance'), description: t('settings.sections.appearanceDescription'), icon: Palette},
  ]};
}

/** Old profile/persona/model bookmarks return to learning preferences. */
export function activeSettingsSection(requested: string | null, sections: {id: string}[]) {
  return sections.find(section => section.id === requested)?.id ?? 'experience';
}
