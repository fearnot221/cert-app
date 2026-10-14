import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import * as fontkit from "fontkit";
import {
  FONT_SHA256,
  IANSUI_SHA256,
  TemplateDocumentSchema,
  interpolateText,
  validateTemplateData,
  type CertificateData,
  type TemplateDocument,
} from "@cert/contracts";
import {
  CertificateView,
  RENDER_FONT_FAMILY,
  IANSUI_RENDER_FAMILY,
} from "./index";
import { fitCertificateText } from "./layout";

export const DEFAULT_FONT_PATH = fileURLToPath(
  new URL("../fonts/NotoSansTC-wght.ttf", import.meta.url),
);
export const IANSUI_FONT_PATH = fileURLToPath(
  new URL("../fonts/Iansui-Regular.ttf", import.meta.url),
);
export { FONT_SHA256 } from "@cert/contracts";

export interface RenderPdfOptions {
  document: TemplateDocument;
  data: CertificateData;
  background?: { id: string; mimeType: string; bytes: Buffer };
  /** Trusted application configuration only. Never expose this field in an HTTP request schema. */
  fontPath?: string;
}

export function validateGlyphs(text: string, fontBytes: Buffer): void {
  const font = fontkit.create(fontBytes);
  if (!("hasGlyphForCodePoint" in font)) throw new Error("不支援字型集合檔案");
  const missing = [
    ...new Set(
      [...text].filter((character) => {
        if (/^[\n\r\t]$/.test(character)) return false;
        return !font.hasGlyphForCodePoint(character.codePointAt(0)!);
      }),
    ),
  ];
  if (missing.length)
    throw new Error(
      `字型缺字：${missing
        .slice(0, 20)
        .map(
          (character) =>
            `${character} (U+${character.codePointAt(0)!.toString(16).toUpperCase()})`,
        )
        .join("、")}`,
    );
}

async function buildMarkup(
  options: RenderPdfOptions,
): Promise<{ html: string; document: TemplateDocument }> {
  const document = TemplateDocumentSchema.parse(options.document);
  const issues = validateTemplateData(document, options.data);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join("；"));
  const bytes = await readFile(options.fontPath ?? DEFAULT_FONT_PATH);
  if (createHash("sha256").update(bytes).digest("hex") !== FONT_SHA256)
    throw new Error("字型檔案版本或雜湊不符，拒絕替換字型產證");
  const iansui = document.elements.some((e) => e.fontFamily === "Iansui")
    ? await readFile(IANSUI_FONT_PATH)
    : undefined;
  if (
    iansui &&
    createHash("sha256").update(iansui).digest("hex") !== IANSUI_SHA256
  )
    throw new Error("芫荽字型完整性檢查失敗");
  for (const element of document.elements)
    validateGlyphs(
      interpolateText(element.text, options.data),
      element.fontFamily === "Iansui" ? iansui! : bytes,
    );
  const assetUrls: Record<string, string> = {};
  if (document.backgroundAssetId) {
    if (
      !options.background ||
      options.background.id !== document.backgroundAssetId
    )
      throw new Error("找不到模板指定的背景資產");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(
        options.background.mimeType,
      )
    )
      throw new Error("不支援背景格式");
    if (options.background.bytes.byteLength > 20 * 1024 * 1024)
      throw new Error("背景檔案超過 20 MB");
    assetUrls[document.backgroundAssetId] =
      `data:${options.background.mimeType};base64,${options.background.bytes.toString("base64")}`;
  }
  const body = renderToStaticMarkup(
    <CertificateView
      document={document}
      data={options.data}
      iansuiUrl={
        iansui ? `data:font/ttf;base64,${iansui.toString("base64")}` : undefined
      }
      fontUrl={`data:font/ttf;base64,${bytes.toString("base64")}`}
      assetUrls={assetUrls}
    />,
  );
  return {
    document,
    html: `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>@page{size:${document.widthMm}mm ${document.heightMm}mm;margin:0}html,body{margin:0;padding:0}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}</body></html>`,
  };
}

/** One isolated Chromium process per invocation; callers must cap concurrent jobs. No remote or file URLs are loaded. */
export async function renderPdf(options: RenderPdfOptions): Promise<Buffer> {
  const { html, document: template } = await buildMarkup(options);
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: process.platform === "linux",
    timeout: 30000,
  });
  // Font decoding and page.pdf do not consistently honor page default timeouts.
  const deadline = setTimeout(() => {
    void browser.close().catch(() => undefined);
  }, 45000);
  deadline.unref();
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      javaScriptEnabled: false,
    });
    // The template contains no executable content. Explicit page.evaluate below is application-owned code.
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(
      async (families) => {
        for (const family of families) {
          const fonts = await document.fonts.load(`400 12pt "${family}"`);
          const boldFonts = await document.fonts.load(`700 12pt "${family}"`);
          await document.fonts.ready;
          if (
            !fonts.length ||
            !boldFonts.length ||
            !document.fonts.check(`400 12pt "${family}"`)
          )
            throw new Error("證書字型載入失敗");
        }
        await Promise.all(
          [...document.images].map(async (image) => {
            await image.decode();
            if (!image.naturalWidth) throw new Error("證書背景載入失敗");
          }),
        );
      },
      [
        RENDER_FONT_FAMILY,
        ...(template.elements.some((e) => e.fontFamily === "Iansui")
          ? [IANSUI_RENDER_FAMILY]
          : []),
      ],
    );
    const errors = (await page.evaluate(
      `(${fitCertificateText.toString()})(document)`,
    )) as string[];
    if (errors.length) throw new Error(errors.join("；"));
    return await page.pdf({
      width: `${template.widthMm}mm`,
      height: `${template.heightMm}mm`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      tagged: true,
    });
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
