import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2).filter(arg=>arg!=='--');
if(args.length!==1)throw Error('Usage: node scripts/pin-core-release.mjs /path/to/xue-learn-core-VERSION.tgz');
const source=path.resolve(args[0]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readMember=name=>execFileSync('tar',['-xOf',source,'package/'+name],{maxBuffer:16*1024*1024});
const packageBytes=readMember('package.json'),manifestBytes=readMember('release-manifest.v1.json');
const metadata=JSON.parse(packageBytes),manifest=JSON.parse(manifestBytes);
if(metadata.name!=='@xue-learn/core'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version))throw Error('Expected a versioned @xue-learn/core release');
if(manifest.package!==metadata.name||manifest.version!==metadata.version)throw Error('Core archive has inconsistent release metadata');
const bytes=fs.readFileSync(source),sha256=hash(bytes);
const receiptFile=path.join(root,'core-dependency.v1.json');
if(fs.existsSync(receiptFile)){const previous=JSON.parse(fs.readFileSync(receiptFile,'utf8'));if(previous.version===metadata.version&&previous.sha256!==sha256)throw Error('A pinned version is immutable; publish a new Core version for changed bytes');}
const artifact='vendor/xue-learn-core-'+metadata.version+'-'+sha256.slice(0,12)+'.tgz',target=path.join(root,artifact);
if(fs.existsSync(target)&&hash(fs.readFileSync(target))!==sha256)throw Error('This Core version already has different bytes; release a new version instead of replacing it');
fs.mkdirSync(path.dirname(target),{recursive:true});
if(source!==target)fs.copyFileSync(source,target,fs.constants.COPYFILE_FICLONE);
const packages=[path.join(root,'package.json')];
const apps=path.join(root,'apps');
if(fs.existsSync(apps))for(const entry of fs.readdirSync(apps,{withFileTypes:true}))if(entry.isDirectory()&&fs.existsSync(path.join(apps,entry.name,'package.json')))packages.push(path.join(apps,entry.name,'package.json'));
for(const file of packages){
  const pkg=JSON.parse(fs.readFileSync(file,'utf8'));let changed=false;
  const dependency='file:'+path.relative(path.dirname(file),target).replaceAll(path.sep,'/');
  for(const group of ['dependencies','devDependencies','optionalDependencies'])if(pkg[group]?.['@xue-learn/core']){pkg[group]['@xue-learn/core']=dependency;changed=true;}
  if(pkg.pnpm?.overrides){for(const key of Object.keys(pkg.pnpm.overrides))if(key==='@xue-learn/core'||key.startsWith('@xue-learn/core@')){delete pkg.pnpm.overrides[key];pkg.pnpm.overrides['@xue-learn/core']=dependency;changed=true;}}
  if(changed)fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
}
fs.writeFileSync(path.join(root,'core-dependency.v1.json'),JSON.stringify({schemaVersion:1,package:metadata.name,version:metadata.version,artifact,sha256,releaseManifestSha256:hash(manifestBytes),packageJsonSha256:hash(packageBytes)},null,2)+'\n');
console.log(`Pinned ${metadata.name}@${metadata.version} (${sha256}). Install dependencies, then run check:core.`);
