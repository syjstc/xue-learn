export type DisplayBuildRetryReason = 'provider-busy' | 'connection';

/** Errors survive provider, host and journal boundaries as plain messages.
 * Only known transport failures qualify; a content rejection can quote one. */
export function displayBuildRetryReason(message: string): DisplayBuildRetryReason | null {
  const value = message.trim();
  const prefix = 'Course display build failed: ';
  if (value.startsWith(prefix)) {
    const reasons = value.slice(prefix.length).split('; ').map(displayBuildRetryReason);
    if (reasons.some(reason => reason === null)) return null;
    return reasons.includes('provider-busy') ? 'provider-busy' : 'connection';
  }
  if (/^Our servers are currently overloaded\. Please try again later\.$/i.test(value)
    || /^Codex image generation failed \(HTTP (?:503|529)\)(?::|$)/.test(value)) return 'provider-busy';
  if (/^(?:fetch failed|Failed to fetch|Connection error\.?|terminated|socket hang up|network error)$/i.test(value)
    || /^(?:connect |read |write )?(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)(?:\s[^;]*)?$/.test(value)) return 'connection';
  return null;
}

export const displayBuildRetryDelayMs = (reason: DisplayBuildRetryReason) => reason === 'provider-busy' ? 60_000 : 10_000;
