import { z } from "zod";
import { learningPositionSchema } from "../learning-trajectory/contracts.js";
const id = z.string().min(1).max(160);
export const mainlineCommandSchema = z
  .object({
    commandId: z.string().uuid(),
    sessionId: id,
    expectedRevision: z.number().int().min(0),
    action: z.enum([
      "start",
      "resume",
      "position",
      "pause",
      "return",
      "preference",
      "shown",
      "later",
      "today",
    ]),
    activityId: id.optional(),
    activityRevision: z.number().int().min(0).optional(),
    goalId: id.optional(),
    unitId: id.optional(),
    kind: z.enum(["lesson", "supplement", "review"]).optional(),
    branchId: id.optional(),
    position: learningPositionSchema.optional(),
    preference: z
      .object({
        newLearning: z.enum(["active", "paused"]),
        reviews: z.boolean(),
        priority: z.number().int().min(0).max(10),
        revision: z.number().int().min(0),
      })
      .strict()
      .optional(),
    timeLimitMinutes: z.number().int().min(1).max(1440).optional(),
    reviewSource: z.enum(["course", "flashcards"]).optional(),
    candidateId: id.optional(),
    snapshotVersion: z.string().max(100).optional(),
    timezone: z
      .string()
      .max(80)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .strict();
