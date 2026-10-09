import { cpSync, existsSync, watch, type FSWatcher } from "node:fs";
import { basename, join, relative } from "node:path";

export const DEVELOPMENT_HOTLOAD_DEBOUNCE_MS = 400;

export type DevelopmentHotloadKind = "renderer" | "sidecar";

export type DevelopmentHotloadOptions = {
  rendererPath?: string;
  sidecarBuildPath: string;
  stagedSidecarPath: string;
  debounceMs?: number;
  reloadRenderer?: () => void;
  restartSidecar: () => Promise<void>;
};

const ignoredNames = new Set([".DS_Store", "Thumbs.db"]);

export function shouldIgnoreHotloadPath(filePath: string): boolean {
  const name = basename(filePath);
  if (ignoredNames.has(name) || name.endsWith("~")) return true;
  return filePath.split(/[\\/]/).includes("node_modules");
}

export function syncStagedSidecarBundle(
  sidecarBuildPath: string,
  stagedSidecarPath: string,
): void {
  if (!existsSync(sidecarBuildPath) || !existsSync(stagedSidecarPath)) return;
  cpSync(sidecarBuildPath, stagedSidecarPath, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const rel = relative(sidecarBuildPath, source);
      return rel === "" || !shouldIgnoreHotloadPath(rel);
    },
  });
}

export function installDevelopmentHotload(
  options: DevelopmentHotloadOptions,
): () => void {
  const debounceMs = options.debounceMs ?? DEVELOPMENT_HOTLOAD_DEBOUNCE_MS;
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rendererDirty = false;
  let sidecarDirty = false;
  let applying = false;

  const flush = () => {
    timer = null;
    if (applying) {
      timer = setTimeout(flush, debounceMs);
      return;
    }
    const restartSidecar = sidecarDirty;
    const reloadRenderer = rendererDirty && !sidecarDirty;
    rendererDirty = false;
    sidecarDirty = false;
    if (!restartSidecar && !reloadRenderer) return;
    applying = true;
    void (async () => {
      try {
        if (restartSidecar) {
          syncStagedSidecarBundle(
            options.sidecarBuildPath,
            options.stagedSidecarPath,
          );
          await options.restartSidecar();
          return;
        }
        if (reloadRenderer) options.reloadRenderer?.();
      } finally {
        applying = false;
      }
    })();
  };

  const mark = (kind: DevelopmentHotloadKind) => {
    if (kind === "sidecar") sidecarDirty = true;
    else rendererDirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const bind = (root: string, kind: DevelopmentHotloadKind) => {
    if (!existsSync(root)) return;
    watchers.push(
      watch(root, { recursive: true }, (_event, filename) => {
        if (filename && shouldIgnoreHotloadPath(String(filename))) return;
        mark(kind);
      }),
    );
  };

  if (options.rendererPath) bind(options.rendererPath, "renderer");
  bind(options.sidecarBuildPath, "sidecar");

  return () => {
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

export function developmentSidecarBuildPath(appPath: string): string {
  return join(appPath, "../../dist/apps/local-runtime");
}

export function developmentStagedSidecarPath(appPath: string): string {
  return join(appPath, ".forge-resources/local-sidecar");
}

export function readDevelopmentRendererOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.XUELEARN_DESKTOP_RENDERER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return null;
    return url.origin;
  } catch {
    return null;
  }
}
