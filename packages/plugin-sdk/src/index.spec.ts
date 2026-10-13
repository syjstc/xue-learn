import { missingPluginCapabilities, parseDesktopPluginManifest } from './index';

const base = () => ({
  schemaVersion: 1, apiVersion: 1, id: 'test.plugin', version: '1.0.0', name: 'Plugin',
  runtime: { entry: 'plugin.cjs' }, integrity: { 'plugin.cjs': 'a'.repeat(64) },
  requires: { 'workspace.connection': 1 }, contributes: { commands: [{ id: 'open', title: 'Open' }] },
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
