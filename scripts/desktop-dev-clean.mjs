#!/usr/bin/env node
import { execFile } from "node:child_process";
import { lstat, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertDevPortAvailable } from "./desktop-dev-preflight.mjs";
import {
  DESKTOP_DEV_RENDERER_PORT,
  DESKTOP_DEV_SIDECAR_PORT,
} from "./desktop-dev-defaults.mjs";

const execute = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Only generated development output. Never remove userData, data/, plugins,
// credentials, databases, exports, dependencies or packaged applications.
export const desktopDevCleanupPaths = [
  "node_modules/.vite",
  "node_modules/.vite-temp",
  "src/desktop-local/node_modules/.vite",
  "apps/lab-runtime/node_modules/.vite",
  "dist-desktop",
  "dist/lab-runtime",
  "dist/apps/local-runtime",
  "apps/desktop/dist",
];

export function parseProcessTable(output) {
  return output.split("\n").flatMap((line) => {
    const match = line
      .trim()
      .match(
        /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
      );
    if (!match) return [];
    return [
      {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        uid: Number(match[3]),
        state: match[4],
        started: match[5].replace(/\s+/g, " "),
        command: match[6],
      },
    ];
  });
}

async function readProcessTable() {
  try {
    const { stdout } = await execute(
      "ps",
      ["-axo", "pid=,ppid=,uid=,stat=,lstart=,command="],
      { maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
    );
    return parseProcessTable(stdout);
  } catch (error) {
    throw new Error(
      `Cannot inspect processes; cleanup has stopped: ${error.message}`,
      { cause: error },
    );
  }
}

export function parseWorkingDirectories(output) {
  const directories = new Map();
  let pid;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n") && pid) directories.set(pid, line.slice(1));
  }
  return directories;
}

async function readWorkingDirectories(pids) {
  if (!pids.length) return new Map();
  try {
    const { stdout } = await execute(
      "lsof",
      ["-a", "-p", pids.join(","), "-d", "cwd", "-Fn"],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return parseWorkingDirectories(stdout);
  } catch (error) {
    // lsof returns 1 if one of the processes exited during the snapshot.
    if (error.code === 1) return parseWorkingDirectories(error.stdout ?? "");
    throw new Error(
      `Cannot verify process working directories: ${error.message}`,
      { cause: error },
    );
  }
}

function inside(root, path) {
  const value = relative(root, path);
  return (
    value === "" ||
    (!value.startsWith(`..${sep}`) && value !== ".." && !value.startsWith(sep))
  );
}

function processRole(command, root) {
  // An absolute Electron runtime under this checkout also identifies orphaned
  // helpers whose working directory has changed. Do not match arbitrary apps
  // just because their command arguments mention XueLearn or this repository.
  if (
    command.startsWith(`${root}${sep}`) &&
    /^\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?electron\/dist\/(?:Electron\.app\/Contents\/(?:MacOS\/Electron|Frameworks\/Electron Helper[^/]*\.app\/Contents\/MacOS\/Electron Helper[^/]*)(?:\s|$)|electron(?:\s|$))/.test(
      command.slice(root.length),
    )
  )
    return "Electron";

  const executable = command.match(/^\S+/)?.[0];
  if (
    !executable ||
    !["node", "nodejs", "pnpm", "vite"].includes(basename(executable))
  )
    return null;
  const args = command.slice(executable.length).trim();
  const startsWithScript = (script) =>
    [script, join(root, script)].some(
      (path) => args === path || args.startsWith(`${path} `),
    );
  if (startsWithScript("scripts/desktop-dev.mjs")) return "launcher";
  if (
    startsWithScript("scripts/build-service.mjs") &&
    /\s+local-runtime\s+.*--watch(?:\s|$)/.test(args)
  )
    return "sidecar watcher";
  if (
    startsWithScript("scripts/run-electron-forge.mjs") ||
    startsWithScript("apps/desktop/scripts/run-electron-forge.mjs")
  ) {
    return /\s+start(?:\s|$)/.test(args) ? "Electron launcher" : null;
  }
  // pnpm's exec wrapper and Vite's Node entrypoint are both included; their
  // cwd is verified separately before selecting them.
  if (/(?:^|[\s/])vite(?:\.js)?\s/.test(command)) {
    if (
      /--config(?:=|\s+)(?:\S*\/)?vite\.desktop-local\.config\.ts(?:\s|$)/.test(
        command,
      )
    )
      return "renderer watcher";
    if (
      /--config(?:=|\s+)(?:\S*\/)?apps\/lab-runtime\/vite\.config\.ts(?:\s|$)/.test(
        command,
      )
    )
      return "lab watcher";
  }
  return null;
}

export function selectDesktopProcesses(
  table,
  directories,
  root,
  { selfPid = process.pid, uid = process.getuid() } = {},
) {
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  const protectedPids = new Set([1, selfPid]);
  let ancestor = byPid.get(selfPid)?.ppid;
  while (ancestor && !protectedPids.has(ancestor)) {
    protectedPids.add(ancestor);
    ancestor = byPid.get(ancestor)?.ppid;
  }
  const selected = new Map();
  const eligible = (entry) =>
    entry.uid === uid &&
    !entry.state.startsWith("Z") &&
    !protectedPids.has(entry.pid);
  for (const entry of table) {
    if (!eligible(entry)) continue;
    const role = processRole(entry.command, root);
    const cwd = directories.get(entry.pid);
    if (role && (role === "Electron" || (cwd && inside(root, cwd)))) {
      selected.set(entry.pid, { ...entry, role });
    }
  }
  // Capture descendants before stopping their parents, including plugin
  // workers, encoders and esbuild grandchildren in other working directories.
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table) {
      if (
        !eligible(entry) ||
        selected.has(entry.pid) ||
        !selected.has(entry.ppid)
      )
        continue;
      selected.set(entry.pid, { ...entry, role: "development child" });
      changed = true;
    }
  }
  return [...selected.values()];
}

