import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import * as fontkit from "fontkit";
import { PDFDocument, PDFName, PDFArray, beginMarkedContent, endMarkedContent } from "pdf-lib";
import {
  FONT_SHA256,
  IANSUI_SHA256,
  CWTEX_FONTS,
  type CwtexFamily,
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
  CWTEX_RENDER_FAMILIES,
} from "./index";
import { fitCertificateText } from "./layout";

export const DEFAULT_FONT_PATH = fileURLToPath(
  new URL("../fonts/NotoSansTC-wght.ttf", import.meta.url),
);
export const IANSUI_FONT_PATH = fileURLToPath(
  new URL("../fonts/Iansui-Regular.ttf", import.meta.url),
);
export const CWTEX_FONT_PATHS = Object.fromEntries(
  Object.entries(CWTEX_FONTS).map(([family, font]) => [family, fileURLToPath(new URL(`../fonts/${font.file}`, import.meta.url))]),
) as Record<CwtexFamily, string>;
export { FONT_SHA256 } from "@cert/contracts";

export interface RenderPdfOptions {
  document: TemplateDocument;
  data: CertificateData;
  /**
   * `bytes` is the raster background. `vector`, when present, is the single-page vector PDF a PDF
   * upload was converted from: the certificate is then drawn on that page and keeps its vectors.
   */
  background?: { id: string; mimeType: string; bytes: Buffer; vector?: Buffer };
  /** Trusted application configuration only. Never expose this field in an HTTP request schema. */
  fontPath?: string;
}

export function validateGlyphs(text: string, fontBytes: Buffer, latinFallback?: Buffer): void {
  const font = fontkit.create(fontBytes);
  const fallback = latinFallback ? fontkit.create(latinFallback) : undefined;
  if (!("hasGlyphForCodePoint" in font)) throw new Error("不支援字型集合檔案");
  const missing = [
    ...new Set(
      [...text].filter((character) => {
        if (/^[\n\r\t]$/.test(character)) return false;
        // The OFL ZH fonts contain Chinese only; ASCII uses the pinned Noto font.
        if (/^[\x20-\x7e]$/.test(character) && fallback && "hasGlyphForCodePoint" in fallback)
          return !fallback.hasGlyphForCodePoint(character.codePointAt(0)!);
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
  const cwtex: Partial<Record<CwtexFamily, Buffer>> = {};
  for (const family of Object.keys(CWTEX_FONTS) as CwtexFamily[]) {
    if (!document.elements.some((e) => e.fontFamily === family)) continue;
    const font = await readFile(CWTEX_FONT_PATHS[family]);
    if (createHash("sha256").update(font).digest("hex") !== CWTEX_FONTS[family].sha256)
      throw new Error(`${CWTEX_FONTS[family].label}字型完整性檢查失敗`);
    cwtex[family] = font;
  }
  for (const element of document.elements)
    validateGlyphs(
      interpolateText(element.text, options.data),
      cwtex[element.fontFamily as CwtexFamily] ?? (element.fontFamily === "Iansui" ? iansui! : bytes),
      element.fontFamily in CWTEX_FONTS ? bytes : undefined,
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
    if (
      options.background.bytes.byteLength > 20 * 1024 * 1024 ||
      (options.background.vector?.byteLength ?? 0) > 20 * 1024 * 1024
    )
      throw new Error("背景檔案超過 20 MB");
    if (!options.background.vector)
      assetUrls[document.backgroundAssetId] =
      `data:${options.background.mimeType};base64,${options.background.bytes.toString("base64")}`;
  }
  const body = renderToStaticMarkup(
    <CertificateView
      document={document}
      data={options.data}
      cwtexUrls={Object.fromEntries(Object.entries(cwtex).map(([family, font]) => [family, `data:font/ttf;base64,${font.toString("base64")}`]))}
      iansuiUrl={
        iansui ? `data:font/ttf;base64,${iansui.toString("base64")}` : undefined
      }
      fontUrl={`data:font/ttf;base64,${bytes.toString("base64")}`}
      assetUrls={assetUrls}
    />,
  );
  return {
    document,
    // With a vector background the page is printed transparent and laid over it afterwards.
    html: `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>@page{size:${document.widthMm}mm ${document.heightMm}mm;margin:0}html,body{margin:0;padding:0}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}${options.background?.vector ? "[data-certificate-page]{background-color:transparent!important}" : ""}</style></head><body>${body}</body></html>`,
  };
}

/** One isolated Chromium process per invocation; callers must cap concurrent jobs. No remote or file URLs are loaded. */
export async function renderPdf(options: RenderPdfOptions): Promise<Buffer> {
  const { html, document: template } = await buildMarkup(options);
  const browser = await chromium.launch({
    headless: true,
    // Restricted containers cannot create Chromium's sandbox namespaces.
    chromiumSandbox: process.env.CHROMIUM_SANDBOX === "false"
      ? false
      : process.env.CHROMIUM_SANDBOX === "true" || process.platform === "linux",
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
        ...(Object.keys(CWTEX_FONTS) as CwtexFamily[]).filter((family) => template.elements.some((e) => e.fontFamily === family)).map((family) => CWTEX_RENDER_FAMILIES[family]),
        ...(template.elements.some((e) => e.fontFamily === "Iansui")
          ? [IANSUI_RENDER_FAMILY]
          : []),
      ],
    );
    const errors = (await page.evaluate(
      `(${fitCertificateText.toString()})(document)`,
    )) as string[];
    if (errors.length) throw new Error(errors.join("；"));
    const pdf = await page.pdf({
      width: `${template.widthMm}mm`,
      height: `${template.heightMm}mm`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      tagged: true,
    });
    return options.background?.vector
      ? await underlayVectorBackground(pdf, options.background.vector)
      : pdf;
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}

/**
 * Draws the vector background page underneath the certificate Chromium printed, scaled and centred
 * like the editor's `object-fit: cover`. The certificate page itself is kept as is, so its text stays
 * selectable and its tagged structure intact; the background is marked as an artifact.
 */
export async function underlayVectorBackground(certificate: Buffer, background: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(certificate, { updateMetadata: false });
  const page = doc.getPage(0);
  const [embedded] = await doc.embedPdf(background, [0]);
  if (!embedded) throw new Error("背景向量檔無法讀取");
  const { width, height } = page.getSize();
  const scale = Math.max(width / embedded.width, height / embedded.height);
  const drawn = { width: embedded.width * scale, height: embedded.height * scale };
  page.pushOperators(beginMarkedContent("Artifact"));
  page.drawPage(embedded, { x: (width - drawn.width) / 2, y: (height - drawn.height) / 2, ...drawn });
  page.pushOperators(endMarkedContent());
  // pdf-lib appends the drawing as the last content stream; move it first so it sits underneath.
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) throw new Error("證書頁面內容格式不符");
  const last = contents.get(contents.size() - 1);
  contents.remove(contents.size() - 1);
  contents.insert(0, last);
  page.node.set(PDFName.of("Contents"), contents);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
