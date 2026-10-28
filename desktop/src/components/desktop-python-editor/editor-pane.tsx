"use client";

import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { bracketMatching } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { Play, Square, WandSparkles, X } from "lucide-react";
import {
  formatPythonAskAiMessage,
  formatPythonConsoleText,
} from "@/components/desktop-python-editor/ask-ai";
import { pythonEditorTheme } from "@/components/desktop-python-editor/python-highlight";
import { useDesktopPythonEditor } from "@xue-learn/core/components/desktop-python-editor/python-editor-provider";
import { DesktopPythonTerminal } from "@/components/desktop-python-editor/python-terminal";
import { Button } from "@xue-learn/core/ui/button";
import { useT } from "@xue-learn/core/i18n";

export function DesktopPythonEditorView({
  onAskAi,
}: {
  onAskAi: (message: string) => void;
}) {
  const t = useT();
  const editor = useDesktopPythonEditor();
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const running =
    editor?.status === "loading" ||
    editor?.status === "running" ||
    editor?.status === "awaiting_input";

  useEffect(() => {
    if (!parentRef.current || !editor) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: editor.code,
        extensions: [
          lineNumbers(),
          history(),
          python(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          ...pythonEditorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) editor.setCode(update.state.doc.toString());
          }),
        ],
      }),
      parent: parentRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when a new scratch session starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.session?.openedAt]);

  if (!editor?.session) return null;

  const output = formatPythonConsoleText(editor.consoleLines);
  const statusLabel =
    editor.status === "loading"
      ? t("pythonEditor.loadingRuntime")
      : editor.status === "awaiting_input"
        ? t("pythonEditor.waitingForInput")
        : editor.status === "running"
          ? t("pythonEditor.running")
          : t("pythonEditor.console");

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--course-content-code-bg)]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--course-content-code-border)] bg-[var(--course-content-code-header-bg)] px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() => (running ? editor.interrupt() : editor.run())}
        >
          {running ? (
            <Square className="size-3" aria-hidden />
          ) : (
            <Play className="size-3" aria-hidden />
          )}
          {running ? t("pythonEditor.stop") : t("pythonEditor.run")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-[var(--course-content-code-muted)] hover:bg-white/10 hover:text-[var(--course-content-code-text)]"
          disabled={!output.trim()}
          onClick={() =>
            onAskAi(
              formatPythonAskAiMessage({
                code: editor.code,
                output,
              }),
            )
          }
        >
          <WandSparkles className="size-3" aria-hidden />
          {t("pythonEditor.askAi")}
        </Button>
        <span className="min-w-0 flex-1 truncate px-2 text-[11px] text-[var(--course-content-code-muted)]">
          {statusLabel}
        </span>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-[var(--course-content-code-muted)] hover:bg-white/10 hover:text-[var(--course-content-code-text)]"
          onClick={editor.closeEditor}
          aria-label={t("pythonEditor.close")}
          title={t("pythonEditor.close")}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-hidden" />
      <DesktopPythonTerminal
        lines={editor.consoleLines}
        awaitingInput={editor.status === "awaiting_input"}
        title={t("pythonEditor.console")}
        emptyLabel={t("pythonEditor.emptyConsole")}
        inputPlaceholder={t("pythonEditor.inputPlaceholder")}
        clearLabel={t("pythonEditor.clearConsole")}
        onClear={editor.clearConsole}
        onSubmitInput={editor.submitStdin}
      />
    </div>
  );
}
