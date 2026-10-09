const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const packageRequire=createRequire(path.join(root,'package.json'));
const core=path.join(root,'node_modules/@xue-learn/core/sources');
function file(raw){const found=[raw,...['.ts','.tsx','.js','.mjs','.json','.css'].map(ext=>raw+ext),path.join(raw,'index.ts'),path.join(raw,'index.tsx')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());return found?fs.realpathSync(found):undefined;}
module.exports=(request,options)=>{
  if(request.startsWith('@xue-learn/core/source/'))return file(path.join(core,request.slice('@xue-learn/core/source/'.length)));
  if(request==='@xue-learn/core/workspace-client')return file(path.join(core,'core/src/workspace-client'));
  // Jest 29's exports resolver treats the dot in '*.ts' as a regexp wildcard
  // and truncates extensionless names such as 'defaults'. Node resolves the
  // installed package's exact exports without that ambiguity.
  if(request==='@xue-learn/core'||request.startsWith('@xue-learn/core/')){
    const resolved=fs.realpathSync(packageRequire.resolve(request));
    if(resolved.endsWith('/sources/src/shared/dev.ts'))return path.join(root,'src/desktop-local/dev.test-mock.ts');
    return resolved;
  }
  if(request.startsWith('@/')){
    const suffix=request.slice(2);
    if(suffix==='shared/api-client'&&options.basedir.includes('src/desktop-local'))return path.join(root,'src/desktop-local/api-client.test-mock.ts');
    if(suffix==='shared/dev'&&options.basedir.includes('src/desktop-local'))return path.join(root,'src/desktop-local/dev.test-mock.ts');
    const found=file(path.join(root,'src',suffix))??file(path.join(core,'src',suffix));if(found)return found;
  }
  if(request.startsWith('@cognilearn/')){
    const [,name,...tail]=request.split('/');
    const raw=name==='desktop-persistence'?path.join(root,'persistence/sqlite',...tail):name==='workspace-client'?path.join(core,'core/src/workspace-client'):path.join(core,'libs',name,'src',...(tail.length?tail:['index']));
    const found=file(raw);if(found)return found;
  }
  const resolved=options.defaultResolver(request,options);
  if(resolved.endsWith('/sources/src/shared/dev.ts'))return path.join(root,'src/desktop-local/dev.test-mock.ts');
  return resolved;
};
