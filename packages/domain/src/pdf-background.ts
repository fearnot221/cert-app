import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const POINTS_PER_INCH = 72;
/** Same ceiling the image path enforces through sharp's limitInputPixels. */
const MAX_PIXELS = 36_000_000;
const TARGET_DPI = 300;

export const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString("latin1") === "%PDF-";

/**
 * Turns the first page of an uploaded PDF into a certificate background, with poppler.
 *
 * `pdftocairo -pdf` redraws page 1 into a fresh single-page PDF: vector shapes, text and embedded
 * images keep their full quality, while scripts, forms, links, attachments and every other page are
 * dropped. That clean page is what certificates are drawn on. The uploaded file itself is never
 * stored or served. A PNG of the same page (up to 300 DPI) is made for the editor and thumbnails.
 */
export async function convertPdfBackground(
  bytes: Buffer,
): Promise<{ pdf: Buffer; png: Buffer; pages: number }> {
  const dir = await mkdtemp(join(tmpdir(), "cert-pdf-"));
  try {
    const input = join(dir, "in.pdf");
    await writeFile(input, bytes, { mode: 0o600 });
    const options = { timeout: 20_000, maxBuffer: 1024 * 1024 };
    const { stdout } = await run("pdfinfo", ["-f", "1", "-l", "1", input], options);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
    const size = /^Page\s+1 size:\s+([\d.]+) x ([\d.]+) pts/m.exec(stdout);
    if (!pages || !size) throw new Error("無法讀取 PDF 頁面尺寸");
    const clean = join(dir, "clean.pdf");
    await run("pdftocairo", ["-pdf", "-f", "1", "-l", "1", input, clean], options);
    const widthIn = Number(size[1]) / POINTS_PER_INCH;
    const heightIn = Number(size[2]) / POINTS_PER_INCH;
    const dpi = Math.floor(Math.min(TARGET_DPI, Math.sqrt(MAX_PIXELS / (widthIn * heightIn))));
    if (!Number.isFinite(dpi) || dpi < 36) throw new Error("PDF 頁面尺寸無效");
    await run(
      "pdftoppm",
      ["-png", "-singlefile", "-r", String(dpi), clean, join(dir, "page")],
      options,
    );
    return { pdf: await readFile(clean), png: await readFile(join(dir, "page.png")), pages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
