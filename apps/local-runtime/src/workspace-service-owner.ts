import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { resolve } from "node:path";
import { workspaceServiceDiscoverySchema, type WorkspaceServiceDiscovery } from "@xue-learn/core/runtime-contracts";

/** An OS-exclusive guard avoids PID reuse and stale-file cleanup races. */
export function workspaceServiceGuardPort(dataPath: string): number {
  return 49152 + createHash("sha256").update(realpathSync(dataPath)).digest().readUInt32BE(0) % 16384;
}
export class WorkspaceServiceOwner {
  private released = false;
  readonly epoch = randomUUID();
  private readonly lockPath: string;
  readonly discoveryPath: string;
  private constructor(readonly dataPath: string, readonly workspaceId: string, readonly instanceId: string,
    readonly pid: number, private readonly guard: Server) {
    this.lockPath = resolve(dataPath, ".workspace-service.lock");
    this.discoveryPath = resolve(dataPath, "workspace-service.v1.json");
  }
  static async acquire(input: { dataPath: string; workspaceId: string; instanceId: string }): Promise<WorkspaceServiceOwner> {
    mkdirSync(resolve(input.dataPath), {recursive: true, mode: 0o700});
    const directory = realpathSync(input.dataPath);
    const guard = createServer(socket => socket.destroy());
    const owner = new WorkspaceServiceOwner(directory, input.workspaceId, input.instanceId, process.pid, guard);
    try {
      await new Promise<void>((resolveReady, reject) => {
        guard.once("error", reject);
        guard.listen({host: "127.0.0.1", port: workspaceServiceGuardPort(directory), exclusive: true}, () => {
          guard.removeListener("error", reject); resolveReady();
        });
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        const discovery = owner.discover();
        throw new Error(`WORKSPACE_SERVICE_ALREADY_RUNNING: Connect to the existing compatible workspace service${discovery ? ` at ${discovery.endpoint}` : "; its ownership guard is busy"}`);
      }
      throw error;
    }
    try {
      // Only the process holding the OS guard can replace crash-left metadata.
      rmSync(owner.lockPath, {recursive: true, force: true});
      mkdirSync(owner.lockPath, {mode: 0o700});
      writeFileSync(resolve(owner.lockPath, "owner.json"), JSON.stringify({workspaceId: owner.workspaceId,
        instanceId: owner.instanceId, epoch: owner.epoch, pid: owner.pid}), {flag: "wx", mode: 0o600});
      return owner;
    } catch (error) { await owner.release(); throw error; }
  }
  discover(): WorkspaceServiceDiscovery | null {
    if (!existsSync(this.discoveryPath)) return null;
    try {
      const discovery = workspaceServiceDiscoverySchema.parse(JSON.parse(readFileSync(this.discoveryPath, "utf8")));
      return discovery.workspaceId === this.workspaceId ? discovery : null;
    } catch { return null; }
  }
  publish(input: Omit<WorkspaceServiceDiscovery, "workspaceId" | "instanceId" | "epoch" | "pid">) {
    if (this.released) throw new Error("Workspace service ownership was released");
    const discovery = workspaceServiceDiscoverySchema.parse({...input, workspaceId: this.workspaceId,
      instanceId: this.instanceId, epoch: this.epoch, pid: this.pid});
    const temporary = `${this.discoveryPath}.${this.epoch}.tmp`;
    writeFileSync(temporary, JSON.stringify(discovery), {mode: 0o600});
    renameSync(temporary, this.discoveryPath);
  }
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    try {
      const current = JSON.parse(readFileSync(resolve(this.lockPath, "owner.json"), "utf8"));
      if (current.epoch === this.epoch) {
        const discovery = this.discover();
        if (discovery?.epoch === this.epoch) rmSync(this.discoveryPath, {force: true});
        rmSync(this.lockPath, {recursive: true, force: true});
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    finally { await new Promise<void>(resolveClosed => this.guard.close(() => resolveClosed())); }
  }
}
