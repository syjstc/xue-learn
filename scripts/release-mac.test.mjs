import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureGitleaks, parseOptions, releaseMac, repositoryName, sha256File } from "./release-mac.mjs";

const commit = "a".repeat(40), otherCommit = "b".repeat(40);
const source = { sourceCommit: commit, sourceTreeSha256: "c".repeat(64), sourceDirty: false };
const file = "HaoHuiXue-1.2.3-mac-arm64.dmg";

async function fixture(t, configure = () => {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "xuelearn-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const save = async (name, content) => {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof content === "string" ? content : JSON.stringify(content));
  };
  const pkg = { version: "1.2.3", repository: { url: "https://github.com/example/learning.git" }, packageManager: "pnpm@9.15.9" };
  for (const name of ["package.json", "desktop/package.json", "desktop/apps/desktop/package.json"]) await save(name, pkg);
  await save("docs/releases/v1.2.3.md", "# 好会学 1.2.3\nFixture release notes.\n");
  await save(`desktop/apps/desktop/out/XueLearn-darwin-arm64/XueLearn.app/Contents/Resources/build-info.json`, source);
  await save(`.release/mac/${file}`, "installer fixture; no native build or GitHub credentials used\n");
  const manifest = { ...source, file, version: "1.2.3", arch: "arm64", platform: "darwin",
    bytes: (await stat(path.join(directory, ".release/mac", file))).size,
    sha256: await sha256File(path.join(directory, ".release/mac", file)),
    hardenedFuses: true, developerIdSigned: true, signatureVerified: true, notarized: true,
    installerSigned: true, installerNotarized: true, gatekeeperAccepted: true, installerGatekeeperAccepted: true };
  const state = {
    source: { ...source }, metadata: { full_name: "example/learning", private: true, permissions: { push: true }, default_branch: "main" },
    localTag: undefined, remoteTag: undefined, assets: [], release: undefined,
    ci: { id: 77, head_sha: commit, status: "completed", conclusion: "success" }, calls: [],
  };
  const uploaded = () => ({ id: 11, name: file, size: manifest.bytes, digest: `sha256:${manifest.sha256}`, state: "uploaded" });
  await configure({ state, manifest, save, uploaded });
  await save(".release/mac/release-manifest.json", manifest);
  const run = async (command, args, options = {}) => {
    state.calls.push({ command, args, options });
    await state.onRun?.(command, args);
    if (state.fail?.(command, args)) throw Error("fixture command failed");
    if (command === "pnpm") return args[0] === "--version" ? "9.15.9" : "";
    if (command === "git") {
      if (args[0] === "remote") return state.pushUrl && args.includes("--push") ? state.pushUrl : pkg.repository.url;
      if (args[0] === "symbolic-ref") return "main";
      if (args[0] === "for-each-ref") return state.localTag ? "refs/tags/v1.2.3" : "";
      if (args[0] === "rev-parse") return state.localTag;
      if (args[0] === "ls-remote") return state.remoteTag ? `${state.remoteTag}\trefs/tags/v1.2.3` : "";
      if (args[0] === "tag") { state.localTag = args[3]; return ""; }
      if (args[0] === "push") {
        if (args[2].startsWith("refs/tags/")) state.remoteTag = state.localTag;
        return "";
      }
    }
    if (command === "gh") {
      if (args[0] === "api") {
        const endpoint = args[3];
        if (endpoint === "repos/example/learning") return JSON.stringify(state.metadata);
        if (endpoint === "repos/example/learning/releases?per_page=100") return JSON.stringify([state.release ? [state.release] : []]);
        if (endpoint === "repos/example/learning/releases/7/assets?per_page=100") return JSON.stringify([state.assets]);
        if (endpoint === "repos/example/learning/releases/7") {
          if (options.input) Object.assign(state.release, JSON.parse(options.input));
          return JSON.stringify(state.release);
        }
        if (endpoint.startsWith("repos/example/learning/actions/workflows/ci.yml/runs?")) return JSON.stringify({ workflow_runs: [state.ci] });
        if (endpoint === "repos/example/learning/actions/runs/77") return JSON.stringify(state.ci);
      }
      if (args[0] === "release" && args[1] === "create") {
        state.release = { id: 7, tag_name: args[2], target_commitish: args[args.indexOf("--target") + 1],
          draft: args.includes("--draft"), prerelease: false, html_url: "https://github.com/example/learning/releases/tag/v1.2.3" };
        return state.release.html_url;
      }
      if (args[0] === "release" && args[1] === "upload") { state.assets = [state.uploadAsset || uploaded()]; return ""; }
      if (args[0] === "run" && args[1] === "watch") return "";
    }
    throw Error(`Unexpected fixture command: ${command} ${args.join(" ")}`);
  };
  const execute = (args = []) => releaseMac(parseOptions(args), { directory, run, sourceIdentity: async () => ({ ...state.source }),
    env: { MACOS_SIGN_IDENTITY: "Developer ID Application: Fixture", APPLE_NOTARY_KEYCHAIN_PROFILE: "fixture" },
    platform: "darwin", arch: "arm64", nodeVersion: "24.19.0", prepareGitleaks: async () => {}, log: () => {}, sleep: async () => {} });
  const did = (command, first, second) => state.calls.some(call => call.command === command && call.args[0] === first && (!second || call.args[1] === second));
  const published = () => state.calls.some(call => call.options.input && JSON.parse(call.options.input).draft === false);
  return { directory, state, manifest, execute, did, published, save };
}

