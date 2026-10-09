import {
  sidecarBootstrapSchema,
  type SidecarBootstrap,
  type SidecarProcess,
} from "./protocol.ts";
import {
  SIDECAR_READY_TIMEOUT_MS,
  SIDECAR_RESTART_DELAYS_MS,
  SidecarSupervisor,
} from "./supervisor.ts";

class FakeProcess implements SidecarProcess {
  pid = 42;
  bootstrap: SidecarBootstrap | null = null;
  killed = false;
  afterBootstrap: ((bootstrap: SidecarBootstrap) => void) | null = null;
  private messageListeners: Array<(message: unknown) => void> = [];
  private exitListeners: Array<(code: number | null) => void> = [];

  onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.push(listener);
  }
  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }
  sendBootstrap(bootstrap: SidecarBootstrap): void {
    this.bootstrap = bootstrap;
    if (this.afterBootstrap)
      queueMicrotask(() => this.afterBootstrap?.(bootstrap));
  }
  sendMessage(_message: unknown): void {}
  async kill(): Promise<void> {
    this.killed = true;
    this.exitListeners.forEach((listener) => listener(0));
  }
  emitMessage(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }
  emitExit(code: number | null): void {
    this.exitListeners.forEach((listener) => listener(code));
  }
}

const bootstrapData = {
  appVersion: "0.1.0",
  os: "macos" as const,
  arch: "arm64",
  dataPath: "/private/data",
  rendererPath: "/app/renderer",
  resourceRoot: "/app/resources",
  embeddingModelRoot: "/app/resources/local-embedding-model",
  embeddingModelManifestPath:
    "/app/resources/local-embedding-model/manifest.json",
  credentials: { openai: { apiKey: "provider-secret" } },
  workspaceId: "2f551cc2-c374-4bc0-9701-b24d3890d8ab",
  syncEnabled: false,
  syncWorkspaceKey: null,
};

const launchToken = "ab".repeat(32);

function emitReady(process: FakeProcess, port: number): void {
  process.emitMessage({
    type: "xuelearn.local.ready",
    instanceId: process.bootstrap?.instanceId,
    port,
    schemaVersion: 1,
  });
}

