import { readdir, readFile, realpath, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { repositoryRoot } from "./public-source-files.mjs";

/** Preserve installed dependency notices, including libraries bundled by Vite/esbuild. */
export async function collectLicenseNotices(destination) {
  const lock = parse(await readFile(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8"));
  const lockedPackages = new Set(Object.keys(lock.packages));
  const store = path.join(repositoryRoot, "node_modules/.pnpm");
  const packageRoots = new Set();
  async function addPackages(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.name.startsWith("@")) await addPackages(candidate);
      else if (entry.isDirectory() || entry.isSymbolicLink())
        packageRoots.add(await realpath(candidate));
    }
  }
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "node_modules")
      await addPackages(path.join(store, entry.name, "node_modules"));
  }
  const records = new Map();
  for (const root of packageRoots) {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8").catch(() => "null"));
    if (!manifest || manifest.name?.startsWith("@xue-learn/")) continue;
    const id = `${manifest.name}@${manifest.version}`;
    if (!lockedPackages.has(id)) continue;
    if (records.has(id)) continue;
    const notices = [];
    async function readNotices(directory, prefix = "", depth = 0) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = entry.name;
        if (entry.isDirectory() && depth === 0 && /^(?:licen[cs]es?|notices?)$/i.test(name))
          await readNotices(path.join(directory, name), `${name}/`, 1);
        else if (entry.isFile() && (depth > 0 || /^(?:licen[cs]e|notice|copying|copyright|ofl|unlicense)(?:[._-].*)?$/i.test(name))) {
          const text = await readFile(path.join(directory, name), "utf8");
          if (text.length && !text.includes("\0")) notices.push(`${prefix}${name}\n\n${text}`);
        }
      }
    }
    await readNotices(root);
    records.set(id, `${id}\nLicense metadata: ${typeof manifest.license === "string" ? manifest.license : JSON.stringify(manifest.license ?? "see upstream package")}\n\n${notices.join("\n\n")}`);
  }
  await mkdir(destination, { recursive: true });
  for (const [source, target] of [
    ["LICENSE", "LICENSE.txt"], ["LICENSING.md", "LICENSING.md"],
    ["core/THIRD_PARTY_NOTICES.md", "core-THIRD_PARTY_NOTICES.md"],
    ["desktop/THIRD_PARTY_NOTICES.md", "desktop-THIRD_PARTY_NOTICES.md"],
    ["desktop/LICENSE-BRAND", "desktop-LICENSE-BRAND"],
    ["desktop/BRAND_POLICY.md", "desktop-BRAND_POLICY.md"],
    ["desktop/third-party/shadcn-LICENSE.md", "shadcn-styles-LICENSE.md"],
    ["desktop/public/lab-assets/kenney-furniture-kit/License.txt", "Kenney-Furniture-Kit.txt"],
  ]) await copyFile(path.join(repositoryRoot, source), path.join(destination, target));
  await writeFile(path.join(destination, "THIRD_PARTY_LICENSES.txt"),
    "XueLearn dependency notices\n\nIncludes the installed build and runtime dependency set. Individual components retain their original licenses. Electron/Chromium notices are also preserved in the Electron framework.\n\n" +
    [...records].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value).join("\n\n============================================================\n\n") + "\n");
  return records.size;
}
