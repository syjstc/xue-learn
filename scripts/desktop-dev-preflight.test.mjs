import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDevPortAvailable,
  focusRunningDesktop,
  prepareDesktopDevelopment,
} from "./desktop-dev-preflight.mjs";

test("an existing window is focused before any occupied dev ports are checked", async () => {
  const start = await prepareDesktopDevelopment({
    focusExisting: async () => true,
    checkPort: () =>
      assert.fail("An existing window must not start another dev session"),
  });
  assert.equal(start, false);
});

test("a new session checks renderer and service ports, with the lab opt-in", async () => {
  for (const labEnabled of [false, true]) {
    const ports = [];
    const start = await prepareDesktopDevelopment({
      focusExisting: async () => false,
      labEnabled,
      checkPort: async (port) => ports.push(port),
    });
    assert.equal(start, true);
    assert.deepEqual(ports, labEnabled ? [5174, 18765, 5177] : [5174, 18765]);
  }
});

test("a probe failure cannot silently start duplicate services", async () => {
  await assert.rejects(
    prepareDesktopDevelopment({
      focusExisting: async () => {
        throw new Error("probe failed");
      },
      checkPort: () => assert.fail("Probe errors must stop startup"),
    }),
    /probe failed/,
  );
});

test("an occupied port stops preparation before subsequent services", async () => {
  const ports = [];
  await assert.rejects(
    prepareDesktopDevelopment({
      focusExisting: async () => false,
      checkPort: async (port) => {
        ports.push(port);
        throw new Error("occupied");
      },
    }),
    /occupied/,
  );
  assert.deepEqual(ports, [5174]);
});

test("port preflight detects a real listener, preserves it, and releases its own probe", async () => {
  const owner = createServer();
  await new Promise((resolve, reject) => {
    owner.once("error", reject);
    owner.listen(0, "127.0.0.1", resolve);
  });
  const port = owner.address().port;
  try {
    await assert.rejects(
      assertDevPortAvailable(port, "Renderer"),
      new RegExp(`Renderer port ${port} is already in use`),
    );
    assert.equal(owner.listening, true);
  } finally {
    await new Promise((resolve) => owner.close(resolve));
  }
  await assertDevPortAvailable(port, "Renderer");
  await assertDevPortAvailable(port, "Renderer");
});

test("Electron probe distinguishes existing, absent, and failed instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xuelearn-preflight-test-"));
  const probe = join(dir, "probe.cjs");
  try {
    await writeFile(
      probe,
      "process.exit(process.env.ELECTRON_RUN_AS_NODE ? 1 : Number(process.env.PROBE_EXIT));",
    );
    const focus = (code) =>
      focusRunningDesktop(process.execPath, probe, {
        env: {
          ...process.env,
          PROBE_EXIT: String(code),
          ELECTRON_RUN_AS_NODE: "1",
        },
      });
    assert.equal(await focus(0), true);
    assert.equal(await focus(2), false);
    await assert.rejects(
      focus(1),
      /Could not check the existing XueLearn window/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
