import {createElement} from 'react';
import {configureClientRuntime} from '@xue-learn/core/client-runtime';
// Native Desktop pages load Display renderers lazily. Their shared CSS must
// enter through the plugin root; the optional Presentation page may not mount.
import '@xue-learn/core/display/runtime.css';
import '@xue-learn/core/display/plugins.css';
import '@xue-learn/core/display/workspace.css';
import {Workbench} from './workbench';
import logo from '../icon.png';

export const inject = ['slots', 'locale', 'layout'];
const NS = 'xuelearn';
/** DSH's host supplies React, layout, slots and localization. */
export function apply(ctx: any) {
  configureClientRuntime({schemaVersion: 1, kind: 'desktop-local', os: 'web', arch: 'browser', appVersion: 'dsh-plugin-0.1.0', capabilities: {
    authentication: false, billing: false, publicCatalog: false, sharing: false, cloudSync: false, localAdmin: false,
    nativeFilesystem: false, nativeTerminal: false, agendaReminderDelivery: false, scenarioTheaterGeneration: false,
    assistantScopedTextThreads: true, flashcards: false, goalIconGeneration: false,
    goalTextbookExport: false, goalBatchGeneration: false,
    chatAudioGeneration: false, materialIllustrationRegeneration: false,
  }});
  ctx.effect(() => ctx.locale.register(NS, {zh: {title: '好会学'}, en: {title: '好会学'}}));
  const t = ctx.locale.bind(NS);
  ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: 'xuelearn'}, Workbench));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name: 'sidebar.panellist', id: 'xuelearn', order: 35, label: () => t('title')}, ({owner}: any) =>
    createElement('img', {src: logo, width: owner?.size ?? 18, height: owner?.size ?? 18,
      alt: '', 'aria-hidden': true, style: {objectFit: 'contain', flexShrink: 0}})));
}
