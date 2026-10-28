import type { MaterialCheckTaskDefinition } from "./material-check-completion-port.js";
export type MaterialRegenerationSource=Readonly<{sections:readonly Readonly<{id:string;title:string;contentRevision:number;generationStatus:string;introduction:string;blocks:string;keyTakeaways:string}|null>[];legacy:Readonly<{introduction:string;sections:string;keyTakeaways:string}>|null}>;
export interface MaterialRegenerationRepository{
 findSource(input:{userId:string;unitId:string}):Promise<MaterialRegenerationSource|null>;
 persistSectionBlocks(input:{userId:string;unitId:string;sectionId:string;expectedSectionRevision:number;blocksJson:string}):Promise<{applied:boolean;contentRevision:number}>;
 persistLegacyBlocks(input:{userId:string;goalId:string;unitId:string;expectedContentRevision:number;blocksJson:string;nextGraphStateJson:string;tasks:readonly MaterialCheckTaskDefinition[]}):Promise<{applied:boolean;contentRevision:number}>;
}
