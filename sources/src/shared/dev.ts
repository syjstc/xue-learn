/** True only when `VITE_ENABLE_DEV_TOOLS=true` (set on `dev:web`, not on build/preview). */
export function isDev(): boolean {
  return import.meta.env.VITE_ENABLE_DEV_TOOLS === "true";
}
