import {LOCAL_OWNER_ID} from "@xue-learn/core/runtime-contracts";
import {isDesktopLocalRuntime} from "@xue-learn/core/client-runtime";
/** The same fixed local owner as the existing desktop identity branch. */
export type AuthUser={id:string;name:string|null;email?:string|null};
export function getAuthUser():AuthUser|null{return isDesktopLocalRuntime()?{id:LOCAL_OWNER_ID,name:'Local learner',email:null}:null;}
export function getAuthToken():string|null{return null;}
export function isAuthenticated():boolean{return isDesktopLocalRuntime();}
