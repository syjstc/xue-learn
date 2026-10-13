import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=process.cwd();
const entries=['browser','node','workspace-client','display-extensions','display-catalog','display-sampling'];
for(const name of entries) {
  await import(pathToFileURL(path.join(root,'dist',name+'.js')).href);
}
// Electron's main process bundles the public SDK into CommonJS. Exercise that
// format after packing compilation, where an unnecessary import.meta shim would
// otherwise survive TypeScript tests and crash the application at startup.
const scratch=fs.mkdtempSync(path.join(root,'.entry-check-'));
try {
  // The teaching renderer has stylesheet dependencies and is consumed by a
  // browser bundler. Resolve those styles in an actual consumer bundle.
  await build({entryPoints:['display','display-runtime','display-plugins','display-workspace','display-film'].map(name=>path.join(root,'dist',name+'.js')),
    outdir:path.join(scratch,'display'),bundle:true,packages:'external',
    platform:'browser',format:'esm',target:'es2022',
    loader:{'.woff':'file','.woff2':'file','.ttf':'file','.svg':'file','.png':'file'},
    plugins:[{name:'public-display-css',setup(builder){
      builder.onResolve({filter:/\.css$/},args=>({path:createRequire(import.meta.url).resolve(args.path,{paths:[args.resolveDir]})}));
    }}]});
  const output=path.join(scratch,'workspace-client.cjs');
  await build({entryPoints:[path.join(root,'dist/workspace-client.js')],outfile:output,
    bundle:true,packages:'external',platform:'node',format:'cjs',target:'es2022',
    logOverride:{'empty-import-meta':'error'}});
  const sdk=createRequire(import.meta.url)(output);
  if(typeof sdk.connectWorkspaceClient!=='function')throw Error('Built SDK has no workspace connection entry');
} finally {
  fs.rmSync(scratch,{recursive:true,force:true});
}
console.log(`${entries.length} public JavaScript entry imports, browser display bundling and CommonJS SDK bundling passed.`);
