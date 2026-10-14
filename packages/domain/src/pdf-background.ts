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
 * Rasterises the first page of an uploaded PDF to PNG with poppler (`pdfinfo` + `pdftoppm`), so a
 * designer's PDF can be used as a certificate background. The PDF itself is never stored or served:
 * only the PNG goes on, through the same re-encoding as an uploaded image.
 */
export async function rasterizePdfBackground(bytes: Buffer): Promise<{ png: Buffer; pages: number }> {
  const dir = await mkdtemp(join(tmpdir(), "cert-pdf-"));
  try {
    const input = join(dir, "in.pdf");
    await writeFile(input, bytes, { mode: 0o600 });
    const options = { timeout: 20_000, maxBuffer: 1024 * 1024 };
    const { stdout } = await run("pdfinfo", ["-f", "1", "-l", "1", input], options);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0);
    const size = /^Page\s+1 size:\s+([\d.]+) x ([\d.]+) pts/m.exec(stdout);
    if (!pages || !size) throw new Error("無法讀取 PDF 頁面尺寸");
    const widthIn = Number(size[1]) / POINTS_PER_INCH;
    const heightIn = Number(size[2]) / POINTS_PER_INCH;
    const dpi = Math.floor(Math.min(TARGET_DPI, Math.sqrt(MAX_PIXELS / (widthIn * heightIn))));
    if (!Number.isFinite(dpi) || dpi < 36) throw new Error("PDF 頁面尺寸無效");
    await run(
      "pdftoppm",
      ["-png", "-f", "1", "-l", "1", "-singlefile", "-r", String(dpi), input, join(dir, "page")],
      options,
    );
    return { png: await readFile(join(dir, "page.png")), pages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