function sameProcess(expected, actual) {
  // A PID alone is not ownership evidence. Recheck start time and command
  // before every signal so PID reuse cannot terminate a different process.
  return (
    actual &&
    actual.uid === expected.uid &&
    actual.started === expected.started &&
    actual.command === expected.command &&
    !actual.state.startsWith("Z")
  );
}

export async function stopDesktopProcesses(
  initial,
  {
    readTable = readProcessTable,
    selectProcesses,
    killProcess = process.kill.bind(process),
    sleep = delay,
    graceMs = 3_000,
    forceMs = 2_000,
    log = (message) => process.stdout.write(`${message}\n`),
  } = {},
) {
  const targets = new Map(initial.map((entry) => [entry.pid, entry]));
  const signalled = new Set();
  const refresh = async () => {
    const snapshot = await readTable();
    // Parents may spawn children during termination. Rescan scoped owners so
    // an orphan produced during cleanup is still caught.
    for (const entry of (await selectProcesses?.(snapshot)) ?? []) {
      if (!targets.has(entry.pid)) targets.set(entry.pid, entry);
    }
    const live = new Map(snapshot.map((entry) => [entry.pid, entry]));
    return [...targets.values()].filter((entry) =>
      sameProcess(entry, live.get(entry.pid)),
    );
  };
  const signal = async (entries, name) => {
    for (const entry of entries) {
      // Stop the supervising launcher first, then all captured descendants.
      const current = (await readTable()).find(
        (item) => item.pid === entry.pid,
      );
      if (!sameProcess(entry, current)) continue;
      try {
        killProcess(entry.pid, name);
        log(`[cleanup] ${name} ${entry.role} (PID ${entry.pid})`);
      } catch (error) {
        if (error.code !== "ESRCH")
          throw new Error(
            `Could not stop PID ${entry.pid}: ${error.code ?? error.message}`,
            { cause: error },
          );
      }
    }
  };
  const depth = (entry) => {
    const seen = new Set([entry.pid]);
    let parent = targets.get(entry.ppid);
    while (parent && !seen.has(parent.pid)) {
      seen.add(parent.pid);
      parent = targets.get(parent.ppid);
    }
    return seen.size;
  };
  let remaining = await refresh();
  for (let elapsed = 0; elapsed < graceMs && remaining.length; elapsed += 100) {
    const fresh = remaining.filter((entry) => !signalled.has(entry.pid));
    await signal(
      fresh.sort(
        (a, b) =>
          depth(a) - depth(b) ||
          Number(b.role === "launcher") - Number(a.role === "launcher"),
      ),
      "SIGTERM",
    );
    for (const entry of fresh) signalled.add(entry.pid);
    await sleep(100);
    remaining = await refresh();
  }
  for (let elapsed = 0; elapsed < forceMs && remaining.length; elapsed += 100) {
    await signal(
      remaining.sort((a, b) => depth(a) - depth(b)),
      "SIGKILL",
    );
    await sleep(100);
    remaining = await refresh();
  }
  if (remaining.length)
    throw new Error(
      `Processes still running: ${remaining.map((entry) => entry.pid).join(", ")}. Generated files have not been removed.`,
    );
  return targets.size;
}

