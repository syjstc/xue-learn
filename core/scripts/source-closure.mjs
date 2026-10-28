import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {builtinModules} from 'node:module';
import {fileURLToPath} from 'node:url';
export function sourceClosure(root, entries, {includeTypes = false} = {}) {
  const config = ts.readConfigFile(path.join(root,'tsconfig.base.json'),ts.sys.readFile);
  if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,' '));
  const options=ts.parseJsonConfigFileContent(config.config,ts.sys,root).options;
  const files=new Map(),packages=new Map(),missing=[];
  const queue=entries.map(e=>({file:path.resolve(root,e),chain:[e]}));
  const builtin=new Set(builtinModules.flatMap(x=>[x,x.replace(/^node:/,''),'node:'+x.replace(/^node:/,'')]));
  while(queue.length){
    const {file,chain}=queue.shift();if(files.has(file))continue;
    if(!fs.existsSync(file)){missing.push({file:path.relative(root,file),chain});continue;}
    const rel=path.relative(root,file).replaceAll(path.sep,'/');
    files.set(file,{path:rel,chain,imports:[]});
    if(!/\.[cm]?[jt]sx?$/.test(file))continue;
    const source=fs.readFileSync(file,'utf8');
    const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,/tsx$/.test(file)?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const requests=[];
    function walk(node){
      let value;
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) {
        if(!includeTypes&&((node.importClause?.isTypeOnly)||node.isTypeOnly))return;
        if(!includeTypes&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&!node.importClause.name&&node.importClause.namedBindings.elements.every(e=>e.isTypeOnly))return;
        value=node.moduleSpecifier;
      }else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(sf)==='require'))value=node.arguments[0];
      else if(ts.isNewExpression(node)&&node.expression.getText(sf)==='URL'&&node.arguments?.[1]?.getText(sf)==='import.meta.url')value=node.arguments?.[0];
      else if(includeTypes&&ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))value=node.argument.literal;
      if(value&&ts.isStringLiteral(value))requests.push(value.text);
      ts.forEachChild(node,walk);
    }
    walk(sf);
    for(const request of new Set(requests)){
      if(builtin.has(request)) { files.get(file).imports.push({request,builtin:true});continue; }
      const resolved=ts.resolveModuleName(request,file,options,ts.sys).resolvedModule;
      let target=resolved?.resolvedFileName;
      if(!target&&request.startsWith('.')) {
        const raw=path.resolve(path.dirname(file),request);
        target=[raw,raw+'.ts',raw+'.tsx',raw+'.js',raw+'.mjs',path.join(raw,'index.ts'),path.join(raw,'index.tsx')].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
      }
      if(target&&!target.includes('/node_modules/')&&target.startsWith(root+path.sep)) {
        files.get(file).imports.push({request,path:path.relative(root,target).replaceAll(path.sep,'/')});
        queue.push({file:target,chain:[...chain,path.relative(root,target).replaceAll(path.sep,'/')]});
      }else if(!request.startsWith('.')&&!request.startsWith('@cognilearn/')&&!request.startsWith('@/')&&!request.startsWith('@xue-learn/')){
        const name=request.startsWith('@')?request.split('/').slice(0,2).join('/'):request.split('/')[0];
        if(!packages.has(name))packages.set(name,{name,chain:[...chain,request]});
        files.get(file).imports.push({request,package:name});
      }else missing.push({request,importer:rel,chain});
    }
  }
  return {entries,includeTypes,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),packages:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)),missing};
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const root=process.cwd(),args=process.argv.slice(2),includeTypes=args.includes('--types');
 const entries=args.filter(x=>!x.startsWith('--'));
 const report=sourceClosure(root,entries.length?entries:['apps/local-runtime/src/main.ts','apps/desktop-electron/src/main.ts','src/desktop-local/main.tsx'],{includeTypes});
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
