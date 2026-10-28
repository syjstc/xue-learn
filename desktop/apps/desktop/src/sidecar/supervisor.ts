import { randomBytes, randomUUID } from "node:crypto";
import type { SidecarHealth } from "@xue-learn/core/runtime-contracts";
import {
  type SidecarBootstrap,
  type SidecarProcess,
  type SidecarProcessFactory,
  sidecarBootstrapSchema,
  sidecarMessageSchema,
  type SidecarCodexAuthRequest,
} from "./protocol.ts";

export const SIDECAR_RESTART_DELAYS_MS = [250, 1_000, 4_000] as const;
export const SIDECAR_FAILURE_WINDOW_MS = 60_000;
export const SIDECAR_READY_TIMEOUT_MS = 120_000;
export const SIDECAR_RETENTION_TIMEOUT_MS = 5_000;

class SidecarLaunchSupersededError extends Error {
  constructor() {
    super("Local service launch was superseded");
    this.name = "SidecarLaunchSupersededError";
  }
}

export type SidecarBootstrapSource = (
  token: string,
) => Promise<
  Omit<SidecarBootstrap, "type" | "schemaVersion" | "token" | "instanceId">
>;

export type SupervisorOptions = {
  factory: SidecarProcessFactory;
  loadBootstrap: SidecarBootstrapSource;
  beforeLaunch?: () => Promise<void>;
  readyTimeoutMs?: number;
  retentionTimeoutMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  createToken?: () => string;
  healthProbe?: (session: { baseUrl: string; token: string }) => Promise<void>;
  onHealthChanged?: (health: SidecarHealth) => void;
  onMessage?: (
    message: SidecarCodexAuthRequest,
    process: SidecarProcess,
  ) => void;
};

type Running = {
  process: SidecarProcess;
  token: string;
  expectedExit: boolean;
};

export class SidecarSupervisor {
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly createToken: () => string;
  private running: Running | null = null;
  private failures: number[] = [];
  private startPromise: Promise<SidecarHealth> | null = null;
  private stopping = false;
  private epoch = 0;
  private relaunchGate: Promise<void> | null = null;
  private health: SidecarHealth = {
    status: "stopped",
    instanceId: null,
    baseUrl: null,
    schemaVersion: null,
    lastError: null,
  };

  constructor(private readonly options: SupervisorOptions) {
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.createToken =
      options.createToken ?? (() => randomBytes(32).toString("hex"));
  }

  getHealth(): SidecarHealth {
    return { ...this.health };
  }

  getSession(): { baseUrl: string; token: string } | null {
    if (!this.running || this.health.status !== "ready" || !this.health.baseUrl)
      return null;
    return { baseUrl: this.health.baseUrl, token: this.running.token };
  }

  /** Windows are clients of a workspace service, not its lifetime owner. */
  async canStop(): Promise<boolean> {
    const session = this.getSession();
    if (!session) return this.running === null && this.startPromise === null && ["stopped", "failed"].includes(this.health.status);
    try {
      const response = await fetch(`${session.baseUrl}/api/workspace-service/retention`, {headers: {Authorization: `Bearer ${session.token}`}, signal: AbortSignal.timeout(this.options.retentionTimeoutMs ?? SIDECAR_RETENTION_TIMEOUT_MS)});
      if (!response.ok) return false;
      const retention = await response.json() as {canStop?: boolean};
      return retention.canStop === true;
    } catch { return false; }
  }

