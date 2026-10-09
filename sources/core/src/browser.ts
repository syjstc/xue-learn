/** Browser-safe learning rules and accepted teaching formats. */
export * from "../../libs/domain/src/index.js";
export * as FormulaAnalysis from "../../libs/formula-analysis/src/index.js";
export * as TeachingDerivation from "../../libs/teaching-derivation/src/index.js";
export * as FormalDerivation from "../../libs/formal-derivation/src/index.js";
export {courseSourceSnapshotSchema, courseSourceAssetSchema, courseSourceSectionSchema} from "../../libs/runtime-contracts/src/course-source.js";
export type {CourseSourceSnapshotV1, CourseSourceAssetV1, CourseSourceSectionV1} from "../../libs/runtime-contracts/src/course-source.js";

export * as FormalExpression from "../../libs/formal-expression-core/src/index.js";
export * as LabEngine from "../../libs/lab-engine/src/index.js";
export * as LabProtocol from "../../libs/lab-protocol/src/index.js";
export * as Memory from "../../libs/memory/src/index.js";
