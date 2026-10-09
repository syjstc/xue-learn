import { AsyncLocalStorage } from "node:async_hooks";
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type INestApplication,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";

export const BACKEND_LOCALES = ["zh-Hans", "zh-Hant", "en"] as const;

export type BackendLocale = (typeof BACKEND_LOCALES)[number];
export type BackendTranslationParams = Record<string, string | number>;

export const DEFAULT_BACKEND_LOCALE: BackendLocale = "zh-Hans";

const en = {
  "error.remotion.previewRequired": "Please finish this unit’s preview before creating a Remotion film; full course material is not required.",
  "error.remotion.overviewRequired": "Please finish preparing the course introduction before creating its video.",
  "error.remotion.previewChanged": "The preview changed during production. Retry from the latest preview; the previous film is preserved.",
  "error.remotion.revisionChanged": "A newer film revision exists. Earlier generation will not overwrite it; please retry.",
  "error.remotion.invalidDisplayCorrection": "Select an existing film-prepared display and provide its complete corrected diagram and narration. Other source objects are preserved.",
  "error.remotion.displayCorrectionSourceBound": "This display belongs to published course content. Correct the course first, then regenerate its video.",
  "error.remotion.previewStale": "The preview has changed. Update the film from the latest preview before exporting.",
  "error.remotion.imageMissing": "A film image is missing or changed. Restore it before continuing.",
  "error.remotion.imageProviderRequired": "Configure image generation before continuing this shot.",
  "error.remotion.authoringTimeout": "Preparing “{title}” exceeded the {seconds}-second model response limit. Accepted content is saved. Continue to resume unfinished work.",
  "error.remotion.authoringIdleTimeout": "No new model output was received for {seconds} seconds while preparing “{title}”. Accepted content is saved. Continue to resume unfinished work.",
  "error.remotion.imageNeedsReview": "The image for “{title}” still failed validation after {attempts} corrections: {issues}. Select Continue to correct this image again; saved progress is preserved.",
  "error.remotion.imageSubjectMissing": "Missing teaching subject: {subject}",
  "error.courseProduction.notFound": "Course not found",
  "error.courseProduction.unitNotFound": "Unit not found in course",
  "error.courseProduction.sectionNotFound": "Section not found",
  "error.courseProduction.legacy": "Legacy content must be regenerated in its existing course editor",
  "error.courseProduction.unfinished": "Section generation has not finished; resume to check again",
  "error.courseProduction.contentRequired": "Prepare the published section content first.",
  "error.courseProduction.storageUnavailable": "Course persistence unavailable",
  "error.internal":
    "Something went wrong on our side. Please try again in a moment.",
  "error.unknown": "Something went wrong. Please try again.",
  "error.notFound": "Not found",
  "error.generation.failed": "Generation failed",
  "error.generation.failedFriendly":
    "We couldn’t finish preparing this content. Your progress is safe—please try again.",
  "error.generation.notFound": "Generation task not found",
  "error.generation.ended": "Generation task has ended",
  "error.generation.cancelled": "Generation stopped",
  "error.generation.interrupted":
    "The server restarted and interrupted this generation. Please try again.",
  "error.auth.registrationDisabled": "Registration is disabled",
  "error.auth.nameRequired": "Username is required",
  "error.auth.passwordRequired": "Password is required",
  "error.auth.userExists": "User already exists",
  "error.auth.userNotFound": "User not found",
  "error.auth.invalidPassword": "Invalid password",
  "error.auth.invalidRefreshToken": "Invalid refresh token",
  "error.auth.refreshTokenUsed": "Refresh token already used",
  "error.auth.missingBearerToken": "Missing bearer token",
  "error.auth.invalidToken": "Invalid token",
  "error.auth.missingUserIdentity": "Missing user identity",
  "error.auth.adminRequired": "Admin access required",
  "error.auth.adminDashboardRequired":
    "Use the admin dashboard to sign in as admin",
  "error.auth.adminClientRequired": "Admin dashboard access required",
  "error.auth.emailInvalid": "Email is invalid",
  "error.auth.passwordMinLength": "{field} must be at least 8 characters",
  "error.auth.identityTokenRequired": "identityToken is required",
  "error.auth.appleNotConfigured": "Apple Sign In is not configured",
  "error.auth.invalidAppleIdentityToken": "Invalid Apple identity token",
  "error.auth.currentPasswordRequired": "Current password is required",
  "error.auth.invalidCurrentPassword": "Invalid current password",
  "error.auth.emailCodeInvalid": "Verification code is incorrect",
  "error.auth.emailCodeExpired":
    "Verification code has expired. Please request a new one.",
  "error.auth.emailCodeFormatInvalid": "Verification code must be 6 digits",
  "error.auth.emailCodeCooldown":
    "Verification code sent too frequently. Please try again in 60 seconds.",
  "error.auth.emailCodeHourlyLimit":
    "This email has reached the hourly verification code limit",
  "error.auth.emailSendFailed": "Failed to send email: {message}",
  "error.auth.accountDeleteConfirmRequired":
    "Type DELETE to confirm account deletion",
  "error.auth.accountDeleteAdminForbidden":
    "The admin account cannot be deleted",
  "error.auth.usernameTooShort": "Username must be at least 3 characters",
  "error.auth.usernameTooLong": "Username must be at most 32 characters",
  "error.auth.usernameInvalid":
    "Username must start with a letter and use only letters, digits, and underscores",
  "error.auth.usernameReserved": "This username is reserved",
  "error.auth.usernameAlreadySet":
    "Username is already set and cannot be changed",
  "error.auth.emailAlreadySet": "Email is already set and cannot be changed",
  "error.auth.emailInUse": "This email is already linked to another account",
  "error.auth.wechatCodeRequired": "WeChat login code is required",
  "error.auth.wechatNotConfigured":
    "WeChat Mini Program login is not configured",
  "error.auth.wechatLoginFailed": "WeChat login failed",
  "error.auth.wechatAccountHasGoals":
    "This WeChat account already has courses. Please contact support to merge accounts safely.",
  "error.auth.notWechatMiniAccount":
    "This account is not a WeChat Mini Program account",
  "error.auth.nameTypeInvalid": "Username must be a string",
  "error.auth.emailTypeInvalid": "Email must be a string",
  "error.auth.passwordTypeInvalid": "Password must be a string",
  "error.auth.passwordMinLengthGeneric":
    "Password must be at least 8 characters",
  "error.auth.passwordLoginIdentityRequired":
    "A username or email is required when setting a password",
  "error.auth.identifierRequired": "Provide at least a username or email",
  "error.auth.usernameOrEmailExists": "Username or email already exists",
  "error.request.invalidBody": "Invalid request body",
  "error.settings.providerNotConfigured":
    "Provider “{provider}” is not configured. Add the required API keys in .env.",
  "error.settings.modelUnavailable":
    "Model “{model}” is not available. Choose a model with LLM billing configured.",
  "error.settings.searchLearnerManaged":
    "Web search is controlled globally in admin AI generation settings and cannot be changed per learner.",
  "error.settings.imagesDisabled":
    "Image generation is disabled for this deployment.",
  "error.settings.imagesLearnerManaged":
    "Image generation is controlled globally in admin AI generation settings and cannot be changed per learner.",
  "status.auth.emailCodeSent":
    "Verification code sent. Please check your email.",
  "status.auth.loginSuccess": "Signed in successfully",
  "status.generation.learningTargets":
    "Checking learning goals and prerequisites…",
  "status.generation.sq": "Organizing this lesson’s preview points…",
  "status.generation.sectionPlan":
    "Grouping this lesson into teaching sections…",
  "status.generation.material": "Preparing this lesson’s learning content…",
  "status.generation.formalDerivation":
    "Preparing this lesson’s formula derivation…",
  "status.generation.teachingDerivation":
    "Preparing this lesson’s teaching derivation…",
  "status.generation.verifyingContent":
    "Checking the generated content for correctness…",
  "status.generation.notes": "Organizing this lesson’s study notes…",
  "status.generation.quiz": "Preparing practice from this lesson…",
  "status.generation.flashcards": "Organizing spaced-review flashcards…",
  "status.generation.quizExplain":
    "Preparing an explanation from the question…",
  "status.generation.socraticMistakes": "Reviewing the questions to revisit…",
  "status.generation.socraticQuestion":
    "Preparing a guiding question from your answer…",
  "status.generation.diagnostic":
    "Preparing {count} diagnostic questions from the learning goals…",
  "status.generation.images": "Preparing illustrations ({current}/{total})…",
  "label.memoryImage.topdown": "Top-down view",
  "label.memoryImage.perspective": "Panoramic view",
  "label.memoryImage.detail": "Detail view",
  "status.generation.memoryRoom": "Preparing the memory palace room…",
  "status.generation.memoryClues": "Organizing memory clues in “{room}”…",
  "status.generation.memoryRoomDetails":
    "Generating sensory details and anchor descriptions for the room…",
  "status.generation.memoryRoomImages":
    "Generating top-down and panoramic views…",
  "status.generation.memoryImageProgress":
    "Generating illustration {current}/{total}: {label}",
  "status.generation.scenarioPreparing":
    "Assembling the cast for this scenario…",
  "status.generation.scenarioFallback":
    "Using a reliable template to arrange the cast…",
  "status.generation.scenarioScene": "Preparing this scene…",
  "status.generation.scenarioScenePrefetch": "Preparing the next scenes…",
  "status.generation.uploadingMaterials":
    "Writing learning materials to the knowledge base…",
  "status.generation.materialsIngested":
    "Learning materials have been vectorized",
  "status.generation.materialIngestionFailed":
    "Writing learning materials failed; planning has stopped",
  "status.generation.processingMaterial":
    "Processing materials ({current}/{total}): {filename}…",
  "status.generation.parsingMaterial": "Parsing “{filename}”…",
  "status.generation.writingSource": "Writing source “{title}”…",
  "status.generation.embedding": "Generating embeddings ({count} chunks)…",
  "status.generation.embeddingBatch":
    "Generating embeddings ({batch}/{total} batches, {count} chunks)…",
  "status.generation.subdivide": "Using AI to split “{title}”…",
  "status.generation.saveLearningSteps":
    "Saving learning steps without changing course structure…",
  "status.generation.subdivideWriting":
    "Generated {count} child units; writing them safely…",
  "status.generation.expand": "Expanding “{title}”…",
  "status.generation.expandWriting":
    "Generated {count} child units; writing them…",
  "status.generation.collectingPathReferences":
    "Collecting learning-path references…",
  "status.generation.generatingMap": "AI is generating the learning map…",
  "status.generation.mapWriting":
    "Generated {count} learning units; writing them…",
  "status.generation.followUp": "Thinking with this lesson’s content…",
  "status.generation.goal": "Clarifying your learning goal…",
  "status.generation.goalIcon": "Creating the learning-goal icon…",
  "status.generation.path": "Planning your learning path…",
  "status.planning.context.started":
    "Reviewing your goal, available materials, and planning constraints…",
  "status.planning.context.pulse1":
    "Still comparing the goal with the available source context…",
  "status.planning.context.pulse2":
    "Checking which information should shape the learning path…",
  "status.planning.context.completed":
    "Goal and source context are ready for planning",
  "status.planning.draft.started":
    "The model is drafting capability milestones and module boundaries…",
  "status.planning.draft.pulse1":
    "Comparing possible module boundaries and prerequisite order…",
  "status.planning.draft.pulse2":
    "Checking that the milestones cover the full learning goal…",
  "status.planning.draft.pulse3":
    "Refining module scope before module-by-module research…",
  "status.planning.draft.completed": "The preliminary module journey is ready",
  "status.planning.final.started":
    "The model is synthesizing research into the final learning path…",
  "status.planning.final.pulse1":
    "Reconciling source findings with module outcomes…",
  "status.planning.final.pulse2":
    "Checking lesson counts, module sizes, and progression…",
  "status.planning.final.pulse3":
    "Resolving overlaps and prerequisite relationships…",
  "status.planning.final.completed": "The final learning path is ready",
  "status.planning.identity.started":
    "Clarifying the goal direction, summary, and assumed foundations…",
  "status.planning.identity.pulse1":
    "Still naming the learning mode and what you will gain…",
  "status.planning.identity.pulse2":
    "Checking the summary against your confirmed level and intent…",
  "status.planning.identity.completed":
    "Goal summary and foundations are ready",
  "status.planning.journey.started":
    "Sequencing the modules you will learn through…",
  "status.planning.journey.pulse1":
    "Comparing milestone boundaries and prerequisite order…",
  "status.planning.journey.pulse2":
    "Checking that the modules cover the full learning goal…",
  "status.planning.journey.pulse3":
    "Removing overlap so later modules build on earlier ones…",
  "status.planning.journey.completed": "The module journey is ready",
  "status.planning.moduleCapabilities.started":
    "Defining exit capabilities for “{title}”…",
  "status.planning.moduleCapabilities.pulse1":
    "Still turning the “{title}” objective into observable capabilities…",
  "status.planning.moduleCapabilities.pulse2":
    "Checking that “{title}” capabilities can be assessed later…",
  "status.planning.moduleCapabilities.completed":
    "Exit capabilities for “{title}” are ready",
  "status.planning.moduleStructure.started":
    "Sequencing lessons for “{title}”…",
  "status.planning.moduleStructure.pulse1":
    "Still outlining the lessons in “{title}”…",
  "status.planning.moduleStructure.pulse2":
    "Checking that “{title}” covers this module’s capabilities…",
  "status.planning.moduleStructure.pulse3":
    "Ordering the “{title}” lessons so they can be learned in sequence…",
  "status.planning.moduleStructure.completed":
    "The “{title}” lesson sequence is ready",
  "status.planning.validation.started":
    "Validating coverage, ordering, and module planning contracts…",
  "status.planning.validation.completed":
    "Planning contracts passed validation and were saved",
  "status.planning.moduleDraft.started":
    "Preparing the “{title}” module structure…",
  "status.planning.moduleDraft.authoring": "Writing lessons for “{title}”…",
  "status.planning.moduleDraft.pulse1":
    "Still outlining the lessons in “{title}”…",
  "status.planning.moduleDraft.pulse2":
    "Checking that “{title}” covers this module’s objective…",
  "status.planning.moduleDraft.pulse3":
    "Ordering the “{title}” lessons so they can be learned in sequence…",
  "status.planning.moduleDraft.completed":
    "The “{title}” module draft is ready for review",
  "status.planning.moduleDraft.fanOut":
    "Preparing every module structure, then running one cross-module audit",
  "status.planning.moduleAudit.started":
    "Checking that every module fits the confirmed goal…",
  "status.planning.moduleAudit.pulse1":
    "Comparing module coverage, overlap, and lesson order…",
  "status.planning.moduleAudit.pulse2":
    "Looking for missing blueprint steps and dependency issues…",
  "status.planning.moduleAudit.completed":
    "Finished the cross-module structure check",
  "status.planning.moduleAudit.passed":
    "Module structures passed the audit and will be published",
  "status.planning.moduleAudit.repairing":
    "The audit found issues; repairing the flagged modules once",
  "status.planning.modulePublish.started": "Publishing the “{title}” module…",
  "status.planning.modulePublish.completed": "Published “{title}”",
  "status.generation.overview": "Organizing the course overview…",
  "status.generation.batchSq":
    "Organizing preview points for {count} learning units…",
  "status.generation.batchMaterial":
    "Preparing learning content for {count} learning units…",
  "status.generation.unitSq": "Organizing preview points for “{title}”…",
  "status.generation.unitSectionPlan":
    "Grouping teaching sections for “{title}”…",
  "status.generation.unitMaterial": "Preparing learning content for “{title}”…",
  "status.generation.unitNeedsSq":
    "Organizing preview points for “{title}” first…",
  "error.goal.notFound":
    "We couldn't find this learning goal. It may have been deleted, or the link is invalid.",
  "error.goal.missing": "Learning goal is required",
  "error.goal.unitNotFound":
    "We couldn't find this lesson. It may have been removed, or the link is invalid.",
  "error.goal.forbidden": "You do not have access to this goal",
  "error.goal.unitForbidden": "You do not have access to this unit",
  "error.goal.sharedNotFound":
    "We couldn't find this shared learning goal. The link may be incorrect or no longer available.",
  "error.goal.sharedCourseNotFound": "Shared course not found or not public",
  "error.goal.invalidShareSettings": "Invalid share settings",
  "error.goal.microUnsupportedMap":
    "Micro-courses do not support learning map or plan actions",
  "error.goal.overviewUnitReadonly": "Overview course units cannot be edited",
  "error.goal.titleRequired": "Title is required",
  "error.goal.idRequired": "goalId is required",
  "error.goal.mapRefreshUnavailable":
    "There are no nodes to refresh at this level",
  "error.goal.contractRequired":
    "Generate and approve the goal contract before creating the learning map",
  "error.goal.mapRequiredForRegeneration":
    "There is no learning map to regenerate yet",
  "error.goal.mapAlreadyExists":
    "A learning map already exists. Use the regenerate action instead.",
  "error.goal.moduleLocked": "This module is not unlocked yet",
  "error.goal.moduleBuilding":
    "This module is still being prepared. Please try again shortly.",
  "error.goal.planRequired": "Generate the learning plan first",
  "error.goal.planIncomplete": "Complete the learning plan first",
  "error.goal.summaryRequired":
    "Generate and approve the learning summary first",
  "error.goal.summaryAlreadyExists":
    "A learning summary already exists. Approve it or request regeneration.",
  "error.goal.settingsRequired": "Provide at least one setting to update",
  "error.goal.invalidContentLanguage": "Invalid content language",
  "error.goal.courseModeDisabled": "Course mode is not enabled",
  "error.goal.topicRequired": "Enter a micro-course topic",
  "error.goal.futureModulesOnly":
    "Only future modules that have not been unlocked can be replanned",
  "error.goal.approvedModuleReadonly":
    "Active or completed modules cannot be changed",
  "error.goal.docsRequired":
    "Upload learning materials before using materials-first planning",
  "error.goal.invalidMapEdit": "This learning-map edit is not allowed",
  "error.goal.invalidSharedCourse": "The shared course structure is invalid",
  "error.goal.approvedCourseReadonly":
    "This course is approved. Replan future modules to adjust modules that are not unlocked yet.",
  "error.goal.mapContractLocked":
    "The current learning map is bound to its goal contract. Change scope through the map replacement flow.",
  "error.goal.planLanguageMismatch":
    "Some modules do not match the course language. Regenerate the plan before approving it.",
  "error.goal.explorationNoMastery":
    "Reading and exploration mode does not provide mastery estimates",
  "error.goal.explorationNoDiagnostic":
    "Reading and exploration mode does not provide cognitive diagnostics",
  "error.goal.explorationNoModel":
    "Reading and exploration mode does not create a cognitive model",
  "error.goal.cognitiveModelBuilding":
    "This module is being prepared. Its cognitive model will be available after the module is published.",
  "error.goal.summaryLocked":
    "The preview summary can no longer be changed after course generation starts",
  "error.goal.notFullGoal": "This feature is only available for full goals",
  "error.goal.notExploration": "This goal is already in mastery mode",
  "error.goal.curriculumNotReady":
    "Please wait for the course to finish preparing before changing learning mode",
  "error.goal.shareActive":
    "Cancel the publication or review request before changing learning mode",
  "error.goal.notKacomGoal":
    "Only full goals with KACOM enabled can detach the cognitive model",
  "error.goal.shareModulesNotReady":
    "Unlock and finish generating all modules before requesting public sharing",
  "error.goal.shareMissingMaterial":
    "{count} required lessons still have no learning material and cannot be shared publicly",
  "error.goal.shareNoContent":
    "This course has no content and cannot be published",
  "error.goal.shareNoPublishedLessons":
    "This course has no published lessons and cannot be shared publicly",
  "error.goal.sharePendingNotFound":
    "The pending course review no longer exists or was already handled",
  "error.goal.sharePendingInvalid": "The pending course content is invalid",
  "error.goal.sharedCourseUnavailable":
    "The public course is unavailable or has been unpublished",
  "error.agenda.itemNotFound": "Agenda item not found",
  "error.agenda.scopeConflict": "goalId and spaceId cannot be used together",
  "error.learning.materialRequired": "Please generate learning content first",
  "error.learning.materialNotFound": "Learning material not found",
  "error.learning.completeMaterialFirst":
    "Please complete the learning content first",
  "error.learning.completeUnitFirst": "Please complete this unit first",
  "error.learning.invalidStep": "Invalid step",
  "error.learning.invalidAction": "Unknown action",
  "error.learning.feynmanUnavailable":
    "Feynman explanation is not available yet",
  "error.learning.threadIdRequired": "threadId is required",
  "error.learning.threadNotFound": "Conversation not found",
  "error.learning.quizSetIdRequired": "quizSetId is required",
  "error.learning.quizSetNotFound": "Quiz set not found",
  "error.learning.quizSetInvalid":
    "Quiz set is invalid. Please regenerate questions.",
  "error.learning.answerRequired": "Please enter an answer first",
  "error.learning.noSocraticConversation":
    "No Socratic conversation can continue",
  "error.learning.socraticEnded":
    "This conversation has ended. Switch to another missed question.",
  "error.learning.completeCorrectionsFirst":
    "Please complete all missed-question corrections first",
  "error.learning.invalidTone": "Invalid content tone",
  "error.learning.guidingQuestionsNotFound": "No guiding questions available",
  "error.learning.slideNarrationRequired": "No slide narration texts provided",
  "error.learning.invalidBlockIndex": "Invalid block index",
  "error.learning.invalidSlideOrBlockIndex": "Invalid slide or block index",
  "error.learning.componentMissing": "Component does not exist",
  "error.learning.componentRegenerateForbidden":
    "Component cannot be regenerated",
  "error.learning.componentRegenerateFailed":
    "Failed to regenerate interactive component",
  "error.learning.imageRegenerationInvalid":
    "This block cannot be regenerated as an image",
  "error.learning.svgIllustrationReplaceUnavailable":
    "Replacing an SVG diagram with an image is only available in desktop development",
  "error.learning.aiBlockEditUnavailable":
    "Editing a content block with AI is only available in desktop development",
  "error.learning.aiBlockEditInstructionRequired":
    "Describe how the AI should change this block first",
  "error.learning.aiBlockEditUnsupported":
    "This block type cannot be edited with AI",
  "error.learning.aiBlockEditFailed": "Failed to edit this block with AI",
  "error.learning.blockDeleteUnavailable":
    "Deleting content blocks is only available in desktop development",
  "error.learning.blockDeleteAssessmentForbidden":
    "Assessment blocks cannot be deleted here",
  "error.learning.subdivideNotFound": "Learning unit not found",
  "error.learning.subdivideAlreadyModule":
    "This learning unit has already been split",
  "error.learning.subdivideMaxDepth":
    "This learning map has reached its maximum depth",
  "error.learning.subdivideModuleContainer":
    "Open a lesson inside the module before splitting it",
  "error.learning.subdivideNoChildren":
    "This learning unit has no child map to remove",
  "error.learning.subdivideUnsafeActivity":
    "Learning activity has started in this unit, so its structure cannot be changed",
  "error.learning.subdivideModuleLimit":
    "The module cannot contain more than {limit} lessons after splitting",
  "error.learning.subdivideNoTargets":
    "This learning unit has no learning targets that can be safely reused",
  "error.learning.subdivideFailed":
    "The learning unit could not be split. Please try again.",
  "error.learning.allAnswersRequired":
    "Please answer every question before submitting",
  "error.learning.answerChoiceRequired": "Please select an answer",
  "error.learning.assessmentAlreadySubmitted":
    "This assessment has already been submitted",
  "error.learning.assessmentNotFound": "Assessment not found",
  "error.learning.assessmentQuestionNotFound": "Assessment question not found",
  "error.learning.assessmentResponseTooLarge":
    "Assessment response is too large",
  "error.learning.idempotencyKeyRequired":
    "A valid idempotency key is required",
  "error.learning.evaluatorFieldsUnsupported":
    "Client-authored evaluator fields are not accepted: {fields}",
  "error.learning.idempotencyConflict":
    "This idempotency key was already used for a different response",
  "error.learning.assessmentDurationInvalid":
    "A valid assessment duration is required",
  "error.learning.adaptiveAssessmentNotFound":
    "Adaptive assessment task not found",
  "error.learning.cognitiveModelFailed":
    "The cognitive model could not be prepared. Please try again.",
  "error.learning.completeRequiredSectionsFirst":
    "Please complete all required learning sections first",
  "error.learning.completeSectionQuizFirst":
    "Please complete the section quiz first",
  "error.learning.explanationNotNeeded":
    "This question does not require an explanation",
  "error.learning.explorationFeynmanEvidenceUnsupported":
    "Feynman evidence is unavailable in reading and exploration mode",
  "error.learning.followUpStreamRequired":
    "Use the streaming endpoint for follow-up questions",
  "error.learning.gradeQuizFirst": "Please grade the quiz first",
  "error.learning.interactionValidationUnsupported":
    "This interaction does not support verified assessment",
  "error.learning.invalidAnchor": "Invalid anchor",
  "error.learning.invalidAnswerFormat": "Invalid answer format",
  "error.learning.invalidAnswerOption": "Invalid answer option",
  "error.learning.invalidInteractionIndex": "Invalid interaction index",
  "error.learning.invalidTrueFalseIndex": "Invalid true/false question index",
  "error.learning.legacyCheckEvidenceUnsupported":
    "Legacy checks do not support learning evidence",
  "error.learning.materialCheckTypeInvalid":
    "Invalid learning-content check type",
  "error.learning.materialCheckUpdated":
    "This learning-content check has changed. Please try again.",
  "error.learning.materialRequiredForFlashcards":
    "Generate learning content before creating flashcards",
  "error.learning.materialRequiredForQuiz":
    "Generate learning content before creating a quiz",
  "error.learning.microDiagnosticUnavailable":
    "Micro-courses do not provide cognitive diagnostics",
  "error.learning.moduleAlreadyCompleted": "This module is already complete",
  "error.learning.moduleContainer":
    "Open a lesson in this module to start learning",
  "error.learning.moduleDiagnosticInsufficient":
    "This module does not yet have enough diagnostic coverage",
  "error.learning.moduleNotFound": "Module not found",
  "error.learning.noDiagnosticTargets":
    "No learning targets are available for diagnosis",
  "error.learning.noModuleDiagnosticTargets":
    "This module has no key capabilities available for diagnosis",
  "error.learning.noQuizAssessableTargets":
    "This unit has no learning targets that can be assessed with a quiz",
  "error.learning.noTestOutTargets":
    "This unit has no learning targets available for testing out",
  "error.learning.questionIndexRequired": "questionIndex is required",
  "error.learning.quizAlreadySubmittedReset":
    "This quiz has already been submitted. Reset it before answering again.",
  "error.learning.quizSetUpdated":
    "This quiz has changed. Please regenerate or reopen it.",
  "error.learning.sectionIdRequired": "sectionId is required",
  "error.learning.sectionQuizAnswersOnly":
    "Only section-quiz answers can be submitted here",
  "error.learning.sectionQuizContentInvalid":
    "The section quiz content is invalid",
  "error.learning.sectionQuizInvalid":
    "The section quiz is invalid. Please regenerate it.",
  "error.learning.sectionQuizRequired": "This section requires a quiz first",
  "error.learning.sectionQuizSubmitFailed": "Failed to submit the section quiz",
  "error.learning.sectionNotFound": "Section not found",
  "error.learning.sectionGenerationStopped":
    "Section generation stopped before completion",
  "error.learning.completeSectionFirst": "Complete the learning section first",
  "error.learning.sectionNoAssessmentCheckpoint":
    "This section does not have an assessment checkpoint",
  "error.learning.completeCheckpointSectionsFirst":
    "Complete all learning sections in this checkpoint first",
  "error.learning.unitPreviewNotReady": "Unit preview is not ready",
  "error.learning.noQuizEligibleTargets":
    "This section has no quiz-eligible learning targets",
  "error.learning.miniTestLeaseSuperseded":
    "Mini-test generation was superseded",
  "error.learning.sectionGenerationLeaseSuperseded":
    "Section generation was superseded",
  "error.learning.miniTestSkipUnsupported":
    "Mini-tests cannot be skipped separately",
  "error.learning.completePreviousSectionsFirst":
    "Complete previous sections first",
  "error.learning.sectionSkipNotEligible":
    "This section is not eligible to skip",
  "error.learning.previousSectionIncomplete":
    "Please complete the previous learning section first",
  "error.learning.sectionContentNotReady": "Section content is not ready",
  "error.learning.testOutUnavailable":
    "Testing out is not available for this unit",
  "error.learning.trueFalseAnswerRequired": "Please answer true or false",
  "error.learning.unitAlreadyCompleted": "This unit is already complete",
  "error.learning.cognitiveEntityNotFound": "Cognitive entity not found",
  "error.learning.contentRevisionMismatch":
    "The learning content revision does not match. Please reopen this unit.",
  "error.learning.contentUpdated":
    "The learning content has been updated. Please reopen this unit.",
  "error.learning.legacyCheckRegenerateUnsupported":
    "Legacy learning checks cannot be regenerated",
  "error.learning.materialCheckTargetsUpdated":
    "The learning targets for this check have changed. Please reopen this unit.",
  "error.learning.regenerateSubmapStepsRequired":
    "Provide the submap steps to regenerate",
  "error.learning.subdivideDisabled":
    "Learning-step subdivision is not enabled",
  "error.learning.microExpandDisabled":
    "Expanding a short course into a full goal is not enabled",
  "error.learning.subdivideStepsRequired":
    "Provide the learning steps to subdivide",
  "error.learning.ttsRateLimited":
    "Speech generation is busy. Please try again in {seconds} seconds.",
  "error.project.notFound": "Project resource not found",
  "error.project.forbidden": "You do not have access to this project resource",
  "error.project.conflict":
    "This project operation conflicts with the current state",
  "error.project.invalid": "The project request is invalid",
  "label.learning.moduleExitDiagnostic": "Module exit diagnostic",
  "status.learning.savingAnswer": "Saving your answer…",
  "status.learning.verifyingRubric":
    "Checking your response against the rubric…",
  "status.learning.generatingSectionMaterial":
    "Preparing the learning section…",
  "status.learning.generatingSectionQuiz": "Preparing the section quiz…",
  "status.learning.imageSubmitting": "Submitting the image request…",
  "status.learning.imageGenerating": "Generating the image…",
  "status.learning.imageFetchingHd": "Fetching the high-resolution image…",
  "status.learning.imageRemovingBackground":
    "Removing the generated background…",
  "status.learning.imageSaving": "Saving the image…",
  "error.review.cardNotFound": "Card not found",
  "error.review.cardForbidden": "You do not have access to this card",
  "error.review.deckNotFound": "Deck not found",
  "error.review.deckForbidden": "You do not have access to this deck",
  "error.review.flashcardNotFound": "Flashcard not found",
  "error.review.flashcardForbidden": "You do not have access to this flashcard",
  "error.review.flashcardSidesRequired": "Front and back cannot be empty",
  "error.media.invalidPdfLayout": "Invalid PDF layout",
  "error.media.invalidImageId": "Invalid image id",
  "error.media.invalidAudioId": "Invalid audio id",
  "error.media.goalNoUnitsForExport":
    "This goal has no learning units to export as materials",
  "error.memory.roomNotFound": "Room not found",
  "error.memory.reviewStatusOnly":
    "Only memory suggestions awaiting review are exposed",
  "error.scenario.notReady": "This scenario is not ready yet",
  "error.scenario.invalidChoicePayload": "Invalid scenario choice parameters",
  "error.scenario.runNotFound": "Scenario save not found",
  "error.scenario.stateUpdated":
    "The scenario state changed. Please refresh and try again.",
  "error.scenario.contentUnavailable": "Scenario content is unavailable",
  "error.scenario.choiceNotFound": "Scenario choice not found",
  "error.agent.threadNotFound": "Conversation not found",
  "error.agent.runInProgress":
    "Your previous request is still being processed. Please wait a moment.",
  "error.agent.resumeScopeUnsupported": "This conversation cannot be resumed.",
  "error.agent.threadForbidden": "You do not have access to this conversation",
  "error.agent.invalidFollowUpContext": "Invalid follow-up context",
  "error.agent.scopeUnsupported": "Unsupported conversation scope: {scope}",
  "error.agent.goalCreationStartFailed": "Failed to start goal creation",
  "error.agent.foundationGoalUnsupported":
    "This goal cannot create a foundation-support goal",
  "error.agent.foundationSelectionStale":
    "The selected foundations are no longer in the current course plan",
  "error.agent.foundationGoalExists":
    "Some selected foundations already have a support goal",
  "error.agent.goalCreationRetryNotNeeded":
    "This goal creation does not need to be retried",
  "error.agent.completedGoalCreationCannotStop":
    "Completed goal creation cannot be stopped",
  "error.agent.deleteConfirmRequired": "Type DELETE to confirm deletion",
  "error.agent.stopGoalCreationFirst": "Stop goal creation before deleting it",
  "error.agent.goalCreationNotFound": "Goal-creation workspace not found",
  "error.agent.goalCreationForbidden":
    "You do not have access to this goal-creation workspace",
  "error.agent.goalCreationStopped":
    "Goal creation has stopped. Delete the draft before creating a new goal.",
  "error.agent.deleteDedicatedThreadFromGoalCreation":
    "Stop and delete this process from the goal-creation workspace",
  "error.agent.stateOutOfSync":
    "The conversation state briefly fell out of sync, so I preserved your progress. Submit the current form again or resend your goal to continue.",
  "label.agent.currentUnit": "Current unit",
  "label.agent.currentGoal": "Current learning goal",
  "status.agent.contextCleared":
    "AI context cleared. The messages above remain available for reference.",
  "status.agent.goalCreationReady": "Your goal-creation workspace is ready",
  "status.agent.foundationPlanningStarted":
    "Fast goal planning started for the selected foundations",
  "status.agent.goalCreationRestored":
    "Your previous goal-creation progress has been restored",
  "status.agent.goalCreationRetrying": "Retrying goal creation",
  "status.agent.goalCreationStopped":
    "Goal creation stopped. Delete this draft before creating a new goal.",
  "status.agent.firstLessonReady": "Your first lesson is ready",
  "error.billing.insufficientCredits": "Insufficient credits",
  "error.payment.purchaseUnavailable":
    "Credit purchases are not available on this platform yet",
  "error.payment.productUnknown": "Unknown credit product",
  "error.payment.merchantNotConfigured":
    "WeChat Pay merchant settings are not configured",
  "error.payment.orderNotFound": "Payment order not found",
  "error.payment.notificationSignatureInvalid":
    "Payment notification signature verification failed",
  "error.payment.notificationInvalid": "Invalid payment notification",
  "error.persona.unsafeInstruction":
    "Custom style instructions cannot change system rules or bypass safety restrictions",
  "error.persona.invalid": "Invalid teaching assistant",
  "error.persona.invalidBuiltin": "Invalid official template",
  "error.persona.notFound": "Teaching assistant not found",
  "error.publicCourse.resourceNotFound": "Public course resource not found",
  "error.rag.filesAndGoalRequired":
    "At least one file/files and goalId are required",
  "error.rag.goalAndDocumentRequired": "goalId and documentId are required",
  "error.rag.documentNotFound": "Document not found",
  "error.rag.goalAndUrlsRequired": "goalId and at least one URL are required",
  "error.rag.pdfRefreshUnsupported":
    "PDF web sources cannot be refreshed. Upload the PDF as learning material instead.",
  "error.rag.invalidUrl": "Invalid URL format",
  "error.rag.httpOnly": "Only HTTP/HTTPS URLs are supported",
  "error.rag.credentialsForbidden": "URL must not contain login credentials",
  "error.rag.localhostForbidden": "Localhost URLs are not allowed",
  "error.rag.privateAddressForbidden":
    "Private or reserved addresses are not allowed",
  "error.rag.redirectMissingLocation": "Redirect is missing a target URL",
  "error.rag.tooManyRedirects": "Too many URL redirects",
  "error.rag.articleTooLarge": "Web content exceeds the 5MB limit",
  "error.rag.planningSourcesTooLarge":
    "The uploaded sources exceed the capacity for a complete course-plan review. Provide a concise syllabus covering all required sections, then retry. No source sections were silently omitted.",
  "error.rag.articleTooShort":
    "Could not extract enough article text from the page",
  "error.rag.fileTextUnavailable":
    "Could not extract usable text from “{filename}”. Check the file and try again.",
  "error.rag.urlAlreadyAdded": "This URL has already been added to this goal",
  "error.rag.tooManyUrls": "You can add at most {count} URLs at a time",
  "error.rag.webRequestFailed": "Could not fetch the webpage (HTTP {status})",
  "error.rag.unsupportedContentType":
    "Unsupported webpage content type: {type}",
  "error.rag.sourceIngestionFailed":
    "The source could not be saved. Please try again.",
  "error.billing.unknownProduct": "Unknown credit product",
  "error.billing.invalidPurchaseReceipt": "Invalid purchase receipt",
  "error.billing.appleIapNotConfigured":
    "In-app credit purchases are not configured on the server",
  "error.billing.userNotFound": "User not found",
  "error.billing.positiveCredits": "Credits must be a positive number",
  "error.teachingSkill.filesObjectInvalid":
    "Files must be an object containing UTF-8 text files",
  "error.teachingSkill.fileTextRequired": "{path} must contain text",
  "error.teachingSkill.invalidPackage": "Invalid teaching-skill package",
  "error.teachingSkill.saveFailed": "Could not save the teaching skill",
  "error.teachingSkill.publishFailed": "Could not publish the teaching skill",
  "error.teachingSkill.notFound": "Teaching skill not found",
  "error.teachingSkill.builtinArchiveForbidden":
    "The general teaching skill cannot be archived",
  "error.teachingSkill.publishedNotFound": "Published teaching skill not found",
  "error.teachingSkill.slugRequired":
    "A valid lower-case hyphenated slug is required",
  "error.teachingSkill.goalIdRequired": "goalId is required",
  "error.teachingSkill.goalNotFound":
    "We couldn't find this learning goal. It may have been deleted, or the link is invalid.",
  "error.teachingSkill.skillIdRequired": "skillId is required",
  "error.teachingSkill.zipRequired": "A teaching-skill ZIP file is required",
  "error.teachingSkill.invalidZip":
    "The teaching-skill package must be a valid ZIP archive",
  "error.teachingSkill.zipTextInvalid":
    "Teaching-skill package files must be valid UTF-8 text",
  "error.productUpdate.invalidAction": "Invalid product update action",
  "error.productUpdate.notFound": "Product update not found",
  "error.productUpdate.invalidStatusAction": "Invalid status action",
  "error.productUpdate.localizedContentRequired":
    "Product update requires localized content",
  "error.generationSettings.invalidSettings":
    "A generation settings object is required",
  "error.generationSettings.searchSettingsInvalid": "Invalid search settings",
  "error.generationSettings.chatAudioSettingsInvalid":
    "Invalid chat audio settings",
  "error.generationSettings.imageSettingsInvalid":
    "Invalid image-generation settings",
  "error.generationSettings.concurrencyInvalid":
    "deepPlanningResearchConcurrency must be an integer from 1 to 4",
  "error.generationSettings.searchEnabledInvalid":
    "searchEnabled must be a boolean",
  "error.generationSettings.searchProviderInvalid":
    "searchProvider must be one of: {providers}",
  "error.generationSettings.chatAudioProviderInvalid":
    "chatAudioProvider must be one of: {providers}",
  "error.generationSettings.imageProviderInvalid":
    "imageProvider must be one of: {providers}",
  "error.generationSettings.openaiBaseUrlInvalid":
    "openaiBaseUrl must be one of: {presets}",
  "error.generationSettings.settingsRequired":
    "Provide at least one generation setting to update",
  "error.llmRouting.invalidBody": "Invalid LLM routing changes",
  "error.llmRouting.unknownOperation": "Unknown LLM operation: {operation}",
  "error.llmRouting.modelProviderMismatch":
    "Model {model} does not belong to provider {provider}",
  "error.llmRouting.modelNotPriced":
    "Model {provider}/{model} is not active in LLM pricing",
  "error.llmRouting.reasoningUnsupported":
    "Reasoning mode {reasoningMode} is not supported by {provider}/{model}",
  "error.backendError.groupNotFound": "Backend error group not found",
  "error.proxy.upstreamNotFound": "No API upstream is configured for {path}",
  "error.proxy.requestFailed": "The API service is temporarily unavailable",
  "label.cognition.relation.prerequisite": "Prerequisite",
  "label.cognition.relation.partOf": "Part of",
  "label.cognition.relation.causes": "Causes",
  "label.cognition.relation.contrasts": "Contrasts with",
  "label.cognition.relation.constrains": "Constrains",
  "label.cognition.relation.supports": "Supports",
  "label.cognition.relation.enables": "Enables",
  "label.cognition.kind.atom": "Knowledge atom",
  "label.cognition.kind.concept": "Concept",
  "label.cognition.kind.skill": "Skill",
  "label.cognition.kind.competency": "Competency",
  "status.generation.cancelled": "Generation stopped",
  "status.learning.generatingPreview":
    "Generating preview outline and guiding questions...",
  "status.learning.cognitiveModelBuilding":
    "The learning model is being prepared. Please wait a moment.",
  "status.learning.generatingMaterial": "Generating interactive lesson...",
  "status.learning.generatingCornell": "Generating study notes...",
  "status.learning.generatingQuiz":
    "Generating quiz questions from the lesson...",
  "status.learning.generatingFlashcards":
    "Generating spaced review flashcards from the lesson...",
  "status.learning.thinking": "Thinking...",
  "status.goal.generatingMap": "AI is generating learning map units...",
  "status.goal.mapSaved":
    "Learning map saved. Detailed learning plan will be generated in the background...",
  "status.goal.language": "Course language: {language}",
  "status.goal.regeneratingMap":
    "Regenerating the learning map from your instructions…",
  "status.goal.generatingMapFromSummary":
    "Generating the learning map from the approved summary…",
  "status.goal.retrievingUploads": "Reviewing uploaded materials…",
  "status.goal.collectingReferences": "Collecting learning-path references…",
  "status.goal.uploadsRetrieved": "Uploaded materials reviewed",
  "status.goal.authoritativePathFound": "Authoritative learning paths found",
  "status.goal.savingUnits": "Saving {count} learning units…",
  "status.goal.mapSavedToContract":
    "Learning map saved against the approved goal contract",
  "status.goal.refreshingOrder": "Refreshing the learning-map order…",
  "status.goal.mapOrderRefreshed":
    "Learning-map order refreshed. Detailed planning will continue in the background…",
  "status.goal.generatingSummary":
    "AI is preparing a concise learning summary…",
  "status.goal.identifyingContract":
    "Identifying the learning domain and drafting the goal contract…",
  "status.goal.revisingPlanFromSources":
    "Revising the plan from saved sources and your feedback (without searching again)",
  "status.goal.analyzingBoundaries":
    "Analyzing the goal, learner context, and course boundaries",
  "status.goal.draftingModules":
    "Drafting the module journey from the selected sources",
  "status.goal.selectingSources":
    "Selecting useful sources from the search results…",
  "status.goal.generatingPlanFromSources":
    "Generating the learning plan from the selected sources…",
  "status.goal.researchingModules":
    "Reviewing sources module by module ({count} modules)",
  "status.goal.synthesizingPlan":
    "Synthesizing module research into the final course structure",
  "status.goal.contractPreserved":
    "Preserved the goal contract used by the current learning map",
  "status.goal.generatingDetailedPlan":
    "Generating a detailed plan from the current learning map…",
  "status.goal.upgradingMicro":
    "Upgrading the micro-course and generating the full learning content…",
  "status.goal.generatingMicroContent": "Generating micro-course content…",
  "status.goal.generatingOverviewContent":
    "Generating overview-course content…",
  "status.goal.savingMicroContent": "Saving micro-course content…",
  "status.goal.savingOverviewContent": "Saving overview-course content…",
  "status.goal.summarySourcesRag":
    "Retrieved planning context from {count} learning-material sources…",
  "status.goal.summarySourcesSearch":
    "Retrieved planning context from {count} web sources…",
  "status.goal.summarySourcesGeneric":
    "No usable learning sources were found; generating the summary from general knowledge…",
  "status.goal.mapSourcesRag":
    "Retrieved {count} learning-material sources; generating the learning map…",
  "status.goal.mapSourcesSearch":
    "Retrieved {count} web sources; generating the learning map…",
  "status.goal.mapSourcesGeneric":
    "No usable learning sources were found; generating the learning map from general knowledge…",
  "status.goal.replanningModules":
    "Replanning summaries for future unlocked modules…",
  "status.goal.batchStopped":
    "Stopped. Completed {succeeded}; skipped {skipped}.",
  "status.goal.batchCompleted":
    "Complete: generated {succeeded}; skipped {skipped}.",
  "status.goal.batchCompletedWithFailures":
    "Complete: {succeeded} succeeded, {skipped} skipped, and {failed} failed.",
  "status.goal.sequentialModulesCreated":
    "Sequential modules are ready; only currently unlocked modules will be generated",
} as const;

