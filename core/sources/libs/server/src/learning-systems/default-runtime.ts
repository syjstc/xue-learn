import type {
  CognitiveModelPresentationReadRepository,
  LearnerStateMemoryInvalidationRepository,
  LearnerStateMemoryReadRepository,
  LearnerStateProjectionReadRepository,
  VerifiedEvidenceAppendRepository,
} from "../../../domain/src/index.js";
import type { LearningSystemPersistenceClient } from "./persistence-client.js";
import {
  attachKacomWriteCommands,
  createBaseGenerationCapability,
  createBuiltinReadCapabilities,
  createOptionalContextCapabilities,
  createRuntimeContextCapabilities,
} from "./adapters/index.js";
import { configureLearnerStateProjectionRead } from "../cognition/context.js";
import {
  DatabaseLearningSystemActivationResolver,
  DatabaseLearningSystemSubjectResolver,
  type LearningSystemActivationStore,
} from "./database-activation.js";
import {
  createLearningSystemRuntime,
  installGenerationContextRuntime,
  type LearningSystemRuntime,
} from "./runtime.js";
import type {
  LearningSpaceApplication,
  LearningSpacePortfolioReader,
} from "../learning-spaces/orm-application-service.js";

let defaultRuntime: LearningSystemRuntime | undefined;
let defaultLearningSpacePortfolio: LearningSpacePortfolioReader | undefined;
let defaultLearningSpaceApplication: LearningSpaceApplication | undefined;
let defaultLearnerStateMemoryRead: LearnerStateMemoryReadRepository | undefined;
let defaultLearnerStateMemoryInvalidation:
  LearnerStateMemoryInvalidationRepository | undefined;
let defaultLearnerStateProjectionRead:
  LearnerStateProjectionReadRepository | undefined;
let defaultCognitiveModelPresentationRead:
  CognitiveModelPresentationReadRepository | undefined;
let defaultPersistence: LearningSystemPersistenceClient | undefined;
let defaultVerifiedEvidenceAppend: VerifiedEvidenceAppendRepository | undefined;

/** Configure the process composition before the default capability runtime is used. */
export function configureDefaultLearningSpaceApplication(
  application: LearningSpaceApplication | undefined,
  learnerStateMemoryRead?: LearnerStateMemoryReadRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  learnerStateProjectionRead?: LearnerStateProjectionReadRepository,
  cognitiveModelPresentationRead?: CognitiveModelPresentationReadRepository,
  persistence?: LearningSystemPersistenceClient,
  verifiedEvidenceAppend?: VerifiedEvidenceAppendRepository,
): void {
  defaultLearningSpaceApplication = application;
  defaultLearnerStateMemoryRead = learnerStateMemoryRead;
  defaultLearnerStateMemoryInvalidation = learnerStateMemoryInvalidation;
  defaultLearnerStateProjectionRead = learnerStateProjectionRead;
  defaultCognitiveModelPresentationRead = cognitiveModelPresentationRead;
  defaultPersistence = persistence;
  defaultVerifiedEvidenceAppend = verifiedEvidenceAppend;
  configureLearnerStateProjectionRead(learnerStateProjectionRead);
  defaultLearningSpacePortfolio = application
    ? application.portfolio.bind(application)
    : undefined;
  if (defaultRuntime) {
    defaultRuntime = undefined;
    installGenerationContextRuntime(undefined);
  }
}

/** @deprecated Use the full typed application composition boundary. */
export function configureDefaultLearningSpacePortfolio(
  reader: LearningSpacePortfolioReader | undefined,
): void {
  defaultLearningSpacePortfolio = reader;
  defaultLearningSpaceApplication = undefined;
  defaultLearnerStateMemoryRead = undefined;
  defaultLearnerStateMemoryInvalidation = undefined;
  defaultLearnerStateProjectionRead = undefined;
  configureLearnerStateProjectionRead(undefined);
  if (defaultRuntime) {
    defaultRuntime = undefined;
    installGenerationContextRuntime(undefined);
  }
}

export function getDefaultLearningSystemRuntime(): LearningSystemRuntime {
  if (defaultRuntime) return defaultRuntime;
  const persistence = defaultPersistence;
  if (!persistence) throw new Error("Learning-system persistence is not configured");
  const verifiedEvidenceAppend = defaultVerifiedEvidenceAppend;
  if (!verifiedEvidenceAppend) {
    throw new Error("Learning-system evidence persistence is not configured");
  }
  const activationStore: LearningSystemActivationStore = persistence;
  const builtinCapabilities = attachKacomWriteCommands(
    createBuiltinReadCapabilities({
      persistence,
      learningSpaceApplication: defaultLearningSpaceApplication,
      learningSpacePortfolio: defaultLearningSpacePortfolio,
      learnerStateMemoryRead: defaultLearnerStateMemoryRead,
      learnerStateProjectionRead: defaultLearnerStateProjectionRead,
      cognitiveModelPresentationRead: defaultCognitiveModelPresentationRead,
    }),
    {
      verifiedEvidenceAppend,
      learnerStateMemoryInvalidation: defaultLearnerStateMemoryInvalidation,
    },
  );
  defaultRuntime = createLearningSystemRuntime({
    capabilities: [
      createBaseGenerationCapability({ persistence }),
      ...builtinCapabilities,
      ...createRuntimeContextCapabilities({ persistence }),
      ...createOptionalContextCapabilities({ persistence }),
    ],
    activationResolver: new DatabaseLearningSystemActivationResolver(
      activationStore,
    ),
    subjectResolver: new DatabaseLearningSystemSubjectResolver(activationStore),
  });
  installGenerationContextRuntime(defaultRuntime);
  return defaultRuntime;
}

export function resetDefaultLearningSystemRuntimeForTests(): void {
  defaultRuntime = undefined;
  defaultLearningSpacePortfolio = undefined;
  defaultLearningSpaceApplication = undefined;
  defaultLearnerStateMemoryRead = undefined;
  defaultLearnerStateMemoryInvalidation = undefined;
  defaultLearnerStateProjectionRead = undefined;
  defaultCognitiveModelPresentationRead = undefined;
  defaultPersistence = undefined;
  defaultVerifiedEvidenceAppend = undefined;
  configureLearnerStateProjectionRead(undefined);
  installGenerationContextRuntime(undefined);
}
