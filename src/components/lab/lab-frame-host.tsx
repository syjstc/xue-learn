"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import {
  LAB_HANDSHAKE_TYPE,
  LAB_PROTOCOL_NAME,
  LAB_PROTOCOL_VERSION,
  createLabEnvelope,
  isLabHello,
  labEventSchema,
  parseLabEnvelope,
  type LabEvent,
  type LabHostCommand,
  type LabManifestV1,
} from "@xue-learn/core/lab-protocol";

export type LabFrameHostProps = {
  manifest: LabManifestV1;
  title?: string;
  className?: string;
  fallback?: ReactNode;
  onEvent?: (event: LabEvent) => void;
  onReady?: () => void;
  onFailure?: (message: string) => void;
};

export type LabFrameHandle = {
  send: (command: LabHostCommand) => boolean;
  reload: () => void;
};

type BridgeState = "loading" | "ready" | "failed";

function labRuntimeUrl(nonce?: string) {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const devOrigin = env?.VITE_LAB_RUNTIME_ORIGIN?.trim();
  const base = devOrigin
    ? `${devOrigin.replace(/\/$/, "")}/lab-runtime/index.html?embedded=1`
    : "/lab-runtime/index.html?embedded=1";
  return nonce ? `${base}&nonce=${encodeURIComponent(nonce)}` : base;
}

/** Host-side boundary for the standalone Lab runtime. The host owns policy;
 * the iframe owns rendering and deterministic interaction state. */
export const LabFrameHost = forwardRef<LabFrameHandle, LabFrameHostProps>(function LabFrameHost({
  manifest,
  title = "互动实验室",
  className,
  fallback,
  onEvent,
  onReady,
  onFailure,
}: LabFrameHostProps, ref) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const sessionRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const expectedSequenceRef = useRef(-1);
  const nonceRef = useRef(crypto.randomUUID());
  const pendingRef = useRef(new Map<string, number>());
  const [state, setState] = useState<BridgeState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const stateRef = useRef<BridgeState>(state);
  const onEventRef = useRef(onEvent);
  const onReadyRef = useRef(onReady);
  const manifestRef = useRef(manifest);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { manifestRef.current = manifest; }, [manifest]);

  const fail = useCallback((message: string) => {
    setState("failed");
    onFailure?.(message);
  }, [onFailure]);

  const send = useCallback((command: LabHostCommand) => {
    const port = portRef.current;
    const sessionId = sessionRef.current;
    if (!port || !sessionId) return false;
    const messageId = `host-${crypto.randomUUID()}`;
    port.postMessage(
      createLabEnvelope(
        sessionId,
        messageId,
        sequenceRef.current++,
        "command",
        command,
      ),
    );
    pendingRef.current.set(
      messageId,
      window.setTimeout(() => {
        pendingRef.current.delete(messageId);
        fail("实验室指令响应超时");
      }, 8_000),
    );
    return true;
  }, [fail]);
  const sendRef = useRef(send);
  sendRef.current = send;

  useImperativeHandle(ref, () => ({
    send,
    reload: () => setReloadKey((value) => value + 1),
  }), [send]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    const sessionId = crypto.randomUUID();
    const nonce = nonceRef.current;
    sessionRef.current = sessionId;
    expectedSequenceRef.current = -1;
    sequenceRef.current = 0;
    stateRef.current = "loading";
    setState("loading");

    const attachPort = (port: MessagePort) => {
      port.onmessage = (messageEvent: MessageEvent) => {
        const envelope = parseLabEnvelope(messageEvent.data);
        if (!envelope || envelope.sessionId !== sessionId) return;
        if (envelope.sequence <= expectedSequenceRef.current) return;
        expectedSequenceRef.current = envelope.sequence;
        if (envelope.kind === "event") {
          const eventPayload = labEventSchema.safeParse(envelope.payload);
          if (!eventPayload.success) return;
          if (eventPayload.data.type === "ready") {
            sendRef.current({ type: "loadManifest", manifest: manifestRef.current });
            setState("ready");
            stateRef.current = "ready";
            onReadyRef.current?.();
          }
          onEventRef.current?.(eventPayload.data);
        }
        if (envelope.kind === "ack") {
          const timeout = pendingRef.current.get(envelope.id);
          if (timeout !== undefined) {
            window.clearTimeout(timeout);
            pendingRef.current.delete(envelope.id);
          }
          const payload = envelope.payload as { type?: string; accepted?: boolean; error?: { message?: string } };
          if (payload.type === "ack" && payload.accepted === false) {
            fail(payload.error?.message || "实验室指令未被接受");
          }
        }
      };
      port.start();
    };

    const handshake = {
      type: LAB_HANDSHAKE_TYPE,
      protocol: LAB_PROTOCOL_NAME,
      version: LAB_PROTOCOL_VERSION,
      sessionId,
      nonce,
    };
    const frameUrl = labRuntimeUrl(nonce);
    const frameOrigin = new URL(frameUrl, window.location.href).origin;

    const sendHandshake = () => {
      if (disposed || stateRef.current === "ready") return;
      const target = iframe.contentWindow;
      if (!target) return;
      const channel = new MessageChannel();
      portRef.current?.close();
      portRef.current = channel.port1;
      attachPort(channel.port1);
      target.postMessage(handshake, frameOrigin, [channel.port2]);
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (!isLabHello(event.data) || event.data.nonce !== nonce) return;
      sendHandshake();
    };

    window.addEventListener("message", onWindowMessage);
    iframe.addEventListener("load", sendHandshake);
    sendHandshake();
    const timeout = window.setTimeout(() => {
      if (!disposed && stateRef.current !== "ready") fail("实验室加载超时");
    }, 12_000);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onWindowMessage);
      iframe.removeEventListener("load", sendHandshake);
      const port = portRef.current;
      if (sessionRef.current === sessionId && port) {
        try {
          port.postMessage(
            createLabEnvelope(
              sessionId,
              `host-destroy-${crypto.randomUUID()}`,
              sequenceRef.current++,
              "command",
              { type: "destroy" },
            ),
          );
        } catch {
          // The transferred port may already be closed after a remount.
        }
      }
      port?.close();
      portRef.current = null;
      for (const pendingTimeout of pendingRef.current.values()) window.clearTimeout(pendingTimeout);
      pendingRef.current.clear();
      sessionRef.current = null;
    };
  }, [fail, reloadKey]);

  if (state === "failed") {
    return (
      <div className={className} role="alert">
        {fallback ?? (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            <p>{title}暂时无法启动。</p>
            <button type="button" className="mt-3 rounded-md border px-3 py-1.5 text-xs" onClick={() => { setState("loading"); setReloadKey((value) => value + 1); }}>
              重试
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <iframe
      key={reloadKey}
      ref={iframeRef}
      title={title}
      src={labRuntimeUrl(nonceRef.current)}
      className={className ?? "h-[440px] w-full rounded-xl border-0"}
      sandbox="allow-scripts allow-same-origin"
      allow=""
      referrerPolicy="no-referrer"
      onError={() => fail("实验室资源加载失败")}
    />
  );
});
