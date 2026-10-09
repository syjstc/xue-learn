import { z } from "zod";
import { MUSIC_INSTRUMENTS } from "../../../domain/src/index.js";
import { materialMusicTeachingBindingSchema } from "../../../domain/src/material-music-teaching-schema.js";
export { materialMusicTeachingBindingSchema } from "../../../domain/src/material-music-teaching-schema.js";

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,30}$/);
const selection = z
  .object({
    bars: z.array(z.number().int().min(1).max(16)).length(2),
    parts: z.array(id).min(1).max(3),
    instruments: z
      .array(
        z.object({ part: id, instrument: z.enum(MUSIC_INSTRUMENTS) }).strict(),
      )
      .max(3)
      .optional(),
  })
  .strict();

/** Shape-only provider binding. Shared domain validation checks rhythm and references. */
const materialMusicV1BindingSchema = z
  .object({
    type: z.literal("music"),
    id: z.string().trim().min(1).optional(),
    version: z.literal(1),
    title: z.string().trim().min(1).max(100),
    key: z.literal("C"),
    meter: z.enum(["2/4", "3/4", "4/4"]),
    tempo: z.number().min(40).max(180),
    keyboard: z.boolean(),
    notation: z.enum(["staff", "jianpu", "both"]).optional(),
    parts: z
      .array(
        z
          .object({
            id,
            label: z.string().trim().min(1).max(40),
            clef: z.enum(["treble", "bass"]),
            instrument: z.enum(MUSIC_INSTRUMENTS).optional(),
            bars: z
              .array(
                z
                  .object({
                    notes: z
                      .array(
                        z
                          .object({
                            pitches: z
                              .array(z.string().regex(/^[A-G][#b]?[0-8]$/))
                              .max(4),
                            beats: z.union([
                              z.literal(0.25),
                              z.literal(0.5),
                              z.literal(0.75),
                              z.literal(1),
                              z.literal(1.5),
                              z.literal(2),
                              z.literal(3),
                              z.literal(4),
                            ]),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(16),
                  })
                  .strict(),
              )
              .min(1)
              .max(16),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    steps: z
      .array(
        selection.extend({
          id,
          label: z.string().trim().min(1).max(60),
          focus: z.array(z.string().min(1)).max(16).optional(),
          compare: selection
            .extend({ label: z.string().trim().min(1).max(60) })
            .optional(),
        }),
      )
      .min(1)
      .max(8),
  })
  .strict();

const teachingId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const musicCueActionSchema = z
  .object({
    figureId: teachingId,
    clipId: teachingId,
    repeat: z.number().int().min(1).max(4).optional(),
  })
  .strict();
export const materialMusicBindingSchema = z.discriminatedUnion("version", [
  materialMusicV1BindingSchema,
  materialMusicTeachingBindingSchema,
]);