export async function cleanDesktopOutputs(
  root,
  {
    dryRun = false,
    log = (message) => process.stdout.write(`${message}\n`),
  } = {},
) {
  root = await realpath(root);
  for (const path of desktopDevCleanupPaths) {
    const target = join(root, path);
    // A symlinked ancestor could redirect rm outside the checkout. A symlink
    // at the target itself is safe: rm unlinks it without following it.
    for (
      let parent = dirname(target);
      parent !== root;
      parent = dirname(parent)
    ) {
      try {
        if ((await lstat(parent)).isSymbolicLink())
          throw new Error(
            `Refusing to clean ${path}: ${parent} is a symbolic link.`,
          );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!dryRun) await rm(target, { recursive: true, force: true });
    log(`[cleanup] ${dryRun ? "Would remove" : "Removed"} ${path}`);
  }
}

export async function cleanDesktopDevelopment({
  root = repositoryRoot,
  dryRun = false,
  stopOnly = false,
  labEnabled = process.env.XUELEARN_DESKTOP_ENABLE_LAB === "1",
  checkPort = assertDevPortAvailable,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  if (process.platform === "win32")
    throw new Error(
      "desktop:clean currently supports macOS and Linux (requires ps and lsof).",
    );
  root = await realpath(root);
  const table = await readProcessTable();
  const directories = await readWorkingDirectories(
    table
      .filter(
        (entry) =>
          entry.uid === process.getuid() && processRole(entry.command, root),
      )
      .map((entry) => entry.pid),
  );
  const selected = selectDesktopProcesses(table, directories, root);
  for (const entry of selected)
    log(
      `[cleanup] ${dryRun ? "Would stop" : "Found"} ${entry.role} (PID ${entry.pid})`,
    );
  if (!dryRun) {
    await stopDesktopProcesses(selected, {
      selectProcesses: async (snapshot) => {
        const cwd = await readWorkingDirectories(
          snapshot
            .filter(
              (entry) =>
                entry.uid === process.getuid() &&
                processRole(entry.command, root),
            )
            .map((entry) => entry.pid),
        );
        return selectDesktopProcesses(snapshot, cwd, root);
      },
      log,
    });
    // Unknown port owners are preserved. A conflict must fail cleanup/restart,
    // not silently start another Electron instance or delete files it uses.
    await checkPort(DESKTOP_DEV_RENDERER_PORT, "Renderer");
    await checkPort(DESKTOP_DEV_SIDECAR_PORT, "Local service");
    if (labEnabled || selected.some((entry) => entry.role === "lab watcher"))
      await checkPort(5177, "Lab runtime");
  }
  if (!stopOnly) await cleanDesktopOutputs(root, { dryRun, log });
  log(
    dryRun
      ? "[cleanup] Preview complete; nothing was changed."
      : "[cleanup] Desktop development is stopped. Run pnpm desktop:dev to start again.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const unknown = args.find(
    (arg) => !["--dry-run", "--stop-only", "--help"].includes(arg),
  );
  if (args.includes("--help")) {
    process.stdout.write(
      "Usage: pnpm desktop:clean [--dry-run] [--stop-only]\nStops this checkout's Desktop processes (TERM, then KILL) and removes generated development output. Saved learner data is preserved.\n",
    );
  } else if (unknown) {
    process.stderr.write(`Unknown option: ${unknown}\n`);
    process.exitCode = 1;
  } else {
    try {
      await cleanDesktopDevelopment({
        dryRun: args.includes("--dry-run"),
        stopOnly: args.includes("--stop-only"),
      });
    } catch (error) {
      process.stderr.write(`[cleanup] ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
