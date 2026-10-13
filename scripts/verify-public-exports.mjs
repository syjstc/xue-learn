import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {sourceClosure} from './source-closure.mjs';

const root = process.cwd();
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(root, '.export-check-'));
const sourceFiles = [];
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inventory(file);
    else sourceFiles.push('./' + path.relative(root, file).replaceAll(path.sep, '/'));
  }
}
inventory(path.join(root, 'sources'));
function exists(target) {
  assert(target.startsWith('./'), `Export target must stay inside the package: ${target}`);
  const file = path.resolve(root, target);
  assert(file.startsWith(root + path.sep), `Export escaped package: ${target}`);
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing export target: ${target}`);
}

try {
  const modules = path.join(scratch, 'node_modules', '@xue-learn');
  fs.mkdirSync(modules, {recursive: true});
  fs.symlinkSync(root, path.join(modules, 'core'), 'dir');
  const importer = path.join(scratch, 'consumer.ts');
  fs.writeFileSync(importer, 'export {};\n');
  const probes = new Set();
  const browserSources = new Set();
  let explicitCount = 0;
  let patternCount = 0;
  for (const [subpath, entry] of Object.entries(metadata.exports)) {
    // Compatibility-only source routes do not form the supported public API.
    if (subpath === './source/*' || subpath === './renderer/*') continue;
    const targets = typeof entry === 'string' ? [entry] : Object.values(entry);
    if (!subpath.includes('*')) {
      targets.forEach(exists);
      explicitCount++;
      if (typeof entry === 'object') {
        assert(Object.keys(entry)[0] === 'types', `Types condition must be first: ${subpath}`);
        probes.add(subpath);
        if (entry.import.startsWith('./sources/src/')) browserSources.add(entry.import.slice('./sources/'.length));
      }
      continue;
    }
    assert(typeof entry === 'object' && entry.types, `Public pattern has no declaration route: ${subpath}`);
    assert(Object.keys(entry)[0] === 'types', `Types condition must be first: ${subpath}`);
    const [prefix, suffix] = entry.import.split('*');
    const candidates = sourceFiles.filter(file => file.startsWith(prefix) && file.endsWith(suffix) && !/\.spec\.tsx?$/.test(file));
    assert(candidates.length > 0, `Export pattern matches no source modules: ${subpath}`);
    for (const file of candidates) {
      const capture = file.slice(prefix.length, suffix ? -suffix.length : undefined);
      for (const target of targets) exists(target.replace('*', capture));
      probes.add(subpath.replace('*', capture));
      patternCount++;
    }
  }
  // Exercise package resolution itself, including the legacy TypeScript mode
  // still used by decorator-aware hosts, rather than checking JSON only.
  for (const resolution of [ts.ModuleResolutionKind.Bundler, ts.ModuleResolutionKind.Node10]) {
    for (const subpath of probes) {
      const request = metadata.name + (subpath === '.' ? '' : subpath.slice(1));
      const result = ts.resolveModuleName(request, importer, {
        moduleResolution: resolution, module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true,
      }, ts.sys).resolvedModule;
      assert(result, `Unresolved ${ts.ModuleResolutionKind[resolution]} public import: ${request}`);
      assert(result.resolvedFileName.endsWith('.d.ts') || result.resolvedFileName.endsWith('.json'), `Public import resolved to undeclared source: ${request}`);
    }
  }
  const graph = sourceClosure(path.join(root, 'sources'), [...browserSources], {includeTypes: true});
  assert.deepEqual(graph.missing, [], 'Public renderer API has unresolved package-owned imports');
  const invalid = graph.files.filter(file => /^(?:apps\/|electron\/|products\/|libs\/server\/|src\/desktop-local\/)/.test(file.path) || file.imports.some(item => item.builtin));
  assert.deepEqual(invalid, [], 'Public renderer API includes a host, server or Node builtin');
  const banned = graph.packages.filter(item => /^(?:electron|@mikro-orm\/.+|better-sqlite3|sqlite-vec|pg|pgvector|ioredis|bullmq|remotion|@remotion\/player)$/.test(item.name));
  assert.deepEqual(banned, [], 'Public renderer API includes private product dependencies');
  console.log(`Public export contract passed: ${explicitCount} explicit entries, ${patternCount} source pattern targets, ${probes.size} imports resolved in Bundler and Node10 modes; ${graph.files.length} browser-safe renderer sources.`);
} finally {
  fs.rmSync(scratch, {recursive: true, force: true});
}
