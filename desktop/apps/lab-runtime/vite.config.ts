import {desktopSourcePlugin,desktopBuildAudit} from '../../scripts/desktop-core.mjs';
import path from "node:path";
import { createReadStream, cpSync, existsSync, mkdirSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function bundledLabAssets(): Plugin {
  const source = path.resolve(__dirname, "../../public/lab-assets");
  const copyTo = (destination: string) => {
    if (!existsSync(source)) return;
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true });
  };
  return {
    name: "bundled-lab-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split("?")[0] ?? "";
        const prefix = "/lab-runtime/lab-assets/";
        if (!url.startsWith(prefix)) {
          next();
          return;
        }
        const relativePath = decodeURIComponent(url.slice(prefix.length));
        if (relativePath.includes("..")) {
          response.statusCode = 400;
          response.end();
          return;
        }
        const filePath = path.join(source, relativePath);
        if (!filePath.startsWith(source) || !existsSync(filePath)) {
          next();
          return;
        }
        if (filePath.endsWith(".glb")) {
          response.setHeader("Content-Type", "model/gltf-binary");
        }
        createReadStream(filePath).pipe(response);
      });
    },
    closeBundle() {
      copyTo(path.resolve(__dirname, "../../dist/lab-runtime/lab-assets"));
    },
  };
}

export default defineConfig({
  root: __dirname,
  base: "/lab-runtime/",
  plugins: [desktopSourcePlugin(), desktopBuildAudit('lab'),react(), bundledLabAssets()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {},
  },
  build: {
    outDir: path.resolve(__dirname, "../../dist/lab-runtime"),
    emptyOutDir: true,
    sourcemap: process.env.VITE_ENABLE_DEV_TOOLS === "true",
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../../../")],
    },
    host: process.env.VITE_LAB_HOST ?? "0.0.0.0",
    port: Number(process.env.VITE_LAB_PORT ?? 5177),
    strictPort: true,
  },
});
