import type { InteractiveBlock } from "../llm/schemas.js";
import {
  formatCollapsedCodeBody,
  repairBareMarkdownCodeFences,
  type RepairCodeFencesOptions,
} from "./repair-code-fences.js";
import {
  resolveHighlightCodeLanguage,
  type HighlightCodeLanguageId,
} from "./code-fence-languages.js";

const MAX_CODE_BLOCK_LENGTH = 64_000;
const SYNTAX_TOOL_LOAD_TIMEOUT_MS = 5_000;

class CodeSyntaxToolUnavailableError extends Error {
  constructor(language: string) {
    super(`Syntax tooling for ${language} did not become ready`);
    this.name = "CodeSyntaxToolUnavailableError";
  }
}

type ParserLanguage =
  | "bash"
  | "c"
  | "cpp"
  | "c_sharp"
  | "css"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "lua"
  | "objc"
  | "php"
  | "python"
  | "ruby"
  | "rust"
  | "scala"
  | "swift"
  | "toml"
  | "tsx"
  | "typescript"
  | "yaml";

type PrettierParser =
  "babel" | "typescript" | "json" | "css" | "scss" | "html" | "yaml";

type LanguageTooling = {
  treeSitter?: ParserLanguage;
  prettier?: PrettierParser;
  ruff?: true;
  clangFilename?: string;
};

export type InvalidGeneratedCode = {
  source: string;
  language: HighlightCodeLanguageId;
  error: Error;
};

export type ImproveCodeOptions = RepairCodeFencesOptions & {
  /** Repair one invalid source value without regenerating its surrounding material. */
  repairInvalidCode?: (request: InvalidGeneratedCode) => Promise<string>;
  /** Keep the lesson publishable if the localized repair also fails. */
  preserveInvalidCodeAsText?: boolean;
  onInvalidCodeFallback?: (
    request: InvalidGeneratedCode,
  ) => void | Promise<void>;
};

const LANGUAGE_TOOLING: Partial<
  Record<HighlightCodeLanguageId, LanguageTooling>
> = {
  bash: { treeSitter: "bash" },
  c: { treeSitter: "c", clangFilename: "main.c" },
  cpp: { treeSitter: "cpp", clangFilename: "main.cpp" },
  csharp: { treeSitter: "c_sharp", clangFilename: "main.cs" },
  css: { treeSitter: "css", prettier: "css" },
  go: { treeSitter: "go" },
  java: { treeSitter: "java", clangFilename: "main.java" },
  javascript: { treeSitter: "javascript", prettier: "babel" },
  json: { treeSitter: "json", prettier: "json" },
  kotlin: { treeSitter: "kotlin" },
  lua: { treeSitter: "lua" },
  ini: { treeSitter: "toml" },
  objectivec: { treeSitter: "objc", clangFilename: "main.m" },
  php: { treeSitter: "php" },
  python: { treeSitter: "python", ruff: true },
  ruby: { treeSitter: "ruby" },
  rust: { treeSitter: "rust" },
  scala: { treeSitter: "scala" },
  scss: { prettier: "scss" },
  swift: { treeSitter: "swift" },
  // TSX is a superset grammar, so one lazy parser safely covers TS and TSX.
  typescript: { treeSitter: "tsx", prettier: "typescript" },
  xml: { treeSitter: "html", prettier: "html" },
  yaml: { treeSitter: "yaml", prettier: "yaml" },
};

type TreeSitterRuntime = typeof import("web-tree-sitter");
type TreeSitterParser = InstanceType<TreeSitterRuntime>;

let treeSitterRuntimePromise: Promise<TreeSitterRuntime> | undefined;
const parserPromises = new Map<ParserLanguage, Promise<TreeSitterParser>>();
let ruffWorkspacePromise:
  Promise<import("@astral-sh/ruff-wasm-nodejs").Workspace> | undefined;
let clangFormatterPromise:
  Promise<typeof import("@wasm-fmt/clang-format")> | undefined;

// Preserve native ESM loading in the CommonJS Nest/Jest output. The package is
// ESM-only; transpiling import() to require() cannot load its Node entry point.
const loadClangFormatter = new Function(
  "return import('@wasm-fmt/clang-format')",
) as () => Promise<typeof import("@wasm-fmt/clang-format")>;

function resolveWebTreeSitterWasmPath(): string {
  return require.resolve("web-tree-sitter/tree-sitter.wasm");
}

