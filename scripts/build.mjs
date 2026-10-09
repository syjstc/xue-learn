import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {transformFileSync} from '@swc/core';
import {sourceClosure} from './source-closure.mjs';

const root=process.cwd(),sourceRoot=path.join(root,'sources'),output=path.join(root,'dist');
const entries={browser:'core/src/browser.ts',display:'core/src/display.ts',node:'core/src/node.ts','workspace-client':'core/src/workspace-client.ts'};
const prohibited=/^(?:apps\/|electron\/|products\/|src\/desktop-local\/)|libs\/server\/src\/(?:billing|auth|admin|lesson-performance|persistence\/(?:reference|migrations))/;
const bannedPackages=new Set(['electron','@mikro-orm/core','@mikro-orm/sqlite','@mikro-orm/postgresql','better-sqlite3','sqlite-vec','pg','pgvector','ioredis','bullmq','remotion','@remotion/player']);
for(const [name,entry] of Object.entries(entries)){
  const graph=sourceClosure(sourceRoot,[entry],{includeTypes:true});
  const invalid=graph.files.filter(file=>prohibited.test(file.path));
  const packages=graph.packages.filter(item=>bannedPackages.has(item.name));
  if(graph.missing.length||invalid.length||packages.length)throw Error(`Core ${name} boundary: ${JSON.stringify({missing:graph.missing,invalid,packages})}`);
  if(['browser','display'].includes(name)&&graph.files.some(file=>file.imports.some(item=>item.builtin)))throw Error(`Core ${name} imports a Node builtin`);
  console.log(`Core ${name}: ${graph.files.length} owned source files, no host/private dependencies.`);
}
if(process.argv.includes('--check'))process.exit(0);
fs.mkdirSync(output,{recursive:true});
const swc={name:'core-decorator-metadata',setup(builder){builder.onLoad({filter:/\.tsx?$/},args=>({contents:transformFileSync(args.path,{jsc:{parser:{syntax:'typescript',tsx:args.path.endsWith('.tsx'),decorators:true},transform:{legacyDecorator:true,decoratorMetadata:true,react:{runtime:'automatic'}},target:'es2022'},module:{type:'es6'}}).code,loader:'js'}));}};
for(const [name,entry] of Object.entries(entries)){
  const node=['node','workspace-client'].includes(name);
  const result=await build({entryPoints:[path.join(sourceRoot,entry)],outfile:path.join(output,name+'.js'),bundle:true,format:'esm',platform:node?'node':'browser',target:'es2022',packages:'external',jsx:'automatic',keepNames:true,metafile:true,
    banner:name==='node'?{js:"import {createRequire as __coreCreateRequire} from 'node:module'; import {fileURLToPath as __coreFileURLToPath} from 'node:url'; import {dirname as __coreDirname} from 'node:path'; const require=__coreCreateRequire(import.meta.url); const __filename=__coreFileURLToPath(import.meta.url); const __dirname=__coreDirname(__filename);"}:undefined,
    loader:{'.svg':'file','.png':'file','.woff':'file','.woff2':'file','.ttf':'file'},plugins:[swc]});
  const outside=Object.keys(result.metafile.inputs).filter(file=>!path.resolve(root,file).startsWith(root+path.sep));
  if(outside.length)throw Error('Core build read outside its own repository: '+outside.join(', '));
  fs.writeFileSync(path.join(output,name+'.metafile.json'),JSON.stringify(result.metafile,null,2)+'\n');
}
fs.cpSync(path.join(sourceRoot,'libs/server/src/teaching-skills/builtin'),path.join(output,'teaching-skills/builtin'),{recursive:true});
fs.copyFileSync(path.join(root,'resources/guided-image-refine.py'),path.join(output,'guided-image-refine.py'));
const declarations=spawnSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.types.json'],{cwd:root,stdio:'inherit'});
if(declarations.error)throw declarations.error;
if(declarations.status!==0)process.exit(declarations.status??1);
for(const name of Object.keys(entries))if(!fs.existsSync(path.join(root,'types/core/src',name+'.d.ts')))throw Error('Missing declaration entry '+name);
// TypeScript declarations can reference JSON/CSS resources through the same
// relative paths as their source files.
function resources(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())resources(file);else if(/\.(?:json|css)$/.test(file)){const target=path.join(root,'types',path.relative(sourceRoot,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}}}
resources(sourceRoot);
const files=[];
function inventory(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())inventory(file);else files.push({path:path.relative(root,file).replaceAll(path.sep,'/'),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
for(const name of ['sources','dist','types','resources'])inventory(path.join(root,name));
files.sort((a,b)=>a.path.localeCompare(b.path));
const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
fs.writeFileSync(path.join(root,'release-manifest.v1.json'),JSON.stringify({schemaVersion:1,package:metadata.name,version:metadata.version,files},null,2)+'\n');
console.log(`Built ${metadata.name}@${metadata.version}: four entries, declarations and ${files.length} integrity records.`);
