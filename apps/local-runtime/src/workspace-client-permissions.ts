import {constants} from "node:fs";
import {open} from "node:fs/promises";
import {z} from "zod";
import {workspaceServiceCapabilitySchema,type WorkspaceServiceCapability,type WorkspaceServiceSessionRequest} from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
const reads:WorkspaceServiceCapability[]=["course.catalog.read","course.content.read","course.assets.read"];
const policySchema=z.object({version:z.literal(1),grants:z.array(z.object({workspaceId:z.string().min(1),clientId:z.string().min(1),capabilities:z.array(workspaceServiceCapabilitySchema)}).strict())}).strict();
/** Only an independently configured owner file can add scopes to read defaults. */
export async function configuredWorkspaceClientCapabilities(path:string|undefined,request:WorkspaceServiceSessionRequest):Promise<WorkspaceServiceCapability[]> {
 if(!path)return [...reads];
 let file;
 try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [...reads];throw error;}
 try{
  const info=await file.stat();
  if(!info.isFile()||(info.mode&0o077)!==0||process.getuid&&info.uid!==process.getuid())throw Error("Workspace client permission file must be private and owned by this OS user");
  if(info.size>1024*1024)throw Error("Workspace client permission file is too large");
  const policy=policySchema.parse(JSON.parse(await file.readFile("utf8")));
  const approved=policy.grants.find(grant=>grant.workspaceId===request.workspaceId&&grant.clientId===request.clientId);
  return [...new Set([...reads,...(approved?.capabilities??[])])];
 }finally{await file.close();}
}
