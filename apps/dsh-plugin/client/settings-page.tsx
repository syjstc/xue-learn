import {useEffect} from 'react';
import {useSearchParams} from 'react-router-dom';
import {useT} from '@xue-learn/core/i18n';
import {AgendaSettingsForm} from '../../../desktop/src/components/settings/agenda-settings-form';
import {LanguageSettingsForm} from '../../../desktop/src/components/settings/language-settings-form';
import {LearningViewSettingsForm} from '../../../desktop/src/components/settings/learning-view-settings-form';
import {ThemeSettingsForm} from '../../../desktop/src/components/settings/theme-settings-form';
import {activeSettingsSection, useSettingsSections} from './settings-sections';

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const {sections} = useSettingsSections();
  const requested = params.get('tab');
  const active = activeSettingsSection(requested, sections);
  const t = useT();
  useEffect(() => {
    if (requested !== active) setParams({tab: active}, {replace: true});
  }, [requested, active, setParams]);
  return <div className="mx-auto w-full max-w-3xl space-y-5">
    <nav aria-label={t('settings.categoryAria')} className="flex gap-2 lg:hidden">
      {sections.map(({id, title}) => <button key={id} type="button" onClick={() => setParams({tab: id})}
        aria-current={active === id ? 'page' : undefined}
        className="rounded-lg border px-3 py-2 text-sm aria-[current=page]:bg-muted">{title}</button>)}
    </nav>
    <h1 className="text-xl font-semibold">{sections.find(section => section.id === active)?.title}</h1>
    {active === 'appearance' ? <>
      <section className="rounded-xl border bg-card p-4"><ThemeSettingsForm compact /></section>
      <section className="rounded-xl border bg-card p-4"><LanguageSettingsForm compact /></section>
    </> : <>
      <section className="rounded-xl border bg-card p-4"><LearningViewSettingsForm /></section>
      <section className="rounded-xl border bg-card p-4"><AgendaSettingsForm /></section>
    </>}
  </div>;
}
