#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const nativePlatform =
  process.platform === "win32" ? "windows" : process.platform;
const sharpPlatform = process.platform === "win32" ? "win32" : process.platform;
const sqliteVecPackage = `sqlite-vec-${nativePlatform}-${process.arch}`;
const sharpNativePackage = `@img/sharp-${sharpPlatform}-${process.arch}`;
const sharpLibvipsPackage = `@img/sharp-libvips-${sharpPlatform}-${process.arch}`;
const resvgLibc =
  process.platform === "linux" &&
  !process.report?.getReport().header.glibcVersionRuntime
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
const sqliteVecLibrary =
  process.platform === "darwin"
    ? "vec0.dylib"
    : process.platform === "win32"
      ? "vec0.dll"
      : "vec0.so";
export const REQUIRED_PACKAGED_RESOURCES = [
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
  "local-sidecar/node_modules/sharp/package.json",
  // Sharp's CommonJS entrypoint imports input.cjs at runtime. Keep both
  // files explicit so a staged package cannot pass manifest/native checks
  // while still failing during sidecar startup.
  "local-sidecar/node_modules/sharp/dist/index.cjs",
  "local-sidecar/node_modules/sharp/dist/input.cjs",
  "local-sidecar/node_modules/@img/colour/package.json",
  "local-sidecar/node_modules/detect-libc/package.json",
  "local-sidecar/node_modules/semver/package.json",
  `local-sidecar/node_modules/${sharpNativePackage}/package.json`,
  `local-sidecar/node_modules/${sharpLibvipsPackage}/package.json`,
  "local-sidecar/node_modules/@resvg/resvg-js/package.json",
  `local-sidecar/node_modules/${resvgNativePackage}/package.json`,
  "local-sidecar/node_modules/web-tree-sitter/tree-sitter.js",
  "local-sidecar/node_modules/web-tree-sitter/tree-sitter.wasm",
  "local-sidecar/node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
  "local-sidecar/node_modules/@astral-sh/ruff-wasm-nodejs/ruff_wasm.js",
  "local-sidecar/node_modules/@astral-sh/ruff-wasm-nodejs/ruff_wasm_bg.wasm",
  "local-sidecar/node_modules/@wasm-fmt/clang-format/clang-format-node.js",
  "local-sidecar/node_modules/@wasm-fmt/clang-format/clang-format.wasm",
  "desktop-renderer/index.html",
];

// Package manifests alone do not prove that Sharp can load on the target
// architecture. Keep the native filenames version-agnostic while requiring
// one non-empty ABI module and one libvips dylib in the staged tree.
export const FORBIDDEN_PACKAGED_PATHS = [
  "desktop-renderer/live2d",
  "native-video",
  "local-sidecar/main.js.map",
  "local-sidecar/persistence-reference.js.map",
  "local-sidecar/node_modules/better-sqlite3/deps",
  "local-sidecar/node_modules/better-sqlite3/src",
  "local-sidecar/node_modules/node-llama-cpp/llama/gitRelease.bundle",
];

export const REQUIRED_PACKAGED_NATIVE_RESOURCES = [
  {
    directory: `local-sidecar/node_modules/${resvgNativePackage}`,
    extension: ".node",
    label: `resvg ${process.arch} native module`,
  },
  {
    directory: `local-sidecar/node_modules/${nodeLlamaNativePackage}/bins`,
    extension: ".node",
    label: `llama.cpp ${process.arch} native module`,
  },
  {
    directory: `local-sidecar/node_modules/${sharpNativePackage}/lib`,
    extension: ".node",
    label: `Sharp ${process.arch} native module`,
  },
  {
    directory: `local-sidecar/node_modules/${sharpLibvipsPackage}/lib`,
    extension:
      process.platform === "darwin"
        ? ".dylib"
        : process.platform === "win32"
          ? ".dll"
          : ".so",
    label: `Sharp ${process.arch} libvips library`,
  },
];

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function findAppBundles(root, depth = 0) {
  if (basename(root).endsWith(".app")) return [root];
  if (depth > 4 || !(await isDirectory(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => findAppBundles(join(root, entry.name), depth + 1)),
  );
  return nested.flat();
}

async function findResourcesRoots(root, depth = 0) {
  if (depth > 7 || !(await isDirectory(root))) return [];
  if (await isDirectory(join(root, "local-sidecar"))) return [root];
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => findResourcesRoots(join(root, entry.name), depth + 1)),
  );
  return nested.flat();
}

