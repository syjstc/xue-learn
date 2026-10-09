"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDesktopDocumentPreview } from "../goals/desktop-document-preview.js";
import {
  DesktopPythonRuntime,
  type PythonConsoleLine,
} from "./python-runtime.js";

type PythonEditorStatus = "idle" | "loading" | "running" | "ready" | "awaiting_input";

type DesktopPythonEditorContextValue = {
  session: { openedAt: number } | null;
  code: string;
  setCode: (code: string) => void;
  consoleLines: PythonConsoleLine[];
  status: PythonEditorStatus;
  lastRunFailed: boolean;
  openEditor: (code: string, options?: { run?: boolean }) => void;
  closeEditor: () => void;
  run: () => void;
  interrupt: () => void;
  submitStdin: (line: string) => void;
  clearConsole: () => void;
};

const DesktopPythonEditorContext =
  createContext<DesktopPythonEditorContextValue | null>(null);

export function DesktopPythonEditorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const documentPreview = useDesktopDocumentPreview();
  const runtimeRef = useRef<DesktopPythonRuntime | null>(null);
  const codeRef = useRef("");
  const [session, setSession] = useState<{ openedAt: number } | null>(null);
  const [code, setCodeState] = useState("");
  const [consoleLines, setConsoleLines] = useState<PythonConsoleLine[]>([]);
  const [status, setStatus] = useState<PythonEditorStatus>("idle");
  const [lastRunFailed, setLastRunFailed] = useState(false);

  const setCode = useCallback((next: string) => {
    codeRef.current = next;
    setCodeState(next);
  }, []);

  useEffect(() => {
    const runtime = new DesktopPythonRuntime();
    runtimeRef.current = runtime;
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === "status") {
        setStatus(
          event.status === "ready" ? "running" : event.status,
        );
        return;
      }
      if (event.type === "line") {
        if (event.line.stream === "stderr") setLastRunFailed(true);
        setConsoleLines((current) => [...current, event.line]);
        return;
      }
      setStatus("ready");
      if (!event.ok) setLastRunFailed(true);
    });
    return () => {
      unsubscribe();
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const run = useCallback(() => {
    setLastRunFailed(false);
    setConsoleLines([]);
    setStatus("loading");
    void runtimeRef.current?.run(codeRef.current);
  }, []);

  const openEditor = useCallback(
    (source: string, options?: { run?: boolean }) => {
      setCode(source.replace(/\n$/, ""));
      setSession({ openedAt: Date.now() });
      documentPreview?.showEditor();
      if (options?.run) {
        setLastRunFailed(false);
        setConsoleLines([]);
        setStatus("loading");
        void runtimeRef.current?.run(codeRef.current);
      }
    },
    [documentPreview, setCode],
  );

  const closeEditor = useCallback(() => {
    setSession(null);
    if (documentPreview?.activeView === "editor") {
      if (documentPreview.document) documentPreview.showDocument();
      else documentPreview.showAssistant();
    }
  }, [documentPreview]);

  const interrupt = useCallback(() => {
    runtimeRef.current?.interrupt();
  }, []);

  const submitStdin = useCallback((line: string) => {
    runtimeRef.current?.sendStdin(line);
  }, []);

  const clearConsole = useCallback(() => {
    setConsoleLines([]);
    setLastRunFailed(false);
  }, []);

  const value = useMemo(
    () => ({
      session,
      code,
      setCode,
      consoleLines,
      status,
      lastRunFailed,
      openEditor,
      closeEditor,
      run,
      interrupt,
      submitStdin,
      clearConsole,
    }),
    [
      session,
      code,
      setCode,
      consoleLines,
      status,
      lastRunFailed,
      openEditor,
      closeEditor,
      run,
      interrupt,
      submitStdin,
      clearConsole,
    ],
  );

  return (
    <DesktopPythonEditorContext.Provider value={value}>
      {children}
    </DesktopPythonEditorContext.Provider>
  );
}

export function useDesktopPythonEditor() {
  return useContext(DesktopPythonEditorContext);
}
