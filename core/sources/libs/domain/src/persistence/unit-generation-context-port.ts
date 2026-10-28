export type UnitGenerationGoalContext = Readonly<{ id:string; userId:string|null; title:string; level:string; contentLanguage:string; generationOptions:string; topicCategory:string; mapPlanJson:string; goalKind:string; learningMode:string }>;
export interface UnitGenerationContextRepository {
  findGoal(goalId:string):Promise<UnitGenerationGoalContext|null>;
  updateGenerationOptions(input:{goalId:string;generationOptions:string}):Promise<boolean>;
}