export type BackendTranslationKey = keyof typeof en;

const zhHans: Record<BackendTranslationKey, string> = {
  "error.remotion.previewRequired": "请先完成本单元的预习，再生成 Remotion 视频；无需生成课程正文",
  "error.remotion.overviewRequired": "请先完成课程导览内容，再制作导览视频",
  "error.remotion.previewChanged": "预习内容在动画生成期间已更新，请根据最新预习重试；原视频已保留",
  "error.remotion.revisionChanged": "动画课程已有新修订，较早生成结果不会覆盖它，请重试",
  "error.remotion.invalidDisplayCorrection": "请选择影片准备的已有演示对象，并提供完整的修正版画面与讲解；其他教学对象保持不变",
  "error.remotion.displayCorrectionSourceBound": "这段演示来自已发布课程，请先修改课程内容，再重新生成视频",
  "error.remotion.previewStale": "预习内容已更新，请先根据最新预习更新动画，再导出视频",
  "error.remotion.imageMissing": "Remotion 图片资源缺失或已改变，请恢复图片后继续",
  "error.remotion.imageProviderRequired": "请配置图片生成服务，再继续当前镜头",
  "error.remotion.authoringTimeout": "准备“{title}”时，模型响应超过 {seconds} 秒上限。已完成的内容已保存，点击继续可从未完成的位置接着制作。",
  "error.remotion.authoringIdleTimeout": "准备“{title}”时，已连续 {seconds} 秒没有收到模型的新内容。已完成的内容已保存，点击继续可从未完成的位置接着制作。",
  "error.remotion.imageNeedsReview": "“{title}”的配图仍未通过检查（已修正 {attempts} 次）：{issues}。点击“继续”可再次修正这张配图，已保存的内容会保留。",
  "error.remotion.imageSubjectMissing": "缺少教学对象：{subject}",
  "error.courseProduction.notFound": "课程不存在。",
  "error.courseProduction.unitNotFound": "课程中找不到该单元。",
  "error.courseProduction.sectionNotFound": "章节不存在。",
  "error.courseProduction.legacy": "请在原课程编辑器中重新生成旧版内容。",
  "error.courseProduction.unfinished": "本节尚未生成完成，请继续制作。",
  "error.courseProduction.contentRequired": "请先准备本节正式内容。",
  "error.courseProduction.storageUnavailable": "课程存储暂不可用。",
  "error.internal": "服务暂时出了点问题，请稍后再试。",
  "error.unknown": "出了点问题，请稍后再试。",
  "error.notFound": "未找到",
  "error.generation.failed": "生成失败",
  "error.generation.failedFriendly":
    "这次内容没有准备完成，你的学习进度已保留。请点击重试再试一次。",
  "error.generation.notFound": "生成任务不存在",
  "error.generation.ended": "生成任务已结束",
  "error.generation.cancelled": "生成已停止",
  "error.generation.interrupted": "服务器已重启，本次生成已中断，请重试",
  "error.auth.registrationDisabled": "注册功能已关闭",
  "error.auth.nameRequired": "请填写用户名",
  "error.auth.passwordRequired": "请填写密码",
  "error.auth.userExists": "用户已存在",
  "error.auth.userNotFound": "用户不存在",
  "error.auth.invalidPassword": "密码不正确",
  "error.auth.invalidRefreshToken": "刷新令牌无效",
  "error.auth.refreshTokenUsed": "刷新令牌已被使用",
  "error.auth.missingBearerToken": "缺少登录凭证",
  "error.auth.invalidToken": "登录凭证无效",
  "error.auth.missingUserIdentity": "缺少用户身份",
  "error.auth.adminRequired": "需要管理员权限",
  "error.auth.adminDashboardRequired": "请使用管理后台登录管理员账号",
  "error.auth.adminClientRequired": "需要管理后台访问权限",
  "error.auth.emailInvalid": "邮箱格式不正确",
  "error.auth.passwordMinLength": "{field} 至少需要 8 个字符",
  "error.auth.identityTokenRequired": "缺少 identityToken",
  "error.auth.appleNotConfigured": "Apple 登录尚未配置",
  "error.auth.invalidAppleIdentityToken": "Apple 身份令牌无效",
  "error.auth.currentPasswordRequired": "请填写当前密码",
  "error.auth.invalidCurrentPassword": "当前密码不正确",
  "error.auth.emailCodeInvalid": "验证码不正确",
  "error.auth.emailCodeExpired": "验证码已过期，请重新获取",
  "error.auth.emailCodeFormatInvalid": "验证码必须是 6 位数字",
  "error.auth.emailCodeCooldown": "验证码发送太频繁，请 60 秒后再试",
  "error.auth.emailCodeHourlyLimit": "该邮箱 1 小时内验证码发送次数已达上限",
  "error.auth.emailSendFailed": "邮件发送失败：{message}",
  "error.auth.accountDeleteConfirmRequired": "请输入 DELETE 以确认注销账号",
  "error.auth.accountDeleteAdminForbidden": "管理员账号不可注销",
  "error.auth.usernameTooShort": "用户名至少需要 3 个字符",
  "error.auth.usernameTooLong": "用户名最多 32 个字符",
  "error.auth.usernameInvalid":
    "用户名需以字母开头，只能包含字母、数字和下划线",
  "error.auth.usernameReserved": "该用户名不可用",
  "error.auth.usernameAlreadySet": "用户名已设置，无法修改",
  "error.auth.emailAlreadySet": "邮箱已设置，无法修改",
  "error.auth.emailInUse": "该邮箱已绑定其他账号",
  "error.auth.wechatCodeRequired": "微信登录 code 不能为空",
  "error.auth.wechatNotConfigured": "微信小程序登录尚未配置",
  "error.auth.wechatLoginFailed": "微信登录失败",
  "error.auth.wechatAccountHasGoals":
    "当前微信账号已有课程，请联系客服安全合并账号",
  "error.auth.notWechatMiniAccount": "当前账号不是微信小程序账号",
  "error.auth.nameTypeInvalid": "用户名必须是字符串",
  "error.auth.emailTypeInvalid": "邮箱必须是字符串",
  "error.auth.passwordTypeInvalid": "密码必须是字符串",
  "error.auth.passwordMinLengthGeneric": "密码至少需要 8 个字符",
  "error.auth.passwordLoginIdentityRequired": "设置密码时需要提供用户名或邮箱",
  "error.auth.identifierRequired": "请至少提供用户名或邮箱",
  "error.auth.usernameOrEmailExists": "用户名或邮箱已存在",
  "error.request.invalidBody": "请求内容无效",
  "error.settings.providerNotConfigured":
    "提供商“{provider}”尚未配置，请在 .env 中添加所需 API 密钥",
  "error.settings.modelUnavailable":
    "模型“{model}”不可用，请选择已配置 LLM 计费的模型",
  "error.settings.searchLearnerManaged":
    "网页搜索由管理后台 AI 生成设置统一控制，学习者不能单独修改",
  "error.settings.imagesDisabled": "此部署未启用图片生成功能",
  "error.settings.imagesLearnerManaged":
    "图片生成由管理后台 AI 生成设置统一控制，学习者不能单独修改",
  "status.auth.emailCodeSent": "验证码已发送，请查收邮箱",
  "status.auth.loginSuccess": "登录成功",
  "status.generation.learningTargets": "正在核对学习目标与先修路径…",
  "status.generation.sq": "正在整理本节预习要点…",
  "status.generation.sectionPlan": "正在划分本节学习段落…",
  "status.generation.material": "正在准备本节学习内容…",
  "status.generation.formalDerivation": "正在准备本节公式推导…",
  "status.generation.teachingDerivation": "正在准备本节教学推导…",
  "status.generation.verifyingContent": "正在检查生成内容的正确性…",
  "status.generation.notes": "正在整理本节学习笔记…",
  "status.generation.quiz": "正在根据本节内容准备练习…",
  "status.generation.flashcards": "正在整理间隔复习闪卡…",
  "status.generation.quizExplain": "正在结合题目整理解析…",
  "status.generation.socraticMistakes": "正在整理需要回顾的题目…",
  "status.generation.socraticQuestion": "正在根据你的作答准备引导问题…",
  "status.generation.diagnostic": "正在根据学习目标准备 {count} 道诊断题…",
  "status.generation.images": "正在准备图示（{current}/{total}）…",
  "label.memoryImage.topdown": "俯视图",
  "label.memoryImage.perspective": "全景图",
  "label.memoryImage.detail": "细节图",
  "status.generation.memoryRoom": "正在准备记忆宫殿房间…",
  "status.generation.memoryClues": "正在「{room}」中整理记忆线索…",
  "status.generation.memoryRoomDetails": "正在生成房间感官细节与锚点描述…",
  "status.generation.memoryRoomImages": "正在生成俯视图与全景图…",
  "status.generation.memoryImageProgress":
    "正在生成配图 {current}/{total}：{label}",
  "status.generation.scenarioPreparing": "正在召集本场角色…",
  "status.generation.scenarioFallback": "正在使用可靠模板安排角色…",
  "status.generation.scenarioScene": "正在布置这一幕…",
  "status.generation.scenarioScenePrefetch": "正在提前布置后续场景…",
  "status.generation.uploadingMaterials": "正在将学习资料写入知识库…",
  "status.generation.materialsIngested": "资料向量化完成",
  "status.generation.materialIngestionFailed": "学习资料写入失败，已停止规划",
  "status.generation.processingMaterial":
    "正在处理资料（{current}/{total}）：{filename}…",
  "status.generation.parsingMaterial": "正在解析《{filename}》…",
  "status.generation.writingSource": "正在写入来源《{title}》…",
  "status.generation.embedding": "正在生成向量嵌入（{count} 段）…",
  "status.generation.embeddingBatch":
    "正在生成向量嵌入（{batch}/{total} 批，共 {count} 段）…",
  "status.generation.subdivide": "正在用 AI 拆分「{title}」…",
  "status.generation.saveLearningSteps": "正在保存不改变课程结构的学习步骤…",
  "status.generation.subdivideWriting":
    "已生成 {count} 个子单元，正在安全写入…",
  "status.generation.expand": "正在展开「{title}」…",
  "status.generation.expandWriting": "已生成 {count} 个子单元，正在写入…",
  "status.generation.collectingPathReferences": "正在收集学习路径参考…",
  "status.generation.generatingMap": "AI 正在生成学习地图…",
  "status.generation.mapWriting": "已生成 {count} 个学习单元，正在写入…",
  "status.generation.followUp": "正在结合本节内容思考…",
  "status.generation.goal": "正在梳理你的学习目标…",
  "status.generation.goalIcon": "正在生成学习目标图标…",
  "status.generation.path": "正在规划学习路径…",
  "status.planning.context.started": "正在核对学习目标、可用资料与规划约束…",
  "status.planning.context.pulse1": "仍在比较目标与当前资料上下文…",
  "status.planning.context.pulse2": "正在判断哪些信息应当影响学习路径…",
  "status.planning.context.completed": "目标与资料上下文已准备完成",
  "status.planning.draft.started": "模型正在构思能力里程碑与模块边界…",
  "status.planning.draft.pulse1": "正在比较模块边界与前置顺序…",
  "status.planning.draft.pulse2": "正在检查里程碑是否覆盖完整学习目标…",
  "status.planning.draft.pulse3": "正在收敛模块范围，准备逐模块研究…",
  "status.planning.draft.completed": "初步模块路径已形成",
  "status.planning.final.started": "模型正在把研究结果综合为最终学习路径…",
  "status.planning.final.pulse1": "正在对齐资料结论与模块学习成果…",
  "status.planning.final.pulse2": "正在检查课时数量、模块体量与进阶节奏…",
  "status.planning.final.pulse3": "正在消除重复并核对前置关系…",
  "status.planning.final.completed": "最终学习路径已形成",
  "status.planning.identity.started": "正在确定目标方向、摘要与假定基础…",
  "status.planning.identity.pulse1": "仍在明确学习方式与你将获得的能力…",
  "status.planning.identity.pulse2": "正在对照你确认的基础与意图核对摘要…",
  "status.planning.identity.completed": "目标摘要与假定基础已就绪",
  "status.planning.journey.started": "正在规划你将依次学习的模块…",
  "status.planning.journey.pulse1": "正在比较模块边界与前置顺序…",
  "status.planning.journey.pulse2": "正在检查模块是否覆盖完整学习目标…",
  "status.planning.journey.pulse3":
    "正在消除重复，让后一模块建立在前一模块之上…",
  "status.planning.journey.completed": "模块学习路径已形成",
  "status.planning.moduleCapabilities.started":
    "正在定义「{title}」的出口能力…",
  "status.planning.moduleCapabilities.pulse1":
    "仍在把「{title}」的目标写成可观察能力…",
  "status.planning.moduleCapabilities.pulse2":
    "正在检查「{title}」的能力是否可被后续评估…",
  "status.planning.moduleCapabilities.completed": "「{title}」的出口能力已就绪",
  "status.planning.moduleStructure.started": "正在规划「{title}」的课时顺序…",
  "status.planning.moduleStructure.pulse1": "仍在梳理「{title}」的课时大纲…",
  "status.planning.moduleStructure.pulse2":
    "正在检查「{title}」是否覆盖本模块能力…",
  "status.planning.moduleStructure.pulse3": "正在整理「{title}」的课时顺序…",
  "status.planning.moduleStructure.completed": "「{title}」的课时结构已就绪",
  "status.planning.validation.started": "正在校验覆盖范围、顺序与模块规划契约…",
  "status.planning.validation.completed": "规划契约校验通过并已保存",
  "status.planning.moduleDraft.started": "正在准备「{title}」的模块结构…",
  "status.planning.moduleDraft.authoring": "正在编写「{title}」的课时…",
  "status.planning.moduleDraft.pulse1": "仍在梳理「{title}」的课时大纲…",
  "status.planning.moduleDraft.pulse2":
    "正在检查「{title}」是否覆盖本模块目标…",
  "status.planning.moduleDraft.pulse3": "正在整理「{title}」的课时顺序…",
  "status.planning.moduleDraft.completed":
    "「{title}」模块草稿已就绪，等待交叉检查",
  "status.planning.moduleDraft.fanOut":
    "正在准备全部模块结构，完成后会做一次交叉审计",
  "status.planning.moduleAudit.started":
    "正在检查全部模块是否贴合已确认的目标…",
  "status.planning.moduleAudit.pulse1": "正在比较模块覆盖、重复范围与课时顺序…",
  "status.planning.moduleAudit.pulse2": "正在查找缺失步骤和依赖问题…",
  "status.planning.moduleAudit.completed": "交叉模块检查已完成",
  "status.planning.moduleAudit.passed": "模块结构已通过审计，即将发布",
  "status.planning.moduleAudit.repairing":
    "审计发现问题，正在对标记模块做一次修复",
  "status.planning.modulePublish.started": "正在发布「{title}」模块…",
  "status.planning.modulePublish.completed": "已发布「{title}」",
  "status.generation.overview": "正在整理课程概览…",
  "status.generation.batchSq": "正在整理 {count} 个学习单元的预习要点…",
  "status.generation.batchMaterial": "正在准备 {count} 个学习单元的学习内容…",
  "status.generation.unitSq": "正在整理「{title}」的预习要点…",
  "status.generation.unitSectionPlan": "正在划分「{title}」的学习段落…",
  "status.generation.unitMaterial": "正在准备「{title}」的学习内容…",
  "status.generation.unitNeedsSq": "正在先为「{title}」整理预习要点…",
  "error.goal.notFound": "找不到这个学习目标，可能已被删除或链接无效。",
  "error.goal.missing": "缺少学习目标",
  "error.goal.unitNotFound": "找不到这个学习单元，可能已被删除或链接无效。",
  "error.goal.forbidden": "无权访问该目标",
  "error.goal.unitForbidden": "无权访问该单元",
  "error.goal.sharedNotFound":
    "找不到这个分享的学习目标，链接可能不正确或已失效。",
  "error.goal.sharedCourseNotFound": "分享的课程不存在或未公开",
  "error.goal.invalidShareSettings": "无效的分享设置",
  "error.goal.microUnsupportedMap": "轻课不支持学习地图或学习规划操作",
  "error.goal.overviewUnitReadonly": "总览课程单元不可编辑",
  "error.goal.titleRequired": "标题不能为空",
  "error.goal.idRequired": "缺少 goalId",
  "error.goal.mapRefreshUnavailable": "当前层级没有可刷新的节点",
  "error.goal.contractRequired": "请先生成并确认目标契约，再生成学习地图",
  "error.goal.mapRequiredForRegeneration": "尚无学习地图，无法重新生成",
  "error.goal.mapAlreadyExists": "学习地图已存在，请使用重新生成功能",
  "error.goal.moduleLocked": "模块尚未解锁",
  "error.goal.moduleBuilding": "模块正在生成，请稍后再试",
  "error.goal.planRequired": "尚无学习计划，请先生成",
  "error.goal.planIncomplete": "请先生成并完成学习计划",
  "error.goal.summaryRequired": "请先生成并确认学习摘要",
  "error.goal.summaryAlreadyExists": "已有学习摘要，请直接确认或请求重新生成",
  "error.goal.settingsRequired": "缺少可更新的设置",
  "error.goal.invalidContentLanguage": "无效的内容语言",
  "error.goal.courseModeDisabled": "课程模式功能未启用",
  "error.goal.topicRequired": "请提供轻课主题",
  "error.goal.futureModulesOnly": "只能重新规划尚未解锁的未来模块",
  "error.goal.approvedModuleReadonly": "活动或已完成模块不可重新规划",
  "error.goal.docsRequired": "资料优先模式需要先上传学习资料",
  "error.goal.invalidMapEdit": "该学习地图编辑操作不被允许",
  "error.goal.invalidSharedCourse": "分享课程结构无效",
  "error.goal.approvedCourseReadonly":
    "课程已批准；只能通过未来模块重规划调整尚未解锁的模块",
  "error.goal.mapContractLocked":
    "当前学习地图已绑定目标契约；范围变更需要在地图替换流程中完成",
  "error.goal.planLanguageMismatch":
    "学习计划包含与课程语言不一致的模块，请重新生成后再确认",
  "error.goal.explorationNoMastery": "阅读探索模式不提供掌握度",
  "error.goal.explorationNoDiagnostic": "阅读探索模式不提供认知诊断",
  "error.goal.explorationNoModel": "阅读探索模式尚未建立认知模型",
  "error.goal.cognitiveModelBuilding":
    "当前模块正在生成；认知模型将在模块原子发布后可用",
  "error.goal.summaryLocked": "课程生成后无法修改预览摘要",
  "error.goal.notFullGoal": "此功能仅适用于完整目标",
  "error.goal.notExploration": "该目标已经是系统掌握模式",
  "error.goal.curriculumNotReady": "请等待课程准备完成后再切换学习模式",
  "error.goal.shareActive": "请先取消发布或发布申请，再切换学习模式",
  "error.goal.notKacomGoal": "只有启用 KACOM 的完整目标可以解除认知模型关联",
  "error.goal.shareModulesNotReady": "请先解锁并生成全部模块，再申请公开发布",
  "error.goal.shareMissingMaterial":
    "仍有 {count} 个必修单元尚未生成学习材料，暂不能公开发布",
  "error.goal.shareNoContent": "课程暂无内容，无法发布",
  "error.goal.shareNoPublishedLessons": "课程暂无已发布课时，无法公开分享",
  "error.goal.sharePendingNotFound": "待审核课程不存在或已处理",
  "error.goal.sharePendingInvalid": "待审核课程内容无效",
  "error.goal.sharedCourseUnavailable": "公开课程不存在或已下架",
  "error.agenda.itemNotFound": "日程项目不存在",
  "error.agenda.scopeConflict": "goalId 与 spaceId 不能同时使用",
  "error.learning.materialRequired": "请先生成学习内容",
  "error.learning.materialNotFound": "学习材料不存在",
  "error.learning.completeMaterialFirst": "请先完成学习正文",
  "error.learning.completeUnitFirst": "请先完成本单元学习",
  "error.learning.invalidStep": "无效的步骤",
  "error.learning.invalidAction": "未知 action",
  "error.learning.feynmanUnavailable": "费曼讲解功能暂未开放",
  "error.learning.threadIdRequired": "缺少 threadId",
  "error.learning.threadNotFound": "对话不存在",
  "error.learning.quizSetIdRequired": "缺少 quizSetId",
  "error.learning.quizSetNotFound": "测验题组不存在",
  "error.learning.quizSetInvalid": "测验题组无效，请重新生成题目",
  "error.learning.answerRequired": "请先输入回答",
  "error.learning.noSocraticConversation": "没有可继续的苏格拉底对话",
  "error.learning.socraticEnded": "该对话已结束，请切换到其他错题",
  "error.learning.completeCorrectionsFirst": "请先完成所有错题修正",
  "error.learning.invalidTone": "无效的内容文风",
  "error.learning.guidingQuestionsNotFound": "暂无引导问题",
  "error.learning.slideNarrationRequired": "缺少幻灯片旁白文本",
  "error.learning.invalidBlockIndex": "无效的内容块索引",
  "error.learning.invalidSlideOrBlockIndex": "无效的幻灯片或内容块索引",
  "error.learning.componentMissing": "组件不存在",
  "error.learning.componentRegenerateForbidden": "该组件不能重新生成",
  "error.learning.componentRegenerateFailed": "重新生成交互组件失败",
  "error.learning.imageRegenerationInvalid": "该内容块不能作为图片重新生成",
  "error.learning.svgIllustrationReplaceUnavailable":
    "用图片替换 SVG 示意图仅在桌面开发环境可用",
  "error.learning.aiBlockEditUnavailable": "AI 修改内容块仅在桌面开发环境可用",
  "error.learning.aiBlockEditInstructionRequired":
    "请先描述希望 AI 如何修改这个内容块",
  "error.learning.aiBlockEditUnsupported": "该内容块不支持 AI 修改",
  "error.learning.aiBlockEditFailed": "AI 修改该内容块失败",
  "error.learning.blockDeleteUnavailable": "删除内容块仅在桌面开发环境可用",
  "error.learning.blockDeleteAssessmentForbidden": "测验内容块不能在这里删除",
  "error.learning.subdivideNotFound": "学习单元不存在",
  "error.learning.subdivideAlreadyModule": "该学习单元已经拆分",
  "error.learning.subdivideMaxDepth": "学习地图已达到最大层级",
  "error.learning.subdivideModuleContainer": "请打开模块内的学习单元后再拆分",
  "error.learning.subdivideNoChildren": "该学习单元没有可移除的子地图",
  "error.learning.subdivideUnsafeActivity":
    "本单元已有学习活动，不能修改课程结构",
  "error.learning.subdivideModuleLimit": "拆分后模块课程数不能超过 {limit} 节",
  "error.learning.subdivideNoTargets": "当前单元尚无可安全复用的学习目标",
  "error.learning.subdivideFailed": "学习单元拆分失败，请重试",
  "error.learning.allAnswersRequired": "请回答全部题目后再提交",
  "error.learning.answerChoiceRequired": "请选择答案",
  "error.learning.assessmentAlreadySubmitted": "本次测评已提交",
  "error.learning.assessmentNotFound": "测评不存在",
  "error.learning.assessmentQuestionNotFound": "测评题目不存在",
  "error.learning.assessmentResponseTooLarge": "评估回答过长",
  "error.learning.idempotencyKeyRequired": "需要有效的幂等键",
  "error.learning.evaluatorFieldsUnsupported":
    "不接受客户端提供的评估器字段：{fields}",
  "error.learning.idempotencyConflict": "该幂等键已用于其他回答",
  "error.learning.assessmentDurationInvalid": "需要有效的评估用时",
  "error.learning.adaptiveAssessmentNotFound": "自适应评估任务不存在",
  "error.learning.cognitiveModelFailed": "认知模型准备失败，请重试",
  "error.learning.completeRequiredSectionsFirst": "请先完成所有必修学习小节",
  "error.learning.completeSectionQuizFirst": "请先完成本节测验",
  "error.learning.explanationNotNeeded": "该题无需解析",
  "error.learning.explorationFeynmanEvidenceUnsupported":
    "阅读探索模式不支持费曼讲解证据",
  "error.learning.followUpStreamRequired": "追问请使用流式接口",
  "error.learning.gradeQuizFirst": "请先完成测验批改",
  "error.learning.interactionValidationUnsupported": "该互动不支持验证式评估",
  "error.learning.invalidAnchor": "无效锚点",
  "error.learning.invalidAnswerFormat": "回答格式无效",
  "error.learning.invalidAnswerOption": "答案选项无效",
  "error.learning.invalidInteractionIndex": "互动索引无效",
  "error.learning.invalidTrueFalseIndex": "判断题索引无效",
  "error.learning.legacyCheckEvidenceUnsupported": "旧版检查不支持学习证据",
  "error.learning.materialCheckTypeInvalid": "学习内容检查类型无效",
  "error.learning.materialCheckUpdated": "学习内容检查已更新，请重试",
  "error.learning.materialRequiredForFlashcards":
    "请先生成学习内容，再生成闪卡",
  "error.learning.materialRequiredForQuiz": "请先生成学习内容，再生成测验",
  "error.learning.microDiagnosticUnavailable": "轻课不提供认知诊断",
  "error.learning.moduleAlreadyCompleted": "本模块已经完成",
  "error.learning.moduleContainer": "请打开模块中的课程开始学习",
  "error.learning.moduleDiagnosticInsufficient": "本模块的诊断覆盖尚不充分",
  "error.learning.moduleNotFound": "模块不存在",
  "error.learning.noDiagnosticTargets": "暂无可诊断的学习目标",
  "error.learning.noModuleDiagnosticTargets": "本模块暂无可测试的关键能力",
  "error.learning.noQuizAssessableTargets": "本单元暂无可由测验评估的学习目标",
  "error.learning.noTestOutTargets": "本单元暂无可用于跳过学习的测试目标",
  "error.learning.questionIndexRequired": "缺少 questionIndex",
  "error.learning.quizAlreadySubmittedReset": "测验已提交，请重置后再作答",
  "error.learning.quizSetUpdated": "测验题组已更新，请重新生成或打开",
  "error.learning.sectionIdRequired": "缺少 sectionId",
  "error.learning.sectionQuizAnswersOnly": "此处仅支持提交小节测验答案",
  "error.learning.sectionQuizContentInvalid": "小节测验内容无效",
  "error.learning.sectionQuizInvalid": "小节测验无效，请重新生成",
  "error.learning.sectionQuizRequired": "本节需要先完成测验",
  "error.learning.sectionQuizSubmitFailed": "小节测验提交失败",
  "error.learning.sectionNotFound": "学习小节不存在",
  "error.learning.sectionGenerationStopped": "小节生成未完成，已停止",
  "error.learning.completeSectionFirst": "请先完成学习小节",
  "error.learning.sectionNoAssessmentCheckpoint": "本小节没有测评检查点",
  "error.learning.completeCheckpointSectionsFirst":
    "请先完成本检查点中的全部学习小节",
  "error.learning.unitPreviewNotReady": "单元预习内容尚未准备好",
  "error.learning.noQuizEligibleTargets": "本小节没有可用于测验的学习目标",
  "error.learning.miniTestLeaseSuperseded": "小节测验生成已被新的任务取代",
  "error.learning.sectionGenerationLeaseSuperseded": "小节生成已被新的任务取代",
  "error.learning.miniTestSkipUnsupported": "小节测验不能单独跳过",
  "error.learning.completePreviousSectionsFirst": "请先完成前面的小节",
  "error.learning.sectionSkipNotEligible": "本小节当前不能跳过",
  "error.learning.previousSectionIncomplete": "请先完成上一学习小节",
  "error.learning.sectionContentNotReady": "小节内容尚未准备好",
  "error.learning.testOutUnavailable": "本单元暂不支持测试跳过",
  "error.learning.trueFalseAnswerRequired": "请选择正确或错误",
  "error.learning.unitAlreadyCompleted": "本单元已经完成",
  "error.learning.cognitiveEntityNotFound": "认知实体不存在",
  "error.learning.contentRevisionMismatch":
    "学习内容版本不匹配，请重新打开本单元",
  "error.learning.contentUpdated": "学习内容已更新，请重新打开本单元",
  "error.learning.legacyCheckRegenerateUnsupported":
    "旧版学习检查不支持重新生成",
  "error.learning.materialCheckTargetsUpdated":
    "该检查的学习目标已更新，请重新打开本单元",
  "error.learning.regenerateSubmapStepsRequired":
    "请提供要重新生成的子地图步骤",
  "error.learning.subdivideDisabled": "学习步骤细分功能未启用",
  "error.learning.microExpandDisabled": "扩展轻课为完整目标功能未启用",
  "error.learning.subdivideStepsRequired": "请提供要细分的学习步骤",
  "error.learning.ttsRateLimited": "语音生成繁忙，请在 {seconds} 秒后重试",
  "error.project.notFound": "项目资源不存在",
  "error.project.forbidden": "无权访问该项目资源",
  "error.project.conflict": "该项目操作与当前状态冲突",
  "error.project.invalid": "项目请求无效",
  "label.learning.moduleExitDiagnostic": "模块出口诊断",
  "status.learning.savingAnswer": "正在保存回答…",
  "status.learning.verifyingRubric": "正在根据评分标准核对回答…",
  "status.learning.generatingSectionMaterial": "正在准备学习小节…",
  "status.learning.generatingSectionQuiz": "正在准备小节测验…",
  "status.learning.imageSubmitting": "正在提交图片生成请求…",
  "status.learning.imageGenerating": "正在生成图片…",
  "status.learning.imageFetchingHd": "正在获取高清图片…",
  "status.learning.imageRemovingBackground": "正在移除生成图背景…",
  "status.learning.imageSaving": "正在保存图片…",
  "error.review.cardNotFound": "卡片不存在",
  "error.review.cardForbidden": "无权访问该卡片",
  "error.review.deckNotFound": "牌组不存在",
  "error.review.deckForbidden": "无权访问该牌组",
  "error.review.flashcardNotFound": "闪卡不存在",
  "error.review.flashcardForbidden": "无权访问该闪卡",
  "error.review.flashcardSidesRequired": "正面和背面不能为空",
  "error.media.invalidPdfLayout": "PDF 布局无效",
  "error.media.invalidImageId": "图片 ID 无效",
  "error.media.invalidAudioId": "音频 ID 无效",
  "error.media.goalNoUnitsForExport": "该目标尚无学习单元，无法导出教材",
  "error.memory.roomNotFound": "房间不存在",
  "error.memory.reviewStatusOnly": "只能查看等待确认的记忆建议",
  "error.scenario.notReady": "情境演练尚未准备完成",
  "error.scenario.invalidChoicePayload": "情境演练选择参数无效",
  "error.scenario.runNotFound": "情境演练存档不存在",
  "error.scenario.stateUpdated": "情境演练状态已更新，请刷新后继续",
  "error.scenario.contentUnavailable": "情境演练内容不可用",
  "error.scenario.choiceNotFound": "选择不存在",
  "error.agent.threadNotFound": "对话不存在",
  "error.agent.runInProgress": "上一条请求还在处理中，请稍等。",
  "error.agent.resumeScopeUnsupported": "不支持的恢复会话范围",
  "error.agent.threadForbidden": "无权访问该对话",
  "error.agent.invalidFollowUpContext": "无效的追问上下文",
  "error.agent.scopeUnsupported": "不支持的会话范围：{scope}",
  "error.agent.goalCreationStartFailed": "目标创建启动失败",
  "error.agent.foundationGoalUnsupported": "当前目标不能创建基础补充目标",
  "error.agent.foundationSelectionStale": "所选基础已不在当前课程规划中",
  "error.agent.foundationGoalExists": "部分基础已有对应的补充目标",
  "error.agent.goalCreationRetryNotNeeded": "当前目标创建不需要重试",
  "error.agent.completedGoalCreationCannotStop": "已完成的目标创建不能停止",
  "error.agent.deleteConfirmRequired": "请输入 DELETE 确认删除",
  "error.agent.stopGoalCreationFirst": "请先停止目标创建",
  "error.agent.goalCreationNotFound": "目标创建空间不存在",
  "error.agent.goalCreationForbidden": "无权访问此目标创建空间",
  "error.agent.goalCreationStopped": "目标创建已停止，请删除草稿后新建目标",
  "error.agent.deleteDedicatedThreadFromGoalCreation":
    "请从目标创建空间停止并删除此流程",
  "error.agent.stateOutOfSync":
    "对话状态刚才不同步了，我已经保护现场。请再提交一次当前表单或重新发送目标，我会继续处理。",
  "label.agent.currentUnit": "当前单元",
  "label.agent.currentGoal": "当前学习目标",
  "status.agent.contextCleared": "已清除 AI 上下文。上方消息仍保留供你查看。",
  "status.agent.goalCreationReady": "目标创建空间已准备好",
  "status.agent.foundationPlanningStarted": "已按选定基础启动快速目标规划",
  "status.agent.goalCreationRestored": "已恢复之前的目标创建进度",
  "status.agent.goalCreationRetrying": "正在重试目标创建",
  "status.agent.goalCreationStopped":
    "目标创建已停止。删除此草稿后才能创建新目标。",
  "status.agent.firstLessonReady": "第一课已准备好",
  "error.billing.insufficientCredits": "积分不足",
  "error.payment.purchaseUnavailable": "当前平台暂未开放积分购买",
  "error.payment.productUnknown": "未知积分商品",
  "error.payment.merchantNotConfigured": "微信支付商户尚未配置",
  "error.payment.orderNotFound": "订单不存在",
  "error.payment.notificationSignatureInvalid": "支付通知验签失败",
  "error.payment.notificationInvalid": "支付通知内容无效",
  "error.persona.unsafeInstruction": "自定义风格不能修改系统规则或绕过安全限制",
  "error.persona.invalid": "无效的教学助手",
  "error.persona.invalidBuiltin": "无效的官方模板",
  "error.persona.notFound": "教学助手不存在",
  "error.publicCourse.resourceNotFound": "公开课程资源不存在",
  "error.rag.filesAndGoalRequired": "需要至少一个 file/files 和 goalId",
  "error.rag.goalAndDocumentRequired": "需要 goalId 和 documentId",
  "error.rag.documentNotFound": "资料不存在",
  "error.rag.goalAndUrlsRequired": "需要 goalId 和至少一个 URL",
  "error.rag.pdfRefreshUnsupported":
    "网页知识来源暂不支持刷新 PDF，请通过上传资料添加 PDF",
  "error.rag.invalidUrl": "URL 格式无效",
  "error.rag.httpOnly": "仅支持 HTTP/HTTPS URL",
  "error.rag.credentialsForbidden": "URL 不可包含登录凭据",
  "error.rag.localhostForbidden": "不允许访问本机地址",
  "error.rag.privateAddressForbidden": "不允许访问内网或保留地址",
  "error.rag.redirectMissingLocation": "重定向缺少目标地址",
  "error.rag.tooManyRedirects": "URL 重定向次数过多",
  "error.rag.articleTooLarge": "网页内容超过 5MB 上限",
  "error.rag.planningSourcesTooLarge":
    "上传资料超过完整课程规划的单次读取容量。请提供保留全部必需章节的精简母纲后重试；系统未静默省略资料章节。",
  "error.rag.articleTooShort": "无法从网页提取足够的正文内容",
  "error.rag.fileTextUnavailable":
    "无法从《{filename}》提取到可用文本，请检查文件内容后重试",
  "error.rag.urlAlreadyAdded": "该 URL 已添加到此目标",
  "error.rag.tooManyUrls": "每次最多添加 {count} 个 URL",
  "error.rag.webRequestFailed": "网页请求失败（HTTP {status}）",
  "error.rag.unsupportedContentType": "不支持的网页内容类型：{type}",
  "error.rag.sourceIngestionFailed": "资料保存失败，请重试",
  "error.billing.unknownProduct": "未知积分商品",
  "error.billing.invalidPurchaseReceipt": "购买凭据无效",
  "error.billing.appleIapNotConfigured": "服务端尚未配置积分内购",
  "error.billing.userNotFound": "用户不存在",
  "error.billing.positiveCredits": "积分必须是正数",
  "error.teachingSkill.filesObjectInvalid":
    "files 必须是包含 UTF-8 文本文件的对象",
  "error.teachingSkill.fileTextRequired": "{path} 必须包含文本",
  "error.teachingSkill.invalidPackage": "教学技能包无效",
  "error.teachingSkill.saveFailed": "教学技能保存失败",
  "error.teachingSkill.publishFailed": "教学技能发布失败",
  "error.teachingSkill.notFound": "教学技能不存在",
  "error.teachingSkill.builtinArchiveForbidden": "通用教学技能不能归档",
  "error.teachingSkill.publishedNotFound": "已发布的教学技能不存在",
  "error.teachingSkill.slugRequired": "请提供有效的小写连字符 slug",
  "error.teachingSkill.goalIdRequired": "缺少 goalId",
  "error.teachingSkill.goalNotFound":
    "找不到这个学习目标，可能已被删除或链接无效。",
  "error.teachingSkill.skillIdRequired": "缺少 skillId",
  "error.teachingSkill.zipRequired": "需要提供教学技能 ZIP 文件",
  "error.teachingSkill.invalidZip": "教学技能包必须是有效的 ZIP 压缩包",
  "error.teachingSkill.zipTextInvalid": "教学技能包文件必须是有效的 UTF-8 文本",
  "error.productUpdate.invalidAction": "产品更新操作无效",
  "error.productUpdate.notFound": "产品更新不存在",
  "error.productUpdate.invalidStatusAction": "状态操作无效",
  "error.productUpdate.localizedContentRequired": "产品更新需要本地化内容",
  "error.generationSettings.invalidSettings": "需要提供生成设置对象",
  "error.generationSettings.searchSettingsInvalid": "搜索设置无效",
  "error.generationSettings.chatAudioSettingsInvalid": "聊天语音设置无效",
  "error.generationSettings.imageSettingsInvalid": "图片生成设置无效",
  "error.generationSettings.concurrencyInvalid":
    "deepPlanningResearchConcurrency 必须是 1 到 4 的整数",
  "error.generationSettings.searchEnabledInvalid": "searchEnabled 必须是布尔值",
  "error.generationSettings.searchProviderInvalid":
    "searchProvider 必须是以下值之一：{providers}",
  "error.generationSettings.chatAudioProviderInvalid":
    "chatAudioProvider 必须是以下值之一：{providers}",
  "error.generationSettings.imageProviderInvalid":
    "imageProvider 必须是以下值之一：{providers}",
  "error.generationSettings.openaiBaseUrlInvalid":
    "openaiBaseUrl 必须是以下值之一：{presets}",
  "error.generationSettings.settingsRequired": "请至少提供一项生成设置",
  "error.llmRouting.invalidBody": "LLM 路由设置无效",
  "error.llmRouting.unknownOperation": "未知的 LLM 操作：{operation}",
  "error.llmRouting.modelProviderMismatch":
    "模型 {model} 不属于提供商 {provider}",
  "error.llmRouting.modelNotPriced":
    "模型 {provider}/{model} 尚未配置有效的 LLM 计费",
  "error.llmRouting.reasoningUnsupported":
    "提供商 {provider} 的模型 {model} 不支持推理模式 {reasoningMode}",
  "error.backendError.groupNotFound": "后端错误组不存在",
  "error.proxy.upstreamNotFound": "未配置 {path} 的 API 上游服务",
  "error.proxy.requestFailed": "API 服务暂时不可用",
  "label.cognition.relation.prerequisite": "前置",
  "label.cognition.relation.partOf": "组成",
  "label.cognition.relation.causes": "导致",
  "label.cognition.relation.contrasts": "对比",
  "label.cognition.relation.constrains": "约束",
  "label.cognition.relation.supports": "支持",
  "label.cognition.relation.enables": "使能",
  "label.cognition.kind.atom": "知识原子",
  "label.cognition.kind.concept": "概念",
  "label.cognition.kind.skill": "技能",
  "label.cognition.kind.competency": "能力",
  "status.generation.cancelled": "生成已停止",
  "status.learning.generatingPreview": "生成预习大纲与引导问题…",
  "status.learning.cognitiveModelBuilding": "正在准备学习模型，请稍候…",
  "status.learning.generatingMaterial": "生成互动学习页…",
  "status.learning.generatingCornell": "生成学习笔记…",
  "status.learning.generatingQuiz": "根据正文生成测验题…",
  "status.learning.generatingFlashcards": "根据正文生成间隔复习闪卡…",
  "status.learning.thinking": "正在思考…",
  "status.goal.generatingMap": "AI 正在生成学习地图单元…",
  "status.goal.mapSaved": "学习地图已保存，详细学习规划将在后台生成…",
  "status.goal.language": "生成语言：{language}",
  "status.goal.regeneratingMap": "正在根据你的说明重新生成学习地图…",
  "status.goal.generatingMapFromSummary": "按已确认的简版摘要生成学习地图…",
  "status.goal.retrievingUploads": "检索已上传资料…",
  "status.goal.collectingReferences": "收集路径参考…",
  "status.goal.uploadsRetrieved": "已检索上传资料",
  "status.goal.authoritativePathFound": "已搜索权威学习路径",
  "status.goal.savingUnits": "保存 {count} 个学习单元…",
  "status.goal.mapSavedToContract": "学习地图已按目标契约保存",
  "status.goal.refreshingOrder": "正在刷新学习地图顺序…",
  "status.goal.mapOrderRefreshed": "学习地图已刷新，详细学习规划将在后台刷新…",
  "status.goal.generatingSummary": "AI 正在生成简版学习摘要…",
  "status.goal.identifyingContract": "正在识别学习领域并制定目标契约…",
  "status.goal.revisingPlanFromSources":
    "正在基于已保存的资料和你的反馈调整计划（不会重新搜索）",
  "status.goal.analyzingBoundaries": "正在分析目标、学习背景和课程边界",
  "status.goal.draftingModules": "正在根据已选来源起草模块学习路径",
  "status.goal.selectingSources": "正在从检索结果中筛选可用来源…",
  "status.goal.generatingPlanFromSources": "正在根据已选来源生成学习计划…",
  "status.goal.researchingModules": "正在逐模块精读资料（{count} 个模块）",
  "status.goal.synthesizingPlan": "正在结合各模块研究结果完成最终编排",
  "status.goal.contractPreserved": "已保留当前学习地图使用的目标契约",
  "status.goal.generatingDetailedPlan": "正在根据当前学习地图生成详细学习规划…",
  "status.goal.upgradingMicro": "正在升级轻课并生成完整学习内容…",
  "status.goal.generatingMicroContent": "正在生成轻课正文…",
  "status.goal.generatingOverviewContent": "正在生成主题总览课程…",
  "status.goal.savingMicroContent": "保存轻课正文…",
  "status.goal.savingOverviewContent": "保存总览课程…",
  "status.goal.summarySourcesRag": "已从 {count} 个学习资料来源检索到规划依据…",
  "status.goal.summarySourcesSearch": "已从 {count} 个网络来源检索到规划依据…",
  "status.goal.summarySourcesGeneric":
    "未检索到可用学习资料，将按通用知识生成摘要…",
  "status.goal.mapSourcesRag":
    "已检索 {count} 个学习资料来源，正在生成学习地图…",
  "status.goal.mapSourcesSearch":
    "已检索 {count} 个网络来源，正在生成学习地图…",
  "status.goal.mapSourcesGeneric":
    "未检索到可用学习资料，正在按通用知识生成学习地图…",
  "status.goal.replanningModules": "正在重新规划尚未解锁的模块摘要…",
  "status.goal.batchStopped":
    "已停止。已完成 {succeeded} 个，跳过 {skipped} 个。",
  "status.goal.batchCompleted":
    "全部完成：新生成 {succeeded} 个，跳过 {skipped} 个。",
  "status.goal.batchCompletedWithFailures":
    "完成：成功 {succeeded} 个，跳过 {skipped} 个，失败 {failed} 个。",
  "status.goal.sequentialModulesCreated":
    "顺序模块已创建，当前只生成已解锁模块",
};

