import { PDFDict, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { serializeAigcMetadata } from "./metadata.js";

export async function writeAigcPdfMetadata(
  pdf: Buffer,
  contentId: string,
): Promise<Buffer> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  document.setProducer("xue-learn");
  const infoRef = document.context.trailerInfo.Info;
  const info = infoRef
    ? document.context.lookup(infoRef, PDFDict)
    : document.context.obj({});
  if (!infoRef) {
    document.context.trailerInfo.Info = document.context.register(info);
  }
  info.set(
    PDFName.of("AIGC"),
    PDFHexString.fromText(serializeAigcMetadata(contentId)),
  );
  const output = Buffer.from(
    await document.save({ useObjectStreams: false, addDefaultPage: false }),
  );

  const verified = await PDFDocument.load(output, { updateMetadata: false });
  const verifiedInfoRef = verified.context.trailerInfo.Info;
  const verifiedInfo = verifiedInfoRef
    ? verified.context.lookup(verifiedInfoRef, PDFDict)
    : null;
  if (!verifiedInfo?.has(PDFName.of("AIGC"))) {
    throw new Error("PDF AIGC metadata verification failed");
  }
  return output;
}
