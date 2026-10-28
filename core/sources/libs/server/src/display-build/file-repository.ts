import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DisplayBuildRepository, DisplayBuildRun } from "../../../domain/src/persistence/display-build-port.js";

const validId = /^[a-f0-9]{64}$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Atomic files make the queue durable without coupling Core to an ORM.
 * Lock directories serialize CAS across processes. A dead process's lock is reclaimed. */
export class FileDisplayBuildRepository implements DisplayBuildRepository {
  constructor(readonly directory: string) {}
  private path(id: string) {
    if (!validId.test(id)) throw Error("Invalid display build ID");
    return join(this.directory, `${id}.json`);
  }
  async get(id: string): Promise<DisplayBuildRun | null> {
    try { return JSON.parse(await readFile(this.path(id), "utf8")) as DisplayBuildRun; }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  async list(): Promise<readonly DisplayBuildRun[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
    const reads = await Promise.allSettled(files.map(file => this.get(file.slice(0, -5))));
    // One damaged job is reported as unavailable on read; it cannot starve other jobs.
    return reads.flatMap(read => read.status === "fulfilled" && read.value ? [read.value] : []);
  }
  private async locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = `${this.path(id)}.lock`;
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(lock);
        const owner = await open(join(lock, "owner"), "wx");
        await owner.writeFile(String(process.pid));
        await owner.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let pid = 0;
        try { pid = Number(await readFile(join(lock, "owner"), "utf8")); } catch { /* Other worker is writing owner. */ }
        if (pid > 0) {
          try { process.kill(pid, 0); }
          catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === "ESRCH") { await rm(lock, { recursive: true, force: true }); continue; }
          }
        } else {
          // Recover a process interrupted between mkdir and writing the owner.
          const info = await stat(lock).catch(() => null);
          if (info && Date.now() - info.mtimeMs > 30_000) { await rm(lock, {recursive: true, force: true}); continue; }
        }
        if (attempt >= 200) throw Error("Display build persistence is busy");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    try { return await operation(); }
    finally { await rm(lock, { recursive: true, force: true }); }
  }
  private async write(run: DisplayBuildRun) {
    const destination = this.path(run.id), temporary = `${destination}.${randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(run)); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  }
  create(run: DisplayBuildRun): Promise<DisplayBuildRun> {
    return this.locked(run.id, async () => {
      const existing = await this.get(run.id);
      if (existing) return existing;
      await this.write(run);
      return run;
    });
  }
  replace(run: DisplayBuildRun, expectedRevision: number): Promise<boolean> {
    return this.locked(run.id, async () => {
      const existing = await this.get(run.id);
      if (!existing || existing.revision !== expectedRevision) return false;
      if (run.id !== existing.id || run.ownerUserId !== existing.ownerUserId || run.sourceHash !== existing.sourceHash
        || run.scopeKey !== existing.scopeKey || run.inputRevision !== existing.inputRevision
        || run.kind !== existing.kind || run.componentVersion !== existing.componentVersion
        || JSON.stringify(run.input) !== JSON.stringify(existing.input) || run.revision !== expectedRevision + 1)
        throw Error("A display build cannot change its owned input");
      await this.write(run);
      return true;
    });
  }
}
