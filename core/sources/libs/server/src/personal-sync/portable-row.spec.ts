import {portablePersonalSyncRow} from "./portable-row.js";
it("sanitizes queued legacy changes without rewriting their stored image",()=>{
 const stored={id:"owner",name:"Synthetic",password:"fake",passwordHash:"hash",tenantId:"tenant"};
 expect(portablePersonalSyncRow("User",stored)).toEqual({id:"owner",name:"Synthetic"});
 expect(stored.password).toBe("fake");
 expect(portablePersonalSyncRow("LearningGoal",{id:"goal",title:"Kept"})).toEqual({id:"goal",title:"Kept"});
});
