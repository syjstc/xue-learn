import type { GenerationScope } from "../../../../../contracts/src/index.js";
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const SCOPES: GenerationScope[] = [
  'goal',
  'module',
  'unit',
  'goal_creation',
];

export class ActiveRunsQueryDto {
  @IsIn(SCOPES)
  scope!: GenerationScope;

  @IsString()
  @IsNotEmpty()
  scopeId!: string;
}
