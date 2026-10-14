import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream, rgb } from "pdf-lib";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  createDefaultDocument,
  FONT_SHA256,
  IANSUI_SHA256,
} from "@cert/contracts";
import { CertificateView } from "./index";
import {
  DEFAULT_FONT_PATH,
  IANSUI_FONT_PATH,
  renderPdf,
  underlayVectorBackground,
  validateGlyphs,
} from "./server";

const data = {
  recipient_name: "王小明",
  recipient_email: "recipient@example.test",
  organization_name: "繁體中文測試學院",
  event_name: "認證課程",
  issue_date: "2026-10-15",
  certificate_number: "CERT-000128",
};

describe("shared HTML and pinned font", () => {
  it("escapes interpolated HTML and blocks remote asset URLs", () => {
    const props = {
      document: createDefaultDocument(),
      data: { ...data, recipient_name: "<script>alert(1)</script>" },
      assetUrls: {},
      fontUrl: "/api/fonts/noto-sans-tc",
    };
    const html = renderToStaticMarkup(createElement(CertificateView, props));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(() =>
      renderToStaticMarkup(
        createElement(CertificateView, {
          ...props,
          fontUrl: "https://attacker.invalid/font.ttf",
        }),
      ),
    ).toThrow("同源");
  });

  it("verifies licensed font bytes and Traditional Chinese/English glyph coverage", async () => {
    const bytes = await readFile(DEFAULT_FONT_PATH);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(FONT_SHA256);
    expect(() =>
      validateGlyphs("繁體中文，臺灣認證；English 2026\n王小明", bytes),
    ).not.toThrow();
    expect(() => validateGlyphs("\u{10FFFF}", bytes)).toThrow("字型缺字");
  });

  it("rejects missing font, missing variables and missing background without rendering", async () => {
    await expect(
      renderPdf({
        document: createDefaultDocument(),
        data,
        fontPath: "/missing-font.ttf",
      }),
    ).rejects.toThrow();
    await expect(
      renderPdf({ document: createDefaultDocument(), data: {} }),
    ).rejects.toThrow("必填");
    const document = createDefaultDocument();
    document.backgroundAssetId = "background-one";
    await expect(renderPdf({ document, data })).rejects.toThrow("背景資產");
  });
});

describe.runIf(process.env.RENDERER_INTEGRATION === "1")(
  "Chromium PDF integration",
  () => {
    it("embeds pinned Iansui alongside Noto and retains Unicode text", async () => {
      const bytes = await readFile(IANSUI_FONT_PATH);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        IANSUI_SHA256,
      );
      validateGlyphs("芫荽臺灣繁體中文王小明 English 2026", bytes);
      const document = createDefaultDocument();
      const name = document.elements.find((e) => e.id === "recipient")!;
      name.fontFamily = "Iansui";
      name.fontWeight = 400;
      const pdf = await renderPdf({ document, data });
      expect(pdf.toString("latin1")).toContain("Iansui");
      expect(pdf.toString("latin1")).toContain("/ToUnicode");
    }, 45000);

    it("produces an A4 landscape PDF with Chinese selectable text", async () => {
      const pdf = await renderPdf({ document: createDefaultDocument(), data });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(5000);
      // Chromium embeds a font and a Unicode map instead of flattening certificate text into an image.
      expect(pdf.toString("latin1")).toContain("/ToUnicode");
      expect(pdf.toString("latin1")).toMatch(
        /\/MediaBox\s*\[0 0 841\.[0-9]+ 594\.[0-9]+\]/,
      );
    }, 45000);

    it("rejects overflow after shrinking to the allowed minimum font size", async () => {
      const document = createDefaultDocument();
      const name = document.elements.find(
        (element) => element.id === "recipient",
      )!;
      name.width = 10;
      name.height = 3;
      name.minFontSize = 12;
      await expect(
        renderPdf({
          document,
          data: {
            ...data,
            recipient_name: "這是無法在最小文字框內完整顯示的長姓名",
          },
        }),
      ).rejects.toThrow("仍超出文字框");
    }, 45000);

    it("wraps and shrinks a long Traditional Chinese name without truncation", async () => {
      const document = createDefaultDocument();
      const name = document.elements.find(
        (element) => element.id === "recipient",
      )!;
      name.width = 65;
      name.height = 25;
      name.minFontSize = 8;
      const pdf = await renderPdf({
        document,
        data: { ...data, recipient_name: "歐陽王陳林黃張吳李楊蔡鄭許洪曾邱" },
      });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }, 45000);
  },
);

it.runIf(process.env.RENDERER_INTEGRATION === '1')('decodes the actual QR printed in a PDF back to its verification URL', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const sharp = (await import('sharp')).default;
  const jsQR = (await import('jsqr')).default;
  const dir = await mkdtemp(join(tmpdir(), 'cert-qr-'));
  const verification = 'https://cert.example.test/verify/12345678-1234-4234-8234-123456789abc';
  try {
    const document = createDefaultDocument();
    const pdf = await renderPdf({ document, data: { ...data, verification_url: verification } });
    await writeFile(join(dir, 'certificate.pdf'), pdf);
    execFileSync('pdftoppm', ['-f','1','-singlefile','-r','200','-png',join(dir,'certificate.pdf'),join(dir,'page')]);
    const { data: pixels, info } = await sharp(join(dir, 'page.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(pixels), info.width, info.height);
    expect(decoded?.data).toBe(verification);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 45000);

describe("vector backgrounds", () => {
  it("draws the background page underneath the certificate, covering the page", async () => {
    const certificate = await PDFDocument.create();
    certificate.addPage([842, 595]).drawText("certificate", { x: 40, y: 40 });
    const background = await PDFDocument.create();
    background.addPage([400, 400]).drawRectangle({ x: 0, y: 0, width: 400, height: 400, color: rgb(0.9, 0.85, 0.7) });
    const merged = await PDFDocument.load(
      await underlayVectorBackground(Buffer.from(await certificate.save()), Buffer.from(await background.save())),
    );
    const page = merged.getPage(0);
    expect(page.getSize()).toEqual({ width: 842, height: 595 });
    const contents = page.node.Contents() as PDFArray;
    const text = (index: number) => {
      const stream = merged.context.lookup(contents.get(index)) as PDFRawStream;
      return inflateSync(stream.contents).toString("latin1");
    };
    // The square background is scaled by 842/400 to cover the page and centred vertically.
    expect(text(0)).toMatch(/\/Artifact BMC[\s\S]*0 -123\.5 cm[\s\S]*2\.105 0 0 2\.105 0 0 cm[\s\S]*Do\s+Q\s+EMC/);
    expect(text(contents.size() - 1)).not.toContain("/Artifact");
  });
});
