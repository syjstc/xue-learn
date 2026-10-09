export function pyodideIndexURL(origin: string): string {
  return new URL("pyodide/", `${origin}/`).href;
}
