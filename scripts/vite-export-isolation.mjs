// An export must keep the renderer that started it: HMR/full reload loses the
// pending seek and can also mix different component versions in one video.
const connect = "transport.connect(createHMRHandler(handleMessage));";
const isolatedConnect = `if (typeof location === "undefined" || location.pathname !== "/lesson-performance-export") {
  ${connect}
}`;

export function isolateExportClient(code) {
  if (code.split(connect).length !== 2) {
    throw new Error("Vite client connection changed; update export HMR isolation before serving exports");
  }
  return code.replace(connect, isolatedConnect);
}

export function exportIsolationPlugin() {
  return {
    name: "xuelearn-export-isolation",
    apply: "serve",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").split("?")[0].endsWith("/vite/dist/client/client.mjs")) return null;
      return { code: isolateExportClient(code), map: null };
    },
  };
}
