import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ignorePackagedAppPath } from "./packager-ignore";

const execFileAsync = promisify(execFile);
const auditScript = join(__dirname, "../scripts/audit-packaged-resources.mjs");

describe("host package boundary", () => {
  it("keeps all executable host bundles and their parent directory", () => {
    for (const path of [
      "", "/", "/package.json", "/dist", "/dist/main.js",
      "/dist/preload.js", "/dist/cloudkit-bridge-preload.js",
      "/dist/plugins", "/dist/plugins/worker.js",
    ]) {
      expect(ignorePackagedAppPath(path)).toBe(false);
    }
  });

  it("excludes signing credentials, learner data, sources and debug files", () => {
    for (const path of [
      "/.env.packaging", "/data", "/data/workspaces/learner.sqlite",
      "/src/main.ts", "/node_modules", "/.forge-resources",
      "/dist/main.js.map", "/.git", "\\data\\credentials.v1.enc.json",
    ]) {
      expect(ignorePackagedAppPath(path)).toBe(true);
    }
  });
});
const nativePlatform =
  process.platform === "win32" ? "windows" : process.platform;
const sharpPlatform = process.platform === "win32" ? "win32" : process.platform;
const nativeExtension =
  process.platform === "darwin"
    ? ".dylib"
    : process.platform === "win32"
      ? ".dll"
      : ".so";
const sqliteVecLibrary =
  process.platform === "darwin"
    ? "vec0.dylib"
    : process.platform === "win32"
      ? "vec0.dll"
      : "vec0.so";
const sqliteVecPackage = `sqlite-vec-${nativePlatform}-${process.arch}`;
const sharpNativePackage = `@img/sharp-${sharpPlatform}-${process.arch}`;
const sharpLibvipsPackage = `@img/sharp-libvips-${sharpPlatform}-${process.arch}`;
const runtimeReport = process.report?.getReport() as
  { header?: { glibcVersionRuntime?: string } } | undefined;
const resvgLibc =
  process.platform === "linux" && !runtimeReport?.header?.glibcVersionRuntime
    ? "-musl"
    : process.platform === "linux"
      ? "-gnu"
      : "";
