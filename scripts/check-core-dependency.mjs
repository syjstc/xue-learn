import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

export function checkCoreDependency(root){
  const receipt=JSON.parse(fs.readFileSync(path.join(root,'core-dependency.v1.json'),'utf8'));
  const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(digest(path.join(root,receipt.artifact))!==receipt.sha256)throw Error('Core vendor artifact does not match its accepted SHA-256');
  const require=createRequire(path.join(root,'package.json'));
  const core=path.dirname(path.dirname(require.resolve('@xue-learn/core/browser')));
  if(!fs.realpathSync(core).startsWith(fs.realpathSync(root)+path.sep+'node_modules'+path.sep))throw Error('Core must be installed inside this product, not linked to another checkout');
  const manifest=JSON.parse(fs.readFileSync(path.join(core,'package.json'),'utf8'));
  if(manifest.name!==receipt.package||manifest.version!==receipt.version)throw Error('Installed Core version differs from the pinned release');
  if(!receipt.releaseManifestSha256||digest(path.join(core,'release-manifest.v1.json'))!==receipt.releaseManifestSha256)throw Error('Installed Core is stale or differs from the pinned archive; reinstall the dependency');
  if(!receipt.packageJsonSha256||digest(path.join(core,'package.json'))!==receipt.packageJsonSha256)throw Error('Installed Core package metadata differs from the pinned archive');
  const integrity=JSON.parse(fs.readFileSync(path.join(core,'release-manifest.v1.json'),'utf8'));
  if(integrity.version!==receipt.version||integrity.package!==receipt.package)throw Error('Installed Core integrity metadata differs from the pinned release');
  for(const file of integrity.files){
    const target=path.resolve(core,file.path);
    if(!target.startsWith(core+path.sep)||digest(target)!==file.sha256)throw Error('Installed Core file differs from release: '+file.path);
  }
  console.log(`Verified ${receipt.package}@${receipt.version}: artifact and ${integrity.files.length} installed files match.`);
  return core;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))checkCoreDependency(process.cwd());
