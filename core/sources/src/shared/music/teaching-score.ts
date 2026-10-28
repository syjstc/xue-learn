import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  Dot,
} from "vexflow";
import {
  parseMusicPitch,
  type MaterialMusicTeaching,
  type MusicTeachingView,
} from "../../../libs/domain/src/index.js";
import { musicTeachingLabelHtml } from "./teaching-label.js";
import {
  layoutMusicAnnotations,
  routeMusicAnnotation,
} from "./annotation-layout.js";

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
const black = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
const name = (midi: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
type Anchor = { x: number; y: number; bottom: number; top: number };
let drawingId = 0;

/** One stable SVG layout. Teaching and audio only change classes on the same nodes. */
export function drawMusicTeaching(
  host: HTMLDivElement,
  source: MaterialMusicTeaching,
  audition: (midi: number) => void,
  interactive: boolean,
  { compact = false }: { compact?: boolean } = {},
) {
  host.replaceChildren();
  // Long score-to-keyboard columns are reading layouts. In a bounded landscape
  // stage, keep their authored order in rows and give the final keyboard a full
  // row. The choice uses only the uncued source and available width.
  const staffGrid =
    compact &&
    host.clientWidth >= 640 &&
    source.layout === "column" &&
    source.views.length >= 3 &&
    source.views.slice(0, -1).every((view) => view.kind === "staff") &&
    source.views.at(-1)?.kind === "keyboard";
  // Scale a stable teaching canvas in wide classroom slots instead of stretching
  // note spacing while leaving the glyphs at reading size.
  const sparseColumn =
    !staffGrid &&
    source.layout === "column" &&
    source.views.every((view) =>
      view.kind === "staff"
        ? view.notes.length <= 3
        : !!view.range &&
          parseMusicPitch(view.range[1]!).midi -
            parseMusicPitch(view.range[0]!).midi <=
            12,
    );
  const width = Math.max(
    340,
    Math.min(sparseColumn ? 560 : 900, Math.round(host.clientWidth)),
  );
  const columns = staffGrid
    ? 2
    : width < 640 || source.layout === "column"
      ? 1
      : source.layout === "grid"
        ? 2
        : Math.min(3, source.views.length);
  const cellWidth = width / columns;
  const placements = new Map(
    source.views.map((view, index) => [
      view.id,
      staffGrid && index === source.views.length - 1
        ? { row: Math.ceil(index / columns), column: 0, span: columns }
        : {
            row: Math.floor(index / columns),
            column: index % columns,
            span: 1,
          },
    ]),
  );
  const innerWidthFor = (view: MusicTeachingView) =>
    cellWidth * placements.get(view.id)!.span - 40;
  const objects = new Map(source.notes.map((note) => [note.id, note]));
  const notesFor = (view: MusicTeachingView) =>
    view.notes.map((id) => objects.get(id)!);
  // Measure real typeset labels in design pixels, before laying out any row.
  // Neither screen transforms nor the current cue participate in this layout.
  const measureLabel = (text: string, maxWidth: number, size: number) => {
    const probe = document.createElement("div");
    probe.className = "music-teaching-label-copy";
    Object.assign(probe.style, {
      position: "absolute",
      visibility: "hidden",
      width: "max-content",
      maxWidth: `${maxWidth}px`,
      fontSize: `${size}px`,
      fontWeight: "600",
    });
    const html = musicTeachingLabelHtml(text);
    probe.innerHTML = html;
    host.append(probe);
    const label = {
      html,
      width: probe.offsetWidth,
      height: probe.offsetHeight,
    };
    probe.remove();
    return label;
  };
  const labels = new Map(
    source.views.map((view) => [
      view.id,
      measureLabel(view.label, innerWidthFor(view), compact ? 22 : 17),
    ]),
  );
  const labelExtra = (view: MusicTeachingView) =>
    Math.max(0, labels.get(view.id)!.height - (compact ? 30 : 23));
  const markLabels = new Map(
    (source.marks ?? []).map((mark) => [
      mark.id,
      measureLabel(
        mark.label,
        Math.min(240, cellWidth - 56),
        compact ? 18 : 16,
      ),
    ]),
  );
  const keyboardLinks = (source.marks ?? []).filter(
    (mark) =>
      mark.kind === "link" &&
      mark.anchors.length === 2 &&
      mark.anchors[0]!.viewId !== mark.anchors[1]!.viewId &&
      placements.get(mark.anchors[1]!.viewId)!.row >
        placements.get(mark.anchors[0]!.viewId)!.row &&
      source.views.find((view) => view.id === mark.anchors[0]!.viewId)?.kind ===
        "staff" &&
      source.views.find((view) => view.id === mark.anchors[1]!.viewId)?.kind ===
        "keyboard",
  );
  const keyboardMarks = (view: MusicTeachingView) =>
    (source.marks ?? []).filter(
      (mark) =>
        view.kind === "keyboard" &&
        (mark.anchors.every((a) => a.viewId === view.id) ||
          (keyboardLinks.includes(mark) &&
            mark.anchors[1]!.viewId === view.id)),
    );
  const keyboardLayout = (view: MusicTeachingView) => {
    const pitches = notesFor(view).flatMap((n) =>
      n.pitches.map((p) => parseMusicPitch(p).midi),
    );
    let low = view.range
      ? parseMusicPitch(view.range[0]!).midi
      : Math.max(21, Math.floor((Math.min(60, ...pitches) - 1) / 12) * 12);
    let high = view.range
      ? parseMusicPitch(view.range[1]!).midi
      : Math.min(108, Math.ceil((Math.max(60, ...pitches) + 1) / 12) * 12);
    while (black(low)) low--;
    while (black(high)) high++;
    const all = Array.from({ length: high - low + 1 }, (_, i) => low + i);
    const whites = all.filter((m) => !black(m));
    // A small pitch range must not turn into broad, squat tiles in a wide slot.
    const captionWidth = keyboardMarks(view).reduce(
      (sum, mark) => sum + markLabels.get(mark.id)!.width + 22,
      0,
    );
    const keyWidth = Math.min(
      Math.max(
        compact ? 38 : 34,
        Math.min(compact ? 52 : 44, captionWidth / whites.length),
      ),
      innerWidthFor(view) / whites.length,
    );
    return { all, whites, keyWidth, keyHeight: keyWidth * 3.3 };
  };
  const keyboardAnnotations = new Map(
    source.views
      .filter((v) => v.kind === "keyboard")
      .map((view) => {
        const { whites, keyWidth } = keyboardLayout(view);
        const start = (innerWidthFor(view) - whites.length * keyWidth) / 2;
        const captions = keyboardMarks(view).map((mark) => {
          const centers = mark.anchors
            .filter((anchor) => anchor.viewId === view.id)
            .map((anchor) => {
              if (!anchor.noteId) return innerWidthFor(view) / 2;
              const midi = parseMusicPitch(
                objects.get(anchor.noteId)!.pitches[0]!,
              ).midi;
              return (
                start +
                (whites.filter((m) => m < midi).length +
                  (black(midi) ? 0 : 0.5)) *
                  keyWidth
              );
            });
          const label = markLabels.get(mark.id)!;
          return {
            id: mark.id,
            center: centers.reduce((sum, x) => sum + x, 0) / centers.length,
            width: label.width + 14,
            height: label.height + 8,
          };
        });
        return [
          view.id,
          layoutMusicAnnotations(captions, innerWidthFor(view)),
        ] as const;
      }),
  );
  const keyboardAnnotationSpace = (view: MusicTeachingView) => {
    const height = keyboardAnnotations.get(view.id)?.height ?? 0;
    return height ? height + 22 : 0;
  };
  const extent = (view: MusicTeachingView) => {
    const base = view.clef === "bass" ? 18 : 30; // bottom line: G2 or E4, diatonic indices
    const offsets = notesFor(view).flatMap((n) =>
      n.pitches.map((p) => {
        const pitch = parseMusicPitch(p);
        return (pitch.octave * 7 + "CDEFGAB".indexOf(pitch.step) - base) * 5;
      }),
    );
    return {
      above: Math.max(0, ...offsets.map((n) => n - 40)),
      below: Math.max(0, ...offsets.map((n) => -n)),
    };
  };
  const notesPerSystem = Math.max(2, Math.floor((cellWidth - 100) / 48));
  const staffLabels = (view: MusicTeachingView, system: number) =>
    (source.marks ?? []).filter((mark) => {
      const anchor = mark.anchors[0]!;
      return (
        view.kind === "staff" &&
        mark.kind === "label" &&
        mark.anchors.length === 1 &&
        anchor.viewId === view.id &&
        Math.floor(
          Math.max(0, view.notes.indexOf(anchor.noteId ?? "")) / notesPerSystem,
        ) === system
      );
    });
  const staffLabelLayout = (
    view: MusicTeachingView,
    system: number,
    center: (noteId?: string) => number,
  ) =>
    layoutMusicAnnotations(
      staffLabels(view, system).map((mark) => {
        const label = markLabels.get(mark.id)!;
        return {
          id: mark.id,
          center: center(mark.anchors[0]!.noteId),
          width: label.width + 14,
          height: label.height + 8,
        };
      }),
      cellWidth - 40,
    );
  // Caption row counts depend on measured widths and score order. After engraving,
  // place those same rows using actual notehead X positions, not guessed spacing.
  const staffAnnotationSpaces = new Map(
    source.views
      .filter((v) => v.kind === "staff")
      .map((view) => [
        view.id,
        Array.from(
          { length: Math.ceil(view.notes.length / notesPerSystem) },
          (_, system) => {
            const layout = staffLabelLayout(view, system, (id) =>
              Math.max(0, view.notes.indexOf(id ?? "")),
            );
            // The existing title-to-notation gap already has 24px available.
            // Only extra caption height should make a multi-view score taller.
            return Math.max(0, layout.height - 24);
          },
        ),
      ]),
  );
  // A classroom has a bounded height. Reading-sized blank rows otherwise
  // shrink the whole score (including its labels) to fit that height. Reserve
  // only the actual staff/key extent and annotation lanes, for every cue.
  const bottomMarkSpace = (view: MusicTeachingView) => {
    const count = (source.marks ?? []).filter(
      (mark) =>
        mark.kind === "bracket" &&
        !keyboardMarks(view).includes(mark) &&
        mark.anchors.some((a) => a.viewId === view.id),
    ).length;
    return count ? 44 + count * 20 : 0;
  };
  const staffHeight = (view: MusicTeachingView) => {
    const ext = extent(view);
    const systems = Math.ceil(view.notes.length / notesPerSystem);
    return (
      (compact ? 155 : 160) +
      bottomMarkSpace(view) +
      labelExtra(view) +
      ext.above +
      ext.below +
      staffAnnotationSpaces
        .get(view.id)!
        .reduce((sum, space) => sum + space, 0) +
      (systems - 1) * (150 + ext.above + ext.below)
    );
  };
  const rowHeights = Array.from(
    { length: Math.max(...[...placements.values()].map((p) => p.row)) + 1 },
    (_, row) =>
      Math.max(
        0,
        ...source.views
          .filter((view) => placements.get(view.id)!.row === row)
          .map((v) =>
            v.kind === "staff"
              ? staffHeight(v)
              : 76 +
                keyboardLayout(v).keyHeight +
                keyboardAnnotationSpace(v) +
                bottomMarkSpace(v) +
                labelExtra(v),
          ),
      ),
  );
  const height = rowHeights.reduce((a, b) => a + b, 0) + (compact ? 12 : 24);
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext(),
    root = host.querySelector("svg")!;
  // VexFlow writes pixel sizes inline; scale the stable viewBox with its slot.
  root.style.removeProperty("width");
  root.style.removeProperty("height");
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  root.dataset.musicLayout = compact ? "classroom" : "reading";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", source.title);
  const nodes = new Map<string, SVGElement[]>(),
    keys = new Map<number, SVGElement[]>(),
    marks = new Map<string, SVGElement>();
  const anchors = new Map<string, Anchor>();
  const keyboardCaptions = new Map<string, { x: number; y: number }>();
  const staffCaptions = new Map<
    string,
    { x: number; y: number; railY: number; system: string }
  >();
  const add = (id: string, node: SVGElement) =>
    nodes.set(id, [...(nodes.get(id) ?? []), node]);
  const svg = (
    tag: string,
    attrs: Record<string, string | number>,
    parent: Element = root,
    text?: string,
  ) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (text != null) node.textContent = text;
    parent.append(node);
    return node;
  };
  // Each score owns its paint IDs: several figures can share one classroom.
  const paintId = `music-keys-${++drawingId}`;
  const defs = svg("defs", {});
  for (const tone of ["ivory", "ebony"]) {
    const gradient = svg(
      "linearGradient",
      { id: `${paintId}-${tone}`, x1: "0", y1: "0", x2: "0", y2: "1" },
      defs,
    );
    svg("stop", { offset: "0", class: `music-key-${tone}-top` }, gradient);
    svg("stop", { offset: "1", class: `music-key-${tone}-bottom` }, gradient);
  }
  const drawLabel = (
    label: ReturnType<typeof measureLabel>,
    x: number,
    y: number,
    className: string,
    parent: Element,
  ) => {
    const foreign = svg(
      "foreignObject",
      {
        x,
        y,
        width: label.width + 1,
        height: label.height + 1,
        class: className,
      },
      parent,
    );
    const copy = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    copy.className = "music-teaching-label-copy";
    copy.innerHTML = label.html;
    foreign.append(copy);
    return foreign;
  };
  source.views.forEach((view) => {
    const { row, column } = placements.get(view.id)!;
    const x = column * cellWidth + 20;
    const y = rowHeights.slice(0, row).reduce((a, b) => a + b, 0),
      innerWidth = innerWidthFor(view);
    const group = ctx.openGroup("music-teaching-view");
    group.classList.add("music-teaching-view");
    group.dataset.view = view.id;
    add(view.id, group);
    svg(
      "path",
      {
        d: `M${x - 8},${y + 14} v${labels.get(view.id)!.height - 8}`,
        class: "music-view-accent",
      },
      group,
    );
    drawLabel(labels.get(view.id)!, x, y + 10, "music-view-label", group);
    const contentY = y + labelExtra(view);
    anchors.set(view.id, {
      x: x + innerWidth / 2,
      y: contentY + 95,
      bottom: y + rowHeights[row]! - 42,
      top: contentY + 52,
    });
    if (view.kind === "staff") {
      const ext = extent(view);
      const allObjects = notesFor(view);
      const alterations = new Map<string, number>();
      for (
        let offset = 0;
        offset < allObjects.length;
        offset += notesPerSystem
      ) {
        const system = Math.floor(offset / notesPerSystem);
        const spaces = staffAnnotationSpaces.get(view.id)!;
        const annotationY =
          contentY +
          system * (150 + ext.above + ext.below) +
          spaces.slice(0, system).reduce((sum, space) => sum + space, 0);
        const systemY = annotationY + spaces[system]!;
        const staveY = systemY + 55 + ext.above;
        // A single note is a short example, not a full-width empty system.
        const count = Math.min(notesPerSystem, allObjects.length - offset);
        const staveWidth = Math.min(
          innerWidth,
          Math.max(220, 110 + count * 64),
        );
        const stave = new Stave(
          x + (innerWidth - staveWidth) / 2,
          staveY,
          staveWidth,
        ).addClef(view.clef ?? "treble");
        // Concept examples deliberately have no meter or barlines.
        stave.setBegBarType(0).setEndBarType(0);
        const objectsInView = allObjects.slice(offset, offset + notesPerSystem);
        const noteGlyphs = objectsInView.map((note) => {
          const pitches = note.pitches.map(parseMusicPitch),
            beats = note.beats ?? 1;
          const glyph = new StaveNote({
            clef: view.clef ?? "treble",
            auto_stem: true,
            keys: pitches.length
              ? pitches.map((p) => `${p.step.toLowerCase()}/${p.octave}`)
              : [view.clef === "bass" ? "d/3" : "b/4"],
            duration: durations[beats]! + (pitches.length ? "" : "r"),
          });
          pitches.forEach((p, i) => {
            const key = `${p.step}${p.octave}`,
              previous = alterations.get(key) ?? 0;
            if (p.alter !== previous)
              glyph.addModifier(
                new Accidental(p.alter > 0 ? "#" : p.alter < 0 ? "b" : "n"),
                i,
              );
            alterations.set(key, p.alter);
          });
          if ([0.75, 1.5, 3].includes(beats))
            Dot.buildAndAttach([glyph], { all: true });
          return glyph;
        });
        const voice = new Voice({ num_beats: 4, beat_value: 4 })
          .setMode(Voice.Mode.SOFT)
          .addTickables(noteGlyphs);
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        stave.setContext(ctx).draw();
        voice.draw(ctx, stave);
        noteGlyphs.forEach((glyph, i) => {
          const id = objectsInView[i]!.id,
            node = glyph.getSVGElement()!;
          node.classList.add("music-teaching-note");
          node.dataset.note = id;
          add(id, node);
          const head = (
            glyph.noteHeads[0]?.getSVGElement() as
              SVGGraphicsElement | undefined
          )?.getBBox();
          anchors.set(`${view.id}:${id}`, {
            x: head?.width ? head.x + head.width / 2 : glyph.getAbsoluteX() + 6,
            y: head?.height ? head.y + head.height / 2 : glyph.getYs()[0]!,
            bottom: systemY + (compact ? 177 : 182) + ext.above + ext.below,
            top: systemY + 52,
          });
        });
        const captions = staffLabelLayout(
          view,
          system,
          (id) => anchors.get(id ? `${view.id}:${id}` : view.id)!.x - x,
        );
        for (const [id, box] of captions.boxes) {
          staffCaptions.set(id, {
            x: x + box.x + 7,
            y: annotationY + 52 + box.y,
            railY: annotationY + 56 + captions.height,
            system: `${view.id}:${system}`,
          });
        }
      }
    } else {
      const { all, whites, keyWidth, keyHeight } = keyboardLayout(view);
      const top = contentY + 60 + keyboardAnnotationSpace(view);
      const keyboardX = x + (innerWidth - whites.length * keyWidth) / 2;
      for (const [id, box] of keyboardAnnotations.get(view.id)!.boxes) {
        keyboardCaptions.set(id, {
          x: x + box.x + 7,
          y: contentY + 52 + box.y,
        });
      }
      anchors.set(view.id, {
        x: keyboardX + (whites.length * keyWidth) / 2,
        y: top + 8,
        top: top - 8,
        bottom: top + keyHeight + 6,
      });
      svg(
        "rect",
        {
          x: keyboardX - 5,
          y: top - 8,
          width: whites.length * keyWidth + 10,
          height: keyHeight + 14,
          rx: 7,
          class: "music-keyboard-bed",
        },
        group,
      );
      svg(
        "path",
        {
          d: `M${keyboardX},${top - 3} h${whites.length * keyWidth}`,
          class: "music-keyboard-felt",
        },
        group,
      );
      for (const midi of [...whites, ...all.filter(black)]) {
        const dark = black(midi),
          before = whites.filter((m) => m < midi).length;
        const left = keyboardX + (before - (dark ? 0.3 : 0)) * keyWidth;
        const key = svg(
          "g",
          {
            class: `music-teaching-key ${dark ? "black" : "white"}`,
            "data-midi": midi,
            role: "button",
            tabindex: interactive ? 0 : -1,
            "aria-label": `试听 ${name(midi)}`,
            "aria-disabled": String(!interactive),
          },
          group,
        );
        svg(
          "rect",
          {
            x: left,
            y: top,
            width: keyWidth * (dark ? 0.6 : 1),
            height: keyHeight * (dark ? 0.62 : 1),
            rx: 3,
            class: "music-key-body",
            fill: `url(#${paintId}-${dark ? "ebony" : "ivory"})`,
          },
          key,
        );
        const keyRight = left + keyWidth * (dark ? 0.6 : 1),
          keyBottom = top + keyHeight * (dark ? 0.62 : 1);
        svg(
          "path",
          {
            d: dark
              ? `M${left + 2},${top + 5} V${keyBottom - 6} Q${left + 2},${keyBottom - 3} ${left + 5},${keyBottom - 3} H${keyRight - 3}`
              : `M${left + 3},${keyBottom - 5} H${keyRight - 3}`,
            class: "music-key-bevel",
          },
          key,
        );
        if (!dark && (whites.length <= 15 || midi % 12 === 0))
          svg(
            "text",
            {
              x: left + keyWidth / 2,
              y: top + keyHeight - 12,
              "text-anchor": "middle",
              "font-size": Math.min(compact ? 20 : 16, keyWidth * 0.45),
            },
            key,
            name(midi),
          );
        if (interactive) {
          key.addEventListener("click", () => audition(midi));
          key.addEventListener("keydown", (e) => {
            const event = e as KeyboardEvent;
            if (["Enter", " "].includes(event.key)) {
              event.preventDefault();
              audition(midi);
            }
          });
        }
        keys.set(midi, [...(keys.get(midi) ?? []), key]);
        for (const note of notesFor(view))
          if (note.pitches.some((p) => parseMusicPitch(p).midi === midi)) {
            add(note.id, key);
            if (!anchors.has(`${view.id}:${note.id}`))
              anchors.set(`${view.id}:${note.id}`, {
                x: left + keyWidth * (dark ? 0.3 : 0.5),
                y: top + 8,
                bottom: top + keyHeight + 6,
                top: top - 8,
              });
          }
      }
    }
    ctx.closeGroup();
  });
  const labelObstacles = [
    ...root.querySelectorAll<SVGGraphicsElement>(
      ".music-teaching-note, .music-view-label",
    ),
  ].map((node) => node.getBBox());
  const markLane = new Map<string, number>();
  for (const mark of source.marks ?? []) {
    const points = mark.anchors.map((a) =>
      anchors.get(a.noteId ? `${a.viewId}:${a.noteId}` : a.viewId)!,
    );
    const a = points[0]!,
      b = points[1];
    const group = svg("g", {
      class: "music-teaching-mark",
      "data-mark": mark.id,
    });
    marks.set(mark.id, group);
    add(mark.id, group);
    const staffCaption = staffCaptions.get(mark.id);
    if (staffCaption) {
      const label = markLabels.get(mark.id)!;
      const obstacles = [...staffCaptions]
        .filter(([, p]) => p.system === staffCaption.system)
        .map(([id, p]) => {
          const copy = markLabels.get(id)!;
          return {
            x: p.x - 7,
            y: p.y - 4,
            width: copy.width + 14,
            height: copy.height + 8,
          };
        });
      // Connect from the final caption position and stop at a ring around the
      // actual engraved notehead. Never move the label after drawing its leader.
      svg(
        "path",
        {
          d:
            routeMusicAnnotation(
              {
                x: staffCaption.x + label.width / 2,
                y: staffCaption.y + label.height + 4,
              },
              { x: a.x, y: staffCaption.railY },
              obstacles,
            ) + ` L${a.x},${a.y - 7}`,
          class: "music-mark-path",
        },
        group,
      );
      svg(
        "ellipse",
        { cx: a.x, cy: a.y, rx: 9, ry: 7, class: "music-mark-origin" },
        group,
      );
      svg(
        "rect",
        {
          x: staffCaption.x - 7,
          y: staffCaption.y - 4,
          width: label.width + 14,
          height: label.height + 8,
          rx: 8,
          class: "music-mark-backdrop",
        },
        group,
      );
      drawLabel(
        label,
        staffCaption.x,
        staffCaption.y,
        "music-mark-label",
        group,
      );
      continue;
    }
    const caption = keyboardCaptions.get(mark.id);
    if (caption) {
      const label = markLabels.get(mark.id)!;
      const labelCenter = caption.x + label.width / 2;
      const labelBottom = caption.y + label.height + 4;
      const crossLink = keyboardLinks.includes(mark);
      const targetY =
        (crossLink ? b!.top : Math.min(...points.map((point) => point.top))) -
        3;
      // The caption stays outside the keyboard; only fine leaders enter the
      // keys, ending above their note names. Pitch order keeps leaders ordered.
      const captionObstacles = keyboardMarks(
        source.views.find(
          (v) => v.id === mark.anchors[crossLink ? 1 : 0]!.viewId,
        )!,
      ).map((other) => {
        const position = keyboardCaptions.get(other.id)!;
        const copy = markLabels.get(other.id)!;
        return {
          x: position.x - 7,
          y: position.y - 4,
          width: copy.width + 14,
          height: copy.height + 8,
        };
      });
      if (crossLink) {
        // Route long staff-to-keyboard links through the outside margins, never
        // down through intervening notation. Captions occupy measured key lanes.
        const left = a.x < width / 2;
        const siblings = keyboardLinks.filter((link) => {
          const anchor = link.anchors[0]!;
          const sourceAnchor = anchors.get(
            anchor.noteId ? `${anchor.viewId}:${anchor.noteId}` : anchor.viewId,
          )!;
          return sourceAnchor.x < width / 2 === left;
        });
        const lane = siblings.indexOf(mark);
        const spacing = Math.min(6, 12 / siblings.length);
        const margin = 6 + (siblings.length - lane) * spacing;
        const railX = left ? margin : width - margin;
        const departureY = a.top - lane * spacing;
        const view = source.views.find(
          (v) => v.id === mark.anchors[1]!.viewId,
        )!;
        const firstCaptionTop =
          Math.min(
            ...keyboardMarks(view).map(
              (other) => keyboardCaptions.get(other.id)!.y,
            ),
          ) - 8;
        const arrival = routeMusicAnnotation(
          { x: railX, y: firstCaptionTop },
          { x: labelCenter, y: caption.y - 4 },
          captionObstacles,
        );
        group.dataset.musicLink = "staff-keyboard";
        svg(
          "path",
          {
            d: `M${a.x},${a.y - 7} V${departureY} H${railX} V${firstCaptionTop} ${arrival.replace(/^M/, "L")}`,
            class: "music-mark-path is-link",
          },
          group,
        );
        svg(
          "ellipse",
          { cx: a.x, cy: a.y, rx: 9, ry: 7, class: "music-mark-origin" },
          group,
        );
      }
      svg(
        "path",
        {
          d: routeMusicAnnotation(
            { x: labelCenter, y: labelBottom },
            { x: crossLink ? b!.x : (a.x + (b?.x ?? a.x)) / 2, y: targetY },
            captionObstacles,
          ),
          class: `music-mark-path ${mark.kind === "link" ? "is-link" : ""}`,
        },
        group,
      );
      if (crossLink) {
        svg(
          "path",
          {
            d: `M${b!.x},${targetY} V${b!.y - 4} m-4,-6 l4,6 l4,-6`,
            class: "music-mark-path is-link",
          },
          group,
        );
      } else if (b) {
        svg(
          "path",
          {
            d:
              mark.kind === "bracket"
                ? `M${a.x},${targetY + 6} V${targetY} H${b.x} v6`
                : `M${a.x},${a.y} V${targetY} H${b.x} V${b.y} m-4,-6 l4,6 l4,-6`,
            class: `music-mark-path ${mark.kind === "link" ? "is-link" : ""}`,
          },
          group,
        );
      } else {
        svg(
          "path",
          { d: `M${a.x},${targetY} V${a.y - 4}`, class: "music-mark-path" },
          group,
        );
        svg(
          "circle",
          { cx: a.x, cy: a.y, r: 3, class: "music-mark-origin" },
          group,
        );
      }
      svg(
        "rect",
        {
          x: caption.x - 7,
          y: caption.y - 4,
          width: label.width + 14,
          height: label.height + 8,
          rx: 8,
          class: "music-mark-backdrop",
        },
        group,
      );
      drawLabel(label, caption.x, caption.y, "music-mark-label", group);
      continue;
    }
    const laneKey = mark.anchors.map((a) => a.viewId).join(":"),
      lane = markLane.get(laneKey) ?? 0;
    markLane.set(laneKey, lane + 1);
    let labelX = a.x,
      labelY = a.top + lane * 22;
    if (b) {
      labelX = (a.x + b.x) / 2;
      if (mark.kind === "bracket") {
        labelY = Math.max(a.bottom, b.bottom) + lane * 20;
        svg(
          "path",
          {
            d: `M${a.x},${labelY - 36} v8 H${b.x} v-8`,
            class: "music-mark-path",
          },
          group,
        );
      } else {
        labelY = Math.max(56, Math.min(a.y, b.y) - 40 - lane * 22);
        svg(
          "path",
          {
            d: `M${a.x},${a.y} C${a.x},${labelY - 6} ${b.x},${labelY - 6} ${b.x},${b.y}`,
            class: `music-mark-path ${mark.kind === "link" ? "is-link" : ""}`,
          },
          group,
        );
        svg(
          "circle",
          {
            cx: a.x,
            cy: a.y,
            r: 5.5,
            class: "music-mark-origin",
          },
          group,
        );
        svg(
          "path",
          {
            d: `M${b.x - 5},${b.y - 9} L${b.x},${b.y} L${b.x + 5},${b.y - 9}`,
            class: "music-mark-path",
          },
          group,
        );
      }
    } else
      svg(
        "path",
        {
          d: `M${a.x},${labelY + 8} L${a.x},${a.y - 12}`,
          class: "music-mark-path",
        },
        group,
      );
    const label = markLabels.get(mark.id)!;
    const textWidth = label.width,
      labelTop = labelY - (compact ? 18 : 16),
      preferredX = Math.max(
        textWidth / 2 + 8,
        Math.min(width - textWidth / 2 - 8, labelX),
      );
    // A connector can cross a third view. Move only its caption within the
    // reserved lane so a pill never masks that view's notation or title.
    const obstacles = labelObstacles.filter(
      (box) =>
        labelTop - 5 < box.y + box.height &&
        labelTop + label.height + 5 > box.y,
    );
    const candidates = [
      preferredX,
      ...obstacles.flatMap((box) => [
        box.x - textWidth / 2 - 10,
        box.x + box.width + textWidth / 2 + 10,
      ]),
    ].sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
    const safeX =
      candidates.find(
        (cx) =>
          cx >= textWidth / 2 + 8 &&
          cx <= width - textWidth / 2 - 8 &&
          obstacles.every(
            (box) =>
              cx + textWidth / 2 + 8 < box.x ||
              cx - textWidth / 2 - 8 > box.x + box.width,
          ),
      ) ?? preferredX;
    const text = drawLabel(
      label,
      safeX - textWidth / 2,
      labelTop,
      "music-mark-label",
      group,
    );
    const backdrop = svg(
      "rect",
      {
        x: safeX - textWidth / 2 - 6,
        y: labelTop - 3,
        width: textWidth + 12,
        height: label.height + 6,
        rx: 8,
        class: "music-mark-backdrop",
      },
      group,
    );
    group.insertBefore(backdrop, text);
  }
  // Measure once, after the complete uncued drawing. The overlay is outside
  // target groups, so cues cannot change their bounds or notation layout.
  const focusIndicators = new Map<string, {group: SVGElement; trace: SVGElement; pointer: SVGElement}[]>();
  const rootMatrix = root.getCTM();
  for (const [id, targets] of nodes) {
    for (const target of targets) {
      const body = (target.querySelector(".music-view-label, .music-key-body, .music-mark-label") ?? target) as SVGGraphicsElement;
      const box = body.getBBox(), matrix = body.getCTM();
      if (!box.width || !box.height || !matrix || !rootMatrix) continue;
      const local = rootMatrix.inverse().multiply(matrix);
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(local));
      const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
      const right = Math.max(...corners.map(p => p.x)), bottom = Math.max(...corners.map(p => p.y));
      const group = svg("g", {class: "music-narration-focus", "data-music-focus-target": id, "aria-hidden": "true", opacity: 0});
      const trace = svg("rect", {x: left - 3, y: top - 3, width: right - left + 6, height: bottom - top + 6,
        rx: 5, pathLength: 1, "stroke-dasharray": "0 1", class: "music-narration-focus-trace"}, group);
      // Note/keyboard neighbors can touch horizontally (clefs, accidentals,
      // black keys). Point from the reserved lower space instead of covering
      // an adjacent glyph or suggesting the neighboring key is the target.
      const below = target.classList.contains("music-teaching-note") || target.classList.contains("music-teaching-key");
      const pointer = svg("path", {d: below ? "M-5 7L0 0L5 7" : "M-7 -5L0 0L-7 5", class: "music-narration-focus-pointer",
        "data-focus-axis": below ? "y" : "x",
        transform: below ? `translate(${(left + right) / 2} ${bottom + 7})` : `translate(${Math.max(8, left - 7)} ${(top + bottom) / 2})`}, group);
      focusIndicators.set(id, [...(focusIndicators.get(id) ?? []), {group, trace, pointer}]);
    }
  }
  return { root, nodes, keys, marks, focusIndicators };
}