const zhHant: Record<BackendTranslationKey, string> = {
  ...zhHans,
  "error.remotion.previewRequired": "請先完成本單元的預習，再生成 Remotion 影片；無需生成課程正文",
  "error.remotion.overviewRequired": "請先完成課程導覽內容，再製作導覽影片",
  "error.remotion.previewChanged": "預習內容在動畫生成期間已更新，請根據最新預習重試；原影片已保留",
  "error.remotion.revisionChanged": "動畫課程已有新修訂，較早生成結果不會覆蓋它，請重試",
  "error.remotion.invalidDisplayCorrection": "請選擇影片準備的既有演示物件，並提供完整的修正版畫面與講解；其他教學物件保持不變",
  "error.remotion.displayCorrectionSourceBound": "這段演示來自已發布課程，請先修改課程內容，再重新生成影片",
  "error.remotion.previewStale": "預習內容已更新，請先根據最新預習更新動畫，再匯出影片",
  "error.remotion.imageMissing": "Remotion 圖片資源缺失或已改變，請還原圖片後繼續",
  "error.remotion.imageProviderRequired": "請設定圖片生成服務，再繼續目前鏡頭",
  "error.remotion.authoringTimeout": "準備「{title}」時，模型回應超過 {seconds} 秒上限。已完成的內容已儲存，點擊繼續可從未完成的位置接著製作。",
  "error.remotion.authoringIdleTimeout": "準備「{title}」時，已連續 {seconds} 秒沒有收到模型的新內容。已完成的內容已儲存，點擊繼續可從未完成的位置接著製作。",
  "error.remotion.imageNeedsReview": "「{title}」的配圖仍未通過檢查（已修正 {attempts} 次）：{issues}。點擊「繼續」可再次修正這張配圖，已儲存的內容會保留。",
  "error.remotion.imageSubjectMissing": "缺少教學對象：{subject}",
  "error.courseProduction.notFound": "課程不存在。",
  "error.courseProduction.unitNotFound": "課程中找不到該單元。",
  "error.courseProduction.sectionNotFound": "章節不存在。",
  "error.courseProduction.legacy": "請在原課程編輯器中重新生成舊版內容。",
  "error.courseProduction.unfinished": "本節尚未生成完成，請繼續製作。",
  "error.courseProduction.contentRequired": "請先準備本節正式內容。",
  "error.courseProduction.storageUnavailable": "課程儲存暫不可用。",
  "error.learning.assessmentResponseTooLarge": "評估回答過長",
  "error.learning.idempotencyKeyRequired": "需要有效的冪等鍵",
  "error.learning.evaluatorFieldsUnsupported":
    "不接受用戶端提供的評估器欄位：{fields}",
  "error.learning.idempotencyConflict": "該冪等鍵已用於其他回答",
  "error.learning.sectionNotFound": "學習小節不存在",
  "error.learning.sectionGenerationStopped": "小節生成未完成，已停止",
  "error.learning.completeSectionFirst": "請先完成學習小節",
  "error.learning.sectionNoAssessmentCheckpoint": "本小節沒有評估檢查點",
  "error.learning.completeCheckpointSectionsFirst":
    "請先完成本檢查點中的全部學習小節",
  "error.learning.unitPreviewNotReady": "單元預習內容尚未準備好",
  "error.learning.noQuizEligibleTargets": "本小節沒有可用於測驗的學習目標",
  "error.learning.miniTestLeaseSuperseded": "小節測驗生成已被新的任務取代",
  "error.learning.sectionGenerationLeaseSuperseded": "小節生成已被新的任務取代",
  "error.learning.miniTestSkipUnsupported": "小節測驗不能單獨跳過",
  "error.learning.completePreviousSectionsFirst": "請先完成前面的小節",
  "error.learning.sectionSkipNotEligible": "本小節目前不能跳過",
  "error.learning.previousSectionIncomplete": "請先完成上一學習小節",
  "error.learning.sectionContentNotReady": "小節內容尚未準備好",
  "error.learning.assessmentDurationInvalid": "需要有效的評估用時",
  "error.learning.adaptiveAssessmentNotFound": "自適應評估任務不存在",
  "error.internal": "服務暫時出了點問題，請稍後再試。",
  "error.unknown": "出了點問題，請稍後再試。",
  "error.notFound": "未找到",
  "error.generation.failed": "生成失敗",
  "error.generation.failedFriendly":
    "這次內容沒有準備完成，你的學習進度已保留。請點擊重試再試一次。",
  "error.generation.notFound": "生成任務不存在",
  "error.generation.ended": "生成任務已結束",
  "error.generation.cancelled": "生成已停止",
  "error.generation.interrupted": "伺服器已重新啟動，本次生成已中斷，請重試",
  "error.auth.registrationDisabled": "註冊功能已關閉",
  "error.auth.nameRequired": "請填寫使用者名稱",
  "error.auth.passwordRequired": "請填寫密碼",
  "error.auth.userExists": "使用者已存在",
  "error.auth.userNotFound": "使用者不存在",
  "error.auth.invalidPassword": "密碼不正確",
  "error.auth.invalidRefreshToken": "刷新權杖無效",
  "error.auth.refreshTokenUsed": "刷新權杖已被使用",
  "error.auth.missingBearerToken": "缺少登入憑證",
  "error.auth.invalidToken": "登入憑證無效",
  "error.auth.missingUserIdentity": "缺少使用者身份",
  "error.auth.adminRequired": "需要管理員權限",
  "error.auth.adminDashboardRequired": "請使用管理後台登入管理員帳號",
  "error.auth.adminClientRequired": "需要管理後台存取權限",
  "error.auth.emailInvalid": "電子郵件格式不正確",
  "error.auth.passwordMinLength": "{field} 至少需要 8 個字元",
  "error.auth.identityTokenRequired": "缺少 identityToken",
  "error.auth.appleNotConfigured": "Apple 登入尚未設定",
  "error.auth.invalidAppleIdentityToken": "Apple 身份權杖無效",
  "error.auth.currentPasswordRequired": "請填寫目前密碼",
  "error.auth.invalidCurrentPassword": "目前密碼不正確",
  "error.auth.emailCodeInvalid": "驗證碼不正確",
  "error.auth.emailCodeExpired": "驗證碼已過期，請重新取得",
  "error.auth.emailCodeFormatInvalid": "驗證碼必須是 6 位數字",
  "error.auth.emailCodeCooldown": "驗證碼發送太頻繁，請 60 秒後再試",
  "error.auth.emailCodeHourlyLimit":
    "該電子郵件 1 小時內驗證碼發送次數已達上限",
  "error.auth.emailSendFailed": "郵件發送失敗：{message}",
  "error.auth.accountDeleteConfirmRequired": "請輸入 DELETE 以確認註銷帳號",
  "error.auth.accountDeleteAdminForbidden": "管理員帳號不可註銷",
  "error.auth.usernameTooShort": "使用者名稱至少需要 3 個字元",
  "error.auth.usernameTooLong": "使用者名稱最多 32 個字元",
  "error.auth.usernameInvalid":
    "使用者名稱需以字母開頭，只能包含字母、數字和底線",
  "error.auth.usernameReserved": "該使用者名稱不可用",
  "error.auth.usernameAlreadySet": "使用者名稱已設定，無法修改",
  "error.auth.emailAlreadySet": "電子郵件已設定，無法修改",
  "error.auth.emailInUse": "該電子郵件已綁定其他帳號",
  "error.auth.wechatCodeRequired": "微信登入 code 不能為空",
  "error.auth.wechatNotConfigured": "微信小程式登入尚未設定",
  "error.auth.wechatLoginFailed": "微信登入失敗",
  "error.auth.wechatAccountHasGoals":
    "目前微信帳號已有課程，請聯絡客服安全合併帳號",
  "error.auth.notWechatMiniAccount": "目前帳號不是微信小程式帳號",
  "error.auth.nameTypeInvalid": "使用者名稱必須是字串",
  "error.auth.emailTypeInvalid": "電子郵件必須是字串",
  "error.auth.passwordTypeInvalid": "密碼必須是字串",
  "error.auth.passwordMinLengthGeneric": "密碼至少需要 8 個字元",
  "error.auth.passwordLoginIdentityRequired":
    "設定密碼時需要提供使用者名稱或電子郵件",
  "error.auth.identifierRequired": "請至少提供使用者名稱或電子郵件",
  "error.auth.usernameOrEmailExists": "使用者名稱或電子郵件已存在",
  "error.request.invalidBody": "請求內容無效",
  "error.settings.providerNotConfigured":
    "提供商「{provider}」尚未設定，請在 .env 中加入所需 API 金鑰",
  "error.settings.modelUnavailable":
    "模型「{model}」不可用，請選擇已設定 LLM 計費的模型",
  "error.settings.searchLearnerManaged":
    "網路搜尋由管理後台 AI 生成設定統一控制，學習者不能單獨修改",
  "error.settings.imagesDisabled": "此部署未啟用圖片生成功能",
  "error.settings.imagesLearnerManaged":
    "圖片生成由管理後台 AI 生成設定統一控制，學習者不能單獨修改",
  "status.auth.emailCodeSent": "驗證碼已發送，請查收郵箱",
  "status.auth.loginSuccess": "登入成功",
  "status.generation.learningTargets": "正在核對學習目標與先修路徑…",
  "status.generation.sq": "正在整理本節預習要點…",
  "status.generation.sectionPlan": "正在劃分本節學習段落…",
  "status.generation.material": "正在準備本節學習內容…",
  "status.generation.formalDerivation": "正在準備本節公式推導…",
  "status.generation.teachingDerivation": "正在準備本節教學推導…",
  "status.generation.verifyingContent": "正在檢查生成內容的正確性…",
  "status.generation.notes": "正在整理本節學習筆記…",
  "status.generation.quiz": "正在根據本節內容準備練習…",
  "status.generation.flashcards": "正在整理間隔複習閃卡…",
  "status.generation.quizExplain": "正在結合題目整理解析…",
  "status.generation.socraticMistakes": "正在整理需要回顧的題目…",
  "status.generation.socraticQuestion": "正在根據你的作答準備引導問題…",
  "status.generation.diagnostic": "正在根據學習目標準備 {count} 道診斷題…",
  "status.generation.images": "正在準備圖示（{current}/{total}）…",
  "status.generation.memoryRoom": "正在準備記憶宮殿房間…",
  "status.generation.memoryClues": "正在「{room}」中整理記憶線索…",
  "status.generation.memoryRoomDetails": "正在生成房間感官細節與錨點描述…",
  "status.generation.memoryRoomImages": "正在生成俯視圖與全景圖…",
  "status.generation.memoryImageProgress":
    "正在生成配圖 {current}/{total}：{label}",
  "label.memoryImage.topdown": "俯視圖",
  "label.memoryImage.perspective": "全景圖",
  "label.memoryImage.detail": "細節圖",
  "status.generation.scenarioPreparing": "正在召集本場角色…",
  "status.generation.scenarioFallback": "正在使用可靠模板安排角色…",
  "status.generation.scenarioScene": "正在佈置這一幕…",
  "status.generation.scenarioScenePrefetch": "正在提前佈置後續場景…",
  "status.generation.uploadingMaterials": "正在將學習資料寫入知識庫…",
  "status.generation.materialsIngested": "資料向量化完成",
  "status.generation.materialIngestionFailed": "學習資料寫入失敗，已停止規劃",
  "status.generation.processingMaterial":
    "正在處理資料（{current}/{total}）：{filename}…",
  "status.generation.parsingMaterial": "正在解析《{filename}》…",
  "status.generation.writingSource": "正在寫入來源《{title}》…",
  "status.generation.embedding": "正在生成向量嵌入（{count} 段）…",
  "status.generation.embeddingBatch":
    "正在生成向量嵌入（{batch}/{total} 批，共 {count} 段）…",
  "status.goal.summarySourcesRag": "已從 {count} 個學習資料來源檢索到規劃依據…",
  "status.goal.summarySourcesSearch": "已從 {count} 個網路來源檢索到規劃依據…",
  "status.goal.summarySourcesGeneric":
    "未檢索到可用學習資料，將按通用知識生成摘要…",
  "status.goal.mapSourcesRag":
    "已檢索 {count} 個學習資料來源，正在生成學習地圖…",
  "status.goal.mapSourcesSearch":
    "已檢索 {count} 個網路來源，正在生成學習地圖…",
  "status.goal.mapSourcesGeneric":
    "未檢索到可用學習資料，正在按通用知識生成學習地圖…",
  "status.generation.subdivide": "正在用 AI 拆分「{title}」…",
  "status.generation.saveLearningSteps": "正在保存不改變課程結構的學習步驟…",
  "status.generation.subdivideWriting":
    "已生成 {count} 個子單元，正在安全寫入…",
  "status.generation.expand": "正在展開「{title}」…",
  "status.generation.expandWriting": "已生成 {count} 個子單元，正在寫入…",
  "status.generation.collectingPathReferences": "正在收集學習路徑參考…",
  "status.generation.generatingMap": "AI 正在生成學習地圖…",
  "status.generation.mapWriting": "已生成 {count} 個學習單元，正在寫入…",
  "status.generation.followUp": "正在結合本節內容思考…",
  "status.generation.goal": "正在梳理你的學習目標…",
  "status.generation.goalIcon": "正在產生學習目標圖示…",
  "status.generation.path": "正在規劃學習路徑…",
  "status.planning.context.started": "正在核對學習目標、可用資料與規劃約束…",
  "status.planning.context.pulse1": "仍在比較目標與目前資料上下文…",
  "status.planning.context.pulse2": "正在判斷哪些資訊應當影響學習路徑…",
  "status.planning.context.completed": "目標與資料上下文已準備完成",
  "status.planning.draft.started": "模型正在構思能力里程碑與模組邊界…",
  "status.planning.draft.pulse1": "正在比較模組邊界與前置順序…",
  "status.planning.draft.pulse2": "正在檢查里程碑是否覆蓋完整學習目標…",
  "status.planning.draft.pulse3": "正在收斂模組範圍，準備逐模組研究…",
  "status.planning.draft.completed": "初步模組路徑已形成",
  "status.planning.final.started": "模型正在把研究結果綜合為最終學習路徑…",
  "status.planning.final.pulse1": "正在對齊資料結論與模組學習成果…",
  "status.planning.final.pulse2": "正在檢查課時數量、模組體量與進階節奏…",
  "status.planning.final.pulse3": "正在消除重複並核對前置關係…",
  "status.planning.final.completed": "最終學習路徑已形成",
  "status.planning.identity.started": "正在確定目標方向、摘要與假定基礎…",
  "status.planning.identity.pulse1": "仍在明確學習方式與你將獲得的能力…",
  "status.planning.identity.pulse2": "正在對照你確認的基礎與意圖核對摘要…",
  "status.planning.identity.completed": "目標摘要與假定基礎已就緒",
  "status.planning.journey.started": "正在規劃你將依序學習的模組…",
  "status.planning.journey.pulse1": "正在比較模組邊界與前置順序…",
  "status.planning.journey.pulse2": "正在檢查模組是否覆蓋完整學習目標…",
  "status.planning.journey.pulse3":
    "正在消除重複，讓後一模組建立在前一模組之上…",
  "status.planning.journey.completed": "模組學習路徑已形成",
  "status.planning.moduleCapabilities.started":
    "正在定義「{title}」的出口能力…",
  "status.planning.moduleCapabilities.pulse1":
    "仍在把「{title}」的目標寫成可觀察能力…",
  "status.planning.moduleCapabilities.pulse2":
    "正在檢查「{title}」的能力是否可被後續評估…",
  "status.planning.moduleCapabilities.completed": "「{title}」的出口能力已就緒",
  "status.planning.moduleStructure.started": "正在規劃「{title}」的課時順序…",
  "status.planning.moduleStructure.pulse1": "仍在梳理「{title}」的課時大綱…",
  "status.planning.moduleStructure.pulse2":
    "正在檢查「{title}」是否覆蓋本模組能力…",
  "status.planning.moduleStructure.pulse3": "正在整理「{title}」的課時順序…",
  "status.planning.moduleStructure.completed": "「{title}」的課時結構已就緒",
  "status.planning.validation.started": "正在校驗覆蓋範圍、順序與模組規劃契約…",
  "status.planning.validation.completed": "規劃契約校驗通過並已儲存",
  "status.planning.moduleDraft.started": "正在準備「{title}」的模組結構…",
  "status.planning.moduleDraft.authoring": "正在編寫「{title}」的課時…",
  "status.planning.moduleDraft.pulse1": "仍在梳理「{title}」的課時大綱…",
  "status.planning.moduleDraft.pulse2":
    "正在檢查「{title}」是否覆蓋本模組目標…",
  "status.planning.moduleDraft.pulse3": "正在整理「{title}」的課時順序…",
  "status.planning.moduleDraft.completed":
    "「{title}」模組草稿已就緒，等待交叉檢查",
  "status.planning.moduleDraft.fanOut":
    "正在準備全部模組結構，完成後會做一次交叉審計",
  "status.planning.moduleAudit.started":
    "正在檢查全部模組是否貼合已確認的目標…",
  "status.planning.moduleAudit.pulse1": "正在比較模組覆蓋、重複範圍與課時順序…",
  "status.planning.moduleAudit.pulse2": "正在查找缺失步驟和依賴問題…",
  "status.planning.moduleAudit.completed": "交叉模組檢查已完成",
  "status.planning.moduleAudit.passed": "模組結構已通過審計，即將發布",
  "status.planning.moduleAudit.repairing":
    "審計發現問題，正在對標記模組做一次修復",
  "status.planning.modulePublish.started": "正在發布「{title}」模組…",
  "status.planning.modulePublish.completed": "已發布「{title}」",
  "status.generation.overview": "正在整理課程概覽…",
  "status.generation.batchSq": "正在整理 {count} 個學習單元的預習要點…",
  "status.generation.batchMaterial": "正在準備 {count} 個學習單元的學習內容…",
  "status.generation.unitSq": "正在整理「{title}」的預習要點…",
  "status.generation.unitSectionPlan": "正在劃分「{title}」的學習段落…",
  "status.generation.unitMaterial": "正在準備「{title}」的學習內容…",
  "status.generation.unitNeedsSq": "正在先為「{title}」整理預習要點…",
  "error.goal.notFound": "找不到這個學習目標，可能已被刪除或連結無效。",
  "error.goal.missing": "缺少學習目標",
  "error.goal.unitNotFound": "找不到這個學習單元，可能已被刪除或連結無效。",
  "error.goal.forbidden": "無權存取該目標",
  "error.goal.unitForbidden": "無權存取該單元",
  "error.goal.sharedNotFound":
    "找不到這個分享的學習目標，連結可能不正確或已失效。",
  "error.goal.sharedCourseNotFound": "分享的課程不存在或未公開",
  "error.goal.invalidShareSettings": "無效的分享設定",
  "error.goal.microUnsupportedMap": "輕課不支援學習地圖或學習規劃操作",
  "error.goal.overviewUnitReadonly": "總覽課程單元不可編輯",
  "error.goal.titleRequired": "標題不能為空",
  "error.goal.notFullGoal": "此功能僅適用於完整目標",
  "error.goal.notExploration": "該目標已經是系統掌握模式",
  "error.goal.curriculumNotReady": "請等待課程準備完成後再切換學習模式",
  "error.goal.shareActive": "請先取消發佈或發佈申請，再切換學習模式",
  "error.goal.notKacomGoal": "只有啟用 KACOM 的完整目標可以解除認知模型關聯",
  "error.goal.shareModulesNotReady": "請先解鎖並生成全部模組，再申請公開發布",
  "error.goal.shareMissingMaterial":
    "仍有 {count} 個必修單元尚未生成學習材料，暫不能公開發布",
  "error.goal.shareNoContent": "課程暫無內容，無法發布",
  "error.goal.shareNoPublishedLessons": "課程暫無已發布課時，無法公開分享",
  "error.goal.sharePendingNotFound": "待審核課程不存在或已處理",
  "error.goal.sharePendingInvalid": "待審核課程內容無效",
  "error.goal.sharedCourseUnavailable": "公開課程不存在或已下架",
  "error.learning.materialRequired": "請先生成學習內容",
  "error.learning.materialNotFound": "學習材料不存在",
  "error.learning.completeMaterialFirst": "請先完成學習正文",
  "error.learning.completeUnitFirst": "請先完成本單元學習",
  "error.learning.invalidStep": "無效的步驟",
  "error.learning.feynmanUnavailable": "費曼講解功能暫未開放",
  "error.learning.threadNotFound": "對話不存在",
  "error.learning.quizSetNotFound": "測驗題組不存在",
  "error.learning.quizSetInvalid": "測驗題組無效，請重新生成題目",
  "error.learning.answerRequired": "請先輸入回答",
  "error.learning.noSocraticConversation": "沒有可繼續的蘇格拉底對話",
  "error.learning.socraticEnded": "該對話已結束，請切換到其他錯題",
  "error.learning.completeCorrectionsFirst": "請先完成所有錯題修正",
  "error.learning.invalidTone": "無效的內容文風",
  "error.learning.guidingQuestionsNotFound": "暫無引導問題",
  "error.learning.slideNarrationRequired": "缺少投影片旁白文字",
  "error.learning.invalidBlockIndex": "無效的內容區塊索引",
  "error.learning.invalidSlideOrBlockIndex": "無效的投影片或內容區塊索引",
  "error.learning.componentMissing": "元件不存在",
  "error.learning.componentRegenerateForbidden": "該元件不能重新生成",
  "error.learning.componentRegenerateFailed": "重新生成互動元件失敗",
  "error.learning.imageRegenerationInvalid": "該內容區塊不能作為圖片重新生成",
  "error.learning.svgIllustrationReplaceUnavailable":
    "用圖片替換 SVG 示意圖僅在桌面開發環境可用",
  "error.learning.aiBlockEditUnavailable":
    "AI 修改內容區塊僅在桌面開發環境可用",
  "error.learning.aiBlockEditInstructionRequired":
    "請先描述希望 AI 如何修改這個內容區塊",
  "error.learning.aiBlockEditUnsupported": "該內容區塊不支援 AI 修改",
  "error.learning.aiBlockEditFailed": "AI 修改該內容區塊失敗",
  "error.learning.blockDeleteUnavailable": "刪除內容區塊僅在桌面開發環境可用",
  "error.learning.blockDeleteAssessmentForbidden": "測驗內容區塊不能在這裡刪除",
  "error.learning.subdivideNotFound": "學習單元不存在",
  "error.learning.subdivideAlreadyModule": "該學習單元已經拆分",
  "error.learning.subdivideMaxDepth": "學習地圖已達到最大層級",
  "error.learning.subdivideModuleContainer": "請開啟模組內的學習單元後再拆分",
  "error.learning.subdivideNoChildren": "該學習單元沒有可移除的子地圖",
  "error.learning.subdivideUnsafeActivity":
    "本單元已有學習活動，不能修改課程結構",
  "error.learning.subdivideModuleLimit": "拆分後模組課程數不能超過 {limit} 節",
  "error.learning.subdivideNoTargets": "目前單元尚無可安全複用的學習目標",
  "error.learning.subdivideFailed": "學習單元拆分失敗，請重試",
  "error.learning.microExpandDisabled": "擴展輕課為完整目標功能未啟用",
  "error.review.cardNotFound": "卡片不存在",
  "error.review.cardForbidden": "無權存取該卡片",
  "error.review.deckNotFound": "牌組不存在",
  "error.review.deckForbidden": "無權存取該牌組",
  "error.review.flashcardNotFound": "閃卡不存在",
  "error.review.flashcardForbidden": "無權存取該閃卡",
  "error.review.flashcardSidesRequired": "正面和背面不能為空",
  "error.media.invalidPdfLayout": "PDF 版面無效",
  "error.media.invalidImageId": "圖片 ID 無效",
  "error.media.invalidAudioId": "音訊 ID 無效",
  "error.media.goalNoUnitsForExport": "該目標尚無學習單元，無法匯出教材",
  "error.memory.roomNotFound": "房間不存在",
  "error.memory.reviewStatusOnly": "只能查看等待確認的記憶建議",
  "error.agenda.itemNotFound": "日程項目不存在",
  "error.agenda.scopeConflict": "goalId 與 spaceId 不能同時使用",
  "error.scenario.notReady": "情境演練尚未準備完成",
  "error.scenario.invalidChoicePayload": "情境演練選擇參數無效",
  "error.scenario.runNotFound": "情境演練存檔不存在",
  "error.scenario.stateUpdated": "情境演練狀態已更新，請重新整理後繼續",
  "error.scenario.contentUnavailable": "情境演練內容不可用",
  "error.scenario.choiceNotFound": "選擇不存在",
  "error.agent.threadNotFound": "對話不存在",
  "error.agent.runInProgress": "上一條請求還在處理中，請稍等。",
  "error.agent.resumeScopeUnsupported": "不支援的恢復對話範圍",
  "error.agent.threadForbidden": "無權存取該對話",
  "error.agent.invalidFollowUpContext": "無效的追問脈絡",
  "error.agent.scopeUnsupported": "不支援的對話範圍：{scope}",
  "error.agent.goalCreationStartFailed": "目標建立啟動失敗",
  "error.agent.foundationGoalUnsupported": "目前目標不能建立基礎補充目標",
  "error.agent.foundationSelectionStale": "所選基礎已不在目前課程規劃中",
  "error.agent.foundationGoalExists": "部分基礎已有對應的補充目標",
  "error.agent.goalCreationRetryNotNeeded": "目前的目標建立不需要重試",
  "error.agent.completedGoalCreationCannotStop": "已完成的目標建立不能停止",
  "error.agent.deleteConfirmRequired": "請輸入 DELETE 確認刪除",
  "error.agent.stopGoalCreationFirst": "請先停止目標建立",
  "error.agent.goalCreationNotFound": "目標建立空間不存在",
  "error.agent.goalCreationForbidden": "無權存取此目標建立空間",
  "error.agent.goalCreationStopped": "目標建立已停止，請刪除草稿後再建立新目標",
  "error.agent.deleteDedicatedThreadFromGoalCreation":
    "請從目標建立空間停止並刪除此流程",
  "error.agent.stateOutOfSync":
    "對話狀態剛才不同步，我已保留進度。請再次提交目前表單或重新傳送目標，我會繼續處理。",
  "label.agent.currentUnit": "目前單元",
  "label.agent.currentGoal": "目前學習目標",
  "status.agent.contextCleared": "已清除 AI 脈絡。上方訊息仍保留供你查看。",
  "status.agent.goalCreationReady": "目標建立空間已準備好",
  "status.agent.foundationPlanningStarted": "已按所選基礎啟動快速目標規劃",
  "status.agent.goalCreationRestored": "已恢復之前的目標建立進度",
  "status.agent.goalCreationRetrying": "正在重試目標建立",
  "status.agent.goalCreationStopped":
    "目標建立已停止。刪除此草稿後才能建立新目標。",
  "status.agent.firstLessonReady": "第一課已準備好",
  "error.billing.insufficientCredits": "積分不足",
  "error.payment.purchaseUnavailable": "目前平台尚未開放積分購買",
  "error.payment.productUnknown": "未知的積分商品",
  "error.payment.merchantNotConfigured": "微信支付商戶尚未設定",
  "error.payment.orderNotFound": "付款訂單不存在",
  "error.payment.notificationSignatureInvalid": "付款通知驗證簽章失敗",
  "error.payment.notificationInvalid": "付款通知內容無效",
  "error.persona.unsafeInstruction": "自訂風格不能修改系統規則或繞過安全限制",
  "error.persona.invalid": "無效的教學助手",
  "error.persona.invalidBuiltin": "無效的官方範本",
  "error.persona.notFound": "教學助手不存在",
  "error.publicCourse.resourceNotFound": "公開課程資源不存在",
  "error.rag.filesAndGoalRequired": "需要至少一個 file/files 和 goalId",
  "error.rag.goalAndDocumentRequired": "需要 goalId 和 documentId",
  "error.rag.documentNotFound": "資料不存在",
  "error.rag.goalAndUrlsRequired": "需要 goalId 和至少一個 URL",
  "error.rag.pdfRefreshUnsupported":
    "網頁知識來源暫不支援重新整理 PDF，請透過上傳資料新增 PDF",
  "error.rag.invalidUrl": "URL 格式無效",
  "error.rag.httpOnly": "僅支援 HTTP/HTTPS URL",
  "error.rag.credentialsForbidden": "URL 不可包含登入憑證",
  "error.rag.localhostForbidden": "不允許存取本機地址",
  "error.rag.privateAddressForbidden": "不允許存取內網或保留地址",
  "error.rag.redirectMissingLocation": "重新導向缺少目標地址",
  "error.rag.tooManyRedirects": "URL 重新導向次數過多",
  "error.rag.articleTooLarge": "網頁內容超過 5MB 上限",
  "error.rag.planningSourcesTooLarge":
    "上傳資料超過完整課程規劃的單次讀取容量。請提供保留全部必需章節的精簡母綱後重試；系統未靜默省略資料章節。",
  "error.rag.articleTooShort": "無法從網頁提取足夠的正文內容",
  "error.project.notFound": "專案資源不存在",
  "error.project.forbidden": "無權存取該專案資源",
  "error.project.conflict": "該專案操作與目前狀態衝突",
  "error.project.invalid": "專案請求無效",
  "error.rag.fileTextUnavailable":
    "無法從《{filename}》提取可用文字，請檢查檔案內容後重試",
  "error.rag.urlAlreadyAdded": "該 URL 已新增至此目標",
  "error.rag.tooManyUrls": "每次最多新增 {count} 個 URL",
  "error.rag.webRequestFailed": "網頁請求失敗（HTTP {status}）",
  "error.rag.unsupportedContentType": "不支援的網頁內容類型：{type}",
  "error.rag.sourceIngestionFailed": "資料儲存失敗，請重試",
  "error.billing.unknownProduct": "未知的積分商品",
  "error.billing.invalidPurchaseReceipt": "購買憑據無效",
  "error.billing.appleIapNotConfigured": "伺服器尚未設定積分內購",
  "error.billing.userNotFound": "使用者不存在",
  "error.billing.positiveCredits": "積分必須是正數",
  "error.teachingSkill.filesObjectInvalid":
    "files 必須是包含 UTF-8 文字檔案的物件",
  "error.teachingSkill.fileTextRequired": "{path} 必須包含文字",
  "error.teachingSkill.invalidPackage": "教學技能套件無效",
  "error.teachingSkill.saveFailed": "教學技能儲存失敗",
  "error.teachingSkill.publishFailed": "教學技能發佈失敗",
  "error.teachingSkill.notFound": "教學技能不存在",
  "error.teachingSkill.builtinArchiveForbidden": "通用教學技能不能封存",
  "error.teachingSkill.publishedNotFound": "已發佈的教學技能不存在",
  "error.teachingSkill.slugRequired": "請提供有效的小寫連字號 slug",
  "error.teachingSkill.goalIdRequired": "缺少 goalId",
  "error.teachingSkill.goalNotFound":
    "找不到這個學習目標，可能已被刪除或連結無效。",
  "error.teachingSkill.skillIdRequired": "缺少 skillId",
  "error.teachingSkill.zipRequired": "需要提供教學技能 ZIP 檔案",
  "error.teachingSkill.invalidZip": "教學技能套件必須是有效的 ZIP 壓縮檔",
  "error.teachingSkill.zipTextInvalid":
    "教學技能套件檔案必須是有效的 UTF-8 文字",
  "error.productUpdate.invalidAction": "產品更新操作無效",
  "error.productUpdate.notFound": "產品更新不存在",
  "error.productUpdate.invalidStatusAction": "狀態操作無效",
  "error.productUpdate.localizedContentRequired": "產品更新需要本地化內容",
  "error.generationSettings.invalidSettings": "需要提供生成設定物件",
  "error.generationSettings.searchSettingsInvalid": "搜尋設定無效",
  "error.generationSettings.chatAudioSettingsInvalid": "聊天語音設定無效",
  "error.generationSettings.imageSettingsInvalid": "圖片生成設定無效",
  "error.generationSettings.concurrencyInvalid":
    "deepPlanningResearchConcurrency 必須是 1 到 4 的整數",
  "error.generationSettings.searchEnabledInvalid": "searchEnabled 必須是布林值",
  "error.generationSettings.searchProviderInvalid":
    "searchProvider 必須是以下值之一：{providers}",
  "error.generationSettings.chatAudioProviderInvalid":
    "chatAudioProvider 必須是以下值之一：{providers}",
  "error.generationSettings.imageProviderInvalid":
    "imageProvider 必須是以下值之一：{providers}",
  "error.generationSettings.openaiBaseUrlInvalid":
    "openaiBaseUrl 必須是以下值之一：{presets}",
  "error.generationSettings.settingsRequired": "請至少提供一項生成設定",
  "error.llmRouting.invalidBody": "LLM 路由設定無效",
  "error.llmRouting.unknownOperation": "未知的 LLM 操作：{operation}",
  "error.llmRouting.modelProviderMismatch":
    "模型 {model} 不屬於提供商 {provider}",
  "error.llmRouting.modelNotPriced":
    "模型 {provider}/{model} 尚未設定有效的 LLM 計費",
  "error.llmRouting.reasoningUnsupported":
    "提供商 {provider} 的模型 {model} 不支援推理模式 {reasoningMode}",
  "error.backendError.groupNotFound": "後端錯誤群組不存在",
  "error.proxy.upstreamNotFound": "未設定 {path} 的 API 上游服務",
  "error.proxy.requestFailed": "API 服務暫時無法使用",
  "label.cognition.relation.prerequisite": "前置",
  "label.cognition.relation.partOf": "組成",
  "label.cognition.relation.causes": "導致",
  "label.cognition.relation.contrasts": "對比",
  "label.cognition.relation.constrains": "約束",
  "label.cognition.relation.supports": "支持",
  "label.cognition.relation.enables": "使能",
  "label.cognition.kind.atom": "知識原子",
  "label.cognition.kind.concept": "概念",
  "label.cognition.kind.skill": "技能",
  "label.cognition.kind.competency": "能力",
  "status.generation.cancelled": "生成已停止",
  "status.learning.generatingPreview": "生成預習大綱與引導問題…",
  "status.learning.cognitiveModelBuilding": "正在準備學習模型，請稍候…",
  "status.learning.generatingMaterial": "生成互動學習頁…",
  "status.learning.generatingCornell": "生成學習筆記…",
  "status.learning.generatingQuiz": "根據正文生成測驗題…",
  "status.learning.generatingFlashcards": "根據正文生成間隔複習閃卡…",
  "status.learning.thinking": "正在思考…",
  "status.goal.generatingMap": "AI 正在生成學習地圖單元…",
  "status.goal.mapSaved": "學習地圖已保存，詳細學習規劃將在背景生成…",
};

