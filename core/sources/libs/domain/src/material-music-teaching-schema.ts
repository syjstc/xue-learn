import { z } from "zod";
import { MUSIC_INSTRUMENTS } from "./material-music.js";

const teachingId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const pitch = z.string().regex(/^[A-G][#b]?[0-8]$/);
const beats = z.union([
  z.literal(0.25),
  z.literal(0.5),
  z.literal(0.75),
  z.literal(1),
  z.literal(1.5),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
// Provider authoring normalizes prose; accepted-source parsing must retain it.
function musicTeachingShape(normalizeText: boolean) {
  const text = (max: number) => normalizeText
    ? z.string().trim().min(1).max(max)
    : z.string().min(1).max(max).regex(/\S/);
  return z
  .object({
    type: z.literal("music"),
    version: z.literal(2),
    id: teachingId,
    title: text(100),
    layout: z.enum(["row", "column", "grid"]),
    notes: z
      .array(
        z
          .object({
            id: teachingId,
            pitches: z.array(pitch).max(4),
            beats: beats.optional().describe("Notated duration in quarter-note beats. When present, every clip event referencing this note must use exactly the same beats; use distinct note IDs for different notated durations. Omit only for pitch-only concepts, never to hide a rhythm mismatch."),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    views: z
      .array(
        z
          .object({
            id: teachingId,
            kind: z.enum(["staff", "keyboard"]),
            label: text(60),
            notes: z.array(teachingId).min(1).max(32),
            clef: z.enum(["treble", "bass"]).optional(),
            range: z.array(pitch).length(2).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    marks: z
      .array(
        z
          .object({
            id: teachingId,
            kind: z.enum(["label", "bracket", "arrow", "link"]),
            label: text(60),
            anchors: z
              .array(
                z
                  .object({ viewId: teachingId, noteId: teachingId.optional() })
                  .strict(),
              )
              .min(1)
              .max(2),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    clips: z
      .array(
        z
          .object({
            id: teachingId,
            label: text(60),
            tempo: z.number().min(40).max(180),
            instrument: z.enum(MUSIC_INSTRUMENTS).optional(),
            events: z
              .array(
                z.object({ notes: z.array(teachingId).max(4), beats: beats.describe("Playback duration in quarter-note beats, equal to every referenced note's explicit beats. All notes in an event start and end together; sequential events cannot sustain one note across later events.") }).strict(),
              )
              .min(1)
              .max(64),
          })
          .strict(),
      )
      .max(12)
      .optional(),
  })
  .strict();
}

/** Shared strict shape for music authoring; semantic validation stays in the domain. */
export const materialMusicTeachingBindingSchema = musicTeachingShape(true);
/** The same bounded source protocol, preserving every accepted string exactly. */
export const materialMusicTeachingSourceSchema = musicTeachingShape(false);
