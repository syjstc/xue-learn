#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicSourceFiles, repositoryRoot } from "./public-source-files.mjs";
import { assertReleaseVersions } from "./mac-release-config.mjs";

const issues = [];
const files = await publicSourceFiles();
const examples = new Set([".env.example", ".env.packaging.example"]);
const forbiddenPaths = /(?:^|\/)(?:\.git|node_modules|\.cache|\.release|artifacts|coverage|test-results|playwright-report|\.forge-resources|vendor)(?:\/|$)|(?:^|\/)(?:repository-source|verification|desktop-tests)\.v1\.json$|\.(?:p8|p12|pfx|pem|key|mobileprovision|db|sqlite3?|dmg|exe|tgz|log)$/i;
const localPath = /\/(?:Users|home)\/[a-zA-Z0-9_-]+\/|\/Volumes\/[a-zA-Z0-9_-]+\//;
for (const file of files) {
  const name = path.basename(file);
  if (forbiddenPaths.test(file) || (name.startsWith(".env") && !examples.has(name)))
    issues.push(`${file}: local data, credentials or generated/internal output`);
  const bytes = await readFile(path.join(repositoryRoot, file));
  if (bytes.includes(0)) continue;
  const lines = bytes.toString("utf8").split("\n");
  for (const [i, line] of lines.entries()) {
    if (localPath.test(line)) issues.push(`${file}:${i + 1}: personal absolute path`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line))
      issues.push(`${file}:${i + 1}: private-key material`);
  }
}
const versions = await Promise.all(["package.json", "desktop/package.json", "desktop/apps/desktop/package.json"]
  .map(async file => JSON.parse(await readFile(path.join(repositoryRoot, file), "utf8")).version));
try { assertReleaseVersions(versions); }
catch (error) { issues.push(error.message); }
for (const file of ["LICENSE", "LICENSING.md", "SECURITY.md", "CONTRIBUTING.md", "docs/privacy.md", "docs/mac-release.md"]) {
  if (!files.includes(file)) issues.push(`Missing distribution document: ${file}`);
}
if (issues.length) {
  console.error(`Public source audit failed:\n${issues.map(issue => `- ${issue}`).join("\n")}`);
  process.exitCode = 1;
} else console.log(`Public source audit passed: ${files.length} files; Desktop ${versions[0]}.`);
