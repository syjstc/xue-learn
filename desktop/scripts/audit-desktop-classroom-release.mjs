#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const roots = [
  join(root, "dist-desktop"),
  join(root, "apps/desktop/dist"),
  join(root, "dist/apps/local-runtime"),
];
const forbiddenPath = [
  /lesson-performance-studio-page/i,
  /lesson-performance-export-page/i,
  /character-motion-preview/i,
  /cast-assets/i,
  /lesson[_-]performance[_-]vt/i,
];
const forbiddenText = [
  "LessonPerformanceVideoExporter",
  "LocalLessonPerformanceController",
  "/api/local/lesson-performances",
  "VITE_ENABLE_CLASSROOM_STUDIO",
];

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) result.push(...filesUnder(path));
    else result.push(path);
  }
  return result;
}

const violations = [];
for (const directory of roots) {
  for (const path of filesUnder(directory)) {
    const relativePath = relative(root, path);
    if (forbiddenPath.some((pattern) => pattern.test(relativePath))) {
      violations.push(`${relativePath}: forbidden classroom artifact path`);
      continue;
    }
    const source = readFileSync(path, "utf8");
    for (const token of forbiddenText) {
      if (source.includes(token)) {
        violations.push(`${relativePath}: contains ${token}`);
      }
    }
  }
}

if (violations.length) {
  console.error("Desktop release contains classroom-development artifacts:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  "Desktop release audit passed: no classroom Studio/export artifacts found.",
);
