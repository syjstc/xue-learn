import { protocol, type Session } from "electron";
import {
  INTERACTIVE_HTML_SCHEME,
  InteractiveHtmlPlayground,
} from "./interactive-html-store.ts";

export {
  INTERACTIVE_HTML_HOST,
  INTERACTIVE_HTML_MAX_CHARS,
  INTERACTIVE_HTML_SCHEME,
  InteractiveHtmlPlayground,
  interactiveHtmlDocumentUrl,
  parseInteractiveHtmlDocumentId,
  type InteractiveHtmlRegistration,
} from "./interactive-html-store.ts";

/** Matches `wrapInteractiveHtmlDocument` so the playground is no-network. */
export const INTERACTIVE_HTML_DOCUMENT_CSP =
  "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Must run before `app.whenReady()`. */
export function registerInteractiveHtmlScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: INTERACTIVE_HTML_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

export function installInteractiveHtmlProtocol(
  electronSession: Session,
  playground: InteractiveHtmlPlayground,
): void {
  electronSession.protocol.handle(INTERACTIVE_HTML_SCHEME, (request) => {
    const html = playground.documentForUrl(request.url);
    if (!html) {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": INTERACTIVE_HTML_DOCUMENT_CSP,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  });
}
