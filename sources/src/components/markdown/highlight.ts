import hljs from "highlight.js/lib/core";
import { isPlainCodeLanguage } from "../../../libs/domain/src/index.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import vbnet from "highlight.js/lib/languages/vbnet";
import wasm from "highlight.js/lib/languages/wasm";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  md: "markdown",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  docker: "dockerfile",
  gql: "graphql",
  make: "makefile",
  mm: "objectivec",
  objc: "objectivec",
  ps1: "powershell",
  pwsh: "powershell",
  toml: "ini",
};

let initialized = false;

function registerLanguages() {
  if (initialized) return;
  initialized = true;

  for (const [name, language] of [
    ["bash", bash],
    ["c", c],
    ["cpp", cpp],
    ["csharp", csharp],
    ["css", css],
    ["diff", diff],
    ["dockerfile", dockerfile],
    ["go", go],
    ["graphql", graphql],
    ["haskell", haskell],
    ["ini", ini],
    ["java", java],
    ["javascript", javascript],
    ["json", json],
    ["kotlin", kotlin],
    ["lua", lua],
    ["makefile", makefile],
    ["markdown", markdown],
    ["objectivec", objectivec],
    ["perl", perl],
    ["php", php],
    ["powershell", powershell],
    ["python", python],
    ["r", r],
    ["ruby", ruby],
    ["rust", rust],
    ["scala", scala],
    ["scss", scss],
    ["sql", sql],
    ["swift", swift],
    ["typescript", typescript],
    ["vbnet", vbnet],
    ["wasm", wasm],
    ["xml", xml],
    ["yaml", yaml],
  ] as const) {
    hljs.registerLanguage(name, language);
  }
}

export function resolveHighlightLanguage(
  language?: string,
): string | undefined {
  if (!language) return undefined;
  registerLanguages();
  const normalized = language.trim().toLowerCase();
  if (!normalized) return undefined;
  const resolved = LANGUAGE_ALIASES[normalized] ?? normalized;
  return hljs.getLanguage(resolved) ? resolved : undefined;
}

export function highlightCode(
  code: string,
  language?: string,
  preserveTrailingNewline = false,
): string {
  registerLanguages();
  const trimmed = preserveTrailingNewline ? code : code.replace(/\n$/, "");
  if (isPlainCodeLanguage(language)) {
    return trimmed
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
  const resolved = resolveHighlightLanguage(language);

  if (resolved) {
    return hljs.highlight(trimmed, { language: resolved, ignoreIllegals: true })
      .value;
  }

  if (language?.trim()) {
    return trimmed
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  return hljs.highlightAuto(trimmed, [
    "javascript",
    "typescript",
    "python",
    "java",
    "json",
    "bash",
    "css",
    "xml",
    "sql",
    "go",
    "rust",
    "cpp",
    "csharp",
    "ruby",
    "php",
    "kotlin",
    "swift",
    "yaml",
    "markdown",
    "diff",
    "dockerfile",
    "graphql",
    "ini",
    "lua",
    "makefile",
    "objectivec",
    "perl",
    "powershell",
    "r",
    "scala",
    "scss",
    "vbnet",
    "wasm",
  ]).value;
}
