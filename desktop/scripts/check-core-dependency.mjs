import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {checkCoreImports} from './check-core-imports.mjs';

const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Desktop must resolve the current Core source in this workspace, never a tarball. */
export function checkCoreDependency(root) {
  const repositoryRoot = path.resolve(root, '..');
  const expectedCore = fs.realpathSync(path.join(repositoryRoot, 'core'));
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const labPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps/lab-runtime/package.json'), 'utf8'));
  for (const [name, specifier] of [
    ['Desktop', desktopPackage.dependencies?.['@xue-learn/core']],
    ['Lab', labPackage.dependencies?.['@xue-learn/core']],
  ]) {
    if (specifier !== 'workspace:*') throw Error(`${name} must depend on the current workspace Core`);
  }

  const installedLink = path.join(root, 'node_modules/@xue-learn/core');
  if (!fs.lstatSync(installedLink).isSymbolicLink() || fs.realpathSync(installedLink) !== expectedCore) {
    throw Error('Desktop Core dependency must link to this monorepo\'s core/; run pnpm install at the repository root');
  }
  const require = createRequire(path.join(root, 'package.json'));
  const core = fs.realpathSync(path.dirname(require.resolve('@xue-learn/core/package.json')));
  if (core !== expectedCore) throw Error('Desktop resolved a Core package outside this monorepo');

  const metadata = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
  const integrity = JSON.parse(fs.readFileSync(path.join(core, 'release-manifest.v1.json'), 'utf8'));
  if (metadata.name !== '@xue-learn/core' || integrity.package !== metadata.name || integrity.version !== metadata.version) {
    throw Error('Workspace Core build metadata is stale or invalid; rebuild Core');
  }
  for (const file of integrity.files) {
    const target = path.resolve(core, file.path);
    if (!target.startsWith(core + path.sep) || digest(target) !== file.sha256) {
      throw Error('Workspace Core build is stale: ' + file.path);
    }
  }
  console.log(`Verified workspace ${metadata.name}@${metadata.version}: ${integrity.files.length} current build files.`);
  checkCoreImports(root);
  return core;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkCoreDependency(process.cwd());
}
