import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  cleanDesktopDevelopment,
  cleanDesktopOutputs,
  desktopDevCleanupPaths,
  parseProcessTable,
  parseWorkingDirectories,
  selectDesktopProcesses,
  stopDesktopProcesses,
} from "./desktop-dev-clean.mjs";
import { assertDevPortAvailable } from "./desktop-dev-preflight.mjs";

const root = "/workspace/Desktop with spaces";
const uid = 501;
const entry = (pid, ppid, command, extra = {}) => ({
  pid,
  ppid,
  uid,
  command,
  state: "S",
  started: "Mon Oct 12 20:46:25 2026",
  ...extra,
});
const electron = `${root}/node_modules/.pnpm/electron@37.10.3/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`;
const select = (table, cwd = new Map()) =>
  selectDesktopProcesses(table, cwd, root, { selfPid: 900, uid });
const silent = () => {};

test("legacy orphaned Electron and its descendants are found without a PID file", () => {
  const table = [
    entry(10, 1, electron),
    entry(11, 10, "/different/path/plugin-worker"),
    entry(12, 11, "/different/path/ffmpeg"),
    entry(20, 1, "/Applications/Other.app/Contents/MacOS/Electron"),
    entry(21, 1, `${electron} --unrelated-user`, { uid: 502 }),
    entry(22, 1, electron, { state: "Z" }),
    entry(23, 1, `/bin/zsh -c echo ${electron}`),
  ];
  assert.deepEqual(
    select(table).map((item) => item.pid),
    [10, 11, 12],
  );
});

test("relative development commands require a cwd in this checkout", () => {
  const table = [
    entry(30, 1, "node scripts/desktop-dev.mjs"),
    entry(31, 1, "node scripts/desktop-dev.mjs"),
    entry(32, 1, "node scripts/build-service.mjs local-runtime --watch"),
    entry(33, 1, "node scripts/build-service.mjs local-runtime --production"),
    entry(
      34,
      1,
      "node /usr/bin/pnpm exec vite --config vite.desktop-local.config.ts",
    ),
    entry(
      35,
      1,
      "node /usr/bin/pnpm exec vite --config apps/lab-runtime/vite.config.ts",
    ),
    entry(36, 1, "node scripts/run-electron-forge.mjs start"),
    entry(37, 1, "node scripts/run-electron-forge.mjs package"),
    entry(38, 1, "node unrelated-server.js"),
    entry(39, 1, `node ${root}/scripts/desktop-dev.mjs`),
  ];
  const cwd = new Map(table.map((item) => [item.pid, root]));
  cwd.set(31, `${root}-other`);
  cwd.set(36, join(root, "apps/desktop"));
  assert.deepEqual(
    select(table, cwd).map((item) => item.pid),
    [30, 32, 34, 35, 36, 39],
  );
});

test("cleanup protects itself, its ancestors and other checkouts", () => {
  const table = [
    entry(890, 1, "node scripts/desktop-dev.mjs"),
    entry(900, 890, "node scripts/desktop-dev.mjs"),
    entry(40, 1, electron.replace(root, "/workspace/other-desktop")),
    entry(41, 1, "node scripts/desktop-dev.mjs"),
  ];
  const cwd = new Map([
    [890, root],
    [900, root],
    [40, "/workspace/other-desktop"],
  ]);
  assert.deepEqual(select(table, cwd), []);
});

test("process and cwd parsing preserves spaces and start times", () => {
  const parsed = parseProcessTable(
    `49798 1 501 S Mon Oct 12 20:46:25 2026 ${electron}\ninvalid\n`,
  );
  assert.deepEqual(parsed, [entry(49798, 1, electron)]);
  assert.deepEqual(
    parseWorkingDirectories(`p49798\nfcwd\nn${root}/apps/desktop\n`),
    new Map([[49798, `${root}/apps/desktop`]]),
  );
});

test("termination escalates hung parents and children and catches newly spawned children", async () => {
  const parent = entry(50, 1, electron, { role: "Electron" });
  const child = entry(51, 50, "plugin-worker", { role: "development child" });
  const late = entry(52, 50, "late-worker", { role: "development child" });
  let live = [child, parent];
  let ticks = 0;
  const calls = [];
  await stopDesktopProcesses(live, {
    readTable: async () => live,
    selectProcesses: async (table) => table,
    killProcess: (pid, signal) => {
      calls.push([pid, signal]);
      if (signal === "SIGKILL") live = live.filter((item) => item.pid !== pid);
    },
    sleep: async () => {
      if (++ticks === 1) live.push(late);
    },
    graceMs: 200,
    forceMs: 100,
    log: silent,
  });
  assert.deepEqual(calls, [
    [50, "SIGTERM"],
    [51, "SIGTERM"],
    [52, "SIGTERM"],
    [50, "SIGKILL"],
    [51, "SIGKILL"],
    [52, "SIGKILL"],
  ]);
});

test("a reused PID is never signalled", async () => {
  const old = entry(60, 1, electron, { role: "Electron" });
  const replacement = { ...old, started: "Tue Oct 13 10:00:00 2026" };
  let reads = 0;
  await stopDesktopProcesses([old], {
    readTable: async () => [++reads === 1 ? old : replacement],
    killProcess: () =>
      assert.fail("A replacement process must not receive a signal"),
    sleep: async () => {},
    graceMs: 100,
    log: silent,
  });
});

