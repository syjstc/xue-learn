import {
  MUSIC_DURATIONS,
  MUSIC_INSTRUMENTS,
  parseMusicPitch,
  readMaterialMusic,
  compileMaterialMusic,
  musicPerformance,
  type MusicDuration,
  type MusicInstrument,
} from "./material-music.js";
import type { MusicPerformancePlan as TimelineMusicInput } from "./music-playback.js";

export type MusicTeachingNote = {
  id: string;
  pitches: string[];
  beats?: MusicDuration;
};
export type MusicTeachingView = {
  id: string;
  kind: "staff" | "keyboard";
  label: string;
  notes: string[];
  clef?: "treble" | "bass";
  range?: string[];
};
export type MusicTeachingAnchor = { viewId: string; noteId?: string };
export type MusicTeachingMark = {
  id: string;
  kind: "label" | "bracket" | "arrow" | "link";
  label: string;
  anchors: MusicTeachingAnchor[];
};
export type MusicTeachingClip = {
  id: string;
  label: string;
  tempo: number;
  instrument?: MusicInstrument;
  events: Array<{ notes: string[]; beats: MusicDuration }>;
};
/** Unmetered teaching objects share pitch facts across independently composed views. */
export type MaterialMusicTeaching = {
  type: "music";
  version: 2;
  id: string;
  title: string;
  layout: "row" | "column" | "grid";
  notes: MusicTeachingNote[];
  views: MusicTeachingView[];
  marks?: MusicTeachingMark[];
  clips?: MusicTeachingClip[];
};
export type MusicCueAction = {
  figureId: string;
  clipId: string;
  repeat?: number;
};

/** Shared conversion for music templates in native teaching displays and legacy
 * films. Kept beside the score compiler to avoid a schema/module cycle. */
export function readTeachingTemplateMusicBlock(value: unknown): MaterialMusicTeaching | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as {templateId?: string; content?: unknown};
  if (source.templateId !== "music-score" && source.templateId !== "music-harmony") return undefined;
  if (!source.content || typeof source.content !== "object") throw Error("Music template needs typed score facts");
  const raw = source.content as Record<string, unknown>;
  if (raw.source === "accepted-v2") {
    const accepted = readMusicTeaching(raw.block);
    if (!accepted) throw Error("Invalid accepted music teaching score");
    return accepted;
  }
  const content = raw as unknown as {id: string; title: string; groups: string[][]; labels: string[]; beats: 1 | 2; range: [string, string]; tempo?: number};
  if (typeof content.id !== "string" || !/^[a-z][a-z0-9_-]{0,23}$/.test(content.id)
    || typeof content.title !== "string" || !content.title.trim() || content.title.length > 60
    || !Array.isArray(content.groups) || content.groups.length < 1 || content.groups.length > 8
    || content.groups.some(group => !Array.isArray(group) || group.length < (source.templateId === "music-harmony" ? 2 : 1) || group.length > (source.templateId === "music-score" ? 1 : 4) || group.some(pitch => typeof pitch !== "string"))
    || !Array.isArray(content.labels) || content.labels.length > content.groups.length || content.labels.some(label => typeof label !== "string" || !label.trim() || label.length > 12)
    || ![1, 2].includes(content.beats) || !Array.isArray(content.range) || content.range.length !== 2
    || content.tempo !== undefined && (!Number.isFinite(content.tempo) || content.tempo < 45 || content.tempo > 160))
    throw Error("Invalid musical template facts");
  const notes = content.groups.map((pitches, index) => ({id: `note-${index}`, pitches, beats: content.beats}));
  const block: MaterialMusicTeaching = {
    type: "music", version: 2, id: `template-${content.id}`, title: content.title, layout: "column", notes,
    views: [{id: "staff", kind: "staff", label: "谱面与琴键共享音符", notes: notes.map(note => note.id), clef: "treble"},
      {id: "keyboard", kind: "keyboard", label: "实际发声音高", notes: notes.map(note => note.id), range: content.range}],
    marks: content.labels.map((label, index) => ({id: `label-${index}`, kind: "label", label, anchors: [{viewId: "staff", noteId: notes[index]!.id}]})),
    clips: [{id: "phrase", label: content.title, tempo: content.tempo ?? 60, instrument: "piano", events: notes.map(note => ({notes: [note.id], beats: content.beats}))}],
  };
  validateMusicTeaching(block);
  return block;
}
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{0,39}$/.test(value);
const label = (value: unknown, max = 100) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

