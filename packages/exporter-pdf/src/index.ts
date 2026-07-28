import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { PDFDocument } from "pdf-lib";
import { type Browser, chromium, type Page } from "playwright";

export const PDF_WIDTH_INCHES = 13.333333;
export const PDF_HEIGHT_INCHES = 7.5;

export interface PdfExportOptions {
  url: string;
  outputPath: string;
  expectedPageCount?: number;
  expectedText?: string[];
  expectedFonts?: string[];
  requireEmbeddedFonts?: boolean;
  requireUnicodeFonts?: boolean;
  timeoutMs?: number;
  executablePath?: string;
  readyFlag?: string;
  pdftotextPath?: string;
  pdffontsPath?: string;
}

export type PdfToolName = "pdftotext" | "pdffonts";
export type PdfToolImplementation = "poppler" | "xpdf" | "unknown" | "missing";

export interface PdfToolProbe {
  name: PdfToolName;
  executable: string;
  implementation: PdfToolImplementation;
  version?: string;
}

export interface PdfFontRecord {
  name: string;
  type: string;
  encoding: string;
  embedded: boolean;
  subset: boolean;
  unicode: boolean;
  objectId: string;
}

export interface PdfInspectionOptions {
  pdftotextPath?: string;
  pdffontsPath?: string;
}

export interface PdfInspection {
  pageCount: number;
  widthPoints: number;
  heightPoints: number;
  text: string;
  fonts: string[];
  fontRecords: PdfFontRecord[];
  toolchain: {
    pdftotext: PdfToolProbe;
    pdffonts: PdfToolProbe;
  };
  inspectionWarnings: string[];
}

export interface PdfValidationOptions {
  expectedPageCount?: number;
  expectedText?: string[];
  expectedFonts?: string[];
  requireEmbeddedFonts?: boolean;
  requireUnicodeFonts?: boolean;
  expectedWidthPoints?: number;
  expectedHeightPoints?: number;
  dimensionTolerancePoints?: number;
}

export class PdfExportError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PdfExportError";
    this.cause = cause;
  }
}

export function detectChromiumExecutable(): string | undefined {
  if (process.env.SLIDE_CHROMIUM_PATH) {
    return process.env.SLIDE_CHROMIUM_PATH;
  }

  const playwrightChromium = chromium.executablePath();
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          playwrightChromium,
        ]
      : process.platform === "win32"
        ? [
            `${process.env.PROGRAMFILES ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"] ?? ""}\\Microsoft\\Edge\\Application\\msedge.exe`,
            playwrightChromium,
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            playwrightChromium,
          ];

  return candidates.find((candidate) => candidate && existsSync(candidate));
}

async function waitForDeckReady(
  page: Page,
  readyFlag: string,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    (flag) => Boolean((window as unknown as Record<string, unknown>)[flag]),
    readyFlag,
    { timeout: timeoutMs },
  );

  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    await Promise.all(
      images.map(async (image) => {
        if (image.complete) {
          return;
        }
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }),
    );
  });
}

const execFileAsync = promisify(execFile);

function executableName(name: PdfToolName): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

export function resolvePdfToolExecutable(
  name: PdfToolName,
  explicitPath?: string,
): string {
  if (explicitPath) {
    return explicitPath;
  }
  const individualOverride =
    name === "pdftotext"
      ? process.env.SLIDE_PDFTOTEXT_PATH
      : process.env.SLIDE_PDFFONTS_PATH;
  if (individualOverride) {
    return individualOverride;
  }
  if (process.env.SLIDE_POPPLER_BIN) {
    return join(process.env.SLIDE_POPPLER_BIN, executableName(name));
  }
  return executableName(name);
}

function versionLine(output: string): string | undefined {
  return output
    .trim()
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim();
}