const dictionaries: Record<
  BackendLocale,
  Record<BackendTranslationKey, string>
> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

const legacyMessageKeys = new Map<string, BackendTranslationKey>(
  Object.entries(zhHans).map(([key, value]) => [
    value,
    key as BackendTranslationKey,
  ]),
);
for (const [key, value] of Object.entries(en)) {
  legacyMessageKeys.set(value, key as BackendTranslationKey);
}
for (const [message, key] of [
  [
    "Cognitive-model expansion is already in progress",
    "status.learning.cognitiveModelBuilding",
  ],
  [
    "Use the admin dashboard to sign in as admin",
    "error.auth.adminDashboardRequired",
  ],
  ["Admin dashboard access required", "error.auth.adminClientRequired"],
  ["email is invalid", "error.auth.emailInvalid"],
  ["name is required", "error.auth.nameRequired"],
  ["password is required", "error.auth.passwordRequired"],
  ["User already exists", "error.auth.userExists"],
  ["User not found", "error.auth.userNotFound"],
  ["Invalid password", "error.auth.invalidPassword"],
  ["currentPassword is required", "error.auth.currentPasswordRequired"],
  ["Invalid current password", "error.auth.invalidCurrentPassword"],
  [
    "Username must start with a letter and use only letters, digits, and underscores",
    "error.auth.usernameInvalid",
  ],
  ["Username must be at least 3 characters", "error.auth.usernameTooShort"],
  ["Username must be at most 32 characters", "error.auth.usernameTooLong"],
  ["This username is reserved", "error.auth.usernameReserved"],
  [
    "Username is already set and cannot be changed",
    "error.auth.usernameAlreadySet",
  ],
  ["Email is already set and cannot be changed", "error.auth.emailAlreadySet"],
  ["This email is already linked to another account", "error.auth.emailInUse"],
  ["邮箱已设置，无法修改", "error.auth.emailAlreadySet"],
  ["该邮箱已绑定其他账号", "error.auth.emailInUse"],
  ["Invalid refresh token", "error.auth.invalidRefreshToken"],
  ["Refresh token already used", "error.auth.refreshTokenUsed"],
  ["Missing bearer token", "error.auth.missingBearerToken"],
  ["Invalid token", "error.auth.invalidToken"],
  ["Missing user identity", "error.auth.missingUserIdentity"],
  ["邮箱格式不正确", "error.auth.emailInvalid"],
  ["验证码必须是 6 位数字", "error.auth.emailCodeFormatInvalid"],
  ["验证码已过期，请重新获取", "error.auth.emailCodeExpired"],
  ["验证码不正确", "error.auth.emailCodeInvalid"],
  ["验证码发送太频繁，请 60 秒后再试", "error.auth.emailCodeCooldown"],
  ["该邮箱 1 小时内验证码发送次数已达上限", "error.auth.emailCodeHourlyLimit"],
  ["Not found", "error.notFound"],
  ["任务不存在", "error.generation.notFound"],
  ["生成任务不存在", "error.generation.notFound"],
  ["生成失败", "error.generation.failed"],
  ["生成已停止", "error.generation.cancelled"],
  ["生成任务已结束", "error.generation.ended"],
  ["目标不存在", "error.goal.notFound"],
  ["Goal not found", "error.goal.notFound"],
  ["Learning goal not found", "error.goal.notFound"],
  ["学习目标不存在", "error.goal.notFound"],
  ["无权访问该目标", "error.goal.forbidden"],
  ["单元不存在", "error.goal.unitNotFound"],
  ["无权访问该单元", "error.goal.unitForbidden"],
  ["Unit not found", "error.goal.unitNotFound"],
  ["Learning unit not found", "error.goal.unitNotFound"],
  ["Section not found", "error.learning.sectionNotFound"],
  ["学习小节不存在", "error.learning.sectionNotFound"],
  [
    "Section generation stopped before completion",
    "error.learning.sectionGenerationStopped",
  ],
  ["小节生成未完成，已停止", "error.learning.sectionGenerationStopped"],
  [
    "Complete the learning section first",
    "error.learning.completeSectionFirst",
  ],
  ["请先完成学习小节", "error.learning.completeSectionFirst"],
  [
    "This section does not have an assessment checkpoint",
    "error.learning.sectionNoAssessmentCheckpoint",
  ],
  ["本小节没有测评检查点", "error.learning.sectionNoAssessmentCheckpoint"],
  [
    "Complete all learning sections in this checkpoint first",
    "error.learning.completeCheckpointSectionsFirst",
  ],
  [
    "请先完成本检查点中的全部学习小节",
    "error.learning.completeCheckpointSectionsFirst",
  ],
  ["Unit preview is not ready", "error.learning.unitPreviewNotReady"],
  ["单元预习内容尚未准备好", "error.learning.unitPreviewNotReady"],
  [
    "This section has no quiz-eligible learning targets",
    "error.learning.noQuizEligibleTargets",
  ],
  ["本小节没有可用于测验的学习目标", "error.learning.noQuizEligibleTargets"],
  [
    "Mini-test generation was superseded",
    "error.learning.miniTestLeaseSuperseded",
  ],
  ["小节测验生成已被新的任务取代", "error.learning.miniTestLeaseSuperseded"],
  [
    "Section generation was superseded",
    "error.learning.sectionGenerationLeaseSuperseded",
  ],
  [
    "小节生成已被新的任务取代",
    "error.learning.sectionGenerationLeaseSuperseded",
  ],
  [
    "Mini-tests cannot be skipped separately",
    "error.learning.miniTestSkipUnsupported",
  ],
  ["小节测验不能单独跳过", "error.learning.miniTestSkipUnsupported"],
  [
    "Complete previous sections first",
    "error.learning.completePreviousSectionsFirst",
  ],
  ["请先完成前面的小节", "error.learning.completePreviousSectionsFirst"],
  ["Section is not eligible to skip", "error.learning.sectionSkipNotEligible"],
  ["本小节当前不能跳过", "error.learning.sectionSkipNotEligible"],
  [
    "Please complete the previous learning section first",
    "error.learning.previousSectionIncomplete",
  ],
  ["请先完成上一学习小节", "error.learning.previousSectionIncomplete"],
  ["Section content is not ready", "error.learning.sectionContentNotReady"],
  ["小节内容尚未准备好", "error.learning.sectionContentNotReady"],
  ["请先完成本节测验", "error.learning.sectionQuizRequired"],
  ["请先生成学习正文", "error.learning.materialRequired"],
  ["请先生成学习内容，再生成测验", "error.learning.materialRequired"],
  ["请先生成学习内容，再生成闪卡", "error.learning.materialRequired"],
  ["请先完成学习正文", "error.learning.completeMaterialFirst"],
  ["请先完成所有必修学习小节", "error.learning.completeMaterialFirst"],
  ["请先完成本节测验", "error.learning.completeUnitFirst"],
  ["请先完成所有必修学习小节", "error.learning.completeMaterialFirst"],
  ["请先完成学习正文，再生成测验", "error.learning.materialRequired"],
  ["请先完成学习正文，再生成闪卡", "error.learning.materialRequired"],
  ["请先完成测验批改", "error.learning.completeUnitFirst"],
  ["该题无需解析", "error.learning.quizSetInvalid"],
  ["缺少有效的 questionIndex", "error.learning.invalidBlockIndex"],
  ["小节测验提交失败", "error.generation.failed"],
  ["会话错误", "error.internal"],
  ["本模块已经完成", "error.learning.completeUnitFirst"],
  ["本模块暂无可测试的关键能力", "error.learning.quizSetNotFound"],
  ["本单元暂无可测试的关键学习目标", "error.learning.quizSetNotFound"],
  [
    "本单元没有可由选择题直接评估的关键学习目标。",
    "error.learning.quizSetNotFound",
  ],
  ["本单元没有可由选择题评估的学习目标。", "error.learning.quizSetNotFound"],
  ["对话不存在", "error.agent.threadNotFound"],
  ["无效的追问上下文", "error.agent.invalidFollowUpContext"],
  ["目标创建启动失败", "error.agent.goalCreationStartFailed"],
  ["当前目标不能创建基础补充目标", "error.agent.foundationGoalUnsupported"],
  ["所选基础已不在当前课程规划中", "error.agent.foundationSelectionStale"],
  ["部分基础已有对应的补充目标", "error.agent.foundationGoalExists"],
  ["当前目标创建不需要重试", "error.agent.goalCreationRetryNotNeeded"],
  ["已完成的目标创建不能停止", "error.agent.completedGoalCreationCannotStop"],
  ["请输入 DELETE 确认删除", "error.agent.deleteConfirmRequired"],
  ["请先停止目标创建", "error.agent.stopGoalCreationFirst"],
  ["目标创建空间不存在", "error.agent.goalCreationNotFound"],
  ["无权访问此目标创建空间", "error.agent.goalCreationForbidden"],
  ["目标创建已停止，请删除草稿后新建目标", "error.agent.goalCreationStopped"],
  [
    "请从目标创建空间停止并删除此流程",
    "error.agent.deleteDedicatedThreadFromGoalCreation",
  ],
  [
    "对话状态刚才不同步了，我已经保护现场。请再提交一次当前表单或重新发送目标，我会继续处理。",
    "error.agent.stateOutOfSync",
  ],
  ["当前单元", "label.agent.currentUnit"],
  ["当前学习目标", "label.agent.currentGoal"],
  ["已清除 AI 上下文。上方消息仍保留供你查看。", "status.agent.contextCleared"],
  ["目标创建空间已准备好", "status.agent.goalCreationReady"],
  ["已按选定基础启动快速目标规划", "status.agent.foundationPlanningStarted"],
  ["已恢复之前的目标创建进度", "status.agent.goalCreationRestored"],
  ["正在重试目标创建", "status.agent.goalCreationRetrying"],
  [
    "目标创建已停止。删除此草稿后才能创建新目标。",
    "status.agent.goalCreationStopped",
  ],
  ["第一课已准备好", "status.agent.firstLessonReady"],
  ["服务器重启中断了当前步骤，请重试", "error.generation.interrupted"],
  ["本单元已经完成", "error.learning.completeUnitFirst"],
  ["请先完成所有错题修正", "error.learning.completeCorrectionsFirst"],
  ["请先输入回答", "error.learning.answerRequired"],
  ["缺少 threadId", "error.learning.threadIdRequired"],
  ["未知 action", "error.learning.invalidAction"],
  ["该对话已结束，请切换到其他错题", "error.learning.socraticEnded"],
  ["没有可继续的苏格拉底对话", "error.learning.noSocraticConversation"],
  ["小节测验内容无效", "error.learning.quizSetInvalid"],
  ["无效锚点", "error.learning.invalidBlockIndex"],
  ["所选房间不存在", "error.memory.roomNotFound"],
  ["无效的内容文风", "error.learning.invalidTone"],
  ["暂无引导问题", "error.learning.guidingQuestionsNotFound"],
  [
    "No slide narration texts provided",
    "error.learning.slideNarrationRequired",
  ],
  ["Invalid block index", "error.learning.invalidBlockIndex"],
  ["Invalid slide or block index", "error.learning.invalidSlideOrBlockIndex"],
  ["Component does not exist", "error.learning.componentMissing"],
  [
    "Component cannot be regenerated",
    "error.learning.componentRegenerateForbidden",
  ],
  ["重新生成交互组件失败", "error.learning.componentRegenerateFailed"],
  [
    "Replacing an SVG diagram with an image is only available in desktop development",
    "error.learning.svgIllustrationReplaceUnavailable",
  ],
  [
    "用图片替换 SVG 示意图仅在桌面开发环境可用",
    "error.learning.svgIllustrationReplaceUnavailable",
  ],
  [
    "Editing a content block with AI is only available in desktop development",
    "error.learning.aiBlockEditUnavailable",
  ],
  [
    "AI 修改内容块仅在桌面开发环境可用",
    "error.learning.aiBlockEditUnavailable",
  ],
  [
    "Describe how the AI should change this block first",
    "error.learning.aiBlockEditInstructionRequired",
  ],
  [
    "请先描述希望 AI 如何修改这个内容块",
    "error.learning.aiBlockEditInstructionRequired",
  ],
  [
    "This block type cannot be edited with AI",
    "error.learning.aiBlockEditUnsupported",
  ],
  ["该内容块不支持 AI 修改", "error.learning.aiBlockEditUnsupported"],
  ["Failed to edit this block with AI", "error.learning.aiBlockEditFailed"],
  ["AI 修改该内容块失败", "error.learning.aiBlockEditFailed"],
  ["卡片不存在", "error.review.cardNotFound"],
  ["无权访问该卡片", "error.review.cardForbidden"],
  ["牌组不存在", "error.review.deckNotFound"],
  ["无权访问该牌组", "error.review.deckForbidden"],
  ["闪卡不存在", "error.review.flashcardNotFound"],
  ["无权访问该闪卡", "error.review.flashcardForbidden"],
  ["正面和背面不能为空", "error.review.flashcardSidesRequired"],
  ["Invalid PDF layout", "error.media.invalidPdfLayout"],
  ["Invalid image id", "error.media.invalidImageId"],
  ["Invalid audio id", "error.media.invalidAudioId"],
  ["该目标尚无学习单元，无法导出教材", "error.media.goalNoUnitsForExport"],
  ["房间不存在", "error.memory.roomNotFound"],
  ["对话不存在", "error.agent.threadNotFound"],
  ["无权访问该对话", "error.agent.threadForbidden"],
  ["需要至少一个 file/files 和 goalId", "error.rag.filesAndGoalRequired"],
  ["需要 goalId 和 documentId", "error.rag.goalAndDocumentRequired"],
  ["资料不存在", "error.rag.documentNotFound"],
  ["需要 goalId 和至少一个 URL", "error.rag.goalAndUrlsRequired"],
  ["Insufficient credits", "error.billing.insufficientCredits"],
  [
    "Insufficient credits. Purchase more credits in the mobile app to continue using AI features.",
    "error.billing.insufficientCredits",
  ],
  ["积分不足", "error.billing.insufficientCredits"],
  ["缺少学习目标", "error.goal.missing"],
  ["学习单元不存在", "error.goal.unitNotFound"],
  ["标题不能为空", "error.goal.titleRequired"],
  ["目标标题不能为空", "error.goal.titleRequired"],
  ["分享的目标不存在", "error.goal.sharedNotFound"],
  ["无效的分享设置", "error.goal.invalidShareSettings"],
  ["轻课不支持学习地图或学习规划操作", "error.goal.microUnsupportedMap"],
  ["总览课程单元不可编辑", "error.goal.overviewUnitReadonly"],
  ["缺少单元标题", "error.goal.titleRequired"],
  ["父级学习单元不存在", "error.goal.unitNotFound"],
  ["模块不存在", "error.goal.unitNotFound"],
  ["总览课程单元不存在", "error.goal.unitNotFound"],
  ["请至少选择一个学习单元", "error.goal.unitNotFound"],
  ["尚无学习单元，请先生成学习地图", "error.goal.unitNotFound"],
  ["资料优先模式需要先上传学习资料", "error.learning.materialRequired"],
  ["课程模式功能未启用", "error.notFound"],
  ["轻课已存在", "error.generation.ended"],
  ["学习地图已存在", "error.generation.ended"],
  ["只有轻课可以直接生成课程", "error.goal.microUnsupportedMap"],
  ["微信小程序仅支持发布轻课", "error.goal.microUnsupportedMap"],
  ["设置热门推荐失败", "error.generation.failed"],
  ["审核通过失败", "error.generation.failed"],
  ["驳回失败", "error.generation.failed"],
  ["提交审核失败", "error.generation.failed"],
  [
    "积分不足，请在移动端购买积分后继续使用 AI 功能。",
    "error.billing.insufficientCredits",
  ],
  ["積分不足", "error.billing.insufficientCredits"],
  [
    "積分不足，請在行動端購買積分後繼續使用 AI 功能。",
    "error.billing.insufficientCredits",
  ],
  ["当前平台暂未开放积分购买", "error.payment.purchaseUnavailable"],
  ["未知积分商品", "error.payment.productUnknown"],
  ["服务端尚未配置积分内购", "error.billing.appleIapNotConfigured"],
  ["微信支付商户尚未配置", "error.payment.merchantNotConfigured"],
  ["订单不存在", "error.payment.orderNotFound"],
  ["支付通知验签失败", "error.payment.notificationSignatureInvalid"],
  ["支付通知内容无效", "error.payment.notificationInvalid"],
  [
    "自定义风格不能修改系统规则或绕过安全限制",
    "error.persona.unsafeInstruction",
  ],
  ["无效的教学助手", "error.persona.invalid"],
  ["无效的官方模板", "error.persona.invalidBuiltin"],
  ["教学助手不存在", "error.persona.notFound"],
  ["公开课程资源不存在", "error.publicCourse.resourceNotFound"],
] as const) {
  legacyMessageKeys.set(message, key);
}
type LocaleContextStore = { locale: BackendLocale };

