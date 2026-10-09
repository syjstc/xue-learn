import { validateMusicTeaching, type MaterialMusicTeaching } from "./material-music-teaching.js";
/** Portable music authoring and performance contract. No DOM, audio or model dependency. */
export const MUSIC_INSTRUMENTS = [
  "piano",
  "electric_piano",
  "guitar",
  "violin",
  "cello",
  "flute",
  "marimba",
  "organ",
] as const;
export type MusicDuration = (typeof MUSIC_DURATIONS)[number];
export type MusicInstrument = (typeof MUSIC_INSTRUMENTS)[number];
export const MUSIC_DURATIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
export type MusicPitch = {
  step: string;
  alter: number;
  octave: number;
  midi: number;
};
export type MusicSelection = {
  bars: number[];
  parts: string[];
  instruments?: Array<{ part: string; instrument: MusicInstrument }>;
};
export type MusicStep = MusicSelection & {
  id: string;
  label: string;
  focus?: string[];
  compare?: MusicSelection & { label: string };
};
export type MaterialMusic = {
  type: "music";
  id?: string;
  version: 1;
  title: string;
  key: "C";
  meter: "2/4" | "3/4" | "4/4";
  tempo: number;
  keyboard: boolean;
  notation?: "staff" | "jianpu" | "both";
  parts: Array<{
    id: string;
    label: string;
    clef: "treble" | "bass";
    instrument?: MusicInstrument;
    bars: Array<{ notes: Array<{ pitches: string[]; beats: MusicDuration }> }>;
  }>;
  steps: MusicStep[];
};
export type MusicNote = {
  id: string;
  eventId: string;
  partId: string;
  pitch: MusicPitch;
  at: number;
  duration: number;
  velocity: number;
};
export type MusicEvent = {
  id: string;
  partId: string;
  bar: number;
  at: number;
  duration: number;
  notes: MusicNote[];
};
export type MusicPlan = {
  source: MaterialMusic;
  barBeats: number;
  barCount: number;
  totalBeats: number;
  events: MusicEvent[];
  notes: MusicNote[];
};
export function parseMusicPitch(name: string): MusicPitch {
  const match = /^([A-G])([#b]?)([0-8])$/.exec(name);
  if (!match) throw Error(`Unsupported pitch ${name}; use C4, F#4 or Bb3`);
  const step = match[1]!,
    octave = Number(match[3]),
    alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const midi =
    12 * (octave + 1) +
    ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[
      step
    ]! +
    alter;
  if (midi < 21 || midi > 108) throw Error("Music pitch must be within A0–C8");
  return { step, alter, octave, midi };
}
function nonEmpty(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}
export function compileMaterialMusic(source: MaterialMusic): MusicPlan {
  if (
    !source ||
    source.type !== "music" ||
    source.version !== 1 ||
    source.key !== "C" ||
    !["2/4", "3/4", "4/4"].includes(source.meter)
  )
    throw Error("Music v1 supports C major and 2/4, 3/4 or 4/4");
  if (
    !nonEmpty(source.title, 100) ||
    !Number.isFinite(source.tempo) ||
    source.tempo < 40 ||
    source.tempo > 180 ||
    typeof source.keyboard !== "boolean"
  )
    throw Error(
      "Music needs title, tempo 40–180 and an explicit keyboard choice",
    );
  if (
    source.notation != null &&
    !["staff", "jianpu", "both"].includes(source.notation)
  )
    throw Error("Unsupported music notation");
  if (
    !Array.isArray(source.parts) ||
    source.parts.length < 1 ||
    source.parts.length > 3
  )
    throw Error("Music needs 1–3 parts");
  const barBeats = Number(source.meter[0]),
    barCount = source.parts[0]?.bars?.length ?? 0;
  if (barCount < 1 || barCount > 16)
    throw Error("Music needs 1–16 bars per part");
  const ids = new Set<string>(),
    events: MusicEvent[] = [],
    notes: MusicNote[] = [];
  for (const [partIndex, part] of source.parts.entries()) {
    if (
      !/^[a-z][a-z0-9_-]{0,30}$/.test(part.id) ||
      ids.has(part.id) ||
      !nonEmpty(part.label, 40)
    )
      throw Error("Music part ids must be unique with nonempty labels");
    ids.add(part.id);
    if (
      !["treble", "bass"].includes(part.clef) ||
      !MUSIC_INSTRUMENTS.includes(part.instrument ?? "piano")
    )
      throw Error("Unsupported clef or instrument");
    if (!Array.isArray(part.bars) || part.bars.length !== barCount)
      throw Error("Music parts must have the same number of bars");
    for (const [barIndex, bar] of part.bars.entries()) {
      if (
        !Array.isArray(bar.notes) ||
        bar.notes.length < 1 ||
        bar.notes.length > 16
      )
        throw Error("Use 1–16 events per bar, including explicit rests");
      let offset = 0;
      for (const [eventIndex, event] of bar.notes.entries()) {
        if (
          !MUSIC_DURATIONS.includes(
            event.beats as (typeof MUSIC_DURATIONS)[number],
          ) ||
          !Array.isArray(event.pitches) ||
          event.pitches.length > 4 ||
          new Set(event.pitches).size !== event.pitches.length
        )
          throw Error(
            "Unsupported rhythm or chord; use at most four distinct pitches",
          );
        const id = `${part.id}:${barIndex + 1}.${eventIndex + 1}`,
          at = barIndex * barBeats + offset;
        const eventNotes = event.pitches.map((name, index): MusicNote => ({
          id: `${id}.${index + 1}`,
          eventId: id,
          partId: part.id,
          pitch: parseMusicPitch(name),
          at,
          duration: event.beats,
          velocity: partIndex === 0 ? 0.75 : 0.25,
        }));
        if (
          new Set(eventNotes.map((note) => note.pitch.midi)).size !==
          eventNotes.length
        )
          throw Error("A chord cannot duplicate an enharmonic pitch");
        events.push({
          id,
          partId: part.id,
          bar: barIndex + 1,
          at,
          duration: event.beats,
          notes: eventNotes,
        });
        notes.push(...eventNotes);
        offset += event.beats;
      }
      if (offset !== barBeats)
        throw Error(
          `${part.id} bar ${barIndex + 1}: expected ${barBeats} beats, received ${offset}`,
        );
    }
  }
  if (notes.length > 1536) throw Error("Music exceeds the 1536-note limit");
  const plan: MusicPlan = {
    source,
    barBeats,
    barCount,
    totalBeats: barBeats * barCount,
    events,
    notes,
  };
  if (
    !Array.isArray(source.steps) ||
    source.steps.length < 1 ||
    source.steps.length > 8
  )
    throw Error("Music needs 1–8 teaching steps");
  for (const step of source.steps) {
    if (
      !/^[a-z][a-z0-9_-]{0,30}$/.test(step.id) ||
      ids.has(step.id) ||
      [source.id, "whole", "display"].includes(step.id) ||
      !nonEmpty(step.label, 60)
    )
      throw Error(
        "Music step ids must be unique and distinct from part/display ids",
      );
    ids.add(step.id);
    validateMusicSelection(plan, step);
    if (step.compare) {
      validateMusicSelection(plan, step.compare);
      if (
        !nonEmpty(step.compare.label, 60) ||
        step.compare.bars[1]! - step.compare.bars[0]! !==
          step.bars[1]! - step.bars[0]!
      )
        throw Error("Music comparisons need a label and equally long ranges");
      const effective = (selection: MusicSelection) =>
        selection.parts
          .slice()
          .sort()
          .map(
            (part) =>
              `${part}:${selection.instruments?.find((item) => item.part === part)?.instrument ?? source.parts.find((item) => item.id === part)!.instrument ?? "piano"}`,
          )
          .join("|");
      if (
        step.bars.join() === step.compare.bars.join() &&
        effective(step) === effective(step.compare)
      )
        throw Error(
          "Music comparison selects exactly the same sound; choose a different passage, part or instrument (reverse playback is not supported)",
        );
    }
    if (
      step.focus != null &&
      (!Array.isArray(step.focus) ||
        step.focus.length > 16 ||
        new Set(step.focus).size !== step.focus.length)
    )
      throw Error("Music focus needs at most 16 distinct event refs");
    for (const ref of step.focus ?? []) {
      const event = events.find((item) => item.id === ref);
      if (
        !event ||
        !step.parts.includes(event.partId) ||
        event.bar < step.bars[0]! ||
        event.bar > step.bars[1]!
      )
        throw Error(`Unknown or out-of-range music focus ${ref}`);
    }
  }
  return plan;
}
export function validateMusicSelection(
  plan: MusicPlan,
  value: MusicSelection,
): void {
  if (
    !Array.isArray(value.bars) ||
    value.bars.length !== 2 ||
    !value.bars.every(Number.isInteger) ||
    value.bars[0]! < 1 ||
    value.bars[1]! < value.bars[0]! ||
    value.bars[1]! > plan.barCount
  )
    throw Error("Invalid music bar range (one-based, inclusive)");
  if (
    !Array.isArray(value.parts) ||
    value.parts.length < 1 ||
    new Set(value.parts).size !== value.parts.length ||
    value.parts.some((id) => !plan.source.parts.some((part) => part.id === id))
  )
    throw Error("Unknown or duplicate music part selection");
  const overrides = value.instruments ?? [];
  if (
    !Array.isArray(overrides) ||
    overrides.length > 3 ||
    new Set(overrides.map((item) => item.part)).size !== overrides.length
  )
    throw Error("Duplicate music instrument override");
  for (const { part, instrument } of overrides)
    if (!value.parts.includes(part) || !MUSIC_INSTRUMENTS.includes(instrument))
      throw Error("Invalid music instrument override");
}
export function musicPerformance(
  plan: MusicPlan,
  selection: MusicSelection,
  speed = 1,
) {
  validateMusicSelection(plan, selection);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 1.5)
    throw Error("Music speed must be 0.5–1.5");
  const from = (selection.bars[0]! - 1) * plan.barBeats,
    to = selection.bars[1]! * plan.barBeats,
    secondsPerBeat = 60 / (plan.source.tempo * speed);
  return {
    from,
    to,
    secondsPerBeat,
    duration: (to - from) * secondsPerBeat,
    notes: plan.notes
      .filter(
        (note) =>
          selection.parts.includes(note.partId) &&
          note.at >= from &&
          note.at < to,
      )
      .map((note) => ({
        ...note,
        velocity: selection.parts.length === 1 ? 0.65 : note.velocity,
        start: (note.at - from) * secondsPerBeat,
        end: (note.at + note.duration - from) * secondsPerBeat,
        instrument:
          selection.instruments?.find((item) => item.part === note.partId)
            ?.instrument ??
          plan.source.parts.find((part) => part.id === note.partId)!
            .instrument ??
          "piano",
      })),
  };
}
export function musicFrame(
  plan: MusicPlan,
  selection: MusicSelection,
  beat: number,
) {
  const from = (selection.bars[0]! - 1) * plan.barBeats,
    to = selection.bars[1]! * plan.barBeats;
  return {
    bar: Math.min(
      plan.barCount,
      Math.floor(Math.max(0, beat) / plan.barBeats) + 1,
    ),
    notes: plan.notes.filter(
      (note) =>
        beat >= from &&
        beat < to &&
        selection.parts.includes(note.partId) &&
        beat >= note.at &&
        beat < note.at + note.duration,
    ),
  };
}
export function readMaterialMusic(value: unknown): MaterialMusic | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { type?: unknown }).type !== "music"
  )
    return null;
  try {
    compileMaterialMusic(value as MaterialMusic);
    return value as MaterialMusic;
  } catch {
    return null;
  }
}
export function materialMusicTreeIssues(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const block = value as { type?: string; figures?: unknown[] };
  if (block.type === "stage") {
    const issues = (block.figures ?? []).flatMap(materialMusicTreeIssues);
    if (!(block.figures ?? []).some(f => (f as { type?: string })?.type === "music")) return issues;
    const ids = new Set<string>();
    for (const figure of block.figures ?? []) {
      const item = figure as Partial<MaterialMusicTeaching>;
      const objects = item.type === "music" && item.version === 2 ? [item, ...(item.notes ?? []), ...(item.views ?? []), ...(item.marks ?? []), ...(item.clips ?? [])] : [item];
      for (const object of objects) if (object.id) { if (ids.has(object.id)) issues.push(`Ambiguous music target in stage: ${object.id}`); ids.add(object.id); }
    }
    return issues;
  }
  if (block.type !== "music") return [];
  try {
    if ((value as { version?: number }).version === 2) validateMusicTeaching(value as MaterialMusicTeaching);
    else compileMaterialMusic(value as MaterialMusic);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Invalid music score"];
  }
}
export const musicStepTarget = (figureId: string, stepId: string) =>
  `music:${figureId || "display"}:${stepId}`;
