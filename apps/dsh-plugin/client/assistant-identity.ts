import avatar from '../icon.png';
import {getCurrentUiLocale} from '@xue-learn/core/i18n';

/** The embedded assistant has one neutral identity; DSH owns account identity. */
export function teachingPersonaAvatarSrc(_avatarCode?: string) { return avatar; }
export function teachingPersonaStandingSrc(_avatarCode?: string) { return avatar; }
export function localizeTeachingPersonaName(..._args: unknown[]) {
  const locale = getCurrentUiLocale();
  return locale === 'en' ? 'Learning assistant' : locale === 'zh-Hant' ? '學習助手' : '学习助手';
}
export function localizeTeachingPersonaContent(..._args: unknown[]) {
  return {name: localizeTeachingPersonaName(), tagline: '', introduction: '', traits: []};
}