const storage = new AsyncLocalStorage<LocaleContextStore>();

function normalizeLocaleTag(tag: string): BackendLocale | null {
  const normalized = tag.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return null;
  if (
    normalized === "zh-hans" ||
    normalized === "zh-cn" ||
    normalized === "zh-sg"
  ) {
    return "zh-Hans";
  }
  if (
    normalized === "zh-hant" ||
    normalized === "zh-tw" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo"
  ) {
    return "zh-Hant";
  }
  if (normalized === "zh") return "zh-Hans";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

export function resolveBackendLocale(
  acceptLanguage?: string | string[] | null,
): BackendLocale {
  const raw = Array.isArray(acceptLanguage)
    ? acceptLanguage.join(",")
    : acceptLanguage;
  if (!raw) return DEFAULT_BACKEND_LOCALE;

  const candidates = raw
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return {
        tag,
        index,
        q: Number.isFinite(q) ? q : 0,
      };
    })
    .filter((candidate) => candidate.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const candidate of candidates) {
    const locale = normalizeLocaleTag(candidate.tag);
    if (locale) return locale;
  }
  return DEFAULT_BACKEND_LOCALE;
}

export function runWithBackendLocale<T>(locale: BackendLocale, fn: () => T): T {
  return storage.run({ locale }, fn);
}

