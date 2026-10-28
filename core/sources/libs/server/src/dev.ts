/** True when the server is not running in production. */
export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}
