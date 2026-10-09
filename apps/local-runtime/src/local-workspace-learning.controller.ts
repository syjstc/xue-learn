import {Body,Controller,Get,HttpException,Inject,Param,Post} from "@nestjs/common";
import {CurrentUserId} from "@xue-learn/core/source/libs/common/src/index.ts";
import {z} from "zod";
import type {WorkspaceLearningPort} from "@xue-learn/core/source/libs/domain/src/persistence/workspace-learning-port.ts";
export const LOCAL_WORKSPACE_LEARNING_CONTEXT=Symbol("LOCAL_WORKSPACE_LEARNING_CONTEXT");
export const workspaceLearningCommandSchema=z.object({expectedContentRevision:z.number().int().nonnegative(),expectedSectionRevision:z.number().int().nonnegative(),
 answers:z.record(z.string().min(1),z.union([z.number().int(),z.array(z.number().int()),z.boolean()])).optional()}).strict();
@Controller("api/workspace-learning/units/:unitId")
export class LocalWorkspaceLearningController {
 constructor(@Inject(LOCAL_WORKSPACE_LEARNING_CONTEXT) private readonly learning:WorkspaceLearningPort){}
 @Get("assessments") assessments(@CurrentUserId() ownerId:string,@Param("unitId") unitId:string){return this.learning.assessments({ownerId,unitId});}
 @Get("progress") progress(@CurrentUserId() ownerId:string,@Param("unitId") unitId:string){return this.learning.progress({ownerId,unitId});}
 @Post("sections/:sectionId/answers") answers(@CurrentUserId() ownerId:string,@Param("unitId") unitId:string,@Param("sectionId") sectionId:string,@Body() body:unknown){return this.command(ownerId,unitId,sectionId,"answers",body);}
 @Post("sections/:sectionId/complete") complete(@CurrentUserId() ownerId:string,@Param("unitId") unitId:string,@Param("sectionId") sectionId:string,@Body() body:unknown){return this.command(ownerId,unitId,sectionId,"complete",body);}
 private async command(ownerId:string,unitId:string,sectionId:string,action:"answers"|"complete",body:unknown){
  const parsed=workspaceLearningCommandSchema.safeParse(body);if(!parsed.success)throw new HttpException("Invalid versioned learning command",400);
  try{return await this.learning.command({ownerId,unitId,sectionId,action,...parsed.data});}
  catch(error){throw new HttpException(error instanceof Error?error.message:String(error),Number((error as {status?:number}).status??409));}
 }
}