export function getCurrentLocale(): BackendLocale {
  return storage.getStore()?.locale ?? DEFAULT_BACKEND_LOCALE;
}

function interpolate(
  message: string,
  params?: BackendTranslationParams,
): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function tBackend(
  key: BackendTranslationKey,
  params?: BackendTranslationParams,
): string {
  return interpolate(dictionaries[getCurrentLocale()][key] ?? en[key], params);
}

function localizeDynamicStatus(message: string): string | null {
  let match = /^正在(?:处理|處理)资料（(\d+)\/(\d+)）：(.+)…$/u.exec(message);
  if (match) {
    return tBackend("status.generation.processingMaterial", {
      current: match[1]!,
      total: match[2]!,
      filename: match[3]!,
    });
  }

  match = /^正在解析《(.+)》…$/u.exec(message);
  if (match) {
    return tBackend("status.generation.parsingMaterial", {
      filename: match[1]!,
    });
  }

  match = /^正在(?:写入|寫入)来源《(.+)》…$/u.exec(message);
  if (match) {
    return tBackend("status.generation.writingSource", {
      title: match[1]!,
    });
  }

  match = /^正在生成向量嵌入（(\d+)\/(\d+) 批，共 (\d+) 段）…$/u.exec(message);
  if (match) {
    return tBackend("status.generation.embeddingBatch", {
      batch: match[1]!,
      total: match[2]!,
      count: match[3]!,
    });
  }

  match = /^正在生成向量嵌入（(\d+) 段）…$/u.exec(message);
  if (match) {
    return tBackend("status.generation.embedding", { count: match[1]! });
  }

  match = /^生成配(?:图|圖) (\d+)\/(\d+)：(.+)$/u.exec(message);
  if (match) {
    const label =
      match[3] === "俯视图" || match[3] === "俯視圖"
        ? tBackend("label.memoryImage.topdown")
        : match[3] === "全景图" || match[3] === "全景圖"
          ? tBackend("label.memoryImage.perspective")
          : match[3] === "细节图" || match[3] === "細節圖"
            ? tBackend("label.memoryImage.detail")
            : match[3]!;
    return tBackend("status.generation.memoryImageProgress", {
      current: match[1]!,
      total: match[2]!,
      label,
    });
  }

  match = /^已从 (\d+) 个学习资料来源检索到规划依据…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.summarySourcesRag", { count: match[1]! });
  }
  match = /^已从 (\d+) 个网络来源检索到规划依据…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.summarySourcesSearch", { count: match[1]! });
  }
  match = /^已检索 (\d+) 个学习资料来源，正在生成学习地图…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.mapSourcesRag", { count: match[1]! });
  }
  match = /^已检索 (\d+) 个网络来源，正在生成学习地图…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.mapSourcesSearch", { count: match[1]! });
  }

  match = /^已從 (\d+) 個學習資料來源檢索到規劃依據…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.summarySourcesRag", { count: match[1]! });
  }
  match = /^已從 (\d+) 個網路來源檢索到規劃依據…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.summarySourcesSearch", { count: match[1]! });
  }
  match = /^已檢索 (\d+) 個學習資料來源，正在生成學習地圖…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.mapSourcesRag", { count: match[1]! });
  }
  match = /^已檢索 (\d+) 個網路來源，正在生成學習地圖…$/u.exec(message);
  if (match) {
    return tBackend("status.goal.mapSourcesSearch", { count: match[1]! });
  }

  return null;
}

