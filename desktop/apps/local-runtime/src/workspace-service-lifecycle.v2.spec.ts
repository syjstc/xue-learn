import {WorkspaceServiceLifecycle} from "./workspace-service-lifecycle.ts";
it("retains admitted work and prevents a new grant/task after an atomic idle drain",async()=>{
 const gate=new WorkspaceServiceLifecycle();const release=gate.enter()!;
 expect(gate.commitDrain({clientSessions:0,backgroundTasks:0})).toBe(false);
 release();release();expect(gate.activeRequests).toBe(0);
 expect(gate.commitDrain({clientSessions:1,backgroundTasks:0})).toBe(false);
 expect(gate.commitDrain({clientSessions:0,backgroundTasks:1})).toBe(false);
 expect(gate.commitDrain({clientSessions:0,backgroundTasks:0})).toBe(true);
 expect(gate.enter()).toBeNull();gate.resume();expect(gate.enter()).not.toBeNull();
});
it("does not decide idle from a stale count while another request has been admitted",async()=>{
 const gate=new WorkspaceServiceLifecycle();let finish:(()=>void)|undefined;
 const counts=new Promise<void>(resolve=>{finish=resolve;});
 const deciding=(async()=>{await counts;return gate.commitDrain({clientSessions:0,backgroundTasks:0});})();
 const release=gate.enter()!;finish!();expect(await deciding).toBe(false);release();
});
