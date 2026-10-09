const MAX_INTERACTIVE_HTML_CHARS = 80_000;
const HOST_STYLE_MARKER = "data-xuelearn-host-style";
const HOST_SCRIPT_MARKER = "data-xuelearn-host-script";

const CSP =
  "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Light-theme tokens mirrored from src/shared/design-tokens.json. */
const LAB_HOST_CSS = `
:root {
  --ink: #3E3632;
  --muted: #7A6F65;
  --canvas: #F5F0EB;
  --background: #FAF7F4;
  --primary: #C25B56;
  --primary-soft: rgba(194, 91, 86, 0.07);
  --border: #DDD5CB;
  --surface: #FAF7F4;
  --success: #6BAF7C;
  --warning: #D4A03C;
  --info: #5B8FB9;
  --focus: rgba(194, 91, 86, 0.35);
  --shadow: 0 12px 30px -24px rgba(62, 54, 50, 0.55);
}
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  color-scheme: light;
  background: var(--canvas);
  color: var(--ink);
  font: 14px/1.45 "SF Pro Text", "PingFang SC", system-ui, sans-serif;
}
* { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
button { -webkit-tap-highlight-color: transparent; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
button:disabled { cursor: not-allowed; }
canvas { display: block; max-width: 100%; background: #ffffff; }
svg { display: block; max-width: 100%; }
.xl-lab {
  min-height: 100vh;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: clamp(16px, 3.5vw, 32px);
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 2.5vw, 22px);
}
.xl-panel, .xl-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: clamp(14px, 2.5vw, 22px);
}
.xl-title { margin: 0; font-size: clamp(18px, 3vw, 24px); line-height: 1.2; letter-spacing: -0.02em; font-weight: 700; color: var(--ink); }
.xl-caption { margin: 0; font-size: 13px; line-height: 1.6; color: var(--muted); }
.xl-btn {
  appearance: none;
  border: 0;
  border-radius: 12px;
  background: var(--primary);
  color: #fff;
  font: 600 13px/1.2 inherit;
  min-height: 38px;
  padding: 9px 14px;
  cursor: pointer;
  box-shadow: 0 5px 12px -9px rgba(194, 91, 86, 0.9);
  transition: transform 160ms ease, filter 160ms ease, box-shadow 160ms ease;
}
.xl-btn:hover:not(:disabled) { filter: brightness(1.03); transform: translateY(-1px); box-shadow: 0 8px 16px -10px rgba(194, 91, 86, 0.9); }
.xl-btn:active:not(:disabled) { transform: translateY(0); }
.xl-btn:disabled { opacity: 0.45; }
.xl-btn-ghost {
  background: var(--primary-soft);
  color: var(--primary);
  box-shadow: none;
}
.xl-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.xl-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.xl-control { min-width: 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: #fff; }
.xl-control label { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--ink); font-weight: 650; }
.xl-control output { color: var(--primary); font-variant-numeric: tabular-nums; }
input[type="range"] { display: block; accent-color: var(--primary); width: 100%; min-height: 32px; margin: 8px 0 0; cursor: pointer; }
input[type="range"]:focus-visible { outline-offset: 4px; }
canvas, svg { width: 100%; height: auto; border-radius: 14px; }
.xl-stage { overflow: hidden; border: 1px solid var(--border); border-radius: 16px; background: #fff; padding: clamp(10px, 2vw, 18px); }
.xl-insight { border-left: 3px solid var(--primary); border-radius: 0 12px 12px 0; background: var(--primary-soft); color: var(--ink); padding: 12px 14px; }
.xl-muted { color: var(--muted); }
.xl-fade { animation: xl-fade 0.45s ease both; }
.xl-slide { animation: xl-slide 0.45s ease both; }
.xl-draw { animation: xl-draw 0.8s ease both; }
@keyframes xl-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes xl-slide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes xl-draw { from { stroke-dashoffset: 120; } to { stroke-dashoffset: 0; } }
@media (max-width: 560px) {
  .xl-lab { padding: 14px; gap: 14px; }
  .xl-panel, .xl-card { border-radius: 14px; padding: 14px; }
  .xl-control { padding: 11px 12px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
`;

const LAB_HOST_SCRIPT = `
window.XueLearnLab = (function () {
  var playing = false;
  var listeners = [];
  function emit(type) {
    for (var i = 0; i < listeners.length; i++) listeners[i]({ type: type, playing: playing });
  }
  function play() { playing = true; emit("play"); }
  function replay() { playing = false; emit("replay"); play(); }
  function onFrame(cb) { if (typeof cb === "function") listeners.push(cb); }
  return { play: play, replay: replay, onFrame: onFrame, get playing() { return playing; } };
})();

(function () {
  function post(type, payload) {
    try { window.parent.postMessage(Object.assign({ source: "xuelearn-html", type: type }, payload || {}), "*"); } catch (_) {}
  }
  function reportSize() {
    var root = document.querySelector(".xl-lab") || document.body;
    var height = Math.max(
      240,
      root ? root.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0
    );
    post("resize", { height: Math.min(1400, Math.ceil(height)) });
  }
  function reportError(message) {
    post("runtime-error", { message: String(message || "Interactive content error").slice(0, 180) });
  }
  window.addEventListener("error", function (event) { reportError(event.message); });
  window.addEventListener("unhandledrejection", function (event) { reportError(event.reason); });
  window.addEventListener("load", function () {
    reportSize();
    if (typeof ResizeObserver === "function") {
      var root = document.querySelector(".xl-lab") || document.body;
      if (root) new ResizeObserver(reportSize).observe(root);
    }
  });
  setTimeout(reportSize, 0);
})();
`;

function stripExternalScripts(html: string): string {
  return html.replace(
    /<script\b([^>]*?)\bsrc\s*=\s*(['"]).*?\2[^>]*>[\s\S]*?<\/script>/gi,
    "",
  );
}

function stripNavigationHazards(html: string): string {
  return html
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)refresh\1[^>]*>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
}

function extractInnerDocument(html: string): {
  head: string;
  body: string;
} {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (body !== undefined) return { head, body };
  return { head: "", body: html };
}

function wrapBody(body: string): string {
  if (/class\s*=\s*['"][^'"]*\bxl-lab\b/.test(body)) return body;
  return `<div class="xl-lab">${body}</div>`;
}

function stripInjectedHostAssets(head: string): string {
  return head
    .replace(
      new RegExp(`<style\\b[^>]*${HOST_STYLE_MARKER}[^>]*>[\\s\\S]*?<\\/style>`, "gi"),
      "",
    )
    .replace(
      new RegExp(`<script\\b[^>]*${HOST_SCRIPT_MARKER}[^>]*>[\\s\\S]*?<\\/script>`, "gi"),
      "",
    );
}

/** Wrap model HTML in a CSP-fenced, token-styled lab playground document. */
export function wrapInteractiveHtmlDocument(html: string): string | null {
  const trimmed = html.trim();
  if (!trimmed || trimmed.length > MAX_INTERACTIVE_HTML_CHARS) return null;
  const cleaned = stripNavigationHazards(stripExternalScripts(trimmed));
  if (!cleaned.includes("<") || !cleaned.includes(">")) return null;
  const { head, body } = extractInnerDocument(cleaned);
  const sourceHead = stripInjectedHostAssets(head);
  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<style ${HOST_STYLE_MARKER}>${LAB_HOST_CSS}</style>
${sourceHead}
<script ${HOST_SCRIPT_MARKER}>${LAB_HOST_SCRIPT}</script>
</head>
<body>
${wrapBody(body)}
</body>
</html>`;
}
