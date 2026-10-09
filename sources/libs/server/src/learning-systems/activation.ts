import type {
  EagerViewProfile,
  LearningSystemCapability,
  LearningSystemSubject,
} from "./types.js";

export type LearningSystemActivationRequest = {
  capability: LearningSystemCapability;
  subject: LearningSystemSubject;
};

export type LearningSystemViewRequirementRequest =
  LearningSystemActivationRequest & {
    profile: EagerViewProfile;
  };

/**
 * Activation is intentionally a policy boundary rather than a property on a
 * capability. Product policy (for example mastery versus exploration) can
 * therefore evolve without coupling the registered system to goal storage.
 */
export interface LearningSystemActivationResolver {
  isActive(
    request: LearningSystemActivationRequest,
  ): boolean | Promise<boolean>;
  /**
   * Narrows a catalog requirement only when product policy intentionally
   * excludes the capability (for example KACOM on a micro course). A missing
   * or unauthorized goal must remain fail-closed.
   */
  isViewRequired?(
    request: LearningSystemViewRequirementRequest,
  ): boolean | Promise<boolean>;
}

/**
 * Canonicalizes an internal generation scope before activation or view reads.
 * Authentication-aware runtimes use this to hydrate trusted background jobs
 * that know only a goal/unit while rejecting inconsistent scope combinations.
 */
export interface LearningSystemSubjectResolver {
  resolve(
    subject: LearningSystemSubject,
  ): LearningSystemSubject | Promise<LearningSystemSubject>;
}

/**
 * Registration already represents an explicit, trusted bootstrap decision.
 * In the absence of a product-specific resolver, registered systems stay
 * active so required systems cannot be silently downgraded.
 */
export class RegisteredSystemsActivationResolver implements LearningSystemActivationResolver {
  isActive(): boolean {
    return true;
  }

  isViewRequired({ profile }: LearningSystemViewRequirementRequest): boolean {
    return profile.required;
  }
}

export class IdentityLearningSystemSubjectResolver implements LearningSystemSubjectResolver {
  resolve(subject: LearningSystemSubject): LearningSystemSubject {
    return { ...subject };
  }
}

export const DEFAULT_ACTIVATION_RESOLVER =
  new RegisteredSystemsActivationResolver();
export const DEFAULT_SUBJECT_RESOLVER =
  new IdentityLearningSystemSubjectResolver();
