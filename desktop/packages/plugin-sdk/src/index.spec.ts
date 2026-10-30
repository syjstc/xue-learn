import { missingPluginCapabilities, parseDesktopPluginManifest, resolveDesktopPluginUiPath } from './index';
import { desktopPluginSettingsPath, desktopPluginViewLaunch, desktopPluginViewPath } from './renderer';

const base = () => ({
  schemaVersion: 1, apiVersion: 1, id: 'test.plugin', version: '1.0.0', name: 'Plugin',
  runtime: { entry: 'plugin.cjs' }, integrity: { 'plugin.cjs': 'a'.repeat(64) },
  requires: { 'workspace.connection': 1 }, contributes: { commands: [{ id: 'open', title: 'Open' }] },
});

describe('plugin UI contributions', () => {
  const input = (ui: unknown[]) => ({
    ...base(), requires: { 'ui.extensions': 1 },
    integrity: { ...base().integrity, 'view.mjs': 'b'.repeat(64) },
    contributes: { ...base().contributes, views: [{ id: 'studio', title: 'Studio', entry: 'view.mjs' }], ui },
  });
  const action = { id: 'open-unit', title: 'Video', slot: 'unit.content.actions', viewId: 'studio', path: '/units/{unitId}?goal={goalId}' };

  it('validates all supported slots and explicit command/view references', () => {
    const manifest = parseDesktopPluginManifest(input([
      action, { id: 'inspect', title: 'Inspect', slot: 'unit.header.actions', command: 'open' },
      { id: 'panel', title: 'Preview', slot: 'unit.content.panels', viewId: 'studio' },
      { id: 'settings', title: 'Video settings', slot: 'settings.tabs', viewId: 'studio', path: '/settings', icon: 'video', order: 10 },
    ]));
    expect(manifest.contributes.ui).toHaveLength(4);
    expect(() => parseDesktopPluginManifest({ ...input([action]), requires: {} })).toThrow('ui.extensions@1');
  });

  it.each([
    { ...action, slot: 'document.anywhere' }, { ...action, viewId: 'missing' },
    { ...action, command: 'open' }, { ...action, icon: 'unknown' }, { ...action, order: 1001 },
    { ...action, path: 'https://example.org' }, { ...action, path: '//example.org' },
    { ...action, path: '/units/{workspaceId}' }, { ...action, path: '/units/{unitId' },
    { ...action, slot: 'settings.tabs' }, { id: 'inspect', title: 'Inspect', slot: 'settings.tabs', command: 'open' },
    { id: 'inspect', title: 'Inspect', slot: 'unit.content.actions', command: 'missing' },
  ])('rejects invalid UI declarations %o', declaration => {
    expect(() => parseDesktopPluginManifest(input([declaration]))).toThrow();
  });
  it('rejects duplicate contribution ids and launch-only views as inline targets', () => {
    expect(() => parseDesktopPluginManifest(input([action, action]))).toThrow('Duplicate');
    const candidate = input([action]);
    expect(() => parseDesktopPluginManifest({ ...candidate, contributes: { ...candidate.contributes, views: [{ id: 'studio', title: 'Studio', command: 'open' }] } })).toThrow('embedded view');
  });
  it('encodes context values once and hides actions when required context is missing', () => {
    expect(resolveDesktopPluginUiPath(action.path, { unitId: 'unit 中文&?#', goalId: 'goal-a' })).toBe('/units/unit%20%E4%B8%AD%E6%96%87%26%3F%23?goal=goal-a');
    expect(resolveDesktopPluginUiPath(action.path, { unitId: 'unit-a' })).toBeUndefined();
    expect(resolveDesktopPluginUiPath('/settings', {})).toBe('/settings');
  });
  it('round-trips launch routes and return positions without accepting workspace authority', () => {
    const context = { slot: 'unit.content.actions' as const, unitId: 'unit-a', goalId: 'goal-a', sectionId: 'section-a', returnTo: '/goals/goal-a/units/unit-a?section=section-a#beat-2' };
    const path = desktopPluginViewPath('test.plugin', 'studio', { initialPath: '/units/unit-a?mode=video', context });
    expect(desktopPluginViewLaunch(path.slice(path.indexOf('?')))).toEqual({ initialPath: '/units/unit-a?mode=video', context });
    expect(desktopPluginSettingsPath('test.plugin', 'settings')).toBe('/settings?tab=plugin%3Atest.plugin%3Asettings');
    expect(desktopPluginViewLaunch('?pluginPath=%2F%2Fevil&returnTo=https%3A%2F%2Fevil&workspaceId=forged&unitId=..&slot=unknown')).toEqual({ initialPath: '/', context: {} });
  });
});
describe('plugin manifest contract', () => {
  it('checks exact capability versions without inherited object members', () => {
    const manifest = parseDesktopPluginManifest(base());
    expect(missingPluginCapabilities(manifest, { 'workspace.connection': 1 })).toEqual([]);
    expect(missingPluginCapabilities(manifest, { 'workspace.connection': 2 })).toEqual(['workspace.connection@1']);
  });
  it.each(['../plugin.cjs', '/plugin.cjs', 'C:/plugin.cjs', 'dir\\plugin.cjs', 'dir/../plugin.cjs'])('rejects unsafe runtime path %s', entry => {
    expect(() => parseDesktopPluginManifest({ ...base(), runtime: { entry } })).toThrow();
  });
  it('validates display contribution paths and command references', () => {
    expect(() => parseDesktopPluginManifest({ ...base(), contributes: { displayPackages: ['../display'] } })).toThrow('display package');
    expect(() => parseDesktopPluginManifest({ ...base(), contributes: { commands: [], views: [{ id: 'view', title: 'View', command: 'missing' }] } })).toThrow('undeclared command');
  });
  it('rejects invalid protocol and prototype-sensitive identifiers', () => {
    expect(() => parseDesktopPluginManifest({ ...base(), apiVersion: 2 })).toThrow('apiVersion');
    expect(() => parseDesktopPluginManifest({ ...base(), id: 'constructor' })).toThrow('plugin id');
    expect(() => parseDesktopPluginManifest({ ...base(), requires: JSON.parse('{"__proto__":1}') })).toThrow('capability');
  });
  it('accepts an embedded UI without a worker while preserving launch views', () => {
    const manifest = parseDesktopPluginManifest({
      ...base(), runtime: undefined, requires: { 'workspace.courses': 1 },
      contributes: { views: [{ id: 'courses', title: 'Courses', entry: 'ui/view.mjs', stylesheet: 'ui/view.css' }] },
      integrity: { 'ui/view.mjs': 'b'.repeat(64), 'ui/view.css': 'c'.repeat(64) },
    });
    expect(manifest.runtime).toBeUndefined();
    expect(manifest.contributes.commands).toEqual([]);
    expect(manifest.contributes.views?.[0]).toEqual({ id: 'courses', title: 'Courses', entry: 'ui/view.mjs', stylesheet: 'ui/view.css' });
    expect(parseDesktopPluginManifest({ ...base(), contributes: { ...base().contributes, views: [{ id: 'launch', title: 'Launch', command: 'open' }] } }).contributes.views?.[0].command).toBe('open');
  });
  it.each([
    { entry: '../view.mjs' },
    { entry: 'view.cjs' },
    { entry: 'view.mjs', command: 'open' },
    { entry: 'view.mjs', stylesheet: '../view.css' },
    { entry: 'view.mjs', stylesheet: 'view.js' },
    { command: 'open', stylesheet: 'view.css' },
    { entry: 'unhashed.mjs' },
    { entry: 'view.mjs', stylesheet: 'unhashed.css' },
  ])('rejects malformed or unhashed embedded contributions %o', view => {
    expect(() => parseDesktopPluginManifest({
      ...base(), integrity: { ...base().integrity, 'view.mjs': 'b'.repeat(64), 'view.css': 'c'.repeat(64) },
      contributes: { ...base().contributes, views: [{ id: 'courses', title: 'Courses', ...view }] },
    })).toThrow();
  });
});
