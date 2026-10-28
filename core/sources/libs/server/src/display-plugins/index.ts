import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, readdir, writeFile, rename, link, unlink, lstat} from "node:fs/promises";
import {join, resolve} from "node:path";
import {validateDisplayPluginManifest} from "../../../display/src/validation.js";
import type {DisplayPluginManifest} from "../../../display/src/types.js";

export type InstalledDisplayPlugin = Readonly<{
  manifest: DisplayPluginManifest;
  sha256: string;
  builtin: boolean;
  enabled: boolean;
}>;
type StoredPlugin = {format: 1; manifest: DisplayPluginManifest; sha256: string; enabled: boolean};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function content(manifest: DisplayPluginManifest) {
  const {integrity: _integrity, ...body} = manifest;
  const sha256 = createHash("sha256").update(canonical(body)).digest("hex");
  if (manifest.integrity && manifest.integrity !== `sha256-${sha256}`) throw new Error("Display plugin integrity does not match its content");
  return {manifest: {...body, integrity: `sha256-${sha256}`} as DisplayPluginManifest, sha256};
}

/** A workspace keeps immutable published versions, including disabled versions
 * referenced by older courses. Public packages are declarative JSON only. */
export class DisplayPluginStore {
  readonly directory: string;
  constructor(directory: string, private readonly builtins: readonly DisplayPluginManifest[] = []) {
    this.directory = resolve(directory);
  }
  private async prepare() {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Display plugin directory must be a workspace-owned directory");
  }
  private filename(id: string, version: string) {
    return join(this.directory, createHash("sha256").update(`${id}\0${version}`).digest("hex") + ".json");
  }
  private async read(filename: string): Promise<StoredPlugin> {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error("Invalid installed display plugin file");
    const saved = JSON.parse(await readFile(filename, "utf8")) as StoredPlugin;
    if (saved.format !== 1 || typeof saved.enabled !== "boolean") throw new Error("Invalid installed display plugin record");
    this.validatePublic(saved.manifest);
    const checked = content(saved.manifest);
    if (saved.sha256 !== checked.sha256 || filename !== this.filename(saved.manifest.id, saved.manifest.version)) throw new Error("Installed display plugin integrity check failed");
    return {...saved, manifest: checked.manifest};
  }
  private validatePublic(value: unknown): asserts value is DisplayPluginManifest {
    const errors = validateDisplayPluginManifest(value);
    if (errors.length) throw new Error(errors.map(error => error.message).join("; "));
    const manifest = value as DisplayPluginManifest;
    if (manifest.execution !== "declarative") throw new Error("Imported display plugins must use declarative components");
    if (manifest.builders?.length) throw new Error("Imported display plugins cannot install executable builders");
    if (this.builtins.some(builtin => builtin.id === manifest.id)) throw new Error("An installed display plugin cannot replace a built-in package");
  }
  async list(): Promise<readonly InstalledDisplayPlugin[]> {
    await this.prepare();
    const installed = await Promise.all((await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(async name => ({...await this.read(join(this.directory, name)), builtin: false})));
    return [...this.builtins.map(manifest => ({manifest, sha256: createHash("sha256").update(canonical(manifest)).digest("hex"), builtin: true, enabled: true})), ...installed];
  }
  async manifests(options: {forGeneration?: boolean} = {}): Promise<readonly DisplayPluginManifest[]> {
    return (await this.list()).filter(item => !options.forGeneration || item.enabled).map(item => item.manifest);
  }
  async install(value: unknown): Promise<InstalledDisplayPlugin> {
    if (Buffer.byteLength(JSON.stringify(value) ?? "") > 2 * 1024 * 1024) throw new Error("Display plugin package exceeds 2 MiB");
    this.validatePublic(value);
    const checked = content(value);
    await this.prepare();
    const filename = this.filename(value.id, value.version);
    const saved: StoredPlugin = {format: 1, ...checked, enabled: true};
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(saved) + "\n", {flag: "wx", mode: 0o600});
    try {
      try { await link(temporary, filename); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const previous = await this.read(filename);
        if (previous.sha256 !== checked.sha256) throw new Error("A published display plugin version is immutable; increase its version before importing changes");
        return {...previous, builtin: false};
      }
      return {...saved, builtin: false};
    } finally { await unlink(temporary); }
  }
  async setEnabled(id: string, version: string, enabled: boolean): Promise<InstalledDisplayPlugin> {
    await this.prepare();
    const filename = this.filename(id, version);
    const saved = {...await this.read(filename), enabled};
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(saved) + "\n", {flag: "wx", mode: 0o600});
    try { await rename(temporary, filename); }
    finally { await unlink(temporary).catch(error => {if (error.code !== "ENOENT") throw error;}); }
    return {...saved, builtin: false};
  }
}