test("default pipeline runs checks before packaging, pushes an exact tag and leaves a DMG-only draft", async t => {
  const f = await fixture(t);
  const receipt = await f.execute();
  assert.equal(receipt.draft, true);
  assert.equal(receipt.sourceCommit, commit);
  assert.equal(f.state.assets.length, 1);
  assert.equal(f.state.assets[0].name, file);
  assert.equal(f.state.remoteTag, commit);
  const steps = f.state.calls.filter(call => call.command === "pnpm").map(call => call.args.join(" "));
  assert.deepEqual(steps, ["--version", "install --frozen-lockfile", "run check", "run check:security", "run build:mac"]);
  assert.equal(f.published(), false);
  assert.equal(f.did("gh", "run", "watch"), false);
  assert.equal(JSON.parse(await readFile(path.join(f.directory, ".release/mac/github-release.json"), "utf8")).draft, true);
  await assert.rejects(stat(path.join(f.directory, ".release/mac-release.lock")), { code: "ENOENT" });
});

test("explicit publish waits for successful CI and rechecks the upload before publishing", async t => {
  const f = await fixture(t);
  const receipt = await f.execute(["--publish"]);
  assert.equal(receipt.draft, false);
  assert.equal(f.state.release.make_latest, "true");
  const watch = f.state.calls.findIndex(call => call.command === "gh" && call.args[0] === "run");
  const publish = f.state.calls.findIndex(call => call.options.input && JSON.parse(call.options.input).draft === false);
  assert(watch >= 0 && publish > watch);
  assert(f.state.calls.slice(watch, publish).some(call => call.args[3]?.includes("/assets?")));
  assert(f.state.calls.every(call => !call.args.includes("--clobber") && !call.args.includes("--force")));
});

test("dry run performs only read operations and creates no lock or receipt", async t => {
  const f = await fixture(t);
  await f.execute(["--dry-run", "--publish"]);
  assert.equal(f.did("pnpm", "install"), false);
  assert.equal(f.did("git", "push"), false);
  assert.equal(f.state.release, undefined);
  await assert.rejects(stat(path.join(f.directory, ".release/mac/github-release.json")), { code: "ENOENT" });
});

test("build-only performs all local gates without accessing GitHub or pushing code/tags", async t => {
  const f = await fixture(t, ({ state }) => { state.remoteTag = otherCommit; });
  const result = await f.execute(["--build-only"]);
  assert.equal(result.localOnly, true);
  assert.equal(f.did("pnpm", "run", "check:security"), true);
  assert.equal(f.did("pnpm", "run", "build:mac"), true);
  assert.equal(f.state.calls.some(call => call.command === "gh"), false);
  assert.equal(f.did("git", "push"), false);
  assert.equal(f.did("git", "tag"), false);
});