export function localizeBackendMessage(message: string): string {
  const key = legacyMessageKeys.get(message);
  if (key) return tBackend(key);
  const dynamic = localizeDynamicStatus(message);
  if (dynamic) return dynamic;
  // Never leak a Simplified/Traditional Chinese fallback into an English API
  // response. Unknown messages stay unchanged for Chinese locales so operators
  // can still see the original domain detail while the remaining call site is
  // migrated to a typed key.
  if (getCurrentLocale() === "en" && /[\u3400-\u9fff]/u.test(message)) {
    return tBackend("error.unknown");
  }
  return message;
}

export function localizeBackendPayload<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  if (!("message" in payload) || typeof payload.message !== "string")
    return payload;
  return {
    ...payload,
    message: localizeBackendMessage(payload.message),
  };
}

type RequestWithHeaders = {
  headers?: Record<string, string | string[] | undefined>;
};

@Injectable()
export class LocaleContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const locale = resolveBackendLocale(request?.headers?.["accept-language"]);
    return new Observable((subscriber) => {
      runWithBackendLocale(locale, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}

export function configureLocaleContext(app: INestApplication): void {
  app.use((req: RequestWithHeaders, _res: unknown, next: () => void) => {
    const locale = resolveBackendLocale(req?.headers?.["accept-language"]);
    runWithBackendLocale(locale, next);
  });
  app.useGlobalInterceptors(new LocaleContextInterceptor());
}
