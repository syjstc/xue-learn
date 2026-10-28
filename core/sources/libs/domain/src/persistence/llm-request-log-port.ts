export type LlmRequestLogPersistenceRecord=Readonly<Record<string,unknown>&{id:string;createdAt:Date;request:string;response:string}>;
export interface LlmRequestLogRepository{create(data:Readonly<Record<string,unknown>>):Promise<{id:string}>;find(id:string):Promise<LlmRequestLogPersistenceRecord|null>;patch(id:string,data:Readonly<Record<string,unknown>>):Promise<boolean>}
