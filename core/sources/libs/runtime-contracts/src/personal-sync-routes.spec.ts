import { classifyPersonalSyncLeaseRequest,registerPersonalSyncLeaseRequestClassifier } from "./personal-sync-routes.js";

describe("personal sync structural route classification", () => {
  it("requires workspace and goal leases for structural mutations", () => {
    expect(classifyPersonalSyncLeaseRequest("POST", "/api/goals")).toEqual({ kind: "workspace" });
    expect(classifyPersonalSyncLeaseRequest("PATCH", "/api/goals/g1/settings")).toEqual({ kind: "goal", goalId: "g1" });
    expect(classifyPersonalSyncLeaseRequest("POST", "/api/units/u1/regenerate")).toEqual({ kind: "unit", unitId: "u1" });
    expect(
      classifyPersonalSyncLeaseRequest(
        "POST",
        "/api/units/u1/sections/s1/generate/stream",
      ),
    ).toEqual({ kind: "unit", unitId: "u1" });
  });

  it("keeps attempts, progress, and messages offline-mergeable", () => {
    expect(classifyPersonalSyncLeaseRequest("POST", "/api/goals/g1/quiz/attempts")).toBeNull();
    expect(classifyPersonalSyncLeaseRequest("POST", "/api/goals/g1/messages")).toBeNull();
    expect(classifyPersonalSyncLeaseRequest("PATCH", "/api/units/u1/session/progress")).toBeNull();
  });
});

test("host extensions preserve their route leases without replacing Core structural ownership",()=>{
 const release=registerPersonalSyncLeaseRequestClassifier("test-host",(_method,path)=>path.startsWith("/api/host-owned/documents")?{kind:"workspace"}:null);
 try{expect(classifyPersonalSyncLeaseRequest("POST","/api/host-owned/documents")).toEqual({kind:"workspace"});expect(classifyPersonalSyncLeaseRequest("GET","/api/host-owned/documents")).toBeNull();expect(classifyPersonalSyncLeaseRequest("POST","/api/units/u1/regenerate")).toEqual({kind:"unit",unitId:"u1"});}
 finally{release();}
 expect(classifyPersonalSyncLeaseRequest("POST","/api/host-owned/documents")).toBeNull();
});
