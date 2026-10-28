import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { DesktopPluginManifest, isPluginIdentifier, parseDesktopPluginManifest } from '../../../../packages/plugin-sdk/src';

// Electron's fs transparently opens .asar files as virtual directories. A package
// inventory must hash/copy their physical bytes exactly as the packaging tool did.
const fs: typeof nodeFs = process.versions.electron
  ? (createRequire(__filename)('original-fs') as typeof import('node:fs')).promises
  : nodeFs;

export interface InstalledDesktopPlugin {
  manifest: DesktopPluginManifest;
  root: string;
  installedAt: string;
  enabled: boolean;
}
interface Registry { schemaVersion: 1; plugins: Record<string, { version: string; installedAt: string; enabled: boolean; manifest: DesktopPluginManifest }> }
const MAX_FILES = 100_000;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function existingFileHash(file: string): Promise<string> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
    return digest.digest('hex');
  } finally { await handle.close(); }
}

/** Walk physical files once; safe internal symlinks support signed macOS framework bundles. */
async function inspectPackage(root: string): Promise<{ manifest: DesktopPluginManifest; files: Map<string, { symlink?: string; mode: number }> }> {
  if (!(await fs.lstat(root)).isDirectory()) throw new Error('Plugin source must be a real directory');
  const physicalRoot = await fs.realpath(root);
  const manifestFile = path.join(root, 'plugin.json');
  const manifestStat = await fs.lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.size > 1024 * 1024) throw new Error('Invalid plugin.json file');
  const manifest = parseDesktopPluginManifest(JSON.parse(await fs.readFile(manifestFile, 'utf8')));
  const files = new Map<string, { symlink?: string; mode: number }>();
  let size = 0;
  async function walk(directory: string): Promise<void> {
    for (const name of await fs.readdir(directory)) {
      const full = path.join(directory, name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(full);
        if (path.isAbsolute(target) || !contained(physicalRoot, await fs.realpath(full))) throw new Error(`Plugin symlink escapes package: ${relative}`);
        files.set(relative, { symlink: target, mode: stat.mode });
      } else if (stat.isDirectory()) {
        await walk(full);
      } else if (stat.isFile()) {
        if (relative === 'plugin.json') continue;
        size += stat.size;
        files.set(relative, { mode: stat.mode });
      } else throw new Error(`Unsupported plugin package file: ${relative}`);
      if (files.size > MAX_FILES || size > MAX_BYTES) throw new Error('Plugin package exceeds installation limit');
    }
  }
  await walk(root);
  const declared = Object.keys(manifest.integrity);
  if (declared.length !== files.size) {
    const missing = declared.filter(file => !files.has(file)).slice(0, 6);
    const unlisted = [...files.keys()].filter(file => !Object.hasOwn(manifest.integrity, file)).slice(0, 6);
    throw new Error(`Plugin integrity must cover every package file (expected ${declared.length}, found ${files.size}; missing: ${missing.join(', ') || 'none'}; unlisted: ${unlisted.join(', ') || 'none'})`);
  }
  for (const [relative, metadata] of files) {
    if (!Object.hasOwn(manifest.integrity, relative)) throw new Error(`Unlisted plugin file: ${relative}`);
    const hash = metadata.symlink !== undefined
      ? createHash('sha256').update(`symlink:${metadata.symlink}`).digest('hex')
      : await existingFileHash(path.join(root, relative));
    if (hash !== manifest.integrity[relative]) throw new Error(`Plugin integrity mismatch: ${relative}`);
  }
  if (manifest.runtime && !files.has(manifest.runtime.entry)) throw new Error('Missing plugin runtime entry');
  for (const display of manifest.contributes.displayPackages ?? []) {
    const full = path.join(root, display);
    if (!(await fs.stat(full)).isDirectory() || !contained(physicalRoot, await fs.realpath(full))) throw new Error(`Invalid display package directory: ${display}`);
  }
  return { manifest, files };
}

/** Package bytes are copied into versioned directories. User data has a separate, retained root. */
export class DesktopPluginPackageStore {
  constructor(readonly root: string) {}