export async function probePdfTool(
  name: PdfToolName,
  explicitPath?: string,
): Promise<PdfToolProbe> {
  const executable = resolvePdfToolExecutable(name, explicitPath);
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["-v"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const output = `${stdout}${stderr}`;
    return {
      name,
      executable,
      implementation: /the poppler developers/i.test(output)
        ? "poppler"
        : /xpdfreader\.com|\bxpdf\b/i.test(output)
          ? "xpdf"
          : "unknown",
      version: versionLine(output),
    };
  } catch (error) {
    const candidate =
      error && typeof error === "object"
        ? (error as { code?: string; stdout?: string; stderr?: string })
        : undefined;
    const code = candidate?.code;
    if (code === "ENOENT") {
      return {
        name,
        executable,
        implementation: "missing",
      };
    }
    const output = `${candidate?.stdout ?? ""}${candidate?.stderr ?? ""}`;
    if (output.trim()) {
      return {
        name,
        executable,
        implementation: /the poppler developers/i.test(output)
          ? "poppler"
          : /xpdfreader\.com|\bxpdf\b/i.test(output)
            ? "xpdf"
            : "unknown",
        version: versionLine(output),
      };
    }
    return {
      name,
      executable,
      implementation: "unknown",
    };
  }
}

function unsupportedToolMessage(probe: PdfToolProbe): string {
  if (probe.implementation === "missing") {
    return `${probe.name} was not found at ${probe.executable}`;
  }
  if (probe.implementation === "xpdf") {
    return `${probe.name} at ${probe.executable} is Xpdf (${probe.version ?? "unknown version"}), not Poppler`;
  }
  return `${probe.name} at ${probe.executable} could not be identified as Poppler (${probe.version ?? "version unavailable"})`;
}

async function requirePopplerTools(options: PdfInspectionOptions): Promise<{
  pdftotext: PdfToolProbe;
  pdffonts: PdfToolProbe;
}> {
  const [pdftotext, pdffonts] = await Promise.all([
    probePdfTool("pdftotext", options.pdftotextPath),
    probePdfTool("pdffonts", options.pdffontsPath),
  ]);
  const unsupported = [pdftotext, pdffonts].filter(
    (probe) => probe.implementation !== "poppler",
  );
  if (unsupported.length > 0) {
    throw new PdfExportError(
      `Poppler is required for reliable PDF text/font validation: ${unsupported
        .map(unsupportedToolMessage)
        .join(
          "; ",
        )}. Run \`mise run setup\`, set SLIDE_POPPLER_BIN, or set SLIDE_PDFTOTEXT_PATH and SLIDE_PDFFONTS_PATH.`,
    );
  }
  return { pdftotext, pdffonts };
}

async function runPoppler(executable: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new PdfExportError(
      `Failed to inspect PDF with Poppler executable ${executable}: ${args.join(" ")}`,
      error,
    );
  }
}

export function parsePdfFonts(output: string): PdfFontRecord[] {
  const separatorIndex = output
    .split(/\r?\n/)
    .findIndex((line) => /^-+\s/.test(line) || /^-{3,}/.test(line));
  if (separatorIndex < 0) {
    return [];
  }
  return output
    .split(/\r?\n/)
    .slice(separatorIndex + 1)
    .flatMap((line): PdfFontRecord[] => {
      const match = line
        .trim()
        .match(
          /^(\S+)\s{2,}(.+?)\s{2,}(\S+)\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+(\d+)\s+(\d+)$/,
        );
      if (!match) {
        return [];
      }
      const [, rawName, type, encoding, embedded, subset, unicode, object, generation] =
        match;
      if (
        !rawName ||
        !type ||
        !encoding ||
        !embedded ||
        !subset ||
        !unicode ||
        !object ||
        !generation
      ) {
        return [];
      }
      return [
        {
          name: rawName.replace(/^[A-Z]{6}\+/, ""),
          type,
          encoding,
          embedded: embedded === "yes",
          subset: subset === "yes",
          unicode: unicode === "yes",
          objectId: `${object} ${generation}`,
        },
      ];
    });
}

