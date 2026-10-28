import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {join,relative,sep,extname} from 'node:path';
import type {DesktopPluginManifest} from '../../../../packages/plugin-sdk/src';

export async function verifiedPluginAsset(root:string,manifest:DesktopPluginManifest,file:string) {
  if(!file||file.startsWith('/')||file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..')||!Object.hasOwn(manifest.integrity,file))throw Error('Undeclared plugin asset');
  const location=join(root,file),actual=await realpath(location),base=await realpath(root),rel=relative(base,actual);
  if(!rel||rel==='..'||rel.startsWith(`..${sep}`))throw Error('Plugin asset escapes its package');
  const info=await lstat(location);
  if(!info.isFile()||info.size>64*1024*1024)throw Error('Plugin asset must be a regular file of at most 64 MiB');
  const body=await readFile(location);
  if(createHash('sha256').update(body).digest('hex')!==manifest.integrity[file])throw Error(`Plugin asset integrity mismatch: ${file}`);
  return {body,contentType:assetMime(file)};
}
export function assetMime(file:string):string {
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.mp4':'video/mp4','.wasm':'application/wasm'} as Record<string,string>)[extname(file)]??'application/octet-stream';
}
