#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publicSourceFiles, repositoryRoot } from "./public-source-files.mjs";

const executable = process.env.GITLEAKS_PATH || "gitleaks";
function scan(args) {
  const result = spawnSync(executable, [...args, "--no-banner", "--redact=100"], {
    cwd: repositoryRoot, stdio: "inherit",
  });
  if (result.error?.code === "ENOENT") throw new Error("Install Gitleaks 8.30.1+ or set GITLEAKS_PATH to its executable.");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Gitleaks did not pass (exit ${result.status ?? result.signal}).`);
}
scan(["git", "--log-opts=--all", repositoryRoot]);
const snapshot = await mkdtemp(path.join(tmpdir(), "xuelearn-source-secrets-"));
try {
  for (const file of await publicSourceFiles()) {
    const target = path.join(snapshot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repositoryRoot, file), target);
  }
  scan(["dir", snapshot]);
} finally { await rm(snapshot, { recursive: true, force: true }); }
console.log("Secret audit passed for complete reachable Git history and current distributable source.");
