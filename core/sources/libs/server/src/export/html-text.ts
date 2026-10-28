import { CITATION_MARKER_RE } from "../citations/inline-citations.js";

/** Remove [^n] and bare [n] citation markers from PDF text. */
export function stripCitationMarkersForPdf(text: string): string {
  if (!text) return text;
  return text
    .replace(CITATION_MARKER_RE, "")
    .replace(/\[\d+\]/g, "");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
