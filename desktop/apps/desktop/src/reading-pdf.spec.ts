import {BrowserWindow, session} from "electron";
import {renderReadingPdf} from "./reading-pdf.ts";

jest.mock("@xue-learn/core/server/aigc/pdf-metadata", () => ({
  writeAigcPdfMetadata: jest.fn(async bytes => bytes),
}));
jest.mock("electron", () => {
  const partition = {
    webRequest: {onBeforeRequest: jest.fn()}, setPermissionRequestHandler: jest.fn(),
    clearStorageData: jest.fn(async () => {}),
  };
  const window = {
    loadFile: jest.fn(async () => {}), destroy: jest.fn(),
    webContents: {setWindowOpenHandler: jest.fn(), on: jest.fn(), printToPDF: jest.fn(async () => Buffer.from("%PDF-fixture"))},
  };
  return {BrowserWindow: jest.fn(() => window), session: {fromPartition: jest.fn(() => partition)}};
});

it("prints without script or network authority and closes the surface after a print failure", async () => {
  const bytes = await renderReadingPdf({html: "<h1>Text</h1>", layout: "mobile"});
  expect(Buffer.from(bytes).toString()).toContain("%PDF");
  const options = (BrowserWindow as unknown as jest.Mock).mock.calls[0][0];
  expect(options.webPreferences).toMatchObject({sandbox: true, nodeIntegration: false, javascript: false});
  const partition = jest.mocked(session.fromPartition).mock.results[0].value;
  const guard = (partition.webRequest.onBeforeRequest as jest.Mock).mock.calls[0][0];
  const done = jest.fn();
  guard({url: "https://example.com/leak"}, done); expect(done).toHaveBeenLastCalledWith({cancel: true});
  guard({url: "file:///private/secret"}, done); expect(done).toHaveBeenLastCalledWith({cancel: true});
  guard({url: "data:font/woff2;base64,abc"}, done); expect(done).toHaveBeenLastCalledWith({cancel: false});
  const window = (BrowserWindow as unknown as jest.Mock).mock.results[0].value;
  expect(window.webContents.printToPDF).toHaveBeenCalledWith(expect.objectContaining({pageSize: {width: 390 / 96, height: 844 / 96}}));
  window.webContents.printToPDF.mockRejectedValueOnce(Error("print failed"));
  await expect(renderReadingPdf({html: "<h1>Text</h1>", layout: "desktop"})).rejects.toThrow("print failed");
  expect(window.destroy).toHaveBeenCalledTimes(2);
  await expect(renderReadingPdf({html: "<h1>Text</h1>", layout: "invalid"})).rejects.toThrow();
});
