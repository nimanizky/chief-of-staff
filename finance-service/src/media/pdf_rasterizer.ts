import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ReceiptError } from "../errors/receipt_errors.js";

const execFile = promisify(execFileCallback);

export type RasterizedPdfPage = {
  pageNumber: number;
  totalPages: number | null;
  truncated: boolean;
  mimeType: "image/jpeg";
  imageBase64: string;
};

async function readPdfPageCount(pdfPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFile("pdfinfo", [pdfPath], { maxBuffer: 10 * 1024 * 1024 });
    const match = stdout.match(/^Pages:\s+(\d+)/m);
    if (!match) return null;
    const count = Number(match[1]);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

function asPdfConversionError(error: unknown): ReceiptError {
  const err = error as { code?: string; message?: string };
  if (err?.code === "ENOENT") {
    return new ReceiptError(
      "PDF_CONVERSION",
      "PDF conversion tool is missing. Install poppler-utils (pdftoppm/pdfinfo).",
      { cause: error }
    );
  }
  return new ReceiptError("PDF_CONVERSION", "PDF conversion failed.", { cause: error });
}

export async function rasterizePdfBufferToJpegPages(
  pdfBuffer: Buffer,
  maxPages: number
): Promise<RasterizedPdfPage[]> {
  const tmpPrefix = path.join(tmpdir(), "receipt-pdf-");
  const workDir = await mkdtemp(tmpPrefix);
  const inputPath = path.join(workDir, "receipt.pdf");
  const outputPrefix = path.join(workDir, "page");

  try {
    await writeFile(inputPath, pdfBuffer);
    const totalPages = await readPdfPageCount(inputPath);

    await execFile(
      "pdftoppm",
      ["-jpeg", "-f", "1", "-l", String(maxPages), inputPath, outputPrefix],
      { maxBuffer: 25 * 1024 * 1024 }
    );

    const files = (await readdir(workDir))
      .filter((name) => /^page-\d+\.jpg$/.test(name))
      .sort((a, b) => {
        const aNum = Number(a.match(/^page-(\d+)\.jpg$/)?.[1] ?? 0);
        const bNum = Number(b.match(/^page-(\d+)\.jpg$/)?.[1] ?? 0);
        return aNum - bNum;
      });

    if (files.length === 0) {
      throw new ReceiptError("PDF_CONVERSION", "PDF was converted, but no pages were produced.");
    }

    const truncated = totalPages !== null ? totalPages > files.length : files.length >= maxPages;
    const pages: RasterizedPdfPage[] = [];
    for (let idx = 0; idx < files.length; idx += 1) {
      const pagePath = path.join(workDir, files[idx]);
      const pageBuffer = await readFile(pagePath);
      pages.push({
        pageNumber: idx + 1,
        totalPages,
        truncated,
        mimeType: "image/jpeg",
        imageBase64: pageBuffer.toString("base64")
      });
    }

    return pages;
  } catch (error) {
    if (error instanceof ReceiptError) throw error;
    throw asPdfConversionError(error);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