export function validateMusicTeaching(source: MaterialMusicTeaching): void {
  if (
    !source ||
    source.type !== "music" ||
    source.version !== 2 ||
    !validId(source.id) ||
    !label(source.title) ||
    !["row", "column", "grid"].includes(source.layout)
  )
    throw Error("Invalid music teaching display");
  if (
    !Array.isArray(source.notes) ||
    source.notes.length < 1 ||
    source.notes.length > 64 ||
    !Array.isArray(source.views) ||
    source.views.length < 1 ||
    source.views.length > 6
  )
    throw Error("Music teaching needs 1–64 note objects and 1–6 views");
  const ids = new Set([source.id, "whole", "display"]);
  const add = (id: string) => {
    if (!validId(id) || ids.has(id))
      throw Error(`Duplicate or invalid music object id: ${id}`);
    ids.add(id);
  };
  source.notes.forEach((note) => {
    add(note.id);
    if (
      !Array.isArray(note.pitches) ||
      note.pitches.length > 4 ||
      !unique(note.pitches) ||
      (note.beats != null && !MUSIC_DURATIONS.includes(note.beats))
    )
      throw Error(`Invalid music note ${note.id}`);
    const midi = note.pitches.map((pitch) => parseMusicPitch(pitch).midi);
    if (new Set(midi).size !== midi.length)
      throw Error("A chord cannot duplicate enharmonic pitches");
  });
  const notes = new Map(source.notes.map((note) => [note.id, note]));
  source.views.forEach((view) => {
    add(view.id);
    if (
      !["staff", "keyboard"].includes(view.kind) ||
      !label(view.label, 60) ||
      !Array.isArray(view.notes) ||
      view.notes.length < 1 ||
      view.notes.length > 32 ||
      !unique(view.notes) ||
      view.notes.some((id) => !notes.has(id))
    )
      throw Error(`Invalid music view ${view.id}`);
    if (view.kind === "staff") {
      if (
        !["treble", "bass"].includes(view.clef ?? "treble") ||
        view.range != null
      )
        throw Error("Staff views need a clef, not a keyboard range");
    } else {
      if (view.clef != null) throw Error("Keyboard views do not use clefs");
      if (view.notes.some((id) => notes.get(id)!.pitches.length === 0))
        throw Error("Keyboard views cannot anchor a rest to a key");
      if (view.range != null) {
        if (!Array.isArray(view.range) || view.range.length !== 2)
          throw Error("Keyboard range needs two pitches");
        const [low, high] = view.range.map((p) => parseMusicPitch(p).midi);
        if (
          low! >= high! ||
          [1, 3, 6, 8, 10].includes(low! % 12) ||
          [1, 3, 6, 8, 10].includes(high! % 12)
        )
          throw Error("Keyboard ranges must start and end on white keys");
        if (
          view.notes.some((id) =>
            notes.get(id)!.pitches.some((p) => {
              const m = parseMusicPitch(p).midi;
              return m < low! || m > high!;
            }),
          )
        )
          throw Error("Keyboard range omits a referenced note");
      }
    }
  });
  if (
    source.marks != null &&
    (!Array.isArray(source.marks) || source.marks.length > 16)
  )
    throw Error("Use at most 16 music marks");
  for (const mark of source.marks ?? []) {
    add(mark.id);
    if (
      !["label", "bracket", "arrow", "link"].includes(mark.kind) ||
      !label(mark.label, 60) ||
      !Array.isArray(mark.anchors) ||
      mark.anchors.length !== (mark.kind === "label" ? 1 : 2)
    )
      throw Error(`Invalid music mark ${mark.id}`);
    for (const anchor of mark.anchors) {
      const view = source.views.find((v) => v.id === anchor.viewId);
      if (
        !view ||
        (anchor.noteId != null && !view.notes.includes(anchor.noteId))
      )
        throw Error(`Unknown music mark anchor in ${mark.id}`);
    }
    if (
      mark.anchors.length === 2 &&
      JSON.stringify(mark.anchors[0]) === JSON.stringify(mark.anchors[1])
    )
      throw Error("Music marks need distinct endpoints");
  }
  if (
    source.clips != null &&
    (!Array.isArray(source.clips) || source.clips.length > 12)
  )
    throw Error("Use at most 12 music clips");
  for (const clip of source.clips ?? []) {
    add(clip.id);
    if (
      !label(clip.label, 60) ||
      !Number.isFinite(clip.tempo) ||
      clip.tempo < 40 ||
      clip.tempo > 180 ||
      !MUSIC_INSTRUMENTS.includes(clip.instrument ?? "piano") ||
      !Array.isArray(clip.events) ||
      clip.events.length < 1 ||
      clip.events.length > 64
    )
      throw Error(`Invalid music clip ${clip.id}`);
    let sounding = false;
    for (const [eventIndex, event] of clip.events.entries()) {
      if (
        !MUSIC_DURATIONS.includes(event.beats) ||
        !Array.isArray(event.notes) ||
        event.notes.length > 4 ||
        !unique(event.notes) ||
        event.notes.some((id) => !notes.has(id))
      )
        throw Error(`Invalid event in ${clip.id}`);
      const pitches = event.notes
        .flatMap((id) => notes.get(id)!.pitches)
        .map((p) => parseMusicPitch(p).midi);
      const mismatchedNotes = event.notes.filter(
        (id) => notes.get(id)!.beats != null && notes.get(id)!.beats !== event.beats,
      );
      if (mismatchedNotes.length)
        throw Error(
          `Playback duration must match an explicitly notated duration: music figure ${source.id}, clip ${clip.id}, events[${eventIndex}] has beats=${event.beats}, but ${mismatchedNotes.map(id => `note ${id} has beats=${notes.get(id)!.beats}`).join(", ")}. ` +
          "Every note in one V2 event starts and ends together; events are sequential, so a sustained bass cannot overlap later melody events. Author consistent note/event durations and narration; use separate note IDs for different notated durations. Do not remove notation or playback cues to bypass this check.",
        );
      if (pitches.length > 8 || new Set(pitches).size !== pitches.length)
        throw Error(
          "A music event must have at most 8 distinct sounding pitches",
        );
      sounding ||= pitches.length > 0;
    }
    if (!sounding) throw Error("A music clip must contain sound");
    if (
      (clip.events.reduce((sum, e) => sum + e.beats, 0) * 60) / clip.tempo >
      120
    )
      throw Error("Music clips must be at most 120 seconds");
  }
}