export async function resolveResourcesRoot(input) {
  const target = resolve(input);
  if (await isDirectory(join(target, "local-sidecar"))) return target;
  if (basename(target) === "Resources") return target;
  if (basename(target).endsWith(".app"))
    return join(target, "Contents", "Resources");
  const resourceRoots = await findResourcesRoots(target);
  if (resourceRoots.length === 1) return resourceRoots[0];
  const bundles = await findAppBundles(target);
  if (bundles.length !== 1) {
    throw new Error(
      `Expected exactly one .app bundle below ${target}; found ${bundles.length}`,
    );
  }
  return join(bundles[0], "Contents", "Resources");
}

export async function auditPackagedResources(input) {
  const resourcesRoot = await resolveResourcesRoot(input);
  const missing = [];
  for (const relativePath of REQUIRED_PACKAGED_RESOURCES) {
    try {
      const file = await stat(join(resourcesRoot, relativePath));
      if (!file.isFile() || file.size === 0) missing.push(relativePath);
    } catch {
      missing.push(relativePath);
    }
  }
  const nativeFiles = [];
  for (const required of REQUIRED_PACKAGED_NATIVE_RESOURCES) {
    const found = await findFirstByExtension(
      join(resourcesRoot, required.directory),
      required.extension,
    );
    if (!found) {
      missing.push(
        `${required.directory}/*${required.extension} (${required.label})`,
      );
    } else {
      nativeFiles.push(found);
    }
  }
  for (const relativePath of [
    "local-sidecar/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    `local-sidecar/node_modules/${sqliteVecPackage}/${sqliteVecLibrary}`,
    ...nativeFiles.map((path) => relative(resourcesRoot, path)),
  ]) {
    try {
      await assertNativeArchitecture(join(resourcesRoot, relativePath));
    } catch (error) {
      missing.push(
        `${relativePath} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  const forbidden = [];
  for (const relativePath of FORBIDDEN_PACKAGED_PATHS) {
    try {
      await stat(join(resourcesRoot, relativePath));
      forbidden.push(relativePath);
    } catch {
      // Absence is the release invariant.
    }
  }
  forbidden.push(...(await findForbiddenDebugAssets(resourcesRoot)));
  if (missing.length > 0 || forbidden.length > 0) {
    const details = [
      ...missing.map((path) => `- missing ${path}`),
      ...forbidden.map((path) => `- unexpected ${path}`),
    ].join("\n");
    throw new Error(
      `Packaged resource audit failed in ${resourcesRoot}:\n${details}`,
    );
  }
  return {
    resourcesRoot,
    checked: [
      ...REQUIRED_PACKAGED_RESOURCES,
      ...REQUIRED_PACKAGED_NATIVE_RESOURCES.map(
        ({ directory, extension }) => `${directory}/*${extension}`,
      ),
      ...FORBIDDEN_PACKAGED_PATHS.map((path) => `absent ${path}`),
    ],
  };
}

async function findFirstByExtension(root, extension) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFirstByExtension(full, extension);
      if (nested) return nested;
    } else if (entry.name.endsWith(extension) && (await stat(full)).size > 0) {
      return full;
    }
  }
  return null;
}

async function assertNativeArchitecture(path) {
  const buffer = await readFile(path);
  let architecture;
  if (buffer[0] === 0x7f && buffer.toString("ascii", 1, 4) === "ELF") {
    const machine = buffer.readUInt16LE(18);
    architecture =
      machine === 62 ? "x64" : machine === 183 ? "arm64" : "unknown";
  } else if (buffer.toString("ascii", 0, 2) === "MZ") {
    const header = buffer.readUInt32LE(0x3c);
    const machine = buffer.readUInt16LE(header + 4);
    architecture =
      machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : "unknown";
  } else {
    const magic = buffer.readUInt32BE(0);
    const littleEndian = magic === 0xcffaedfe || magic === 0xcefaedfe;
    const cpu = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
    architecture =
      cpu === 0x01000007 ? "x64" : cpu === 0x0100000c ? "arm64" : "unknown";
  }
  if (architecture !== process.arch) {
    throw new Error(
      `native architecture ${architecture}, expected ${process.arch}`,
    );
  }
}

async function findForbiddenDebugAssets(root) {
  const extra = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (
        entry.name.endsWith(".map") ||
        (entry.name.endsWith(".woff") && !entry.name.endsWith(".woff2"))
      ) {
        extra.push(relative(root, full));
      }
    }
  }
  await visit(root);
  return extra;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const input = process.argv[2] ?? join(process.cwd(), "out");
  auditPackagedResources(input)
    .then(({ resourcesRoot, checked }) => {
      process.stdout.write(
        `Packaged resource audit passed: ${resourcesRoot} (${checked.length} checks; model downloaded separately)\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
