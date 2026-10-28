import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DesktopPluginPackageStore } from './package-store';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
describe('DesktopPluginPackageStore', () => {
  let directory: string;
  let source: string;
  let store: DesktopPluginPackageStore;
  const manifest = () => ({
    schemaVersion: 1, apiVersion: 1, id: 'test.plugin', name: 'Test', version: '1.0.0',
    runtime: { entry: 'plugin.cjs' }, requires: {}, contributes: { commands: [{ id: 'test.run', title: 'Run' }] },
    integrity: { 'plugin.cjs': hash('module.exports = {};') },
  });
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xue-plugin-store-'));
    source = path.join(directory, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'plugin.cjs'), 'module.exports = {};');
    await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify(manifest()));
    store = new DesktopPluginPackageStore(path.join(directory, 'installed'));
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('copies verified bytes, starts disabled, prevents in-place version replacement and preserves user data', async () => {
    const installed = await store.install(source);
    expect(installed.enabled).toBe(false);
    await fs.writeFile(path.join(source, 'plugin.cjs'), 'source changes cannot affect installed code');
    expect(await fs.readFile(path.join(installed.root, 'plugin.cjs'), 'utf8')).toBe('module.exports = {};');
    await expect(store.install(installed.root)).rejects.toThrow('version already exists');
    const data = await store.storagePath('test.plugin');
    await fs.writeFile(path.join(data, 'project.json'), 'saved user project');
    await store.remove('test.plugin');
    expect(await fs.readFile(path.join(data, 'project.json'), 'utf8')).toBe('saved user project');
    expect(await store.list()).toEqual([]);
  });
  it('rejects altered and unlisted files before registration', async () => {
    await fs.writeFile(path.join(source, 'plugin.cjs'), 'modified');
    await expect(store.install(source)).rejects.toThrow('integrity mismatch');
    expect(await store.list()).toEqual([]);
    await fs.writeFile(path.join(source, 'plugin.cjs'), 'module.exports = {};');
    await fs.writeFile(path.join(source, 'undeclared.js'), 'untracked');
    await expect(store.install(source)).rejects.toThrow('cover every package file');
  });
  it('rejects escaping symlinks even when their link text has a matching digest', async () => {
    const input = manifest();
    await fs.symlink('../outside', path.join(source, 'escape'));
    await fs.writeFile(path.join(directory, 'outside'), 'external');
    await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify({ ...input, integrity: { ...input.integrity, escape: hash('symlink:../outside') } }));
    await expect(store.install(source)).rejects.toThrow('escapes package');
  });
  it('preserves verified internal framework symlinks', async () => {
    await fs.mkdir(path.join(source, 'framework', 'Versions', 'A'), { recursive: true });
    await fs.writeFile(path.join(source, 'framework', 'Versions', 'A', 'binary'), 'binary');
    await fs.symlink('A', path.join(source, 'framework', 'Versions', 'Current'));
    const input = manifest();
    await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify({ ...input, integrity: {
      ...input.integrity, 'framework/Versions/A/binary': hash('binary'), 'framework/Versions/Current': hash('symlink:A'),
    } }));
    const installed = await store.install(source);
    expect(await fs.readlink(path.join(installed.root, 'framework/Versions/Current'))).toBe('A');
    expect(await fs.readFile(path.join(installed.root, 'framework/Versions/Current/binary'), 'utf8')).toBe('binary');
    await store.verify(input.id);
  });
  it('detects installed tampering on activation verification', async () => {
    const installed = await store.install(source);
    await fs.writeFile(path.join(installed.root, 'plugin.cjs'), 'tampered');
    await expect(store.verify('test.plugin')).rejects.toThrow('integrity mismatch');
  });
  it('pins the verified manifest separately so edited hashes cannot conceal package changes', async () => {
    const installed = await store.install(source);
    await fs.writeFile(path.join(installed.root, 'plugin.cjs'), 'modified');
    const edited = { ...installed.manifest, integrity: { 'plugin.cjs': hash('modified') } };
    await fs.writeFile(path.join(installed.root, 'plugin.json'), JSON.stringify(edited));
    await expect(store.verify('test.plugin')).rejects.toThrow('manifest changed');
    expect((await store.list())[0].manifest.integrity['plugin.cjs']).toBe(manifest().integrity['plugin.cjs']);
  });
});
