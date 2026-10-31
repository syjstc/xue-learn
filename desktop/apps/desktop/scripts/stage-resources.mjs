#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditPackagedResources, betterSqliteNativeTarget } from "./audit-packaged-resources.mjs";
import { collectLicenseNotices } from "../../../../scripts/collect-license-notices.mjs";
import { releaseSourceIdentity } from "../../../../scripts/release-source-identity.mjs";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(desktopRoot, "../..");
export const stagedResourcesRoot = join(desktopRoot, ".forge-resources");
export const stagedSidecarRoot = join(stagedResourcesRoot, "local-sidecar");
export const stagedRendererRoot = join(stagedResourcesRoot, "desktop-renderer");
const localRequire = createRequire(join(workspaceRoot, "package.json"));

function packageRoot(entryPoint) {
  let candidate = dirname(realpathSync(entryPoint));
  while (!existsSync(join(candidate, "package.json"))) {
    const parent = dirname(candidate);
    if (parent === candidate)
      throw new Error(`Cannot resolve package root for ${entryPoint}`);
    candidate = parent;
  }
  return candidate;
}

function resolvePackageManifest(fromRequire, name) {
  try { return fromRequire.resolve(`${name}/package.json`); }
  catch (error) { if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error; return fromRequire.resolve(`${name}/package`); }
}

const betterSqliteRoot = packageRoot(localRequire.resolve("better-sqlite3"));
const sharpRoot = packageRoot(localRequire.resolve("sharp"));
const requireFromSharp = createRequire(join(sharpRoot, "package.json"));
const resvgRoot = packageRoot(localRequire.resolve("@resvg/resvg-js"));
const requireFromResvg = createRequire(join(resvgRoot, "package.json"));
const nodeLlamaRoot = packageRoot(localRequire.resolve("node-llama-cpp"));
const nodeLlamaPackage = JSON.parse(
  await readFile(join(nodeLlamaRoot, "package.json"), "utf8"),
);
const sqliteVecNativeRoot = packageRoot(
  localRequire("sqlite-vec").getLoadablePath(),
);
const sqliteVecNativeName = JSON.parse(
  await readFile(join(sqliteVecNativeRoot, "package.json"), "utf8"),
).name;
const sharpPlatform = process.platform === "win32" ? "win32" : process.platform;
const sharpNativeName = `@img/sharp-${sharpPlatform}-${process.arch}`;
const sharpLibvipsName = `@img/sharp-libvips-${sharpPlatform}-${process.arch}`;
const resvgLibc =
  process.platform === "linux" &&
  !process.report?.getReport().header.glibcVersionRuntime
    ? "-musl"
    : process.platform === "linux"
      ? "-gnu"
      : "";
const resvgNativeName = `@resvg/resvg-js-${process.platform}-${process.arch}${
  process.platform === "win32" ? "-msvc" : resvgLibc
}`;
const webTreeSitterRoot = packageRoot(localRequire.resolve("web-tree-sitter"));
const treeSitterWasmsRoot = packageRoot(
  localRequire.resolve("tree-sitter-wasms/package.json"),
);
const ruffWasmRoot = packageRoot(
  localRequire.resolve("@astral-sh/ruff-wasm-nodejs"),
);
const clangFormatRoot = packageRoot(
  localRequire.resolve("@wasm-fmt/clang-format/package.json"),
);
const resources = [
  [betterSqliteRoot, "better-sqlite3"],
  [packageRoot(localRequire.resolve("@mikro-orm/core")), "@mikro-orm/core"],
  [packageRoot(localRequire.resolve("@mikro-orm/sqlite")), "@mikro-orm/sqlite"],
  [packageRoot(localRequire.resolve("@mikro-orm/sql")), "@mikro-orm/sql"],
  [
    packageRoot(localRequire.resolve("@mikro-orm/migrations")),
    "@mikro-orm/migrations",
  ],
  [packageRoot(localRequire.resolve("sqlite-vec")), "sqlite-vec"],
  [sqliteVecNativeRoot, sqliteVecNativeName],
  [sharpRoot, "sharp"],
  [resvgRoot, "@resvg/resvg-js"],
  [packageRoot(requireFromResvg.resolve(resvgNativeName)), resvgNativeName],
  [packageRoot(requireFromSharp.resolve("@img/colour")), "@img/colour"],
  [packageRoot(requireFromSharp.resolve("detect-libc")), "detect-libc"],
  [packageRoot(requireFromSharp.resolve("semver")), "semver"],
  [
    packageRoot(
      resolvePackageManifest(requireFromSharp, sharpNativeName),
    ),
    sharpNativeName,
  ],
  [
    packageRoot(
      resolvePackageManifest(requireFromSharp, sharpLibvipsName),
    ),
    sharpLibvipsName,
  ],
  [webTreeSitterRoot, "web-tree-sitter"],
  [treeSitterWasmsRoot, "tree-sitter-wasms"],
  [ruffWasmRoot, "@astral-sh/ruff-wasm-nodejs"],
  [clangFormatRoot, "@wasm-fmt/clang-format"],
];

