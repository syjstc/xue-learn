import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const trees=['src','apps','libs','source','storage','host','generation','persistence','persistence-postgres','learner-http','tests','compat','scripts'];
const skipped=new Set(['node_modules','archive','history','artifacts','release','.git','.cache','coverage']);
const requests=/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'](@xue-learn\/core(?:\/[^"']+)?)["']/g;

/** Validate the public package imports in active consumer code, including tests. */
export function checkCoreImports(root) {
  const require=createRequire(path.join(root,'package.json'));
  const core=fs.realpathSync(path.dirname(require.resolve('@xue-learn/core/package.json')));
  const imports=new Map();
  let files=0;
  function visit(directory) {
    if(!fs.existsSync(directory))return;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory()) {
        if(!skipped.has(entry.name)&&!entry.name.startsWith('dist')&&!entry.name.startsWith('.'))visit(file);
      } else if(entry.isFile()&&/\.[cm]?[jt]sx?$/.test(entry.name)) {
        files++;
        for(const match of fs.readFileSync(file,'utf8').matchAll(requests)) {
          const specifier=match[1];
          if(/\/core\/(?:source|renderer)\//.test(specifier)||/\.[cm]?[jt]sx?$/.test(specifier)) {
            throw Error('Use a public Core entry without source paths or code extensions: '+path.relative(root,file)+' -> '+specifier);
          }
          const references=imports.get(specifier)??[];
          references.push(path.relative(root,file));
          imports.set(specifier,references);
        }
      }
    }
  }
  for(const tree of trees)visit(path.join(root,tree));
  for(const [specifier,references] of imports) {
    let resolved;
    try { resolved=fs.realpathSync(require.resolve(specifier)); }
    catch(error) { throw Error('Unresolvable public Core import '+specifier+' in '+references[0]+': '+error.message); }
    if(!resolved.startsWith(core+path.sep))throw Error('Core import escaped the installed package: '+specifier);
  }
  console.log('Checked '+files+' consumer source files and '+imports.size+' public Core imports.');
  return {files,imports:imports.size};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))checkCoreImports(process.cwd());
