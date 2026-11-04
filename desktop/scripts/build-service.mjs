#!/usr/bin/env node
/**
 * Fast NestJS service bundle: SWC (decorator metadata) + esbuild.
 * Replaces per-app webpack configs for production builds.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformFileSync } from "@swc/core";
import * as esbuild from "esbuild";
import { createMatchPath, loadConfig } from "tsconfig-paths";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const service = process.argv[2];

if (!service) {
  console.error("Usage: node scripts/build-service.mjs <service-name>");
  process.exit(1);
}

const appDir = join(root, "apps", service);
const tsconfigFile = join(appDir, "tsconfig.app.json");
// Other local hosts reuse this exact learning service composition and build
// pipeline, providing only their process/model transport entry point.
const entry = service === "local-runtime" && process.env.XUELEARN_LOCAL_RUNTIME_ENTRY
  ? resolve(process.env.XUELEARN_LOCAL_RUNTIME_ENTRY)
  : join(appDir, "src/main.ts");
const localRuntimeOutput =
  service === "local-runtime" && process.env.XUELEARN_LOCAL_RUNTIME_BUILD_DIR
    ? resolve(root, process.env.XUELEARN_LOCAL_RUNTIME_BUILD_DIR)
    : null;
const outfile =
  service === "generation-service"
    ? join(appDir, "dist/main.js")
    : join(localRuntimeOutput ?? join(root, "dist/apps", service), "main.js");
const templateSrc = join(appDir, "src/templates");
const templateOut =
  service === "generation-service"
    ? join(appDir, "dist/templates")
    : join(localRuntimeOutput ?? join(root, "dist/apps", service), "templates");
const persistenceReferenceOut = join(
  dirname(outfile),
  "persistence-reference.js",
);

const localRuntimeExternals = [
  "better-sqlite3",
  // Sharp is ESM and resolves a platform-native libvips package via
  // import.meta.url. Bundling it into this CJS artifact corrupts that lookup;
  // Forge stages the package and its arm64 native dependencies.
  "sharp",
  // resvg loads a platform-specific N-API module at runtime. Keep both the
  // wrapper and native package outside the sidecar bundle for Forge staging.
  "@resvg/resvg-js",
  "@resvg/resvg-js-*",
  "sqlite-vec",
  "sqlite-vec-*",
  "node-llama-cpp",
  // Keep MikroORM and its EntitySchema constructors external. The shared
  // reference graph and driver must see the same core module instance.
  "@mikro-orm/core",
  "@mikro-orm/sqlite",
  "@mikro-orm/sql",
  "@mikro-orm/migrations",
  // WASM syntax tools load sibling .wasm files from __dirname / import.meta.url.
  // Bundling them into main.js makes Emscripten look for tree-sitter.wasm next
  // to the sidecar bundle. Forge stages these packages beside the sidecar.
  "web-tree-sitter",
  "tree-sitter-wasms",
  "tree-sitter-wasms/*",
  "@astral-sh/ruff-wasm-nodejs",
  "@wasm-fmt/clang-format",
  "@nestjs/microservices",
  "@nestjs/microservices/*",
  "@nestjs/websockets/*",
];

// Workspace aliases are declared in the root config. Loading an app config (or
// its directory) makes inherited path values relative to that app with
// tsconfig-paths, leaving @cognilearn imports as runtime requires in production.
const configResult = loadConfig(join(root, "tsconfig.base.json"));
if (configResult.resultType === "failed") {
  console.error(
    `Failed to load tsconfig for ${service}: ${configResult.message}`,
  );
  process.exit(1);
}

const matchPath = createMatchPath(
  configResult.absoluteBaseUrl,
  configResult.paths,
  configResult.mainFields,
  configResult.addMatchAll,
);

function resolveImportPath(request) {
  const matched = matchPath(request, existsSync, undefined, [
    ".ts",
    ".tsx",
    ".js",
    ".json",
  ]);
  if (!matched) return null;

  const candidates = [matched];
  for (const ext of [".ts", ".tsx", ".js", ".json"]) {
    candidates.push(`${matched}${ext}`);
  }
  for (const ext of [".ts", ".tsx", ".js"]) {
    candidates.push(join(matched, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    if (statSync(candidate).isDirectory()) {
      for (const ext of [".ts", ".tsx", ".js"]) {
        const indexPath = join(candidate, `index${ext}`);
        if (existsSync(indexPath)) return indexPath;
      }
      continue;
    }
    return candidate;
  }

  return null;
}

function tsconfigPathsPlugin() {
  return {
    name: "tsconfig-paths",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace !== "file") return;
        if (args.path.startsWith(".") || args.path.startsWith("/")) return;

        const resolved = resolveImportPath(args.path);
        if (resolved) return { path: resolved };
      });
    },
  };
}

function swcPlugin() {
  return {
    name: "swc",
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, (args) => {
        const result = transformFileSync(args.path, {
          jsc: {
            parser: {
              syntax: "typescript",
              tsx: args.path.endsWith(".tsx"),
              decorators: true,
            },
            transform: {
              legacyDecorator: true,
              decoratorMetadata: true,
            },
            target: "es2022",
          },
          module: { type: "es6" },
          sourceMaps: true,
        });
        return { contents: result.code, loader: "js" };
      });
    },
  };
}

mkdirSync(dirname(outfile), { recursive: true });

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/**
 * node-fetch@2 optionally requires `encoding` (iconv-lite) for non-UTF8
 * bodies. pnpm may leave that optional tree incomplete, and tesseract.js
 * still pulls node-fetch into the sidecar graph. UTF-8 fetch works without
 * it, so stub the optional package instead of failing the bundle.
 */
