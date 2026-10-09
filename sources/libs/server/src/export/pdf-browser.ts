import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: ["--disable-dev-shm-usage", "--font-render-hinting=none"],
      })
      .then((instance) => {
        browser = instance;
        return instance;
      });
  }
  return browserPromise;
}

export async function renderHtmlToPdf(
  html: string,
  options: {
    title: string;
    page?: {
      format?: "A4";
      width?: string;
      height?: string;
      margin: { top: string; bottom: string; left: string; right: string };
      footerPaddingX: string;
    };
  },
): Promise<Buffer> {
  const instance = await getBrowser();
  const page = await instance.newPage();
  const pdfPage = options.page ?? {
    format: "A4" as const,
    margin: { top: "48px", bottom: "56px", left: "48px", right: "48px" },
    footerPaddingX: "48px",
  };

  try {
    await page.setContent(html, { waitUntil: "load" });
    // Emulate print so TOC page counters and internal links resolve correctly.
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      ...(pdfPage.format
        ? { format: pdfPage.format }
        : { width: pdfPage.width, height: pdfPage.height }),
      printBackground: true,
      // Both required: Chromium builds the sidebar bookmark tree from h1–h6.
      tagged: true,
      outline: true,
      margin: pdfPage.margin,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="width:100%;text-align:center;font-size:8px;color:#94a3b8;font-family:NotoSansSC,sans-serif;padding:0 ${pdfPage.footerPaddingX};">
        <span>${options.title.replace(/</g, "&lt;")}</span> · 部分内容由 AI 生成
      </div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