test("resume still runs tests and security checks, reusing only this source's existing build", async t => {
  const f = await fixture(t);
  await f.execute(["--resume"]);
  assert(f.state.calls.some(call => call.command === "pnpm" && call.args.join(" ") === "run build:mac --finish-existing"));
  assert(f.did("pnpm", "run", "check:security"));
  assert.equal(f.published(), false);
});

test("resume refuses an old application before running checks or editing a release", async t => {
  const f = await fixture(t);
  await f.save("desktop/apps/desktop/out/XueLearn-darwin-arm64/XueLearn.app/Contents/Resources/build-info.json", { ...source, sourceCommit: otherCommit });
  await assert.rejects(f.execute(["--resume"]), /different source/);
  assert.equal(f.did("pnpm", "install"), false);
  assert.equal(f.did("git", "push"), false);
});

for (const [name, configure, message] of [
  ["dirty source", ({ state }) => { state.source.sourceDirty = true; }, /clean committed/],
  ["a local tag on another commit", ({ state }) => { state.localTag = otherCommit; }, /Local.*different source/],
  ["a remote tag on another commit", ({ state }) => { state.remoteTag = otherCommit; }, /Remote.*different source/],
  ["a published release", ({ state }) => { state.release = { tag_name: "v1.2.3", draft: false }; }, /already published/],
  ["a draft for another commit", ({ state }) => { state.release = { tag_name: "v1.2.3", draft: true, target_commitish: otherCommit }; }, /draft points to different source/],
  ["a different push repository", ({ state }) => { state.pushUrl = "git@github.com:another/repository.git"; }, /fetch\/push URLs/],
  ["multiple push destinations", ({ state }) => { state.pushUrl = "git@github.com:example/learning.git\ngit@github.com:another/repository.git"; }, /fetch\/push URLs/],
]) test(`preflight stops on ${name} without building, pushing or publishing`, async t => {
  const f = await fixture(t, configure);
  await assert.rejects(f.execute(["--publish"]), message);
  assert.equal(f.did("pnpm", "install"), false);
  assert.equal(f.did("git", "push"), false);
  assert.equal(f.published(), false);
});

test("failed dependency audit prevents packaging and all remote writes", async t => {
  const f = await fixture(t, ({ state }) => { state.fail = (cmd, args) => cmd === "pnpm" && args.includes("check:security"); });
  await assert.rejects(f.execute(["--publish"]), /fixture command failed/);
  assert.equal(f.did("pnpm", "run", "build:mac"), false);
  assert.equal(f.did("git", "push"), false);
  assert.equal(f.published(), false);
  await assert.rejects(stat(path.join(f.directory, ".release/mac-release.lock")), { code: "ENOENT" });
});

test("changing source during tests stops before packaging", async t => {
  const f = await fixture(t, ({ state }) => { state.onRun = (cmd, args) => {
    if (cmd === "pnpm" && args.includes("check")) state.source.sourceDirty = true;
  }; });
  await assert.rejects(f.execute(), /clean committed/);
  assert.equal(f.did("pnpm", "run", "build:mac"), false);
  assert.equal(f.did("git", "push"), false);
});

for (const [name, configure, message] of [
  ["failed Gatekeeper", ({ manifest }) => { manifest.gatekeeperAccepted = false; }, /gatekeeperAccepted/],
  ["stale source stamp", ({ manifest }) => { manifest.sourceCommit = otherCommit; }, /different source/],
  ["modified DMG", async ({ save }) => { await save(`.release/mac/${file}`, "changed installer"); }, /Local DMG was modified/],
]) test(`${name} prevents all pushes and uploads`, async t => {
  const f = await fixture(t, configure);
  await assert.rejects(f.execute(["--publish"]), message);
  assert.equal(f.did("git", "push"), false);
  assert.equal(f.did("gh", "release", "upload"), false);
  assert.equal(f.published(), false);
});

