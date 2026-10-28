import { createServer, createConnection, type Socket } from "node:net";
import { chmod, lstat, mkdir, unlink, realpath } from "node:fs/promises";
import {createHash} from "node:crypto";
import { join, resolve } from "node:path";
import { workspaceServiceSessionRequestSchema, workspaceServiceSessionSchema, type WorkspaceServiceSessionRequest, type WorkspaceServiceSession } from "../../libs/runtime-contracts/src/index.js";

const readCapabilities = new Set(["course.catalog.read","course.content.read","course.assets.read"]);
const maxBytes = 16 * 1024;
export type WorkspaceClientConnection = { endpoint:string; session:WorkspaceServiceSession };
async function ownedDirectory(path:string) {
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||process.getuid && info.uid!==process.getuid())throw Error("Workspace connection directory is not owned by this OS user");
  if((info.mode&0o077)!==0)throw Error("Workspace connection directory must be private to its OS user");
}
async function socketPathFor(directory:string) {
  const direct=join(directory,"session.sock");
  if(Buffer.byteLength(direct)<=100)return direct;
  const canonical=await realpath(directory);
  const identity=createHash("sha256").update(canonical).digest("hex").slice(0,20);
  const temporary=join(process.platform==="darwin"?"/private/tmp":"/tmp",`xuelearn-client-${process.getuid?.() ?? "user"}-${identity}`);
  await ownedDirectory(temporary);
  return join(temporary,"session.sock");
}
async function validateSocket(path:string) {
  const info=await lstat(path);
  if(!info.isSocket()||info.isSymbolicLink()||process.getuid && info.uid!==process.getuid()||(info.mode&0o077)!==0)throw Error("Workspace broker socket is not a private same-user connection");
}
function readLine(socket:Socket):Promise<string> {
  return new Promise((resolve,reject)=>{
    let buffer="",bytes=0,settled=false;
    const timer=setTimeout(()=>finish(Error("Workspace connection timed out")),30_000);
    const finish=(error?:Error,value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);socket.off("data",data);socket.off("error",failure);socket.off("end",ended);socket.off("close",ended);error?reject(error):resolve(value!);};
    const data=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxBytes){finish(Error("Workspace connection message is too large"));socket.destroy();return;}
      buffer+=chunk.toString("utf8");const end=buffer.indexOf("\n");if(end>=0)finish(undefined,buffer.slice(0,end));};
    const failure=(error:Error)=>finish(error),ended=()=>finish(Error("Workspace connection closed before its response"));
    socket.on("data",data);socket.once("error",failure);socket.once("end",ended);socket.once("close",ended);
  });
}

/** OS filesystem permissions are the transport authority. Only scoped course-read
 * sessions cross the socket; the privileged service bearer stays in this host. */
export async function createWorkspaceClientBroker(directory:string,grant:(request:WorkspaceServiceSessionRequest)=>Promise<WorkspaceClientConnection>,options:{authorizeLearningCommands?:(request:WorkspaceServiceSessionRequest)=>Promise<boolean>}={}) {
  if(process.platform==="win32")throw Error("The workspace connection broker requires a platform ACL adapter on Windows");
  const root=resolve(directory);await ownedDirectory(root);const path=await socketPathFor(root);
  try {
    await validateSocket(path);
    const previous = await lstat(path);
    const active = await new Promise<boolean>((resolve,reject) => {
      const probe = createConnection(path);
      const timer = setTimeout(() => {probe.destroy();reject(Error("Workspace broker probe timed out"));},1_000);
      probe.once("connect",() => {clearTimeout(timer);probe.destroy();resolve(true);});
      probe.once("error",error => {clearTimeout(timer);probe.destroy();if((error as NodeJS.ErrnoException).code === "ECONNREFUSED")resolve(false);else reject(error);});
    });
    if(active)throw Error("A workspace connection broker already owns this socket");
    const current=await lstat(path);
    if(current.ino!==previous.ino||current.dev!==previous.dev)throw Error("Workspace broker socket changed during recovery");
    await unlink(path);
  } catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  let accepting=true;
  const sockets=new Set<Socket>();
  const connections=new Map<Socket,{admitted:boolean;task:Promise<void>}>();
  const server=createServer(socket=>{
    sockets.add(socket);socket.once("close",()=>sockets.delete(socket));
    if(!accepting){socket.end(JSON.stringify({error:"Workspace broker is draining"})+"\n");return;}
    const state={admitted:false,task:Promise.resolve()};
    state.task=readLine(socket).then(async line=>{
      if(!accepting)throw Error("Workspace broker is draining");
      state.admitted=true;
      const request=workspaceServiceSessionRequestSchema.parse(JSON.parse(line));
      if(request.capabilities.some(capability=>!readCapabilities.has(capability)) && !(await options.authorizeLearningCommands?.(request)))
        throw Error("External source connections permit only explicit course-read capabilities unless learning commands are configured for this client");
      const result=await grant(request);
      const session=workspaceServiceSessionSchema.parse(result.session);
      if(session.workspaceId!==request.workspaceId||session.clientId!==request.clientId||session.capabilities.some(capability=>!request.capabilities.includes(capability)))throw Error("Workspace broker grant exceeded the requested identity or permissions");
      socket.end(JSON.stringify({endpoint:result.endpoint,session})+"\n");
    }).catch(error=>{if(!socket.destroyed&&!socket.writableEnded)socket.end(JSON.stringify({error:error instanceof Error?error.message:String(error)})+"\n");}).finally(()=>connections.delete(socket));
    connections.set(socket,state);
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(path,resolve);});await chmod(path,0o600);
  const suspend=async()=>{
    accepting=false;
    for(const [socket,state] of connections)if(!state.admitted)socket.destroy();
    await Promise.all([...connections.values()].map(state=>state.task));
  };
  return {path,suspend,resume:()=>{accepting=true;},close:async()=>{await suspend();for(const socket of sockets)socket.destroy();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await unlink(path).catch(error=>{if(error.code!=="ENOENT")throw error;});}};
}

/** Consumer adapter for a controlled broker directory, never a discovery token. */
export async function connectWorkspaceClient(directory:string,request:WorkspaceServiceSessionRequest):Promise<WorkspaceClientConnection> {
  if(process.platform==="win32")throw Error("The workspace connection broker requires a platform ACL adapter on Windows");
  const root=resolve(directory);await ownedDirectory(root);const path=await socketPathFor(root);await validateSocket(path);
  const parsed=workspaceServiceSessionRequestSchema.parse(request);
  const socket=createConnection(path);
  const response=readLine(socket);
  await new Promise<void>((resolve,reject)=>{socket.once("connect",resolve);socket.once("error",reject);});
  socket.write(JSON.stringify(parsed)+"\n");
  try{const value=JSON.parse(await response);if(value.error)throw Error(value.error);
    const session=workspaceServiceSessionSchema.parse(value.session);
    if(session.workspaceId!==parsed.workspaceId||session.clientId!==parsed.clientId)throw Error("Workspace session identity differs from the connection request");
    const endpoint=new URL(value.endpoint);if(endpoint.protocol!=="http:"||endpoint.hostname!=="127.0.0.1"||endpoint.username||endpoint.password)throw Error("Workspace connection endpoint is not local");
    return {endpoint:endpoint.origin,session};
  }finally{socket.destroy();}
}
