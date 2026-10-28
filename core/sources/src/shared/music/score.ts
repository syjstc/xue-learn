import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Dot,
  Accidental,
  Beam,
} from "vexflow";
import type { MusicPlan } from "../../../libs/domain/src/index.js";
const durations: Record<number, string> = {
  0.25: "16",
  0.5: "8",
  0.75: "8d",
  1: "q",
  1.5: "qd",
  2: "h",
  3: "hd",
  4: "w",
};
/** Stable overview geometry. Cue/playhead changes only paint these same SVG groups. */
export function drawMusicScore(host: HTMLDivElement, plan: MusicPlan) {
  host.replaceChildren();
  const barWidth = Math.max(
      300,
      Math.min(600, host.clientWidth / Math.min(4, plan.barCount)),
      ...plan.source.parts.flatMap((part) =>
        part.bars.map((bar) => bar.notes.length * 30 + 110),
      ),
    ),
    rowHeight = 205,
    width = plan.barCount * barWidth + 12;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, plan.source.parts.length * rowHeight + 20);
  const ctx = renderer.getContext(),
    root = host.querySelector("svg")!;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", plan.source.title);
  const nodes = new Map<string, SVGElement[]>();
  const svg = (
    tag: string,
    attrs: Record<string, string | number>,
    parent: Element,
    text?: string,
  ) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) =>
      node.setAttribute(key, String(value)),
    );
    if (text != null) node.textContent = text;
    parent.append(node);
    return node;
  };
  for (let bar = 1; bar <= plan.barCount; bar++) {
    const staves: Stave[] = [],
      voices: Voice[] = [],
      rows: {
        events: typeof plan.events;
        notes: StaveNote[];
        beams: Beam[];
      }[] = [];
    plan.source.parts.forEach((part, row) => {
      const stave = new Stave(
        (bar - 1) * barWidth + 8,
        row * rowHeight + 12,
        barWidth,
      );
      if (bar === 1)
        stave.addClef(part.clef).addTimeSignature(plan.source.meter);
      const events = plan.events.filter(
        (e) => e.partId === part.id && e.bar === bar,
      );
      const notes = events.map((e) => {
        const note = new StaveNote({
          clef: part.clef,
          keys: e.notes.length
            ? e.notes.map(
                (n) => `${n.pitch.step.toLowerCase()}/${n.pitch.octave}`,
              )
            : [part.clef === "treble" ? "b/4" : "d/3"],
          duration: durations[e.duration]! + (e.notes.length ? "" : "r"),
        });
        if ([0.75, 1.5, 3].includes(e.duration))
          Dot.buildAndAttach([note], { all: true });
        return note;
      });
      const voice = new Voice({
        num_beats: plan.barBeats,
        beat_value: 4,
      }).addTickables(notes);
      // Explicit spellings including natural cancellations: never infer accidental state across a bar.
      const alterations = new Map<string, number>();
      events.forEach((event, i) =>
        event.notes.forEach((n, j) => {
          const key = `${n.pitch.step}${n.pitch.octave}`,
            previous = alterations.get(key) ?? 0;
          if (previous !== n.pitch.alter)
            notes[i]!.addModifier(
              new Accidental(
                n.pitch.alter === 1 ? "#" : n.pitch.alter === -1 ? "b" : "n",
              ),
              j,
            );
          alterations.set(key, n.pitch.alter);
        }),
      );
      staves.push(stave);
      voices.push(voice);
      // Beams must own their notes before formatting and drawing. Creating
      // them afterwards leaves standalone flags and duplicate stems in the SVG.
      const beams = Beam.generateBeams(notes, {
        groups: Beam.getDefaultBeamGroups(plan.source.meter),
      });
      rows.push({ events, notes, beams });
    });
    const formatter = new Formatter();
    voices.forEach((v) => formatter.joinVoices([v]));
    formatter.formatToStave(voices, staves[0]!);
    staves.forEach((stave, row) => {
      const part = plan.source.parts[row]!,
        { events, notes, beams } = rows[row]!;
      const group = ctx.openGroup("music-part");
      group.dataset.part = part.id;
      group.dataset.bar = String(bar);
      const staff = ctx.openGroup("music-staff");
      staff.classList.add("music-staff");
      stave.setContext(ctx).draw();
      voices[row]!.draw(ctx, stave);
      beams.forEach((beam) => beam.setContext(ctx).draw());
      ctx.closeGroup();
      events.forEach((event, i) => {
        const ink = notes[i]!.getSVGElement()!,
          x = notes[i]!.getAbsoluteX();
        ink.classList.add("music-event");
        ink.dataset.event = event.id;
        const numbered = svg(
          "g",
          { class: "music-numbered music-event", "data-event": event.id },
          group,
        );
        (event.notes.length ? event.notes.map((n) => n.pitch) : [null]).forEach(
          (pitch, index) => {
            const y = row * rowHeight + 181 - index * 21;
            const degree = pitch
              ? `${pitch.alter === 1 ? "♯" : pitch.alter === -1 ? "♭" : ""}${"CDEFGAB".indexOf(pitch.step) + 1}`
              : "0";
            svg(
              "text",
              { x, y, "text-anchor": "middle", "font-size": 16 },
              numbered,
              degree,
            );
            if (pitch)
              for (let dot = 0; dot < Math.abs(pitch.octave - 4); dot++)
                svg(
                  "circle",
                  {
                    cx: x,
                    cy: y + (pitch.octave > 4 ? -18 - dot * 4 : 5 + dot * 4),
                    r: 1.15,
                  },
                  numbered,
                );
            const lines = event.duration < 0.5 ? 2 : event.duration < 1 ? 1 : 0;
            for (let line = 0; line < lines; line++)
              svg(
                "line",
                {
                  x1: x - 6,
                  x2: x + 6,
                  y1: y + 11 + line * 3,
                  y2: y + 11 + line * 3,
                },
                numbered,
              );
            if ([0.75, 1.5].includes(event.duration))
              svg("circle", { cx: x + 11, cy: y - 5, r: 1.4 }, numbered);
            for (let tail = 1; tail < Math.floor(event.duration); tail++)
              svg(
                "text",
                { x: x + tail * 15, y, "font-size": 14 },
                numbered,
                "–",
              );
          },
        );
        nodes.set(event.id, [ink, numbered]);
      });
      svg(
        "text",
        {
          x: (bar - 1) * barWidth + 16,
          y: row * rowHeight + 16,
          class: "music-score-label",
          "font-size": 12,
        },
        group,
        `${part.label} · ${bar}`,
      );
      ctx.closeGroup();
    });
  }
  return { nodes, root, barWidth };
}