async function loadTreeSitterRuntime(): Promise<TreeSitterRuntime> {
  treeSitterRuntimePromise ??= import("web-tree-sitter")
    .then(async ({ default: Parser }) => {
      const wasmPath = resolveWebTreeSitterWasmPath();
      await Parser.init({
        locateFile: (file: string) =>
          file === "tree-sitter.wasm" || file.endsWith("/tree-sitter.wasm")
            ? wasmPath
            : file,
      });
      return Parser;
    })
    .catch((error: unknown) => {
      treeSitterRuntimePromise = undefined;
      throw error;
    });
  return treeSitterRuntimePromise;
}

async function loadParser(language: ParserLanguage): Promise<TreeSitterParser> {
  const existing = parserPromises.get(language);
  if (existing) return existing;

  const loading = loadTreeSitterRuntime()
    .then(async (Parser) => {
      const parser = new Parser();
      const grammarPath = require.resolve(
        `tree-sitter-wasms/out/tree-sitter-${language}.wasm`,
      );
      const grammar = await Parser.Language.load(grammarPath);
      parser.setLanguage(grammar);
      return parser;
    })
    .catch((error: unknown) => {
      parserPromises.delete(language);
      throw error;
    });
  parserPromises.set(language, loading);
  return loading;
}

async function assertValidSyntax(
  source: string,
  language: HighlightCodeLanguageId,
): Promise<void> {
  const parserLanguage = LANGUAGE_TOOLING[language]?.treeSitter;
  if (!parserLanguage) return;

  const loading = loadParser(parserLanguage);
  const parser = await Promise.race([
    loading,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new CodeSyntaxToolUnavailableError(language)),
        SYNTAX_TOOL_LOAD_TIMEOUT_MS,
      );
      timer.unref?.();
    }),
  ]).catch((error: unknown) => {
    void loading.catch(() => undefined);
    throw error;
  });
  const tree = parser.parse(source);
  try {
    if (tree.rootNode.hasError()) {
      throw new Error(`invalid ${language} syntax`);
    }
  } finally {
    tree.delete();
  }
}

async function formatPython(source: string): Promise<string> {
  ruffWorkspacePromise ??= import("@astral-sh/ruff-wasm-nodejs").then(
    ({ PositionEncoding, Workspace }) =>
      new Workspace(
        {
          "line-length": 88,
          "indent-width": 4,
          format: {
            "indent-style": "space",
            "quote-style": "double",
          },
        },
        PositionEncoding.Utf16,
      ),
  );
  const workspace = await ruffWorkspacePromise;
  return workspace.format(source);
}

async function formatWithClang(
  source: string,
  filename: string,
): Promise<string> {
  clangFormatterPromise ??= loadClangFormatter().then(async (clang) => {
    await clang.default();
    return clang;
  });
  const clang = await clangFormatterPromise;
  return clang.format(
    source,
    filename,
    "{BasedOnStyle: LLVM, ColumnLimit: 88, IndentWidth: 2}",
  );
}

async function formatCode(
  source: string,
  language: HighlightCodeLanguageId,
): Promise<string> {
  const tooling = LANGUAGE_TOOLING[language];
  if (tooling?.ruff) return formatPython(source);
  if (tooling?.clangFilename) {
    return formatWithClang(source, tooling.clangFilename);
  }
  if (!tooling?.prettier) return source;

  const { format } =
    require("prettier/standalone") as typeof import("prettier/standalone");
  const estree = require("prettier/plugins/estree");
  const plugins: NonNullable<import("prettier").Options["plugins"]> =
    tooling.prettier === "babel" || tooling.prettier === "json"
      ? [require("prettier/plugins/babel"), estree]
      : tooling.prettier === "typescript"
        ? [require("prettier/plugins/typescript"), estree]
        : tooling.prettier === "css" || tooling.prettier === "scss"
          ? [require("prettier/plugins/postcss")]
          : tooling.prettier === "html"
            ? [require("prettier/plugins/html")]
            : [require("prettier/plugins/yaml")];
  return format(source, {
    parser: tooling.prettier,
    plugins,
    printWidth: 88,
    tabWidth: 2,
  });
}

function trimOneTrailingNewline(source: string): string {
  return source.endsWith("\n") ? source.slice(0, -1) : source;
}

