import {configureReadingDocument} from "./context.js";
import {readingFollowUpContext} from "./follow-up.js";
import {anchorId, parseMaterialAnchor, resolveBlockIndex, type MaterialAnchor} from "../domain/material-anchor.js";
import {anchorId as browserAnchorId, parseMaterialAnchor as parseBrowserAnchor,
  canLocateMaterialAnchor} from "../../../../src/shared/domain/material-anchor.js";
import type {ReadingDocument} from "../../../domain/src/reading-document.js";

const anchor: MaterialAnchor = {
  scope: "block", sectionId: "section", blockIndex: 0, selectedText: "阅读中的状态",
  reading: {documentId: "reading-job", blockId: "b1"},
};
const document: ReadingDocument = {version: 1, title: "独立阅读", blocks: [
  {type: "paragraph", id: "b1", text: "阅读中的状态需要显式保存。"},
  {type: "paragraph", id: "b2", text: "下一段解释为什么要保存。"},
]};
afterEach(() => configureReadingDocument(undefined));

it("uses the exact reading document and neighboring prose for the selected quote", async () => {
  const read = jest.fn(async () => document);
  configureReadingDocument(read);
  const context = await readingFollowUpContext("alice", "unit", anchor);
  expect(read).toHaveBeenCalledWith("alice", "unit", "section", "reading-job");
  expect(context?.anchorSnippet).toContain("【用户选中】\n阅读中的状态");
  expect(context?.anchorSnippet).toContain("阅读中的状态需要显式保存。");
  expect(context?.anchorSnippet).toContain("下一段解释为什么要保存。");
  expect(context?.material.blocks).toEqual([{type: "paragraph", text: "阅读中的状态需要显式保存。"}]);
});

it("does not fall back to Display for a missing document or block", async () => {
  expect(await readingFollowUpContext("alice", "unit", anchor)).toBeNull();
  configureReadingDocument(async () => document);
  expect(await readingFollowUpContext("alice", "unit", {...anchor,
    reading: {...anchor.reading!, blockId: "missing"}})).toBeNull();
  expect(await readingFollowUpContext("alice", "unit", {...anchor, reading: undefined})).toBeNull();
});

it("keeps reading anchors distinct across versions, quotes and Display on both sides", () => {
  expect(parseMaterialAnchor(anchor)).toMatchObject(anchor);
  expect(parseBrowserAnchor(anchor)).toMatchObject(anchor);
  expect(browserAnchorId(anchor)).toBe(anchorId(anchor));
  expect(anchorId({...anchor, reading: undefined})).not.toBe(anchorId(anchor));
  expect(anchorId({...anchor, reading: {...anchor.reading!, documentId: "next"}})).not.toBe(anchorId(anchor));
  expect(anchorId({...anchor, selectedText: "另一处"})).not.toBe(anchorId(anchor));
  const display = {introduction: "", keyTakeaways: [], blocks: [{type: "paragraph" as const, text: "Display 正文"}]};
  expect(resolveBlockIndex(display, anchor)).toBeNull();
  expect(canLocateMaterialAnchor(display, anchor)).toBe(false);
  for (const invalid of [{...anchor, sectionId: undefined}, {...anchor, reading: {}}, {...anchor, reading: null}]) {
    expect(parseMaterialAnchor(invalid)).toBeNull();
    expect(parseBrowserAnchor(invalid)).toBeNull();
  }
});