const resvgNativePackage = `@resvg/resvg-js-${process.platform}-${process.arch}${
  process.platform === "win32" ? "-msvc" : resvgLibc
}`;
const nodeLlamaNativePackage =
  process.platform === "darwin"
    ? `@node-llama-cpp/mac-${process.arch}${process.arch === "arm64" ? "-metal" : ""}`
    : `@node-llama-cpp/${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
const required = [
  "licenses/LICENSE.txt",
  "licenses/LICENSING.md",
  "licenses/THIRD_PARTY_LICENSES.txt",
  "licenses/desktop-LICENSE-BRAND",
  "local-sidecar/main.js",
  "local-sidecar/tree-sitter.wasm",
  "local-sidecar/teaching-skills/builtin/general-teaching/SKILL.md",
  "local-sidecar/teaching-skills/builtin/general-teaching/xuelearn.json",
  "local-sidecar/teaching-skills/builtin/language-learning/SKILL.md",
  "local-sidecar/teaching-skills/builtin/coding-by-building/SKILL.md",
  "local-sidecar/teaching-skills/builtin/mathematics/SKILL.md",
  "local-sidecar/fonts/NotoSansSC_400Regular.ttf",
  "local-sidecar/fonts/NotoSansSC_700Bold.ttf",
  "local-sidecar/fonts/NotoSansSC-LICENSE.txt",
  "local-sidecar/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  `local-sidecar/node_modules/${sqliteVecPackage}/${sqliteVecLibrary}`,
  "local-sidecar/node_modules/node-llama-cpp/package.json",
  `local-sidecar/node_modules/${nodeLlamaNativePackage}/package.json`,
  `local-sidecar/node_modules/${nodeLlamaNativePackage}/bins/test/llama-addon.node`,
  "local-sidecar/node_modules/sharp/package.json",
  "local-sidecar/node_modules/sharp/dist/index.cjs",
  "local-sidecar/node_modules/sharp/dist/input.cjs",
  "local-sidecar/node_modules/@img/colour/package.json",
  "local-sidecar/node_modules/detect-libc/package.json",
  "local-sidecar/node_modules/semver/package.json",
  `local-sidecar/node_modules/${sharpNativePackage}/package.json`,
  `local-sidecar/node_modules/${sharpLibvipsPackage}/package.json`,
  "local-sidecar/node_modules/@resvg/resvg-js/package.json",
  `local-sidecar/node_modules/${resvgNativePackage}/package.json`,
  `local-sidecar/node_modules/${sharpNativePackage}/lib/sharp-${process.arch}-test.node`,
  `local-sidecar/node_modules/${sharpLibvipsPackage}/lib/libvips-test${nativeExtension}`,
  "local-sidecar/node_modules/web-tree-sitter/tree-sitter.js",
  "local-sidecar/node_modules/web-tree-sitter/tree-sitter.wasm",
  "local-sidecar/node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
  "local-sidecar/node_modules/@astral-sh/ruff-wasm-nodejs/ruff_wasm.js",
  "local-sidecar/node_modules/@astral-sh/ruff-wasm-nodejs/ruff_wasm_bg.wasm",
  "local-sidecar/node_modules/@wasm-fmt/clang-format/clang-format-node.js",
  "local-sidecar/node_modules/@wasm-fmt/clang-format/clang-format.wasm",
  "desktop-renderer/index.html",
];

const nativePaths = new Set([
  "local-sidecar/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  `local-sidecar/node_modules/${sqliteVecPackage}/${sqliteVecLibrary}`,
  `local-sidecar/node_modules/${nodeLlamaNativePackage}/bins/test/llama-addon.node`,
  `local-sidecar/node_modules/${sharpNativePackage}/lib/sharp-${process.arch}-test.node`,
  `local-sidecar/node_modules/${sharpLibvipsPackage}/lib/libvips-test${nativeExtension}`,
]);
const resvgNativeFile = `local-sidecar/node_modules/${resvgNativePackage}/resvgjs.${resvgNativePackage.slice("@resvg/resvg-js-".length)}.node`;
required.push(resvgNativeFile);
nativePaths.add(resvgNativeFile);

function nativeFixture(): Buffer {
  if (process.platform === "linux") {
    const buffer = Buffer.alloc(20);
    buffer.write("ELF", 1, "ascii");
    buffer[0] = 0x7f;
    buffer.writeUInt16LE(process.arch === "arm64" ? 183 : 62, 18);
    return buffer;
  }
  if (process.platform === "win32") {
    const buffer = Buffer.alloc(128);
    buffer.write("MZ", 0, "ascii");
    buffer.writeUInt32LE(64, 0x3c);
    buffer.writeUInt16LE(process.arch === "arm64" ? 0xaa64 : 0x8664, 68);
    return buffer;
  }
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0xcffaedfe, 0);
  buffer.writeUInt32LE(process.arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  return buffer;
}

async function writeAuditFixture(resources: string): Promise<void> {
  for (const relativePath of required) {
    const path = join(resources, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      nativePaths.has(relativePath) ? nativeFixture() : "present",
    );
  }
}

describe("packaged resource audit", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "xuelearn-package-audit-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("accepts a Forge output containing every runtime and native resource", async () => {
    const resources = join(
      directory,
      "XueLearn-darwin-arm64",
      "XueLearn.app",
      "Contents",
      "Resources",
    );
    await writeAuditFixture(resources);
    await expect(
      execFileAsync(process.execPath, [auditScript, directory]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("audit passed"),
    });
  });

  it("fails with the exact missing native resource", async () => {
    const resources = join(directory, "XueLearn.app", "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await expect(
      execFileAsync(process.execPath, [auditScript, directory]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("better_sqlite3.node"),
    });
  });

  it("fails when Sharp's platform native module is missing", async () => {
    const resources = join(directory, "XueLearn.app", "Contents", "Resources");
    await writeAuditFixture(resources);
    await rm(
      join(
        resources,
        `local-sidecar/node_modules/${sharpNativePackage}/lib/sharp-${process.arch}-test.node`,
      ),
    );
    await expect(
      execFileAsync(process.execPath, [auditScript, directory]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Sharp arm64 native module"),
    });
  });

  it("fails when Sharp's CommonJS runtime dependency is missing", async () => {
    const resources = join(directory, "XueLearn.app", "Contents", "Resources");
    await writeAuditFixture(resources);
    await rm(
      join(resources, "local-sidecar/node_modules/sharp/dist/input.cjs"),
    );
    await expect(
      execFileAsync(process.execPath, [auditScript, directory]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("sharp/dist/input.cjs"),
    });
  });

  it("fails when a sidecar sourcemap is staged", async () => {
    const resources = join(directory, "XueLearn.app", "Contents", "Resources");
    await writeAuditFixture(resources);
    await writeFile(join(resources, "local-sidecar/main.js.map"), "debug");
    await expect(
      execFileAsync(process.execPath, [auditScript, directory]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unexpected local-sidecar/main.js.map"),
    });
  });

  it("fails when private film resources leak into the learning package", async () => {
    const resources = join(directory, "XueLearn.app", "Contents", "Resources");
    await writeAuditFixture(resources);
    await mkdir(join(resources,"desktop-renderer/live2d"));
    await expect(execFileAsync(process.execPath,[auditScript,directory])).rejects.toMatchObject({
      stderr:expect.stringContaining("unexpected desktop-renderer/live2d"),
    });
  });

  it.each(["local-sidecar/.env.packaging", "local-sidecar/credentials.v1.enc.json", "desktop-renderer/learner.sqlite", "local-sidecar/AuthKey_example.p8"])("rejects accidental private payload %s", async (file) => {
    const resources = join(directory, "XueLearn.app", "Contents", "Resources");
    await writeAuditFixture(resources);
    await writeFile(join(resources, file), "private fixture");
    await expect(execFileAsync(process.execPath, [auditScript, directory])).rejects.toMatchObject({
      stderr: expect.stringContaining(`unexpected ${file}`),
    });
  });
});