export async function inspectPdf(
  path: string,
  options: PdfInspectionOptions = {},
): Promise<PdfInspection> {
  const bytes = await readFile(path);
  const document = await PDFDocument.load(bytes);
  const pages = document.getPages();
  const firstPage = pages[0];

  if (!firstPage) {
    throw new PdfExportError(`PDF contains no pages: ${path}`);
  }

  const size = firstPage.getSize();
  const toolchain = await requirePopplerTools(options);
  const [textResult, fontResult] = await Promise.all([
    runPoppler(toolchain.pdftotext.executable, [path, "-"]),
    runPoppler(toolchain.pdffonts.executable, [path]),
  ]);
  const fontRecords = parsePdfFonts(fontResult);
  return {
    pageCount: pages.length,
    widthPoints: size.width,
    heightPoints: size.height,
    text: textResult.replace(/\f/g, "\n").trim(),
    fonts: [
      ...new Set(
        fontRecords.map((record) => record.name).filter((name) => name !== "[none]"),
      ),
    ].sort(),
    fontRecords,
    toolchain,
    inspectionWarnings: [],
  };
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

function normalizeFontName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchingFontRecords(
  expected: string,
  records: PdfFontRecord[],
): PdfFontRecord[] {
  const normalizedExpected = normalizeFontName(expected);
  return records.filter((record) =>
    normalizeFontName(record.name).includes(normalizedExpected),
  );
}

export async function validatePdf(
  path: string,
  options: PdfValidationOptions,
  inspectionOptions: PdfInspectionOptions = {},
): Promise<PdfInspection> {
  const inspection = await inspectPdf(path, inspectionOptions);
  const failures: string[] = [];
  const tolerance = options.dimensionTolerancePoints ?? 0.75;

  if (
    options.expectedPageCount !== undefined &&
    inspection.pageCount !== options.expectedPageCount
  ) {
    failures.push(
      `page count: expected ${options.expectedPageCount}, got ${inspection.pageCount}`,
    );
  }
  if (
    options.expectedWidthPoints !== undefined &&
    Math.abs(inspection.widthPoints - options.expectedWidthPoints) > tolerance
  ) {
    failures.push(
      `width: expected ${options.expectedWidthPoints}pt, got ${inspection.widthPoints}pt`,
    );
  }
  if (
    options.expectedHeightPoints !== undefined &&
    Math.abs(inspection.heightPoints - options.expectedHeightPoints) > tolerance
  ) {
    failures.push(
      `height: expected ${options.expectedHeightPoints}pt, got ${inspection.heightPoints}pt`,
    );
  }
  for (const expected of options.expectedText ?? []) {
    if (!normalizeText(inspection.text).includes(normalizeText(expected))) {
      failures.push(`text not found: ${expected}`);
    }
  }
  for (const expected of options.expectedFonts ?? []) {
    const matches = matchingFontRecords(expected, inspection.fontRecords);
    if (matches.length === 0) {
      failures.push(`font not found: ${expected}`);
      continue;
    }
    if (options.requireEmbeddedFonts && matches.some((record) => !record.embedded)) {
      failures.push(`font is not embedded: ${expected}`);
    }
    if (options.requireUnicodeFonts && matches.some((record) => !record.unicode)) {
      failures.push(`font has no Unicode map: ${expected}`);
    }
  }

  if (failures.length > 0) {
    throw new PdfExportError(
      `PDF structural validation failed for ${path}: ${failures.join("; ")}`,
    );
  }
  return inspection;
}

export async function exportPdf(options: PdfExportOptions): Promise<PdfInspection> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const readyFlag = options.readyFlag ?? "__SLIDES_READY__";
  let browser: Browser | undefined;

  try {
    await mkdir(dirname(options.outputPath), { recursive: true });
    const executablePath = options.executablePath ?? detectChromiumExecutable();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });

    await page.goto(options.url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });
    await page.emulateMedia({ media: "screen" });
    await waitForDeckReady(page, readyFlag, timeoutMs);

    await page.pdf({
      path: options.outputPath,
      width: `${PDF_WIDTH_INCHES}in`,
      height: `${PDF_HEIGHT_INCHES}in`,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      printBackground: true,
      preferCSSPageSize: true,
    });

    const inspection = await validatePdf(
      options.outputPath,
      {
        expectedPageCount: options.expectedPageCount,
        expectedText: options.expectedText,
        expectedFonts: options.expectedFonts,
        requireEmbeddedFonts: options.requireEmbeddedFonts,
        requireUnicodeFonts: options.requireUnicodeFonts,
        expectedWidthPoints: PDF_WIDTH_INCHES * 72,
        expectedHeightPoints: PDF_HEIGHT_INCHES * 72,
      },
      {
        pdftotextPath: options.pdftotextPath,
        pdffontsPath: options.pdffontsPath,
      },
    );

    return inspection;
  } catch (error) {
    if (error instanceof PdfExportError) {
      throw error;
    }
    throw new PdfExportError(
      "Failed to export PDF. Run `mise run setup` followed by `mise run doctor` and ensure Playwright Chromium is installed.",
      error,
    );
  } finally {
    await browser?.close();
  }
}