export function readMusicTeaching(
  value: unknown,
): MaterialMusicTeaching | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as MaterialMusicTeaching).version !== 2
  )
    return null;
  try {
    validateMusicTeaching(value as MaterialMusicTeaching);
    return value as MaterialMusicTeaching;
  } catch {
    return null;
  }
}

export function compileMusicTeachingClip(
  source: MaterialMusicTeaching,
  clipId: string,
  repeat = 1,
): TimelineMusicInput {
  validateMusicTeaching(source);
  const clip = source.clips?.find((c) => c.id === clipId);
  if (!clip) throw Error(`Unknown music clip ${clipId}`);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 4)
    throw Error("Music repeat must be 1–4");
  const notes: TimelineMusicInput["notes"][number][] = [];
  let beats = 0;
  for (let pass = 0; pass < repeat; pass++)
    for (const event of clip.events) {
      const startTick = Math.round(((beats * 60) / clip.tempo) * 48_000);
      const endTick = Math.round(
        (((beats + event.beats) * 60) / clip.tempo) * 48_000,
      );
      for (const id of event.notes)
        for (const pitch of source.notes.find((n) => n.id === id)!.pitches)
          notes.push({
            targetId: id,
            midi: parseMusicPitch(pitch).midi,
            instrument: clip.instrument ?? "piano",
            startTick,
            durationTicks: endTick - startTick,
            velocity: 0.6,
          });
      beats += event.beats;
    }
  return {
    figureId: source.id,
    clipId,
    label: clip.label,
    durationTicks: Math.round(((beats * 60) / clip.tempo) * 48_000),
    notes,
  };
}

/** Resolve against the actual board, never a label, future topic or external score. */
export function resolveMusicCue(
  display: unknown,
  raw: unknown,
): TimelineMusicInput | undefined {
  if (raw == null) return undefined;
  const action = raw as MusicCueAction;
  if (
    !action ||
    typeof action !== "object" ||
    (typeof action.figureId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(action.figureId)) ||
    !validId(action.clipId)
  )
    throw Error("Music action needs figureId and clipId");
  const board = display as { type?: string; figures?: unknown[] } | undefined;
  const figures = board?.type === "stage" ? (board.figures ?? []) : [display];
  const source = figures.find(
    (f) => (f as { id?: string })?.id === action.figureId,
  );
  // A recognized V2 figure must surface its actual validation failure. The
  // tolerant reader returns null for invalid scores and used to turn duration
  // conflicts into misleading "missing figure" errors on every playback cue.
  if ((source as Partial<MaterialMusicTeaching>)?.type === "music" && (source as Partial<MaterialMusicTeaching>).version === 2)
    return compileMusicTeachingClip(source as MaterialMusicTeaching, action.clipId, action.repeat ?? 1);
  if ((source as {type?: string; version?: number})?.type === "teaching" && (source as {version?: number}).version === 1) {
    const teaching = readTeachingTemplateMusicBlock(source);
    if (teaching) return {...compileMusicTeachingClip(teaching, action.clipId, action.repeat ?? 1), figureId: action.figureId};
  }
  const score = readMaterialMusic(source), repeat = action.repeat ?? 1;
  if (!score) throw Error(`Music action must reference a music figure: ${action.figureId}`);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 4) throw Error("Music repeat must be 1–4");
  const step = score.steps.find(step => step.id === action.clipId);
  if (!step) throw Error(`Unknown music step ${action.clipId}`);
  const performance = musicPerformance(compileMaterialMusic(score), step);
  if (performance.notes.length * repeat > 2048) throw Error("Music performance exceeds 2048 notes; choose a shorter passage");
  const durationTicks = Math.round(performance.duration * 48_000);
  return { figureId: action.figureId, clipId: step.id, label: step.label, durationTicks: durationTicks * repeat,
    notes: Array.from({ length: repeat }, (_, pass) => performance.notes.map(note => ({ targetId: note.eventId, midi: note.pitch.midi, instrument: note.instrument, velocity: note.velocity,
      startTick: durationTicks * pass + Math.round(note.start * 48_000), durationTicks: Math.round(note.end * 48_000) - Math.round(note.start * 48_000) }))).flat() };
}