test("failure to stop a process fails cleanup", async () => {
  const old = entry(70, 1, electron, { role: "Electron" });
  await assert.rejects(
    stopDesktopProcesses([old], {
      readTable: async () => [old],
      killProcess: () => {},
      sleep: async () => {},
      graceMs: 100,
      forceMs: 100,
      log: silent,
    }),
    /Processes still running: 70/,
  );
});

async function temporaryRoot(t) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "xuelearn-clean-test-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function seedOutput(directory) {
  for (const path of desktopDevCleanupPaths) {
    await mkdir(join(directory, path), { recursive: true });
    await writeFile(join(directory, path, "generated.txt"), "generated");
  }
  for (const path of [
    "data/workspace.sqlite",
    "apps/desktop/data/workspace.sqlite",
    "profile/credentials.v1.enc.json",
    "exports/lesson.mp4",
    "node_modules/dependency/index.js",
  ]) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), "saved content");
  }
}

test("cleanup is repeatable and only removes generated output", async (t) => {
  const directory = await temporaryRoot(t);
  await seedOutput(directory);
  await cleanDesktopOutputs(directory, { dryRun: true, log: silent });
  await access(join(directory, "apps/desktop/dist/generated.txt"));
  await cleanDesktopOutputs(directory, { log: silent });
  await cleanDesktopOutputs(directory, { log: silent });
  for (const path of desktopDevCleanupPaths)
    await assert.rejects(access(join(directory, path)), { code: "ENOENT" });
  for (const path of [
    "data/workspace.sqlite",
    "apps/desktop/data/workspace.sqlite",
    "profile/credentials.v1.enc.json",
    "exports/lesson.mp4",
    "node_modules/dependency/index.js",
  ]) {
    assert.equal(
      await readFile(join(directory, path), "utf8"),
      "saved content",
    );
  }
});

test("cleanup refuses symlinked parents that lead outside the checkout", async (t) => {
  const directory = await temporaryRoot(t);
  const external = await temporaryRoot(t);
  await mkdir(join(external, ".vite"));
  await writeFile(join(external, ".vite/keep.txt"), "keep");
  await symlink(external, join(directory, "node_modules"));
  await assert.rejects(
    cleanDesktopOutputs(directory, { log: silent }),
    /symbolic link/,
  );
  assert.equal(
    await readFile(join(external, ".vite/keep.txt"), "utf8"),
    "keep",
  );
});

test("an unrelated real port listener blocks cleanup without deleting output", async (t) => {
  const directory = await temporaryRoot(t);
  await seedOutput(directory);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    cleanDesktopDevelopment({
      root: directory,
      checkPort: (_, label) =>
        assertDevPortAvailable(server.address().port, label),
      log: silent,
    }),
    /already in use/,
  );
  assert.equal(server.listening, true);
  await access(join(directory, "apps/desktop/dist/generated.txt"));
});

async function spawnHungDevelopment(directory) {
  await mkdir(join(directory, "scripts"), { recursive: true });
  await writeFile(
    join(directory, "worker.mjs"),
    `
    import { createServer } from "node:net";
    process.on("SIGTERM", () => {});
    const server = createServer();
    server.listen(0, "127.0.0.1", () => process.send({ pid: process.pid, port: server.address().port }));
  `,
  );
  await writeFile(
    join(directory, "scripts/desktop-dev.mjs"),
    `
    import { spawn } from "node:child_process";
    process.on("SIGTERM", () => {});
    const child = spawn(process.execPath, ["worker.mjs"], { cwd: process.cwd(), stdio: ["ignore", "ignore", "ignore", "ipc"] });
    child.once("message", message => process.send(message));
    setInterval(() => {}, 1000);
  `,
  );
  const launcher = spawn(
    process.execPath,
    [join(directory, "scripts/desktop-dev.mjs")],
    {
      cwd: directory,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  const [worker] = await once(launcher, "message");
  return { launcher, worker };
}

test(
  "real hung process tree is force-stopped, dry-run and stop-only preserve files and other checkouts",
  { timeout: 20_000 },
  async (t) => {
    const directory = await temporaryRoot(t);
    const other = await temporaryRoot(t);
    await seedOutput(directory);
    const own = await spawnHungDevelopment(directory);
    const unrelated = await spawnHungDevelopment(other);
    t.after(() => {
      for (const fixture of [own, unrelated]) {
        if (
          fixture.launcher.exitCode === null &&
          fixture.launcher.signalCode === null
        )
          fixture.launcher.kill("SIGKILL");
        try {
          process.kill(fixture.worker.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    });
    await cleanDesktopDevelopment({
      root: directory,
      dryRun: true,
      log: silent,
    });
    assert.equal(own.launcher.signalCode, null);
    await access(join(directory, "apps/desktop/dist/generated.txt"));
    const exited = once(own.launcher, "exit");
    await cleanDesktopDevelopment({
      root: directory,
      stopOnly: true,
      checkPort: async (port, label) => {
        if (port === 5174) await assertDevPortAvailable(own.worker.port, label);
      },
      log: silent,
    });
    assert.deepEqual(await exited, [null, "SIGKILL"]);
    await assertDevPortAvailable(own.worker.port, "Fixture child");
    await access(join(directory, "apps/desktop/dist/generated.txt"));
    assert.equal(unrelated.launcher.signalCode, null);
    await assert.rejects(
      assertDevPortAvailable(unrelated.worker.port, "Unrelated"),
      /already in use/,
    );
    await cleanDesktopOutputs(directory, { log: silent });
    assert.equal(
      await readFile(join(directory, "data/workspace.sqlite"), "utf8"),
      "saved content",
    );
  },
);
