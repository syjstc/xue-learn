import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
for (const script of ['build-runtime.mjs', 'build-client.mjs']) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], {cwd, stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