  async prepareStop(): Promise<boolean> {
    const session=this.getSession();if(!session)return this.running === null && this.startPromise === null && ["stopped", "failed"].includes(this.health.status);
    try {
      const response=await fetch(`${session.baseUrl}/api/workspace-service/drain`,{method:"POST",headers:{Authorization:`Bearer ${session.token}`,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(this.options.retentionTimeoutMs ?? SIDECAR_RETENTION_TIMEOUT_MS)});
      return response.ok&&(await response.json() as {canStop?:boolean}).canStop===true;
    } catch {return false;}
  }
  async resumeAccepting(): Promise<void> {
    const session=this.getSession();if(!session)return;
    await fetch(`${session.baseUrl}/api/workspace-service/resume`,{method:"POST",headers:{Authorization:`Bearer ${session.token}`,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(this.options.retentionTimeoutMs ?? SIDECAR_RETENTION_TIMEOUT_MS)}).catch(()=>undefined);
  }

  start(): Promise<SidecarHealth> {
    if (this.health.status === "ready")
      return Promise.resolve(this.getHealth());
    return this.beginStart();
  }

  private beginStart(): Promise<SidecarHealth> {
    if (this.startPromise) return this.startPromise;
    this.stopping = false;
    const pending = this.startUntilReady().finally(() => {
      if (this.startPromise === pending) this.startPromise = null;
    });
    this.startPromise = pending;
    return pending;
  }

  private async startUntilReady(): Promise<SidecarHealth> {
    while (!this.stopping) {
      try {
        return await this.launch();
      } catch (error) {
        if (error instanceof SidecarLaunchSupersededError) {
          if (this.relaunchGate) await this.relaunchGate;
          continue;
        }
        const failures = this.pruneFailures();
        if (failures.length > SIDECAR_RESTART_DELAYS_MS.length) throw error;
        this.setHealth({
          status: "restarting",
          lastError: error instanceof Error ? error.message : String(error),
        });
        await this.wait(SIDECAR_RESTART_DELAYS_MS[failures.length - 1]);
      }
    }
    throw new Error("Local service startup was cancelled");
  }

  async restart(): Promise<SidecarHealth> {
    this.epoch += 1;
    this.setHealth({ status: "restarting", lastError: null });
    this.stopping = false;
    await this.stopProcess();
    return this.startPromise ?? this.beginStart();
  }

  async restartAfter(work: () => void | Promise<void>): Promise<SidecarHealth> {
    this.epoch += 1;
    this.setHealth({ status: "restarting", lastError: null });
    this.stopping = false;
    let releaseGate: () => void = () => undefined;
    this.relaunchGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    await this.stopProcess();
    try {
      await work();
    } finally {
      releaseGate();
      this.relaunchGate = null;
    }
    return this.startPromise ?? this.beginStart();
  }

  stop(): void {
    this.stopping = true;
    void this.stopProcess();
    this.setHealth({
      status: "stopped",
      instanceId: null,
      baseUrl: null,
      schemaVersion: null,
      lastError: null,
    });
  }

  private async launch(): Promise<SidecarHealth> {
    this.setHealth({
      status: "starting",
      instanceId: null,
      baseUrl: null,
      schemaVersion: null,
      lastError: null,
    });
    if (this.options.beforeLaunch) await this.options.beforeLaunch();
    const token = this.createToken();
    const bootstrapData = await this.options.loadBootstrap(token);
    const process = this.options.factory();
    const epoch = this.epoch;
    const running: Running = { process, token, expectedExit: false };
    this.running = running;

    const bootstrap: SidecarBootstrap = sidecarBootstrapSchema.parse({
      type: "xuelearn.local.start",
      schemaVersion: 2,
      token,
      instanceId: randomUUID(),
      ...bootstrapData,
    });

    return new Promise<SidecarHealth>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(
        () => fail(new Error("Local service did not become ready in time")),
        this.options.readyTimeoutMs ?? SIDECAR_READY_TIMEOUT_MS,
      );

      const settle = (error: Error, record: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        let stopped = Promise.resolve();
        if (this.running === running) {
          running.expectedExit = true;
          stopped = process.kill();
          this.running = null;
        }
        if (record) {
          this.recordFailure(error.message);
          this.setHealth({ status: "failed", lastError: error.message });
        }
        void stopped.then(
          () => reject(error),
          () => reject(error),
        );
      };
      const fail = (error: Error) => settle(error, true);
      const supersede = () => settle(new SidecarLaunchSupersededError(), false);

      process.onMessage((raw) => {
        const parsed = sidecarMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        if (parsed.data.type === "xuelearn.codex.auth.request") {
          this.options.onMessage?.(parsed.data, process);
          return;
        }
        if (parsed.data.type === "xuelearn.local.fatal") {
          fail(new Error(parsed.data.message));
          return;
        }
        if (parsed.data.instanceId !== bootstrap.instanceId) {
          fail(new Error("Local service returned a mismatched instance ID"));
          return;
        }
        if (settled || this.running !== running) return;
        const baseUrl = `http://127.0.0.1:${parsed.data.port}`;
        this.setHealth({
          status: "starting",
          instanceId: parsed.data.instanceId,
          baseUrl,
          schemaVersion: parsed.data.schemaVersion,
          lastError: null,
        });
        void (
          this.options.healthProbe?.({ baseUrl, token }) ?? Promise.resolve()
        )
          .then(() => {
            if (settled || this.running !== running) return;
            settled = true;
            clearTimeout(timeout);
            this.setHealth({ status: "ready" });
            resolve(this.getHealth());
          })
          .catch((error) =>
            fail(error instanceof Error ? error : new Error(String(error))),
          );
      });

      process.onExit((code) => {
        if (this.running === running) this.running = null;
        if (
          running.expectedExit ||
          this.stopping ||
          epoch !== this.epoch
        ) {
          if (!settled) supersede();
          return;
        }
        const message = `Local service exited unexpectedly${code === null ? "" : ` (code ${code})`}`;
        if (!settled) {
          fail(new Error(message));
          return;
        }
        void this.recover(message, epoch);
      });

      try {
        process.sendBootstrap(bootstrap);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async recover(message: string, epoch: number): Promise<void> {
    this.recordFailure(message);
    const recentFailures = this.pruneFailures();
    if (recentFailures.length > SIDECAR_RESTART_DELAYS_MS.length) {
      this.setHealth({ status: "failed", lastError: message });
      return;
    }
    this.setHealth({ status: "restarting", lastError: message });
    await this.wait(SIDECAR_RESTART_DELAYS_MS[recentFailures.length - 1]);
    if (
      this.stopping ||
      this.health.status === "failed" ||
      epoch !== this.epoch
    )
      return;
    try {
      await this.start();
    } catch {
      // launch records the failure; another unexpected exit or explicit restart may recover.
    }
  }

  private recordFailure(message: string): void {
    this.failures.push(this.now());
    this.pruneFailures();
    this.setHealth({ lastError: message });
  }

  private pruneFailures(): number[] {
    const cutoff = this.now() - SIDECAR_FAILURE_WINDOW_MS;
    this.failures = this.failures.filter((at) => at >= cutoff);
    return this.failures;
  }

  private async stopProcess(): Promise<void> {
    if (!this.running) return;
    const running = this.running;
    running.expectedExit = true;
    this.running = null;
    await running.process.kill();
  }

  private setHealth(patch: Partial<SidecarHealth>): void {
    this.health = { ...this.health, ...patch };
    this.options.onHealthChanged?.(this.getHealth());
  }
}
