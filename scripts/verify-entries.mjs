import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=process.cwd();
for(const name of ['browser','node','workspace-client']) {
  await import(pathToFileURL(path.join(root,'dist',name+'.js')).href);
}
// Electron's main process bundles the public SDK into CommonJS. Exercise that
// format after packing compilation, where an unnecessary import.meta shim would
// otherwise survive TypeScript tests and crash the application at startup.
const scratch=fs.mkdtempSync(path.join(root,'.entry-check-'));
try {
  const output=path.join(scratch,'workspace-client.cjs');
  await build({entryPoints:[path.join(root,'dist/workspace-client.js')],outfile:output,
    bundle:true,packages:'external',platform:'node',format:'cjs',target:'es2022',
    logOverride:{'empty-import-meta':'error'}});
  const sdk=createRequire(import.meta.url)(output);
  if(typeof sdk.connectWorkspaceClient!=='function')throw Error('Built SDK has no workspace connection entry');
} finally {
  fs.rmSync(scratch,{recursive:true,force:true});
}
console.log('Three Node-compatible JavaScript entry imports and CommonJS SDK bundling passed.');