function collectPackageClosure(
  packageName,
  fromRequire,
  collected = new Map(),
) {
  let root;
  try {
    root = packageRoot(fromRequire.resolve(packageName));
  } catch {
    return collected;
  }
  if (collected.has(root)) return collected;
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entry = {
    name: manifest.name ?? packageName,
    root,
    dependencies: [],
  };
  collected.set(root, entry);
  const requireFromPackage = createRequire(join(root, "package.json"));
  for (const dependency of [
    ...Object.keys(manifest.name === "better-sqlite3" ? {} : manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]) {
    try {
      entry.dependencies.push(
        packageRoot(requireFromPackage.resolve(dependency)),
      );
    } catch {
      continue;
    }
    collectPackageClosure(dependency, requireFromPackage, collected);
  }
  return collected;
}

const nodeLlamaPackageGraph = collectPackageClosure(
  "node-llama-cpp",
  localRequire,
);
for (const packageName of ["@mikro-orm/sqlite", "@mikro-orm/migrations"]) {
  collectPackageClosure(packageName, localRequire, nodeLlamaPackageGraph);
}
const nodeLlamaTopLevelPackages = new Map();
for (const entry of nodeLlamaPackageGraph.values()) {
  if (!nodeLlamaTopLevelPackages.has(entry.name)) {
    nodeLlamaTopLevelPackages.set(entry.name, entry);
    resources.push([entry.root, entry.name]);
  }
}

async function stageNestedPackageConflicts(entry, destination, ancestors) {
  const nextAncestors = new Set(ancestors).add(entry.root);
  for (const dependencyRoot of entry.dependencies) {
    const dependency = nodeLlamaPackageGraph.get(dependencyRoot);
    if (!dependency || nextAncestors.has(dependency.root)) continue;
    const topLevel = nodeLlamaTopLevelPackages.get(dependency.name);
    if (topLevel?.root === dependency.root) continue;
    const dependencyDestination = join(
      destination,
      "node_modules",
      dependency.name,
    );
    await cp(dependency.root, dependencyDestination, {
      recursive: true,
      dereference: true,
      filter: skipDebugAssets,
    });
    await stageNestedPackageConflicts(
      dependency,
      dependencyDestination,
      nextAncestors,
    );
  }
}

export async function stageElectronResources() {
  const sidecarBuild = join(workspaceRoot, "dist/apps/local-runtime");
  const rendererBuild = join(workspaceRoot, "dist-desktop");
  for (const required of [sidecarBuild, rendererBuild]) {
    if (!existsSync(required))
      throw new Error(`Missing desktop package input: ${required}`);
  }
  await rm(stagedResourcesRoot, { recursive: true, force: true });
  await mkdir(join(stagedSidecarRoot, "node_modules"), { recursive: true });
  await cp(sidecarBuild, stagedSidecarRoot, {
    recursive: true,
    dereference: true,
    filter: skipDebugAssets,
  });
  // Bundled Emscripten still looks next to main.js. Keep a copy there even
  // after web-tree-sitter is staged as a real node_modules package.
  await cp(
    join(webTreeSitterRoot, "tree-sitter.wasm"),
    join(stagedSidecarRoot, "tree-sitter.wasm"),
  );
  await cp(
    join(workspaceRoot, "node_modules/@xue-learn/core/sources/libs/server/src/teaching-skills/builtin"),
    join(stagedSidecarRoot, "teaching-skills/builtin"),
    { recursive: true, dereference: true },
  );
  await cp(join(workspaceRoot, "node_modules/@xue-learn/core/resources/guided-image-refine.py"), join(stagedSidecarRoot, "guided-image-refine.py"));
  await mkdir(join(stagedSidecarRoot, "fonts"), { recursive: true });
  for (const weight of ["400Regular", "700Bold"]) {
    const filename = `NotoSansSC_${weight}.ttf`;
    await cp(
      join(workspaceRoot, "node_modules/@expo-google-fonts/noto-sans-sc", weight, filename),
      join(stagedSidecarRoot, "fonts", filename),
    );
  }
  await cp(join(workspaceRoot, "node_modules/@expo-google-fonts/noto-sans-sc/LICENSE_FONT"),
    join(stagedSidecarRoot, "fonts/NotoSansSC-LICENSE.txt"));
  await cp(rendererBuild, stagedRendererRoot, {
    recursive: true,
    dereference: true,
    filter: skipDebugAssets,
  });
  for (const [from, name] of resources) {
    await cp(from, join(stagedSidecarRoot, "node_modules", name), {
      recursive: true,
      dereference: true,
      filter: skipDebugAssets,
    });
  }
  for (const entry of nodeLlamaTopLevelPackages.values()) {
    await stageNestedPackageConflicts(
      entry,
      join(stagedSidecarRoot, "node_modules", entry.name),
      new Set(),
    );
  }
  const sharpPackage = JSON.parse(
    await readFile(join(sharpRoot, "package.json"), "utf8"),
  );
  await writeFile(
    join(stagedSidecarRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@xue-learn/packaged-local-sidecar",
        version: localRequire("./apps/desktop/package.json").version,
        private: true,
        dependencies: {
          "better-sqlite3": localRequire("better-sqlite3/package.json").version,
          "@mikro-orm/core": localRequire("@mikro-orm/core/package.json")
            .version,
          "@mikro-orm/sqlite": localRequire("@mikro-orm/sqlite/package.json")
            .version,
          "@mikro-orm/sql": localRequire("@mikro-orm/sql/package.json").version,
          "@mikro-orm/migrations": localRequire(
            "@mikro-orm/migrations/package.json",
          ).version,
          sharp: sharpPackage.version,
          "@resvg/resvg-js": localRequire("@resvg/resvg-js/package.json")
            .version,
          "node-llama-cpp": nodeLlamaPackage.version,
          "web-tree-sitter": localRequire("web-tree-sitter/package.json")
            .version,
          "tree-sitter-wasms": localRequire("tree-sitter-wasms/package.json")
            .version,
          "@astral-sh/ruff-wasm-nodejs": localRequire(
            "@astral-sh/ruff-wasm-nodejs/package.json",
          ).version,
          "@wasm-fmt/clang-format": localRequire(
            "@wasm-fmt/clang-format/package.json",
          ).version,
        },
      },
      null,
      2,
    )}\n`,
  );
  // better-sqlite3 13 ships Node-API binaries shared by Node and Electron.
  // Keep the target prebuild; do not rebuild a V8-specific addon for Electron.
  await pruneStagedReleasePayload(stagedResourcesRoot);
  await collectLicenseNotices(join(stagedResourcesRoot, "licenses"));
  await writeFile(join(stagedResourcesRoot, "build-info.json"), JSON.stringify({
    ...await releaseSourceIdentity(),
    version: localRequire("./apps/desktop/package.json").version,
    coreVersion: localRequire("@xue-learn/core/package.json").version,
    electronVersion: localRequire("electron/package.json").version,
  }, null, 2) + "\n");
  await auditPackagedResources(stagedResourcesRoot);
  const stagedNodeLlama = await import(
    pathToFileURL(
      join(stagedSidecarRoot, "node_modules/node-llama-cpp/dist/index.js"),
    ).href
  );
  if (typeof stagedNodeLlama.getLlama !== "function") {
    throw new Error("Staged node-llama-cpp runtime is not loadable");
  }
}

function skipDebugAssets(source) {
  if (source.endsWith(".map")) return false;
  if (source.endsWith(".woff") && !source.endsWith(".woff2")) return false;
  return true;
}

export async function pruneStagedReleasePayload(resourcesRoot) {
  await removeMatchingFiles(resourcesRoot, (file) => !skipDebugAssets(file));
  const sqliteRoot = join(
    resourcesRoot,
    "local-sidecar",
    "node_modules",
    "better-sqlite3",
  );
  await rm(join(sqliteRoot, "deps"), { recursive: true, force: true });
  await rm(join(sqliteRoot, "src"), { recursive: true, force: true });
  await rm(join(sqliteRoot, "build"), { recursive: true, force: true });
  for (const file of await readdir(join(sqliteRoot, "prebuilds"))) {
    if (file !== `${betterSqliteNativeTarget}.node`)
      await rm(join(sqliteRoot, "prebuilds", file), { recursive: true, force: true });
  }
  // The reviewed native llama.cpp binary is staged separately. Its C/C++
  // source tree is build-time input and must not inflate the desktop runtime.
  await rm(
    join(
      resourcesRoot,
      "local-sidecar",
      "node_modules",
      "node-llama-cpp",
      "llama",
      "gitRelease.bundle",
    ),
    { force: true },
  );
}

async function removeMatchingFiles(root, shouldRemove) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      await removeMatchingFiles(full, shouldRemove);
      continue;
    }
    if (shouldRemove(full)) await rm(full, { force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  stageElectronResources()
    .then(() =>
      process.stdout.write(
        `Staged and audited Electron resources: ${stagedResourcesRoot}\n`,
      ),
    )
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
