/** Reserved login account name for the admin console. */
export const RESERVED_ADMIN_USERNAME = "admin";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/**
 * Login account username: starts with a letter, then letters/digits/underscore.
 * Length is 3–32 (enforced by the pattern).
 */
export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;

export type UsernameValidationError =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_format"
  | "reserved";

export type UsernameValidationResult =
  | { ok: true; name: string }
  | { ok: false; error: UsernameValidationError };

export function isValidUsernameFormat(name: string): boolean {
  return (
    USERNAME_PATTERN.test(name) &&
    name.toLowerCase() !== RESERVED_ADMIN_USERNAME
  );
}

/**
 * Validate and normalize a login account username.
 * Trims whitespace; does not lower-case (storage remains case-sensitive).
 */
export function validateUsername(value: unknown): UsernameValidationResult {
  if (value == null || typeof value !== "string") {
    return { ok: false, error: "required" };
  }
  const name = value.trim();
  if (!name) {
    return { ok: false, error: "required" };
  }
  if (name.length < USERNAME_MIN_LENGTH) {
    return { ok: false, error: "too_short" };
  }
  if (name.length > USERNAME_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  if (name.toLowerCase() === RESERVED_ADMIN_USERNAME) {
    return { ok: false, error: "reserved" };
  }
  if (!USERNAME_PATTERN.test(name)) {
    return { ok: false, error: "invalid_format" };
  }
  return { ok: true, name };
}