  private async registry(): Promise<Registry> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.root, 'registry.json'), 'utf8')) as Registry;
      if (raw.schemaVersion !== 1 || !raw.plugins || typeof raw.plugins !== 'object' || Array.isArray(raw.plugins)) throw new Error('Invalid plugin registry');
      for (const [id, record] of Object.entries(raw.plugins)) {
        if (!isPluginIdentifier(id) || !record || typeof record !== 'object' || typeof record.enabled !== 'boolean'
          || typeof record.installedAt !== 'string' || typeof record.version !== 'string'
          || !/^[0-9A-Za-z.-]+$/.test(record.version) || record.version.includes('..')) throw new Error('Invalid plugin registry record');
        const manifest = parseDesktopPluginManifest(record.manifest);
        if (manifest.id !== id || manifest.version !== record.version) throw new Error(`Plugin registry identity mismatch: ${id}`);
        record.manifest = manifest;
      }
      return raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, plugins: {} };
      throw error;
    }
  }

  private async save(registry: Registry): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.root, `registry-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, path.join(this.root, 'registry.json'));
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private versionRoot(id: string, version: string): string { return path.join(this.root, 'packages', id, version); }
  async list(): Promise<InstalledDesktopPlugin[]> {
    const registry = await this.registry();
    return Object.entries(registry.plugins).map(([id, record]) => {
      const root = this.versionRoot(id, record.version);
      // Keep the verified descriptor independently: damage to one bundle must not hide all plugins.
      return { manifest: record.manifest, root, installedAt: record.installedAt, enabled: record.enabled };
    });
  }
  async get(id: string): Promise<InstalledDesktopPlugin> {
    const plugin = (await this.list()).find(item => item.manifest.id === id);
    if (!plugin) throw new Error(`Plugin is not installed: ${id}`);
    return plugin;
  }
  async verify(id: string): Promise<InstalledDesktopPlugin> {
    const installed = await this.get(id);
    const checked = await inspectPackage(installed.root);
    if (JSON.stringify(checked.manifest) !== JSON.stringify(installed.manifest)) throw new Error('Plugin manifest changed during verification');
    return installed;
  }
  async storagePath(id: string): Promise<string> {
    if (!isPluginIdentifier(id)) throw new Error('Invalid plugin id');
    const directory = path.join(this.root, 'data', id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }
  async install(directory: string): Promise<InstalledDesktopPlugin> {
    const source = path.resolve(directory);
    const { manifest, files } = await inspectPackage(source);
    const registry = await this.registry();
    const current = registry.plugins[manifest.id];
    if (current?.enabled) throw new Error('Disable the installed plugin before updating it');
    const destination = this.versionRoot(manifest.id, manifest.version);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.lstat(destination);
      throw new Error(`Plugin version already exists; publish a new version: ${manifest.id}@${manifest.version}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const staging = path.join(this.root, 'packages', `.install-${randomUUID()}`);
    try {
      await fs.mkdir(staging, { recursive: false, mode: 0o700 });
      for (const [relative, metadata] of files) {
        const target = path.join(staging, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (metadata.symlink !== undefined) await fs.symlink(metadata.symlink, target);
        else {
          await fs.copyFile(path.join(source, relative), target, constants.COPYFILE_EXCL);
          await fs.chmod(target, metadata.mode & 0o755);
        }
      }
      await fs.writeFile(path.join(staging, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
      // Verify the destination copy to detect source edits or symlink replacement during copying.
      await inspectPackage(staging);
      await fs.rename(staging, destination);
      registry.plugins[manifest.id] = { version: manifest.version, installedAt: new Date().toISOString(), enabled: false, manifest };
      await this.save(registry);
      return this.get(manifest.id);
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const registry = await this.registry();
    if (!Object.hasOwn(registry.plugins, id)) throw new Error(`Plugin is not installed: ${id}`);
    registry.plugins[id].enabled = enabled;
    await this.save(registry);
  }
  async remove(id: string): Promise<void> {
    const registry = await this.registry();
    if (!Object.hasOwn(registry.plugins, id)) throw new Error(`Plugin is not installed: ${id}`);
    if (registry.plugins[id].enabled) throw new Error('Disable the plugin before removing it');
    delete registry.plugins[id];
    await this.save(registry);
    await fs.rm(path.join(this.root, 'packages', id), { recursive: true, force: true });
    // data/<id> is deliberately preserved across removal and reinstallation.
  }
}
