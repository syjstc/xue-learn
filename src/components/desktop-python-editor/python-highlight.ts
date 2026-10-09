import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";

const comment = "var(--course-content-code-syntax-comment)";
const keyword = "var(--course-content-code-syntax-keyword)";
const string = "var(--course-content-code-syntax-string)";
const number = "var(--course-content-code-syntax-number)";
const fn = "var(--course-content-code-syntax-function)";
const variable = "var(--course-content-code-syntax-variable)";
const type = "var(--course-content-code-syntax-type)";
const meta = "var(--course-content-code-syntax-meta)";
const text = "var(--course-content-code-text)";

const pythonHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: keyword },
  { tag: tags.operatorKeyword, color: keyword },
  { tag: tags.controlKeyword, color: keyword },
  { tag: tags.definitionKeyword, color: keyword },
  { tag: tags.moduleKeyword, color: keyword },
  { tag: [tags.standard(tags.name), tags.standard(tags.variableName)], color: keyword },
  { tag: [tags.function(tags.variableName), tags.labelName], color: fn },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.self], color: type },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], color: number },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.inserted], color: string },
  { tag: [tags.comment, tags.quote], color: comment, fontStyle: "italic" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: meta },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: variable },
  { tag: [tags.operator, tags.separator, tags.punctuation], color: text },
  { tag: tags.invalid, color: "var(--course-content-code-syntax-deletion)" },
]);

export const pythonEditorTheme = [
  EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "13px",
        backgroundColor: "var(--course-content-code-bg)",
        color: text,
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      ".cm-gutters": {
        backgroundColor: "var(--course-content-code-gutter-bg)",
        color: "var(--course-content-code-gutter-text)",
        borderRight: "1px solid var(--course-content-code-border)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "color-mix(in srgb, var(--course-content-code-text) 8%, var(--course-content-code-gutter-bg))",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--course-content-code-text) 6%, transparent)",
      },
      ".cm-content": { caretColor: text },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: text },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: "color-mix(in srgb, var(--course-content-code-syntax-function) 35%, transparent)",
        },
      "&.cm-focused": { outline: "none" },
    },
    { dark: true },
  ),
  syntaxHighlighting(pythonHighlightStyle),
  drawSelection(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
];
