import type {DisplayResource} from "../../../libs/display/src/types.js";

export type BrowserDisplayResource = Readonly<{uri: string; width?: number; height?: number; duration?: number; family?: string; data?: unknown}>;
export type BrowserDisplayResourceResolver = ((resource: DisplayResource) => Promise<BrowserDisplayResource>) & {dispose: () => void};

/** Create one resolver per runtime. Verified bytes are retained as blob URLs until disposal. */
export function createBrowserDisplayResourceResolver(options: {resolveUri?: (resource: DisplayResource) => string | Promise<string>; timeoutMs?: number} = {}): BrowserDisplayResourceResolver {
  const blobs = new Set<string>(), fonts = new Set<FontFace>(), controllers = new Set<AbortController>(), cancel = new Set<() => void>();
  let disposed = false;
  const fetchResource = async (uri: string, resource: DisplayResource): Promise<{bytes: ArrayBuffer; contentType: string}> => {
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      const response = await fetch(uri, {signal: controller.signal, credentials: "omit", ...(resource.integrity ? {integrity: resource.integrity} : {})});
      if (!response.ok) throw new Error(`Display resource returned HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      return {bytes, contentType: response.headers.get("content-type") ?? "application/octet-stream"};
    } finally {clearTimeout(timeout); controllers.delete(controller);}
  };
  const resolver = async (resource: DisplayResource): Promise<BrowserDisplayResource> => {
    if (disposed) throw new Error("Display resource resolver is disposed");
    let uri = await (options.resolveUri?.(resource) ?? resource.uri);
    if (/^\s*(?:javascript|vbscript):/i.test(uri)) throw new Error("Unsupported display resource URI");
    if (resource.kind === "data" || resource.kind === "font") {
      const response = await fetchResource(uri, resource);
      if (disposed) throw new Error("Display resource resolver is disposed");
      if (resource.kind === "data") {const text = new TextDecoder().decode(response.bytes); return {uri, data: /json/i.test(response.contentType) ? JSON.parse(text) : text};}
      const family = resource.id;
      const face = new FontFace(family, response.bytes);
      await face.load();
      if (disposed) throw new Error("Display resource resolver is disposed");
      fonts.add(face); document.fonts.add(face);
      await document.fonts.ready;
      return {uri, family};
    }
    if (resource.integrity) {
      const response = await fetchResource(uri, resource);
      if (disposed) throw new Error("Display resource resolver is disposed");
      uri = URL.createObjectURL(new Blob([response.bytes], {type: response.contentType})); blobs.add(uri);
    }
    if (disposed) throw new Error("Display resource resolver is disposed");
    return new Promise<BrowserDisplayResource>((resolve, reject) => {
      const element = resource.kind === "image" ? new Image() : resource.kind === "video" ? document.createElement("video") : document.createElement("audio");
      let settled = false;
      const stop = () => finish(new Error(`Cancelled display resource ${resource.id}`));
      const timeout = setTimeout(() => finish(new Error(`Timed out loading ${resource.id}`)), options.timeoutMs ?? 20_000);
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); cancel.delete(stop);
        element.removeEventListener("error", failed);
        element.removeEventListener(resource.kind === "image" ? "load" : "loadeddata", loaded);
        if (error) {element.removeAttribute("src"); reject(error);}
        else if (element instanceof HTMLImageElement) resolve({uri, width: element.naturalWidth, height: element.naturalHeight});
        else {const result = {uri, duration: Number.isFinite(element.duration) ? element.duration : undefined, ...(element instanceof HTMLVideoElement ? {width: element.videoWidth, height: element.videoHeight} : {})}; element.removeAttribute("src"); resolve(result);}
      };
      const failed = () => finish(new Error(`Could not load display resource ${resource.id}`));
      const loaded = () => {
        if (element instanceof HTMLImageElement && typeof element.decode === "function") void element.decode().then(() => finish(), finish);
        else finish();
      };
      cancel.add(stop);
      element.addEventListener("error", failed);
      element.addEventListener(resource.kind === "image" ? "load" : "loadeddata", loaded);
      if (!(element instanceof HTMLImageElement)) element.preload = "auto";
      if (/^https?:/i.test(uri)) element.crossOrigin = "anonymous";
      element.src = uri;
    });
  };
  return Object.assign(resolver, {dispose: () => {
    disposed = true;
    for (const controller of controllers) controller.abort();
    for (const stop of [...cancel]) stop();
    for (const uri of blobs) URL.revokeObjectURL(uri);
    for (const font of fonts) document.fonts.delete(font);
    blobs.clear(); fonts.clear(); controllers.clear();
  }});
}
