import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PINNED_SIDECAR_PORT_ENV = "XUELEARN_DESKTOP_SIDECAR_PORT";

export function readPinnedSidecarPort(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = Number.parseInt(env[PINNED_SIDECAR_PORT_ENV] ?? "", 10);
  if (!Number.isInteger(raw) || raw <= 0 || raw > 65_535) return null;
  return raw;
}

export function parseLsofListenPids(stdout: string): number[] {
  const pids = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^p(\d+)$/.exec(line.trim());
    if (match) pids.add(Number(match[1]));
  }
  return [...pids];
}

export async function listLoopbackListenPids(
  port: number,
): Promise<number[]> {
  if (process.platform === "win32") return [];
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "p"],
      { timeout: 3_000 },
    );
    return parseLsofListenPids(stdout);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 1) return [];
    return [];
  }
}

export type ReclaimLoopbackListenPortOptions = {
  exceptPids?: Iterable<number>;
  listPids?: (port: number) => Promise<number[]>;
  killPid?: (pid: number, signal: NodeJS.Signals) => void;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};

function defaultKillPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code !== "ESRCH") throw error;
  }
}

/**
 * Desktop-dev pins the sidecar to one loopback port so Vite can proxy `/api`.
 * Crash recovery and hotload restarts must free leftover listeners before the
 * replacement process binds, or Nest fails with EADDRINUSE and the supervisor
 * exhausts its bounded retries.
 */
export async function reclaimLoopbackListenPort(
  port: number,
  options: ReclaimLoopbackListenPortOptions = {},
): Promise<void> {
  const except = new Set(options.exceptPids ?? []);
  except.add(process.pid);
  const listPids = options.listPids ?? listLoopbackListenPids;
  const killPid = options.killPid ?? defaultKillPid;
  const wait =
    options.wait ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const occupants = async () =>
    (await listPids(port)).filter((pid) => pid > 1 && !except.has(pid));

  for (const pid of await occupants()) killPid(pid, "SIGTERM");
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const live = await occupants();
    if (live.length === 0) return;
    for (const pid of live) killPid(pid, "SIGKILL");
    await wait(100);
  }
}
