import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { LabRuntimeApp } from "./runtime-app.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Lab runtime root is missing");

class LabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep details local to the Lab frame. The host receives failure facts via
    // the protocol, never an exception or stack trace from the renderer.
    console.error("Lab runtime failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", color: "#4b5563" }}><div role="alert"><strong>实验室视图暂时不可用</strong><p style={{ marginTop: 8, fontSize: 13 }}>请返回主应用继续查看实验摘要和观察要点。</p></div></main>;
    }
    return this.props.children;
  }
}

createRoot(root).render(
  <StrictMode>
    <LabErrorBoundary>
      <LabRuntimeApp />
    </LabErrorBoundary>
  </StrictMode>,
);
