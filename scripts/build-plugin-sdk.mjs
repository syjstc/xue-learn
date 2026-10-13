import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = join(root, 'packages/plugin-sdk');
const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(sdk, 'tsconfig.build.json')], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await build({
  entryPoints: ['index', 'cordis', 'harness', 'renderer'].map(name => join(sdk, `src/${name}.ts`)),
  outdir: join(sdk, 'dist'), bundle: false, format: 'esm', platform: 'neutral', target: 'es2022',
});
// Keep generated declarations compatible with NodeNext consumers without bundling Cordis.
const cordisDeclaration = join(sdk, 'dist/cordis.d.ts');
await writeFile(cordisDeclaration, (await readFile(cordisDeclaration, 'utf8')).replace("from './index'", "from './index.js'"));
console.log(`Built ${resolve(sdk, 'dist')}`);