describe("SidecarSupervisor", () => {
  it("allows a fresh local database enough time to migrate and initialize", () => {
    expect(SIDECAR_READY_TIMEOUT_MS).toBe(120_000);
  });

  it("passes token and credentials through bootstrap and publishes loopback health", async () => {
    const process = new FakeProcess();
    const supervisor = new SidecarSupervisor({
      factory: () => process,
      loadBootstrap: async () => bootstrapData,
      createToken: () => launchToken,
    });

    const starting = supervisor.start();
    await Promise.resolve();
    expect(process.bootstrap).toEqual({
      type: "xuelearn.local.start",
      schemaVersion: 2,
      token: launchToken,
      instanceId: expect.any(String),
      ...bootstrapData,
    });
    emitReady(process, 43210);
    await expect(starting).resolves.toMatchObject({
      status: "ready",
      baseUrl: "http://127.0.0.1:43210",
    });
    expect(supervisor.getSession()).toEqual({
      baseUrl: "http://127.0.0.1:43210",
      token: launchToken,
    });
  });

  it("uses the specified backoff after an unexpected ready-process exit", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const processes = [first, second];
    const waits: number[] = [];
    const supervisor = new SidecarSupervisor({
      factory: () => processes.shift()!,
      loadBootstrap: async () => bootstrapData,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    const started = supervisor.start();
    await Promise.resolve();
    emitReady(first, 41001);
    await started;
    first.emitExit(9);
    await new Promise((resolve) => setImmediate(resolve));
    expect(waits).toEqual([SIDECAR_RESTART_DELAYS_MS[0]]);
    expect(supervisor.getHealth().status).toBe("starting");
    emitReady(second, 41002);
    await new Promise((resolve) => setImmediate(resolve));
    supervisor.stop();
  });

  it("runs beforeLaunch before forking a replacement process", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const queue = [first, second];
    const events: string[] = [];
    const supervisor = new SidecarSupervisor({
      factory: () => {
        events.push("launched");
        return queue.shift()!;
      },
      beforeLaunch: async () => {
        events.push("reclaim");
      },
      loadBootstrap: async () => bootstrapData,
    });
    const started = supervisor.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(["reclaim", "launched"]);
    emitReady(first, 41001);
    await started;
    events.length = 0;
    const restarted = supervisor.restart();
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(["reclaim", "launched"]);
    emitReady(second, 41002);
    await restarted;
    supervisor.stop();
  });

  it("restarts an in-flight launch without failing closed", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const queue = [first, second];
    const supervisor = new SidecarSupervisor({
      factory: () => queue.shift()!,
      loadBootstrap: async () => bootstrapData,
    });
    const started = supervisor.start();
    await Promise.resolve();
    const restarted = supervisor.restart();
    await new Promise((resolve) => setImmediate(resolve));
    expect(first.killed).toBe(true);
    emitReady(second, 41002);
    await expect(started).resolves.toMatchObject({ status: "ready" });
    await expect(restarted).resolves.toMatchObject({
      status: "ready",
      instanceId: second.bootstrap?.instanceId,
    });
    expect(supervisor.getHealth().lastError).toBeNull();
    supervisor.stop();
  });

  it("coalesces overlapping restarts without treating SIGTERM as a crash", async () => {
    const processes = Array.from({ length: 5 }, () => new FakeProcess());
    const queue = [...processes];
    const supervisor = new SidecarSupervisor({
      factory: () => queue.shift()!,
      loadBootstrap: async () => bootstrapData,
    });
    const started = supervisor.start();
    await Promise.resolve();
    emitReady(processes[0], 41001);
    await started;

    const restarts = [
      supervisor.restart(),
      supervisor.restart(),
      supervisor.restart(),
    ];
    for (let round = 0; round < 8; round += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      processes.forEach((process, index) => {
        if (process.bootstrap) emitReady(process, 41100 + index);
      });
    }
    await expect(Promise.all(restarts)).resolves.toEqual([
      expect.objectContaining({ status: "ready" }),
      expect.objectContaining({ status: "ready" }),
      expect.objectContaining({ status: "ready" }),
    ]);
    expect(supervisor.getHealth()).toMatchObject({
      status: "ready",
      lastError: null,
    });
    supervisor.stop();
  });

  it("kills the previous process on an explicit restart", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const queue = [first, second];
    const supervisor = new SidecarSupervisor({
      factory: () => queue.shift()!,
      loadBootstrap: async () => bootstrapData,
    });
    const started = supervisor.start();
    await Promise.resolve();
    emitReady(first, 41001);
    await started;
    const restarted = supervisor.restart();
    await new Promise((resolve) => setImmediate(resolve));
    expect(first.killed).toBe(true);
    emitReady(second, 41002);
    await expect(restarted).resolves.toMatchObject({
      instanceId: second.bootstrap?.instanceId,
    });
    supervisor.stop();
  });

  it("waits for the previous process to exit before launching its replacement", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    let finishExit: (() => void) | undefined;
    first.kill = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishExit = resolve;
        }),
    );
    const factory = jest
      .fn<SidecarProcess, []>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const supervisor = new SidecarSupervisor({
      factory,
      loadBootstrap: async () => bootstrapData,
    });
    const started = supervisor.start();
    await Promise.resolve();
    emitReady(first, 41001);
    await started;

    const restarted = supervisor.restart();
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);
    finishExit?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(factory).toHaveBeenCalledTimes(2);
    emitReady(second, 41002);
    await restarted;
    supervisor.stop();
  });

  it("runs reset work after shutdown and before launching a fresh process", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const events: string[] = [];
    first.kill = jest.fn(async () => {
      events.push("stopped");
    });
    const queue = [first, second];
    const supervisor = new SidecarSupervisor({
      factory: () => {
        events.push("launched");
        return queue.shift()!;
      },
      loadBootstrap: async () => bootstrapData,
    });
    const started = supervisor.start();
    await Promise.resolve();
    emitReady(first, 41001);
    await started;
    events.length = 0;

    const restarted = supervisor.restartAfter(() => {
      events.push("reset");
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(["stopped", "reset", "launched"]);
    emitReady(second, 41002);
    await restarted;
    supervisor.stop();
  });

  it("retries startup failures with the complete bounded backoff then fails closed", async () => {
    const processes = Array.from({ length: 4 }, () => new FakeProcess());
    for (const process of processes) {
      process.afterBootstrap = () =>
        process.emitMessage({
          type: "xuelearn.local.fatal",
          message: "startup failed",
        });
    }
    const queue = [...processes];
    const waits: number[] = [];
    const supervisor = new SidecarSupervisor({
      factory: () => queue.shift()!,
      loadBootstrap: async () => bootstrapData,
      createToken: () => launchToken,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    await expect(supervisor.start()).rejects.toThrow("startup failed");
    expect(waits).toEqual([...SIDECAR_RESTART_DELAYS_MS]);
    expect(processes.every((process) => process.killed)).toBe(true);
    expect(supervisor.getHealth()).toMatchObject({
      status: "failed",
      lastError: "startup failed",
    });
  });

  it("prunes old startup failures from the rolling failure window", async () => {
    let now = 1_000;
    const processes = Array.from({ length: 4 }, () => new FakeProcess());
    processes.slice(0, 3).forEach((process) => {
      process.afterBootstrap = () =>
        process.emitMessage({
          type: "xuelearn.local.fatal",
          message: "transient",
        });
    });
    processes[3].afterBootstrap = () => emitReady(processes[3], 42000);
    const queue = [...processes];
    const waits: number[] = [];
    const supervisor = new SidecarSupervisor({
      factory: () => queue.shift()!,
      loadBootstrap: async () => bootstrapData,
      createToken: () => launchToken,
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        now += 60_001;
      },
    });

    await expect(supervisor.start()).resolves.toMatchObject({
      status: "ready",
    });
    expect(waits).toEqual([250, 250, 250]);
    supervisor.stop();
  });

  it("uses the unified bootstrap shape and rejects legacy token fields", () => {
    const valid = {
      type: "xuelearn.local.start",
      schemaVersion: 2,
      token: launchToken,
      instanceId: "15b875b7-1188-42cc-931c-3e4f07421a98",
      ...bootstrapData,
    };
    expect(sidecarBootstrapSchema.parse(valid)).toEqual(valid);
    expect(
      sidecarBootstrapSchema.safeParse({ ...valid, sessionToken: launchToken })
        .success,
    ).toBe(false);
    expect(
      sidecarBootstrapSchema.safeParse({ ...valid, type: "bootstrap" }).success,
    ).toBe(false);
  });
});

