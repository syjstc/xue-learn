import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

export const desktopRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const repositoryRoot=path.resolve(desktopRoot,'..');
const require=createRequire(path.join(desktopRoot,'package.json'));
export const coreRoot=path.dirname(path.dirname(require.resolve('@xue-learn/core/browser')));
export const coreSources=path.join(coreRoot,'sources');
const names=['domain','common','contracts','runtime-contracts','server','memory','lab-engine','lab-protocol','formula-analysis','formal-derivation','teaching-derivation','formal-expression-core','formal-expression-motion'];
const extensions=['.ts','.tsx','.mjs','.js','.json','.css','.svg'];
function file(raw){return [raw,...extensions.map(ext=>raw+ext),path.join(raw,'index.ts'),path.join(raw,'index.tsx')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());}
export function resolveDesktopModule(specifier,importer){
  if(specifier==='@cognilearn/workspace-client')return file(path.join(coreSources,'core/src/workspace-client'));
  if(specifier.startsWith('@cognilearn/desktop-persistence/'))return file(path.join(desktopRoot,'persistence/sqlite',specifier.slice('@cognilearn/desktop-persistence/'.length)));
  for(const name of names){const prefix='@cognilearn/'+name;if(specifier===prefix||specifier.startsWith(prefix+'/'))return file(path.join(coreSources,'libs',name,'src',specifier===prefix?'index':specifier.slice(prefix.length+1)));}
  if(specifier.startsWith('@xue-learn/core/source/'))return file(path.join(coreSources,specifier.slice('@xue-learn/core/source/'.length)));
  if(specifier.startsWith('@/'))return file(path.join(desktopRoot,'src',specifier.slice(2)))??file(path.join(coreSources,'src',specifier.slice(2)));
  if(specifier.startsWith('.')&&importer){
    const raw=path.resolve(path.dirname(importer.split('?')[0]),specifier);
    if(raw.startsWith(path.join(desktopRoot,'src')+path.sep))return file(raw)??file(path.join(coreSources,'src',path.relative(path.join(desktopRoot,'src'),raw)));
  }
}
export function desktopSourcePlugin(){return {name:'desktop-workspace-core',enforce:'pre',resolveId(specifier,importer){return resolveDesktopModule(specifier,importer)??null;}};}
export function desktopBuildAudit(label){return {name:'desktop-source-ownership',generateBundle(){
  const inputs=[...this.getModuleIds()].filter(id=>path.isAbsolute(id));
  const outside=inputs.filter(id=>!path.resolve(id.split('?')[0]).startsWith(repositoryRoot+path.sep));
  if(outside.length)throw Error('Desktop build read outside the public monorepo: '+outside.slice(0,10).join(', '));
  const target=path.join(desktopRoot,'build-receipts');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,label+'.json'),JSON.stringify({inputs,outsideRepository:[]},null,2)+'\n');
}};}