test("server-side digest mismatch leaves the release as a draft", async t => {
  const f = await fixture(t, ({ state, uploaded }) => { state.uploadAsset = { ...uploaded(), digest: `sha256:${"0".repeat(64)}` }; });
  await assert.rejects(f.execute(["--publish"]), /SHA-256 does not match/);
  assert.equal(f.state.release.draft, true);
  assert.equal(f.published(), false);
});

test("failed CI leaves the verified DMG in a draft", async t => {
  const f = await fixture(t, ({ state }) => { state.ci.conclusion = "failure"; });
  await assert.rejects(f.execute(["--publish"]), /CI did not succeed/);
  assert.equal(f.state.release.draft, true);
  assert.equal(f.published(), false);
});

test("CI for another commit cannot authorize publication", async t => {
  const f = await fixture(t, ({ state }) => { state.ci.head_sha = otherCommit; });
  await assert.rejects(f.execute(["--publish"]), /exact commit/);
  assert.equal(f.published(), false);
});

test("an interrupted upload resumes the same draft without deleting or replacing assets", async t => {
  const f = await fixture(t, ({ state }) => { state.fail = (cmd, args) => cmd === "gh" && args[0] === "release" && args[1] === "upload"; });
  await assert.rejects(f.execute(), /fixture command failed/);
  assert.equal(f.state.release.draft, true);
  f.state.fail = undefined;
  const result = await f.execute(["--resume"]);
  assert.equal(result.releaseId, 7);
  assert.equal(f.state.calls.filter(call => call.command === "gh" && call.args[1] === "create").length, 1);
  const uploads = f.state.calls.filter(call => call.command === "gh" && call.args[1] === "upload").length;
  await f.execute(["--resume"]);
  assert.equal(f.state.calls.filter(call => call.command === "gh" && call.args[1] === "upload").length, uploads);
  assert.equal(f.state.release.draft, true);
});

test("a concurrent visibility change stops before editing a release", async t => {
  let reads = 0;
  const f = await fixture(t, ({ state }) => { state.onRun = (cmd, args) => {
    if (cmd === "gh" && args[3] === "repos/example/learning" && ++reads === 2) state.metadata.private = false;
  }; });
  await assert.rejects(f.execute(), /visibility or default branch changed/);
  assert.equal(f.did("gh", "release", "create"), false);
  assert.equal(f.published(), false);
});

test("an occupied lock prevents installation and is preserved for its owner", async t => {
  const f = await fixture(t);
  await f.save(".release/mac-release.lock/owner.json", { pid: 123 });
  await assert.rejects(f.execute(), /Another release may be running/);
  assert.equal(f.did("pnpm", "install"), false);
  assert.equal(JSON.parse(await readFile(path.join(f.directory, ".release/mac-release.lock/owner.json"))).pid, 123);
});

test("Gitleaks bootstrap rejects a corrupted download before extracting or executing it", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "xuelearn-tools-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(cmd);
    if (cmd === "gitleaks") throw Error("not installed");
    if (cmd === "curl") await writeFile(args[args.indexOf("--output") + 1], "corrupt archive");
    return "";
  };
  await assert.rejects(ensureGitleaks(directory, "arm64", {}, run), /checksum mismatch/);
  assert.deepEqual(calls, ["gitleaks", "curl"]);
});

test("CLI accepts pnpm's separator but rejects unknown/repeated flags", () => {
  assert.equal(parseOptions([]).publish, false);
  assert.equal(parseOptions(["--", "--publish"]).publish, true);
  assert.throws(() => parseOptions(["--force"]), /Unknown/);
  assert.throws(() => parseOptions(["--publish", "--publish"]), /repeated/);
  assert.throws(() => parseOptions(["--publish", "--build-only"]), /cannot be combined/);
});

test("repository parsing rejects credential URLs and accepts GitHub SSH/HTTPS", () => {
  for (const url of ["https://github.com/example/learning.git", "git@github.com:example/learning.git", "ssh://git@github.com/example/learning.git"])
    assert.equal(repositoryName(url), "example/learning");
  assert.throws(() => repositoryName("https://token@github.com/example/learning.git"), /credential-free/);
  assert.throws(() => repositoryName("https://another.host/example/learning.git"), /GitHub/);
});
