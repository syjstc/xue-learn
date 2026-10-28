import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopPluginSurfaces,createPluginNativeServices,validateNativePluginAbi} from './native-services';
import type {DesktopPluginProcessConfiguration} from './manager';
describe('native plugin host services',()=>{
 let root:string,configuration:DesktopPluginProcessConfiguration;
 beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),'xue-native-services-'));await mkdir(join(root,'renderer'));
  const files={'renderer/index.html':'<main>Video</main>','renderer/chunk.mjs':'export const value=1','runtime.json':JSON.stringify({platform:process.platform,arch:process.arch,electronVersion:'37.10.3'})};
  for(const [file,value]of Object.entries(files))await writeFile(join(root,file),value);
  configuration={pluginId:'org.example.video',pluginRoot:root,entry:join(root,'plugin.cjs'),storagePath:root,manifest:{schemaVersion:1,apiVersion:1,id:'org.example.video',name:'Video',version:'1.0.0',requires:{'workspace.courses':1},runtime:{entry:'plugin.cjs',mode:'host'},contributes:{commands:[]},integrity:Object.fromEntries(Object.entries(files).map(([key,value])=>[key,createHash('sha256').update(value).digest('hex')]))}};
 });
 afterEach(()=>rm(root,{recursive:true,force:true}));
 function host(){const invoke=jest.fn(async(_cap,_method,args,context)=>({args,workspaceId:context.workspaceId}));const surfaces=new DesktopPluginSurfaces();return{surfaces,invoke,...createPluginNativeServices({configuration,surfaces,capabilities:{versions:{'workspace.courses':1},invoke},hasWorkspace:id=>id==='a',getAIEnvironment:async()=>({OPENAI_API_KEY:'private'}),codexToken:async()=>'private-token'})};}
 it('binds background calls to one validated workspace until native disposal',async()=>{
  const native=host(),binding=await native.services.bindWorkspace('a');
  expect(await binding.call('workspace.courses','catalog',{workspaceId:'forged'})).toEqual({args:{workspaceId:'forged'},workspaceId:'a'});
  await expect(binding.call('secrets','get')).rejects.toThrow('Undeclared');
  await expect(native.services.bindWorkspace('b')).rejects.toThrow('Unknown');
  native.dispose();expect(binding.signal.aborted).toBe(true);await expect(binding.call('workspace.courses','catalog')).rejects.toThrow();
 });
 it('serves verified static chunks and dispatches JSON/binary in-process, then revokes',async()=>{
  const native=host(),request=jest.fn(async input=>({status:200,body:input.path.includes('audio')?new Uint8Array([1,2,3]):{body:input.body},headers:{'Content-Type':input.path.includes('audio')?'audio/wav':'application/json'}}));
  const surface=native.services.createSurface({workspaceId:'a',root:'renderer',request});
  expect(await (await native.surfaces.response(new Request(surface.baseUrl+'/lesson-performance-export')))!.text()).toContain('Video');
  expect(await (await native.surfaces.response(new Request(surface.baseUrl+'/chunk.mjs')))!.text()).toContain('value=1');
  const response=await native.surfaces.response(new Request(surface.baseUrl+'/api/save',{method:'POST',body:JSON.stringify({title:'edited'})}));expect(await response!.json()).toEqual({body:{title:'edited'}});
  const audio=await native.surfaces.response(new Request(surface.baseUrl+'/api/audio'));expect([...new Uint8Array(await audio!.arrayBuffer())]).toEqual([1,2,3]);
  await writeFile(join(root,'renderer/chunk.mjs'),'tampered');expect((await native.surfaces.response(new Request(surface.baseUrl+'/chunk.mjs')))!.status).toBe(404);
  native.dispose();expect(await native.surfaces.response(new Request(surface.baseUrl+'/api/save'))).toBeUndefined();
 });
 it('rejects incompatible native packages before loading any code',async()=>{
  await expect(validateNativePluginAbi(configuration,'37.10.3')).resolves.toBeUndefined();
  await expect(validateNativePluginAbi(configuration,'38.0.0')).rejects.toThrow('requires');
 });
});
