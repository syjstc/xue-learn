import * as React from "react";
import * as ReactDOM from "react-dom";
import {renderToStaticMarkup} from "react-dom/server";
import { Button } from "@xue-learn/core/ui/button";
import { TeachingDisplay } from "@xue-learn/core/display/teaching-display";
import { InlineMathText } from "@/components/markdown/inline-math-text";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { DesktopPluginViewSession } from "../../../packages/plugin-sdk/src/index";
import type { DesktopPluginRendererHost } from "../../../packages/plugin-sdk/src/renderer";
import type { DesktopPluginCourse } from "../../../packages/plugin-sdk/src/renderer";
import type { CourseSourceSnapshotV1 } from "@xue-learn/core/runtime-contracts";
import type { DesktopPluginsBridge } from "./bridge";

export function createPluginRendererHost(options: {
  bridge: DesktopPluginsBridge;
  session: DesktopPluginViewSession;
  pluginId: string;
  viewId: string;
  navigate(path: string): void;
}) {
  const { bridge, session } = options;
  const controller = new AbortController();
  const disposers = new Set<() => void>();
  const assertLive = () => { if (controller.signal.aborted) throw new DOMException("Plugin view closed", "AbortError"); };
  const call: DesktopPluginRendererHost["call"] = async (capability, method, args) => {
    assertLive();
    const result = await bridge.callView(session.sessionId, capability, method, args);
    assertLive();
    return result as never;
  };
  const host: DesktopPluginRendererHost = Object.freeze({
    version: 1,
    React,
    ReactDOM,
    ReactDOMServer: Object.freeze({renderToStaticMarkup}),
    assetUrl: (path: string) => {
      assertLive();
      if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) throw Error("Invalid plugin asset path");
      return new URL(path, session.assetBaseUrl ?? new URL(".", session.moduleUrl)).href;
    },
    pluginId: options.pluginId,
    viewId: options.viewId,
    workspaceId: session.workspaceId,
    signal: controller.signal,
    ui: Object.freeze({ Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Badge }),
    core: Object.freeze({
      courseSource: Object.freeze({
        catalog: () => call<DesktopPluginCourse[]>("workspace.courses", "catalog"),
        readUnit: (unitId: string) => call<CourseSourceSnapshotV1 | null>("workspace.courses", "readUnit", { unitId }),
      }),
      display: Object.freeze({ TeachingDisplay, InlineMathText }),
    }),
    call,
    execute: async (command: string, args?: unknown) => {
      assertLive();
      const result = await bridge.executeView(session.sessionId, command, args);
      assertLive();
      return result as never;
    },
    navigate: (path: string) => {
      assertLive();
      if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw Error("Plugin navigation requires a local route");
      options.navigate(path);
    },
    onDispose: (callback: () => void) => {
      assertLive();
      disposers.add(callback);
      return () => { disposers.delete(callback); };
    },
  });
  return {
    host,
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      for (const dispose of [...disposers].reverse()) {
        try { dispose(); } catch { /* One plugin effect must not skip remaining cleanup. */ }
      }
      disposers.clear();
    },
  };
}
