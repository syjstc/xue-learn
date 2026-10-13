import {randomUUID} from 'node:crypto';
import {posix} from 'node:path';
import {LOCAL_OWNER_ID} from '@xue-learn/core/runtime-contracts';
import type {DesktopPluginNativeServices,DesktopPluginSurfaceRequest,DesktopPluginSurfaceResponse} from '../../../../packages/plugin-sdk/src/cordis';
import type {DesktopPluginCapabilityHost,DesktopPluginProcessConfiguration} from './manager';
import {verifiedPluginAsset} from './package-assets';

type Surface={configuration:DesktopPluginProcessConfiguration;root:string;signal:AbortSignal;request(input:DesktopPluginSurfaceRequest):Promise<DesktopPluginSurfaceResponse>};
/** In-process application surfaces, scoped to an enabled native extension. */
export class DesktopPluginSurfaces {
  private readonly surfaces=new Map<string,Surface>();
  create(surface:Surface) {
    const id=`surface-${randomUUID()}`;this.surfaces.set(id,surface);
    return {baseUrl:`xuelearn-plugin://${id}`,dispose:()=>{this.surfaces.delete(id);}};
  }
  async response(request:Request):Promise<Response|undefined> {
    const url=new URL(request.url),surface=this.surfaces.get(url.hostname);
    if(!surface||url.port||url.username||url.password||surface.signal.aborted)return;
    const headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Accept-Language'}});
    try {
      if(url.pathname.startsWith('/api/')) {
        let body:unknown;
        if(!['GET','HEAD'].includes(request.method)) {
          const bytes=await request.text();if(bytes.length>8*1024*1024)return new Response('Request too large',{status:413,headers});
          if(bytes)body=JSON.parse(bytes);
        }
        const result=await surface.request({method:request.method,path:url.pathname+url.search,body,headers:Object.fromEntries(request.headers)});
        surface.signal.throwIfAborted();
        const binary=result.body instanceof Uint8Array;
        const output=result.body==null?null:binary?new Uint8Array(result.body as Uint8Array):typeof result.body==='string'?result.body:JSON.stringify(result.body);
        return new Response(output,{status:result.status,headers:{...headers,...(binary?{}:{'Content-Type':'application/json; charset=utf-8'}),...result.headers}});
      }
      if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers});
      const path=decodeURIComponent(url.pathname).slice(1);
      if(path.includes('\\')||path.split('/').some(part=>part==='..'||part==='.')||path.startsWith('/'))return;
      const relative=path&&posix.extname(path)?path:'index.html';
      const file=posix.join(surface.root,relative);
      const asset=await verifiedPluginAsset(surface.configuration.pluginRoot,surface.configuration.manifest,file);
      surface.signal.throwIfAborted();
      return new Response(new Uint8Array(asset.body),{headers:{...headers,'Content-Type':asset.contentType}});
    }catch{return new Response('Plugin resource unavailable',{status:404,headers});}
  }
}
export function createPluginNativeServices(options:{
  configuration:DesktopPluginProcessConfiguration;capabilities:DesktopPluginCapabilityHost;surfaces:DesktopPluginSurfaces;
  hasWorkspace(id:string):boolean;getAIEnvironment():Promise<Record<string,string>>;codexToken(input?:{forceRefresh?:boolean}):Promise<string>;
}) {
  const controller=new AbortController(),disposers=new Set<()=>void>();
  const validWorkspace=(workspaceId:string)=>{controller.signal.throwIfAborted();if(!options.hasWorkspace(workspaceId))throw Error('Unknown plugin workspace');};
  const services:DesktopPluginNativeServices={
    async bindWorkspace(workspaceId) {
      validWorkspace(workspaceId);
      return {workspaceId,ownerId:LOCAL_OWNER_ID,signal:controller.signal,async call<T>(capability:string,method:string,args?:unknown):Promise<T>{
        validWorkspace(workspaceId);
        const version=options.configuration.manifest.requires[capability];
        if(!version||options.capabilities.versions[capability]!==version)throw Error('Undeclared or unavailable native capability');
        if(!/^[a-zA-Z][a-zA-Z0-9.-]{0,100}$/.test(method))throw Error('Invalid capability method');
        const result=await options.capabilities.invoke(capability,method,args,{pluginId:options.configuration.pluginId,workspaceId,signal:controller.signal});
        controller.signal.throwIfAborted();return result as T;
      }};
    },
    createSurface(input) {
      validWorkspace(input.workspaceId);
      if(!input.root||input.root.startsWith('/')||input.root.includes('\\')||input.root.split('/').some(part=>!part||part==='..'||part==='.'))throw Error('Invalid plugin surface root');
      const surface=options.surfaces.create({configuration:options.configuration,root:input.root,signal:controller.signal,request:input.request});
      disposers.add(surface.dispose);return surface;
    },
    async getAIEnvironment(){controller.signal.throwIfAborted();const value=await options.getAIEnvironment();controller.signal.throwIfAborted();return value;},
    async codexToken(input){controller.signal.throwIfAborted();const token=await options.codexToken(input);controller.signal.throwIfAborted();return token;},
  };
  return {services,dispose(){controller.abort();for(const dispose of disposers)dispose();disposers.clear();}};
}
export async function validateNativePluginAbi(configuration:DesktopPluginProcessConfiguration,electronVersion:string) {
  const file=await verifiedPluginAsset(configuration.pluginRoot,configuration.manifest,'runtime.json');
  const runtime=JSON.parse(file.body.toString());
  if(runtime.platform!==process.platform||runtime.arch!==process.arch||runtime.electronVersion!==electronVersion)throw Error(`Plugin native runtime requires ${runtime.platform}/${runtime.arch} Electron ${runtime.electronVersion}`);
}