function stubOptionalFetchEncodingPlugin() {
  return {
    name: "stub-optional-fetch-encoding",
    setup(build) {
      if (service !== "local-runtime") return;
      build.onResolve({ filter: /^encoding$/ }, () => ({
        path: "encoding",
        namespace: "encoding-stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "encoding-stub" }, () => ({
        contents:
          "exports.convert = function convert(str) { return Buffer.from(str ?? ''); };",
        loader: "js",
      }));
    },
  };
}

const mainBuildOptions = {
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile,
  sourcemap: !production,
  minify: production,
  // Nest/SWC decorator metadata and DI tokens resolve by constructor name.
  keepNames: true,
  legalComments: production ? "none" : "inline",
  // The desktop-local utility process is shipped as a standalone resource.
  // Bundle its JS dependency graph; keep native and WASM sibling-file packages
  // external so Forge can stage them next to the sidecar.
  packages: service === "local-runtime" ? undefined : "external",
  external:
    service === "local-runtime"
      ? localRuntimeExternals
      : undefined,
  logLevel: "warning",
  metafile: service === "local-runtime",
  plugins: [
    stubOptionalFetchEncodingPlugin(),
    tsconfigPathsPlugin(),
    swcPlugin(),
  ],
};

const persistenceBuildOptions = {
  entryPoints: [join(root, "persistence/sqlite/reference/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: persistenceReferenceOut,
  sourcemap: !production,
  minify: production,
  keepNames: true,
  legalComments: production ? "none" : "inline",
  packages: service === "local-runtime" ? undefined : "external",
  external:
    service === "local-runtime"
      ? localRuntimeExternals
      : undefined,
  logLevel: "warning",
  plugins: [
    stubOptionalFetchEncodingPlugin(),
    tsconfigPathsPlugin(),
    swcPlugin(),
  ],
};

function assertNoUnresolvedWorkspaceImports(bundlePath) {
  const bundledSource = readFileSync(bundlePath, "utf8");
  const unresolvedWorkspaceImport = bundledSource.match(
    /require\(["'](@cognilearn\/[^"']+)["']\)/,
  );
  if (unresolvedWorkspaceImport) {
    throw new Error(
      `Production bundle contains unresolved workspace import: ${unresolvedWorkspaceImport[1]}`,
    );
  }
}

function assertNoSharpInMetafile(metafile) {
  if (service !== "local-runtime" || !metafile) return;
  const sharpInputs = Object.keys(metafile.inputs).filter((input) =>
    /(?:^|\/)sharp@[^/]+\/node_modules\/sharp\//.test(input),
  );
  if (sharpInputs.length === 0) return;
  const importers = new Map();
  for (const [input, metadata] of Object.entries(metafile.inputs)) {
    for (const imported of metadata.imports) {
      const parents = importers.get(imported.path) ?? [];
      parents.push(input);
      importers.set(imported.path, parents);
    }
  }
  let frontier = sharpInputs;
  const seen = new Set(frontier);
  for (let depth = 0; depth < 20 && frontier.length > 0; depth += 1) {
    const next = [];
    for (const input of frontier) {
      for (const importer of importers.get(input) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        next.push(importer);
        console.error(`  imported by ${importer}`);
      }
    }
    frontier = next;
  }
  throw new Error(
    "Local runtime bundle must not contain Sharp; use a portable boundary or stage it as an explicit native dependency.",
  );
}

function copyTemplates() {
  if (existsSync(templateSrc)) {
    cpSync(templateSrc, templateOut, { recursive: true });
  }
}

function copyLocalRuntimeWasmAssets() {
  if (service !== "local-runtime") return;
  cpSync(join(root, "node_modules/@xue-learn/core/resources/guided-image-refine.py"), join(dirname(outfile), "guided-image-refine.py"));
  const serviceRequire = createRequire(join(root, "package.json"));
  const katexDirectory = dirname(serviceRequire.resolve("katex/dist/katex.min.css"));
  const pdfFonts = join(dirname(outfile), "reading-pdf/katex");
  mkdirSync(pdfFonts, {recursive: true});
  cpSync(join(katexDirectory, "katex.min.css"), join(pdfFonts, "katex.min.css"));
  cpSync(join(katexDirectory, "fonts"), join(pdfFonts, "fonts"), {recursive: true});
  cpSync(
    serviceRequire.resolve("web-tree-sitter/tree-sitter.wasm"),
    join(dirname(outfile), "tree-sitter.wasm"),
  );
}

async function writeSqliteMigrations() {
  if (service !== "local-runtime") return;
  // Learning schema adoption is bundled from its reviewed manifest. Historical
  // private histories are retained in private compatibility archives only.
  const migrationsOut = join(dirname(outfile), "migrations/sqlite");
  mkdirSync(migrationsOut, { recursive: true });
  for (const file of readdirSync(migrationsOut)) {
    if (file.endsWith(".js")) unlinkSync(join(migrationsOut, file));
  }
}

function removeStaleSourcemap(bundlePath) {
  if (!production) return;
  try {
    unlinkSync(`${bundlePath}.map`);
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
}

async function finishServiceBuild(result, startedAt) {
  if (result.errors?.length) {
    console.error(
      `skipped ${service} finish: ${result.errors.length} build error(s)`,
    );
    return;
  }
  assertNoUnresolvedWorkspaceImports(outfile);
  assertNoSharpInMetafile(result.metafile);
  console.log(`finishing ${service}: persistence reference + migrations`);
  await esbuild.build(persistenceBuildOptions);
  assertNoUnresolvedWorkspaceImports(persistenceReferenceOut);
  removeStaleSourcemap(outfile);
  removeStaleSourcemap(persistenceReferenceOut);
  copyTemplates();
  copyLocalRuntimeWasmAssets();
  await writeSqliteMigrations();
  const ms = Math.round(performance.now() - startedAt);
  console.log(`built ${service} -> ${outfile} (${ms}ms)`);
}

if (watch) {
  const ctx = await esbuild.context({
    ...mainBuildOptions,
    plugins: [
      ...mainBuildOptions.plugins,
      {
        name: "service-watch-finish",
        setup(build) {
          build.onEnd(async (result) => {
            const startedAt = performance.now();
            try {
              await finishServiceBuild(result, startedAt);
            } catch (error) {
              console.error(
                error instanceof Error ? error.stack : String(error),
              );
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log(`watching ${service} -> ${outfile}`);
} else {
  const start = performance.now();
  try {
    const buildResult = await esbuild.build(mainBuildOptions);
    await finishServiceBuild(buildResult, start);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
