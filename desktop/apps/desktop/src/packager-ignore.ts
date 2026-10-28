const hostBundles = new Set([
  "dist/main.js",
  "dist/preload.js",
  "dist/cloudkit-bridge-preload.js",
  "dist/plugins/worker.js",
]);

/** Only copy the bundled host; the Forge resource hook stages dependencies. */
export function ignorePackagedAppPath(filePath: string): boolean {
  const relativePath = filePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relativePath || relativePath === "package.json" || relativePath === "dist" || relativePath === "dist/plugins") {
    return false;
  }
  return !hostBundles.has(relativePath);
}
