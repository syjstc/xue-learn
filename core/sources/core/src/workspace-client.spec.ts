import { mkdtemp, mkdir, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createWorkspaceClientBroker, connectWorkspaceClient } from "./workspace-client.js";

it("hands a same-user client only its selected read session and leaves an active broker intact", async () => {
  const root=await mkdtemp(join(tmpdir(),"workspace-client-broker-"));
  const request={protocolVersion:1 as const,workspaceId:"workspace-a",clientId:"independent-tool",capabilities:["course.content.read","course.assets.read"] as ("course.content.read"|"course.assets.read")[]};
  const grant=jest.fn(async input=>({endpoint:"http://127.0.0.1:41001",session:{protocolVersion:1 as const,coreContractVersion:"course-source.v1" as const,
    ...input,ownerId:"owner",instanceId:randomUUID(),epoch:randomUUID(),sessionId:randomUUID(),token:"a".repeat(64),expiresAt:new Date(Date.now()+300_000).toISOString()}}));
  const broker=await createWorkspaceClientBroker(root,grant);
  try {
    const connection=await connectWorkspaceClient(root,request);
    expect(connection.session.workspaceId).toBe("workspace-a");expect(connection.session.capabilities).toEqual(request.capabilities);
    expect(connection).not.toHaveProperty("hostToken");
    expect((await stat(broker.path)).mode&0o077).toBe(0);
    await expect(createWorkspaceClientBroker(root,grant)).rejects.toThrow("already owns");
    await expect(connectWorkspaceClient(root,{...request,capabilities:["learning.answer.submit"]})).rejects.toThrow("course-read");
    expect(grant).toHaveBeenCalledTimes(1);
    expect((await connectWorkspaceClient(root,request)).session.workspaceId).toBe("workspace-a");
  } finally {await broker.close();await rm(root,{recursive:true,force:true});}
});

it("rejects symlink connection directories before granting any session",async()=>{
  const root=await mkdtemp(join(tmpdir(),"workspace-client-link-"));
  const target=join(root,"target"),link=join(root,"link");await mkdir(target,{mode:0o700});await symlink(target,link);
  const grant=jest.fn();
  try{await expect(createWorkspaceClientBroker(link,grant)).rejects.toThrow("not owned");expect(grant).not.toHaveBeenCalled();}
  finally{await rm(root,{recursive:true,force:true});}
});

it("supports long isolated profile paths using the same private socket mapping for host and client",async()=>{
  const parent=await mkdtemp(join(tmpdir(),"workspace-client-long-"));
  const root=join(parent,"a".repeat(55),"b".repeat(55));await mkdir(root,{recursive:true,mode:0o700});
  const request={protocolVersion:1 as const,workspaceId:"workspace",clientId:"long-profile-client",capabilities:["course.content.read"] as "course.content.read"[]};
  const broker=await createWorkspaceClientBroker(root,async input=>({endpoint:"http://127.0.0.1:41002",session:{...input,coreContractVersion:"course-source.v1",ownerId:"owner",instanceId:randomUUID(),epoch:randomUUID(),sessionId:randomUUID(),token:"b".repeat(64),expiresAt:new Date(Date.now()+300_000).toISOString()}}));
  try{expect(Buffer.byteLength(broker.path)).toBeLessThanOrEqual(100);expect((await connectWorkspaceClient(root,request)).session.workspaceId).toBe("workspace");}
  finally{await broker.close();await rm(parent,{recursive:true,force:true});}
});

it("only grants formal learning commands when the independent configured policy authorizes that exact client",async()=>{
  const root=await mkdtemp(join(tmpdir(),"workspace-client-policy-"));
  const grant=jest.fn(async input=>({endpoint:"http://127.0.0.1:41003",session:{...input,coreContractVersion:"course-source.v1" as const,ownerId:"owner",instanceId:randomUUID(),epoch:randomUUID(),sessionId:randomUUID(),token:"c".repeat(64),expiresAt:new Date(Date.now()+300_000).toISOString()}}));
  const authorize=jest.fn(async request=>request.workspaceId==="selected"&&request.clientId==="configured-client");
  const broker=await createWorkspaceClientBroker(root,grant,{authorizeLearningCommands:authorize});
  const request={protocolVersion:1 as const,workspaceId:"selected",clientId:"unconfigured-client",capabilities:["learning.answer.submit"] as "learning.answer.submit"[]};
  try{await expect(connectWorkspaceClient(root,request)).rejects.toThrow("configured");expect(grant).not.toHaveBeenCalled();
    const connection=await connectWorkspaceClient(root,{...request,clientId:"configured-client"});expect(connection.session.capabilities).toEqual(["learning.answer.submit"]);expect(authorize).toHaveBeenCalledTimes(2);}
  finally{await broker.close();await rm(root,{recursive:true,force:true});}
});


it("drains an admitted grant before the service pool snapshot and rejects new grants until resumed",async()=>{
  const root=await mkdtemp(join(tmpdir(),"workspace-client-drain-"));
  const request={protocolVersion:1 as const,workspaceId:"workspace",clientId:"client",capabilities:["course.content.read"] as "course.content.read"[]};
  let finish!:()=>void,admitted!:()=>void;
  const entered=new Promise<void>(resolve=>{admitted=resolve;});
  const blocked=new Promise<void>(resolve=>{finish=resolve;});
  const grant=jest.fn(async input=>{admitted();await blocked;return {endpoint:"http://127.0.0.1:41004",session:{...input,coreContractVersion:"course-source.v1" as const,ownerId:"owner",instanceId:randomUUID(),epoch:randomUUID(),sessionId:randomUUID(),token:"d".repeat(64),expiresAt:new Date(Date.now()+300_000).toISOString()}};});
  const broker=await createWorkspaceClientBroker(root,grant);
  try {
    const first=connectWorkspaceClient(root,request);await entered;
    let drained=false;const draining=broker.suspend().then(()=>{drained=true;});
    await expect(connectWorkspaceClient(root,request)).rejects.toThrow("draining");
    expect(drained).toBe(false);expect(grant).toHaveBeenCalledTimes(1);
    finish();await first;await draining;expect(drained).toBe(true);
    broker.resume();await connectWorkspaceClient(root,request);expect(grant).toHaveBeenCalledTimes(2);
  }finally{finish();await broker.close();await rm(root,{recursive:true,force:true});}
});
