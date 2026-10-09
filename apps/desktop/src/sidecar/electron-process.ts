import { dirname } from "node:path";
import {
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import type { SidecarBootstrap, SidecarProcess } from "./protocol.ts";
import {
  shouldLogSidecarOutput,
  sidecarUtilityProcessForkOptions,
} from "./utility-process-options.ts";

function redactSidecarLog(chunk: Buffer | string): string {
  return String(chunk)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[A-Fa-f0-9]{48,}/g, "[redacted]");
}

export class ElectronSidecarProcess implements SidecarProcess {
  private readonly child: UtilityProcess;

  constructor(entryPoint: string) {
    this.child = utilityProcess.fork(entryPoint, [], {
      ...sidecarUtilityProcessForkOptions(),
      cwd: dirname(entryPoint),
    });
    // Never echo sidecar output in product builds: provider SDKs may include
    // secrets in failures. Desktop-dev and isolated E2E runs keep redacted
    // diagnostics so native crashes are visible in the orchestrator log.
    if (shouldLogSidecarOutput()) {
      const forward = (label: string, chunk: Buffer | string) => {
        process.stderr.write(`[${label}] ${redactSidecarLog(chunk)}`);
      };
      this.child.stdout?.on("data", (chunk) => forward("sidecar", chunk));
      this.child.stderr?.on("data", (chunk) => forward("sidecar-error", chunk));
      this.child.on("error", (type, location) => {
        process.stderr.write(
          `[sidecar-error] ${type} at ${redactSidecarLog(location)}\n`,
        );
      });
    } else {
      // Drain output to prevent an unconsumed pipe from blocking the utility process.
      this.child.stdout?.resume();
      this.child.stderr?.resume();
    }
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  onMessage(listener: (message: unknown) => void): void {
    this.child.on("message", listener);
  }

  onExit(listener: (code: number | null) => void): void {
    this.child.on("exit", (code) => listener(code));
  }

  sendBootstrap(bootstrap: SidecarBootstrap): void {
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage({ type: "bootstrap-port" }, [port2]);
    port1.postMessage(bootstrap);
    port1.close();
  }

  sendMessage(message: unknown): void {
    this.child.postMessage(message);
  }

  kill(): Promise<void> {
    const pid = this.child.pid;
    if (pid === undefined) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(escalate);
        clearTimeout(giveUp);
        resolve();
      };
      this.child.once("exit", done);
      const sent = this.child.kill();
      if (!sent) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          done();
        }
      }
      const escalate = setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          done();
        }
        this.child.kill();
      }, 2_000);
      const giveUp = setTimeout(done, 8_000);
    });
  }
}
