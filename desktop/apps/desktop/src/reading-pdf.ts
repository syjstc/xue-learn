import {BrowserWindow, session} from "electron";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {writeAigcPdfMetadata} from "@xue-learn/core/server/aigc/pdf-metadata";

const inputSchema = z.object({html: z.string().min(1).max(30_000_000), layout: z.enum(["mobile", "desktop"])}).strict();

/** A disposable, script-free print surface with no workspace session or network. */
export async function renderReadingPdf(raw: unknown): Promise<Uint8Array> {
  const {html, layout} = inputSchema.parse(raw);
  const directory = await mkdtemp(join(tmpdir(), "xuelearn-reading-pdf-"));
  const filename = join(directory, "chapter.html");
  const printSession = session.fromPartition(`reading-pdf-${randomUUID()}`, {cache: false});
  const allowedFile = pathToFileURL(filename).href;
  printSession.webRequest.onBeforeRequest((request, done) => done({
    cancel: request.url !== allowedFile && !request.url.startsWith("data:"),
  }));
  printSession.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
  const window = new BrowserWindow({show: false, webPreferences: {
    session: printSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
    javascript: false, webSecurity: true, webviewTag: false,
  }});
  window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
  window.webContents.on("will-navigate", event => event.preventDefault());
  try {
    await writeFile(filename, html);
    await window.loadFile(filename);
    const mobile = layout === "mobile";
    const pdf = await window.webContents.printToPDF({
      printBackground: true, generateTaggedPDF: true, generateDocumentOutline: true,
      pageSize: mobile ? {width: 390 / 96, height: 844 / 96} : "A4",
      margins: mobile ? {top: 22 / 96, bottom: 36 / 96, left: 20 / 96, right: 20 / 96}
        : {top: 44 / 96, bottom: 52 / 96, left: 48 / 96, right: 48 / 96},
      displayHeaderFooter: true, headerTemplate: "<span></span>",
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#64748b">AI · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    return new Uint8Array(await writeAigcPdfMetadata(pdf, randomUUID()));
  } finally {
    window.destroy();
    await printSession.clearStorageData();
    await rm(directory, {recursive: true, force: true});
  }
}
