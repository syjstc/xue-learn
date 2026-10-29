import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer, optimizeDeps, resolveConfig } from "vite";
import { terminateDevChildren } from "./desktop-dev-processes.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

test("cold renderer optimization preserves the PDF worker URL asset", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "xuelearn-vite-test-"));
  const inlineConfig = {
    configFile: path.join(root, "vite.desktop-local.config.ts"),
    cacheDir,
    logLevel: "silent",
    server: { middlewareMode: true, watch: null },
  };
  let server;
  try {
    const config = await resolveConfig(inlineConfig, "serve");
    // Exercise optimization with the workspace Core. It may be handled as
    // source instead of appearing in Vite's optimized dependency inventory.
    await optimizeDeps(config, true);
    server = await createServer(inlineConfig);
    const worker = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
    const transformed = await server.transformRequest(`/@fs/${worker}?url`);
    assert.ok(transformed);
    const url = /export default "([^"]+)"/.exec(transformed.code)?.[1];
    assert.ok(url?.endsWith("/pdf.worker.min.mjs"), transformed.code);
    assert.ok(!url.includes("?url"));
  } finally {
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("shutdown signals each POSIX service group and skips unstarted children", () => {
  const calls = [];
  terminateDevChildren([{ pid: 101 }, {}, { pid: 102, killed: true }, { pid: 103 }], {
    platform: "darwin",
    killProcess: (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [[-101, "SIGTERM"], [-103, "SIGTERM"]]);
});

test("shutdown falls back to the direct child when group signalling is denied", () => {
  const calls = [];
  terminateDevChildren([{ pid: 101 }, { pid: 102 }], {
    platform: "darwin",
    killProcess: (pid, signal) => {
      calls.push([pid, signal]);
      if (pid === -101) throw Object.assign(new Error("denied"), { code: "EPERM" });
    },
  });
  assert.deepEqual(calls, [[-101, "SIGTERM"], [101, "SIGTERM"], [-102, "SIGTERM"]]);
});

test("shutdown reports denied cleanup and still stops the remaining services", () => {
  const calls = [];
  const warnings = [];
  terminateDevChildren([{ pid: 101 }, { pid: 102 }, { pid: 103 }], {
    platform: "darwin",
    killProcess: (pid) => {
      calls.push(pid);
      if (Math.abs(pid) === 101) throw Object.assign(new Error("denied"), { code: "EPERM" });
      if (pid === -102) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(calls, [-101, 101, -102, -103]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /child 101: EPERM/);
});

test("shutdown uses individual processes on Windows", () => {
  const calls = [];
  terminateDevChildren([{ pid: 101 }], {
    platform: "win32",
    killProcess: (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [[101, "SIGTERM"]]);
});
