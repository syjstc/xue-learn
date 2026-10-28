import {mkdtemp,writeFile,chmod,rm,symlink} from "node:fs/promises";
import {join} from "node:path";import {tmpdir} from "node:os";import {randomUUID} from "node:crypto";
import {configuredWorkspaceClientCapabilities} from "./workspace-client-permissions.ts";
import {WorkspaceServiceSessions} from "./workspace-service-sessions.ts";
import {LocalWorkspaceServiceController} from "./local-workspace-service.controller.ts";
import {workspaceLearningCommandSchema} from "./local-workspace-learning.controller.ts";
it("requires independent exact owner configuration for any game learning scope",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"workspace-client-policy-")),file=join(directory,"permissions.json");
 const sessions=new WorkspaceServiceSessions("workspace","owner",randomUUID(),randomUUID());
 const controller=new LocalWorkspaceServiceController({sessions,clientPermissionsPath:file,backgroundTaskCount:async()=>0});
 const request={protocolVersion:1 as const,workspaceId:"workspace",clientId:"game-client",capabilities:["learning.answer.submit" as const]};
 try{
  await expect(controller.grant(request)).rejects.toThrow("not explicitly configured");
  await writeFile(file,JSON.stringify({version:1,grants:[{workspaceId:"workspace",clientId:"game-client",capabilities:["learning.answer.submit"]}]}),{mode:0o600});
  const granted=await controller.grant(request);
  expect(sessions.authorize(granted.token,"POST","/api/workspace-learning/units/unit/sections/section/answers")).not.toBeNull();
  expect(sessions.authorize(granted.token,"POST","/api/workspace-learning/units/unit/sections/section/complete")).toBeNull();
  expect(sessions.authorize(granted.token,"POST","/api/units/unit/session")).toBeNull();
  await expect(controller.grant({...request,clientId:"other"})).rejects.toThrow("not explicitly configured");
  await chmod(file,0o644);await expect(configuredWorkspaceClientCapabilities(file,request)).rejects.toThrow("private");
  await chmod(file,0o600);const link=join(directory,"symlink.json");await symlink(file,link);
  await expect(configuredWorkspaceClientCapabilities(link,request)).rejects.toThrow();
  expect(workspaceLearningCommandSchema.safeParse({expectedContentRevision:1,expectedSectionRevision:1,mastered:true,campusReward:100}).success).toBe(false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