async function improveCodeSource(
  source: string,
  language: HighlightCodeLanguageId,
  options: ImproveCodeOptions,
): Promise<{ source: string; language: string }> {
  const improve = async (candidate: string): Promise<string> => {
    await assertValidSyntax(candidate, language);
    const formatted = trimOneTrailingNewline(
      await formatCode(candidate, language),
    );
    await assertValidSyntax(formatted, language);
    return formatted;
  };

  try {
    return { source: await improve(source), language };
  } catch (cause) {
    // Syntax checking is a publication safeguard, not a reason to leave an
    // otherwise valid lesson permanently in `building`. In packaged/local
    // runtimes a lazily loaded WASM grammar can be unavailable or fail to
    // initialize; preserve the authored code and publish the lesson.
    if (cause instanceof CodeSyntaxToolUnavailableError) {
      return { source, language };
    }
    const initialError =
      cause instanceof Error
        ? cause
        : new Error(String(cause || "invalid generated source"));
    if (options.repairInvalidCode) {
      try {
        const repaired = await options.repairInvalidCode({
          source,
          language,
          error: initialError,
        });
        return { source: await improve(repaired), language };
      } catch {
        // The caller may elect to publish the isolated source as plain text.
      }
    }
    if (options.preserveInvalidCodeAsText) {
      await options.onInvalidCodeFallback?.({
        source,
        language,
        error: initialError,
      });
      return { source, language: "text" };
    }
    throw initialError;
  }
}

/**
 * Repairs legacy fence shapes, rejects syntactically invalid supported code,
 * and formats valid code using a language-native formatter when available.
 * Heavy runtimes and individual grammars are loaded only when a generated
 * material block actually contains a supported code fence.
 */
export async function improveMarkdownCodeFences(
  markdown: string,
  options: ImproveCodeOptions = {},
): Promise<string> {
  const repaired = repairBareMarkdownCodeFences(markdown, options);
  const fence = /(^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;
  let cursor = 0;
  let output = "";

  for (const match of repaired.matchAll(fence)) {
    const index = match.index ?? 0;
    output += repaired.slice(cursor, index);

    const prefix = match[1] ?? "";
    const marker = match[2] ?? "```";
    const info = (match[3] ?? "").trim();
    const source = match[4] ?? "";
    const language = resolveHighlightCodeLanguage(info.split(/\s+/)[0] ?? "");

    if (!language || source.length > MAX_CODE_BLOCK_LENGTH) {
      output += match[0];
      cursor = index + match[0].length;
      continue;
    }

    const improved = await improveCodeSource(source, language, options);
    const improvedInfo = improved.language === "text" ? "text" : info;
    output += `${prefix}${marker}${improvedInfo}\n${improved.source}\n${marker}`;
    cursor = index + match[0].length;
  }

  return output + repaired.slice(cursor);
}

async function improveCodeStrings(
  value: unknown,
  options: ImproveCodeOptions,
): Promise<unknown> {
  if (typeof value === "string") {
    return value.includes("```") || value.includes("~~~")
      ? improveMarkdownCodeFences(value, options)
      : value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => improveCodeStrings(item, options)));
  }
  if (!value || typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  if (
    object.type === "code" &&
    typeof object.code === "string" &&
    typeof object.language === "string"
  ) {
    if (Array.isArray(object.parts) && object.parts.length > 1) {
      return object;
    }
    const language = resolveHighlightCodeLanguage(object.language);
    if (language) {
      const normalizedSource = formatCollapsedCodeBody(
        language,
        object.code.replace(/\n$/, ""),
      );
      const improved = await improveCodeSource(
        normalizedSource,
        language,
        options,
      );
      const next: Record<string, unknown> = {
        ...object,
        language: improved.language,
        code: improved.source,
      };
      if (Array.isArray(object.parts) && object.parts.length === 1) {
        const only = object.parts[0];
        if (only && typeof only === "object" && !Array.isArray(only)) {
          next.parts = [{ ...only, text: improved.source }];
        }
      }
      return next;
    }
  }

  return Object.fromEntries(
    await Promise.all(
      Object.entries(object).map(
        async ([key, item]) =>
          [key, await improveCodeStrings(item, options)] as const,
      ),
    ),
  );
}

export async function improveLearningMaterialCode(
  material: {
    introduction: string;
    blocks: InteractiveBlock[];
    keyTakeaways: string[];
  },
  options: ImproveCodeOptions = {},
): Promise<typeof material> {
  return (await improveCodeStrings(material, options)) as typeof material;
}
