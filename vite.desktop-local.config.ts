import {desktopSourcePlugin,desktopBuildAudit} from './scripts/desktop-core.mjs';
import path from "node:path";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { exportIsolationPlugin } from "./scripts/vite-export-isolation.mjs";
import { viteWatchIgnored } from "./scripts/vite-watch-ignored.mjs";
import {
  DESKTOP_DEV_RENDERER_HOST,
  DESKTOP_DEV_RENDERER_PORT,
  DESKTOP_DEV_SIDECAR_ORIGIN,
} from "./scripts/desktop-dev-defaults.mjs";

const desktopOutput = path.resolve(__dirname, "dist-desktop");
const sidecarOrigin =
  process.env.XUELEARN_DESKTOP_SIDECAR_ORIGIN?.trim() ||
  DESKTOP_DEV_SIDECAR_ORIGIN;

const desktopSourcemaps = process.env.VITE_ENABLE_DEV_TOOLS === "true";

const pyodideRoot = path.resolve(__dirname, "node_modules/pyodide");

const PYODIDE_ASSETS = [
  "pyodide.mjs",
  "pyodide.mjs.map",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

function serveAndCopyPyodide(): Plugin {
  const copyAssets = () => {
    const dest = path.join(desktopOutput, "pyodide");
    mkdirSync(dest, { recursive: true });
    for (const name of PYODIDE_ASSETS) {
      const source = path.join(pyodideRoot, name);
      if (!existsSync(source)) continue;
      cpSync(source, path.join(dest, name));
    }
  };
  return {
    name: "desktop-pyodide-assets",
    configureServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (!req.url?.startsWith("/pyodide/")) {
            next();
            return;
          }
          const name = decodeURIComponent(
            req.url.slice("/pyodide/".length).split("?")[0] ?? "",
          );
          if (!name || name.includes("..") || !PYODIDE_ASSETS.includes(name)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const file = path.join(pyodideRoot, name);
          if (!existsSync(file) || !statSync(file).isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          if (name.endsWith(".wasm"))
            res.setHeader("Content-Type", "application/wasm");
          else if (name.endsWith(".mjs"))
            res.setHeader("Content-Type", "text/javascript");
          else if (name.endsWith(".json"))
            res.setHeader("Content-Type", "application/json");
          else if (name.endsWith(".zip"))
            res.setHeader("Content-Type", "application/zip");
          createReadStream(file).pipe(res);
        },
      );
    },
    writeBundle: copyAssets,
  };
}

function copyKatexFonts() {
  return {
    name: "copy-katex-fonts",
    apply: "build" as const,
    writeBundle() {
      cpSync(
        path.resolve(__dirname, "node_modules/katex/dist/fonts"),
        path.join(desktopOutput, "fonts"),
        {
          recursive: true,
          filter: (source) =>
            desktopSourcemaps ||
            source.endsWith(".woff2") ||
            !/\.(?:woff|ttf)$/.test(source),
        },
      );
    },
  };
}

function omitLegacyWebfonts() {
  return {
    name: "omit-legacy-webfonts",
    apply: "build" as const,
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      if (desktopSourcemaps) return;
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith(".woff") && !fileName.endsWith(".woff2")) {
          delete bundle[fileName];
        }
      }
    },
  };
}

function omitClassroomStudioAssets() {
  const classroomAsset =
    /(?:^|\/)(?:idle|speak|present|point_content|emphasize|think|celebrate|react_miss|react_correct)-[A-Za-z0-9_-]+\.png$/;
  return {
    name: "omit-classroom-studio-assets",
    apply: "build" as const,
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      if (process.env.VITE_ENABLE_CLASSROOM_STUDIO === "true") return;
      for (const fileName of Object.keys(bundle)) {
        if (classroomAsset.test(fileName)) delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, "src/desktop-local"),
  publicDir: path.resolve(__dirname, "public"),
  plugins: [desktopSourcePlugin(), desktopBuildAudit('renderer'),
    exportIsolationPlugin(),
    react(),
    serveAndCopyPyodide(),
    copyKatexFonts(),
    omitLegacyWebfonts(),
    omitClassroomStudioAssets(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "katex"],
    alias: {},
  },
  optimizeDeps: {
    // Core display sources are outside Vite's initial app dependency scan.
    // Prebundle their CommonJS runtime packages, including deep imports.
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react-markdown",
      "highlight.js/lib/core",
      "highlight.js/lib/languages/*",
      "elkjs/lib/elk.bundled.js",
      "katex",
      "katex/contrib/mhchem",
      "mammoth",
      "recharts",
      "ts-fsrs",
      "vexflow",
    ],
    exclude: ["pyodide"],
  },
  worker: {
    format: "es",
  },
  server: {
    host: DESKTOP_DEV_RENDERER_HOST,
    port: DESKTOP_DEV_RENDERER_PORT,
    strictPort: true,
    watch: { ignored: viteWatchIgnored },
    proxy: {
      "/api": {
        target: sidecarOrigin,
        changeOrigin: false,
        ws: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      "/lab-runtime": {
        target: process.env.VITE_LAB_PROXY_TARGET ?? "http://127.0.0.1:5177",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: desktopOutput,
    emptyOutDir: !process.argv.includes("--watch"),
    sourcemap: desktopSourcemaps,
  },
});
