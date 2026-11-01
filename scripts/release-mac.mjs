#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { loadPackagingEnv } from "../desktop/apps/desktop/src/load-packaging-env.ts";
import { assertReleaseVersions, assertTrustedMacRelease, macNotaryArguments } from "./mac-release-config.mjs";
import { assertReleaseSourceIdentity, releaseSourceIdentity } from "./release-source-identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const help = `Usage: pnpm run release:mac [--publish | --build-only] [--resume] [--dry-run]

  (default)  Test, sign/notarize, push the source/tag, upload only a DMG to a draft.
  --publish  Also wait for Source and security CI, then publish the verified draft.
  --build-only  Build and verify a local installer; no GitHub access or Git push.
  --resume   Finish the existing build for this exact committed source.
  --dry-run  Read-only preflight and plan; no install, build, push or release edits.

Requires macOS, Node.js 24, pnpm 9.15.9, gh login and .env.packaging.
The source must be clean and committed on the repository's default branch.
Repository visibility is never changed. Published versions/tags are never replaced.
`;

export function parseOptions(args) {
  const options = { publish: false, buildOnly: false, resume: false, dryRun: false, help: false };
  for (const arg of args[0] === "--" ? args.slice(1) : args) {
    const key = { "--publish": "publish", "--build-only": "buildOnly", "--resume": "resume", "--dry-run": "dryRun", "--help": "help", "-h": "help" }[arg];
    if (!key || options[key]) throw Error(`Unknown or repeated option: ${arg}\n${help}`);
    options[key] = true;
  }
  if (options.publish && options.buildOnly) throw Error("--publish and --build-only cannot be combined.");
  return options;
}

export function repositoryName(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  if (!match || match[1].split("/").some(part => part === "." || part === ".."))
    throw Error("Release repository must be a credential-free GitHub HTTPS or SSH URL.");
  return match[1];
}

export async function sha256File(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

export function commandRunner(cwd, env) {
  const scrub = text => [env.APPLE_APP_SPECIFIC_PASSWORD, env.GH_TOKEN, env.GITHUB_TOKEN]
    .filter(Boolean).reduce((result, secret) => result.split(secret).join("[redacted]"), text);
  return (command, args, { quiet = true, input } = {}) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; if (!quiet) process.stdout.write(scrub(String(chunk))); });
    child.stderr.on("data", chunk => { stderr += chunk; if (!quiet) process.stderr.write(scrub(String(chunk))); });
    child.on("error", error => reject(Error(`Could not run ${path.basename(command)}: ${error.message}`)));
    child.stdin.on("error", error => { if (error.code !== "EPIPE") reject(error); });
    child.stdin.end(input);
    child.on("close", code => code === 0 ? resolve(stdout.trim()) :
      reject(Error(scrub(`${path.basename(command)} failed (${code ?? "signal"}): ${(stderr || stdout).slice(-6000)}`))));
  });
}

// Official v8.30.1 archives. Verify before extracting; no global installation.
const gitleaksHashes = {
  arm64: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
  x64: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
};
export async function ensureGitleaks(directory, arch, env, run) {
  const executable = env.GITLEAKS_PATH || "gitleaks";
  try {
    const version = await run(executable, ["version"]);
    const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(version);
    if (match && (Number(match[1]) > 8 || (Number(match[1]) === 8 &&
      (Number(match[2]) > 30 || (Number(match[2]) === 30 && Number(match[3]) >= 1))))) {
      env.GITLEAKS_PATH = executable;
      return;
    }
    throw Error("Gitleaks 8.30.1 or later is required.");
  } catch (error) {
    if (env.GITLEAKS_PATH) throw error;
  }
  const expected = gitleaksHashes[arch];
  if (!expected) throw Error(`No checksum-pinned Gitleaks for ${arch}.`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(directory, "gitleaks-"));
  const archive = path.join(temporary, "gitleaks.tar.gz");
  try {
    await run("curl", ["--fail", "--location", "--silent", "--show-error", "--retry", "3", "--output", archive,
      `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_${arch}.tar.gz`]);
    if (await sha256File(archive) !== expected) throw Error("Gitleaks archive checksum mismatch; nothing was executed.");
    await run("tar", ["-xzf", archive, "-C", temporary, "gitleaks"]);
    const installed = path.join(directory, `gitleaks-8.30.1-${arch}`);
    await writeFile(installed, await readFile(path.join(temporary, "gitleaks")), { mode: 0o700 });
    await chmod(installed, 0o700);
    await run(installed, ["version"]);
    env.GITLEAKS_PATH = installed;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export function assertUploadedAsset(assets, manifest) {
  if (assets.length !== 1 || assets[0].name !== manifest.file)
    throw Error("Release must contain exactly the intended DMG and no other manual assets.");
  const asset = assets[0];
  if (asset.state !== "uploaded" || asset.size !== manifest.bytes || asset.digest !== `sha256:${manifest.sha256}`)
    throw Error("GitHub DMG size/state/SHA-256 does not match the verified local installer. The draft was not published.");
}

export async function releaseMac(options, {
  directory = root, env = process.env, run = commandRunner(directory, env),
  platform = process.platform, arch = process.arch, nodeVersion = process.versions.node,
  sourceIdentity = releaseSourceIdentity, log = console.log, sleep = delay,
  prepareGitleaks = ensureGitleaks,
} = {}) {
  if (options.help) { log(help); return; }
  if (platform !== "darwin" || !["arm64", "x64"].includes(arch)) throw Error("Run Mac releases on an arm64 or x64 Mac.");
  if (Number(nodeVersion.split(".")[0]) !== 24) throw Error("Use Node.js 24 from .nvmrc before running release:mac.");
  const jsonFile = async name => JSON.parse(await readFile(path.join(directory, name), "utf8"));
  const packages = await Promise.all(["package.json", "desktop/package.json", "desktop/apps/desktop/package.json"].map(jsonFile));
  assertReleaseVersions(packages.map(item => item.version));
  const version = packages[0].version, tag = `v${version}`, title = `好会学 ${version}`;
  const repo = repositoryName(packages[0].repository.url);
  const notesFile = path.join(directory, `docs/releases/${tag}.md`);
  const notes = await readFile(notesFile, "utf8");
  if (!notes.trim()) throw Error(`Write release notes in docs/releases/${tag}.md first.`);
  const pnpmVersion = await run("pnpm", ["--version"]);
  if (`pnpm@${pnpmVersion}` !== packages[0].packageManager) throw Error(`Use ${packages[0].packageManager}.`);
  const source = await sourceIdentity();
  assertReleaseSourceIdentity(source, source);
  for (const flags of [[], ["--push"]]) {
    const urls = (await run("git", ["remote", "get-url", ...flags, "--all", "origin"])).split("\n");
    if (urls.length !== 1 || repositoryName(urls[0]).toLowerCase() !== repo.toLowerCase())
      throw Error("origin fetch/push URLs must both match package.json repository.");
  }
  const api = async (endpoint, body) => JSON.parse(await run("gh", ["api", "--hostname", "github.com", endpoint,
    ...(body ? ["--method", "PATCH", "--input", "-"] : [])], body ? { input: JSON.stringify(body) } : undefined));
  const pages = async endpoint => JSON.parse(await run("gh", ["api", "--hostname", "github.com", endpoint, "--paginate", "--slurp"])).flat();
  const branch = await run("git", ["symbolic-ref", "--short", "HEAD"]);
  const metadata = options.buildOnly ? { default_branch: branch } : await api(`repos/${repo}`);
  if (!options.buildOnly) {
    if (metadata.full_name.toLowerCase() !== repo.toLowerCase() || !metadata.permissions?.push || metadata.archived)
      throw Error("GitHub authentication must have push access to the configured, active repository.");
    if (branch !== metadata.default_branch) throw Error(`Release from the default branch (${metadata.default_branch}).`);
  }
  const fileName = `HaoHuiXue-${version}-mac-${arch}.dmg`;
  const releases = () => pages(`repos/${repo}/releases?per_page=100`);
  const findRelease = async () => {
    const matches = (await releases()).filter(item => item.tag_name === tag);
    if (matches.length > 1) throw Error(`Multiple releases use ${tag}; resolve them manually.`);
    return matches[0];
  };
  const assertDraft = release => {
    if (!release) return;
    if (release.draft !== true) throw Error(`${tag} is already published. Use a new version; published releases are never modified.`);
    if (release.target_commitish !== source.sourceCommit)
      throw Error(`${tag} draft points to different source. Use a new version; existing release source is never replaced.`);
  };
  const checkTags = async () => {
    const local = await run("git", ["for-each-ref", "--format=%(refname)", `refs/tags/${tag}`]);
    if (local.split("\n").includes(`refs/tags/${tag}`) &&
      await run("git", ["rev-parse", `${tag}^{commit}`]) !== source.sourceCommit)
      throw Error(`Local ${tag} points to different source. Use a new version.`);
    const remote = await run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
    const refs = new Map(remote.split("\n").filter(Boolean).map(line => line.split(/\s+/).reverse()));
    const commit = refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`);
    if (commit && commit !== source.sourceCommit) throw Error(`Remote ${tag} points to different source. Use a new version.`);
    return { local: local.split("\n").includes(`refs/tags/${tag}`), remote: Boolean(commit) };
  };
  let release;
  if (!options.buildOnly) {
    await checkTags();
    release = await findRelease();
    assertDraft(release);
  }
  const assets = id => pages(`repos/${repo}/releases/${id}/assets?per_page=100`);
  if (release && (await assets(release.id)).some(asset => asset.name !== fileName))
    throw Error("Existing draft has other assets; resolve them manually. Nothing will be deleted.");
  if (!env.MACOS_SIGN_IDENTITY) throw Error("Configure MACOS_SIGN_IDENTITY in .env.packaging.");
  macNotaryArguments(env);
  if (options.resume) {
    const built = await jsonFile(`desktop/apps/desktop/out/XueLearn-darwin-${arch}/XueLearn.app/Contents/Resources/build-info.json`);
    assertReleaseSourceIdentity(built, source);
  }
  log(`${title} · ${repo} (${options.buildOnly ? "local package" : metadata.private ? "private" : "public"}) · ${source.sourceCommit}`);
  log(`Plan: frozen install → tests/types/build → secret/dependency audit → ${options.resume ? "finish existing" : "build/sign/notarize"} → verify DMG${options.buildOnly ? " → local installer only" : ` → push source/tag → upload DMG → ${options.publish ? "CI → publish" : "draft for review"}`}`);
  if (options.dryRun) { log("Dry run complete. No files, tags, release or repository settings were changed."); return; }

  const lock = path.join(directory, ".release/mac-release.lock");
  await mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw Error("Another release may be running. Inspect .release/mac-release.lock before removing a stale lock.");
    throw error;
  }
  const assertCurrentSource = async () => assertReleaseSourceIdentity(source, await sourceIdentity());
  const verifyRemote = async () => {
    const current = await api(`repos/${repo}`);
    if (current.private !== metadata.private || current.default_branch !== branch)
      throw Error("Repository visibility or default branch changed during the release. Review before retrying.");
    const refs = await checkTags();
    if (!refs.remote) throw Error("The exact release tag is missing from origin.");
  };
  try {
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, commit: source.sourceCommit, tag, startedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
    await run("pnpm", ["install", "--frozen-lockfile"], { quiet: false });
    await prepareGitleaks(path.join(directory, ".cache/release-tools"), arch, env, run);
    await run("pnpm", ["run", "check"], { quiet: false });
    await run("pnpm", ["run", "check:security"], { quiet: false });
    await assertCurrentSource();
    await run("pnpm", ["run", "build:mac", ...(options.resume ? ["--finish-existing"] : [])], { quiet: false });
    await assertCurrentSource();
    const manifest = await jsonFile(".release/mac/release-manifest.json");
    assertReleaseSourceIdentity(manifest, source);
    assertTrustedMacRelease(manifest);
    if (manifest.file !== fileName || manifest.version !== version || manifest.arch !== arch || manifest.platform !== "darwin")
      throw Error("Release manifest version/platform/file does not match this release.");
    const installer = path.join(directory, ".release/mac", fileName);
    if (manifest.sha256 !== await sha256File(installer) || manifest.bytes !== (await stat(installer)).size)
      throw Error("Local DMG was modified after verification. Nothing will be uploaded.");
    if (options.buildOnly) {
      log(`Local installer ready: ${installer}\nDMG SHA-256: ${manifest.sha256}`);
      return { ...manifest, localOnly: true };
    }
    // Recheck remote state after the potentially long build, before any GitHub mutation.
    await checkTags();
    release = await findRelease();
    assertDraft(release);
    if (release) {
      const existing = await assets(release.id);
      if (existing.length) assertUploadedAsset(existing, manifest);
    }
    await run("git", ["push", "origin", `HEAD:refs/heads/${branch}`], { quiet: false });
    const refs = await checkTags();
    if (!refs.local) await run("git", ["tag", "-a", tag, source.sourceCommit, "-m", title]);
    if (!refs.remote) await run("git", ["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`], { quiet: false });
    await verifyRemote();
    await assertCurrentSource();
    if (!release) {
      await run("gh", ["release", "create", tag, "--repo", `github.com/${repo}`, "--draft", "--verify-tag", "--target", source.sourceCommit,
        "--title", title, "--notes-file", notesFile], { quiet: false });
      release = await findRelease();
      if (!release) throw Error("The created draft could not be read back; inspect GitHub before retrying.");
    }
    release = await api(`repos/${repo}/releases/${release.id}`);
    assertDraft(release);
    await api(`repos/${repo}/releases/${release.id}`, { name: title, body: notes, target_commitish: source.sourceCommit, draft: true, prerelease: false });
    const existing = await assets(release.id);
    if (existing.length) assertUploadedAsset(existing, manifest);
    else await run("gh", ["release", "upload", tag, installer, "--repo", `github.com/${repo}`], { quiet: false });
    assertUploadedAsset(await assets(release.id), manifest);
    const saveReceipt = async current => {
      const receipt = { repository: repo, private: metadata.private, tag, ...source, file: fileName, sha256: manifest.sha256,
        releaseId: current.id, url: current.html_url, draft: current.draft, asset: (await assets(current.id))[0], recordedAt: new Date().toISOString() };
      await writeFile(path.join(directory, ".release/mac/github-release.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
      return receipt;
    };
    await saveReceipt(release);
    if (options.publish) {
      let workflow;
      for (let attempt = 0; attempt < 13; attempt++) {
        workflow = (await api(`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${source.sourceCommit}&event=push&per_page=1`)).workflow_runs[0];
        if (workflow) break;
        if (attempt < 12) await sleep(10000);
      }
      if (!workflow) throw Error("No Source and security CI run for this exact commit. The release remains a draft.");
      await run("gh", ["run", "watch", String(workflow.id), "--repo", `github.com/${repo}`, "--exit-status", "--interval", "10"], { quiet: false });
      const completed = await api(`repos/${repo}/actions/runs/${workflow.id}`);
      if (completed.head_sha !== source.sourceCommit || completed.conclusion !== "success")
        throw Error("Source and security CI did not succeed for this exact commit. The release remains a draft.");
      await assertCurrentSource();
      await verifyRemote();
      release = await api(`repos/${repo}/releases/${release.id}`);
      assertDraft(release);
      assertUploadedAsset(await assets(release.id), manifest);
      release = await api(`repos/${repo}/releases/${release.id}`, { draft: false, prerelease: false, make_latest: "true" });
    } else release = await api(`repos/${repo}/releases/${release.id}`);
    if (release.draft !== !options.publish) throw Error("Unexpected release state. Inspect GitHub; no further changes were attempted.");
    assertUploadedAsset(await assets(release.id), manifest);
    const receipt = await saveReceipt(release);
    log(`${receipt.draft ? "Draft ready for review" : "Release published"}: ${receipt.url}`);
    log(`DMG SHA-256: ${receipt.sha256}\nLocal receipt: .release/mac/github-release.json`);
    return receipt;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (!options.help) loadPackagingEnv({ cwd: path.join(root, "desktop/apps/desktop") });
    await releaseMac(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