describe("workspace retention while recovering", () => {
  it("retains initial startup and ready-process crash recovery until the retention service can answer", async () => {
    const first = new FakeProcess(), second = new FakeProcess();
    const queue = [first, second];
    const supervisor = new SidecarSupervisor({ factory: () => queue.shift()!, loadBootstrap: async () => bootstrapData, wait: async () => undefined });
    expect(await supervisor.prepareStop()).toBe(true);
    const starting = supervisor.start();
    expect(await supervisor.canStop()).toBe(false);
    expect(await supervisor.prepareStop()).toBe(false);
    await Promise.resolve(); emitReady(first, 43001); await starting;
    first.emitExit(9);
    expect(await supervisor.prepareStop()).toBe(false);
    await new Promise(resolve => setImmediate(resolve));
    expect(await supervisor.canStop()).toBe(false);
    emitReady(second, 43002);
    await new Promise(resolve => setImmediate(resolve));
    supervisor.stop();
  });

  it("fails closed when a ready child's drain request hangs and bounds resume calls", async () => {
    const child = new FakeProcess();
    const supervisor = new SidecarSupervisor({ factory: () => child, loadBootstrap: async () => bootstrapData, retentionTimeoutMs: 5 });
    const started = supervisor.start(); await Promise.resolve(); emitReady(child, 43003); await started;
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("retention timeout")), { once: true });
    }));
    try {
      expect(await supervisor.prepareStop()).toBe(false);
      expect(await supervisor.canStop()).toBe(false);
      await supervisor.resumeAccepting();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(child.killed).toBe(false);
    } finally { fetchMock.mockRestore(); supervisor.stop(); }
  });
});
