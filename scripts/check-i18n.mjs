#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicSourceFiles, repositoryRoot } from "./public-source-files.mjs";

const require = createRequire(
  new URL("../desktop/package.json", import.meta.url),
);
const ts = require("typescript");
const dictionaries = {};
const issues = [];
for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
  const file = `core/sources/src/shared/i18n/locales/${locale}.ts`;
  const source = ts.createSourceFile(
    file,
    await readFile(path.join(repositoryRoot, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const messages = (dictionaries[locale] = new Map());
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteral(node.name) &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      if (messages.has(node.name.text))
        issues.push(`${file}: duplicate key ${node.name.text}`);
      messages.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const parameters = (text) =>
  [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))]
    .sort()
    .join(",");
for (const locale of ["zh-Hans", "zh-Hant"]) {
  for (const [key, value] of dictionaries.en) {
    const translation = dictionaries[locale].get(key);
    if (!translation?.trim())
      issues.push(`${locale}: missing translation ${key}`);
    else if (parameters(value) !== parameters(translation))
      issues.push(`${locale}: interpolation parameters differ for ${key}`);
  }
  for (const key of dictionaries[locale].keys())
    if (!dictionaries.en.has(key))
      issues.push(`${locale}: unknown translation key ${key}`);
}
let filesChecked = 0;
for (const file of (await publicSourceFiles()).filter(
  (file) =>
    /^(?:desktop\/src|core\/sources\/src\/components)\/.*\.tsx$/.test(file) &&
    // These are authored teaching scenes/examples, independent of interface language.
    !/core\/sources\/src\/components\/(?:course-display\/teaching|display-plugins)\//.test(
      file,
    ) &&
    !/\.(?:spec|test)\.tsx$/.test(file),
)) {
  filesChecked++;
  const source = ts.createSourceFile(
    file,
    await readFile(path.join(repositoryRoot, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node) => {
    if (
      (ts.isJsxText(node) ||
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      /\p{Script=Han}/u.test(node.text ?? "")
    ) {
      let parent = node.parent,
        visible = ts.isJsxText(node);
      while (parent && !ts.isBlock(parent) && !ts.isSourceFile(parent)) {
        if (
          ts.isJsxElement(parent) ||
          ts.isJsxSelfClosingElement(parent) ||
          ts.isJsxAttribute(parent)
        ) {
          visible = true;
          break;
        }
        parent = parent.parent;
      }
      if (visible)
        issues.push(
          `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: untranslated interface text`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
if (issues.length) {
  console.error(
    `Internationalization checks failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
  );
  process.exitCode = 1;
} else
  console.log(
    `Internationalization checks passed: ${dictionaries.en.size} keys in 3 languages; ${filesChecked} UI files.`,
  );
