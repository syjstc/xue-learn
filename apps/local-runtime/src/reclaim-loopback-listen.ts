import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

function killPid(pid: number, signal: NodeJS.Signals): void {
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

/** Free a pinned desktop-dev sidecar port held by a crashed leftover process. */
export async function reclaimLoopbackListenPort(
  port: number,
  exceptPids: Iterable<number> = [],
): Promise<void> {
  const except = new Set(exceptPids);
  except.add(process.pid);
  const occupants = async () =>
    (await listLoopbackListenPids(port)).filter(
      (pid) => pid > 1 && !except.has(pid),
    );
  for (const pid of await occupants()) killPid(pid, "SIGTERM");
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const live = await occupants();
    if (live.length === 0) return;
    for (const pid of live) killPid(pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
