import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { DeckCompileError, serializeDeck } from "@livetoon/slide-compiler";
import type { DeckIR, ElementIR, ParagraphIR } from "@livetoon/slide-deck-ir";
import {
  detectChromiumExecutable,
  exportPdf,
  probePdfTool,
} from "@livetoon/slide-exporter-pdf";
import { assertPptx, inspectPptx } from "@livetoon/slide-qa-pptx";
import { writePptxFile } from "@livetoon/slide-renderer-pptx";
import chokidar from "chokidar";
import { chromium } from "playwright";
import { parse as parseYaml } from "yaml";

import {
  atomicWriteText,
  type CompiledArtifact,
  compileArtifact,
  formatDiagnostic,
  type RunningStudio,
  repositoryRoot,
  startStudio,
  writeBuildManifest,
} from "./runtime.js";

const execFileAsync = promisify(execFile);

export interface CommandIO {
  out(message: string): void;
  error(message: string): void;
}

export const consoleIO: CommandIO = {
  out: (message) => console.log(message),
  error: (message) => console.error(message),
};

function emitDiagnostics(
  diagnostics: CompiledArtifact["diagnostics"],
  io: CommandIO,
): void {
  for (const diagnostic of diagnostics) {
    const output = formatDiagnostic(diagnostic);
    if (diagnostic.severity === "error") {
      io.error(output);
    } else {
      io.out(output);
    }
  }
}

export async function lintCommand(
  deckDirectory: string,
  options: { strictEditable?: boolean; failOnWarnings?: boolean },
  io: CommandIO = consoleIO,
): Promise<void> {
  try {
    const artifact = await compileArtifact(deckDirectory, {
      failOnWarnings: options.failOnWarnings,
    });
    assertArtifactLint(artifact, options, io);
  } catch (error) {
    if (error instanceof DeckCompileError) {
      for (const diagnostic of error.diagnostics) {
        io.error(formatDiagnostic(diagnostic));
      }
    }
    throw error;
  }
}

const deckIdPattern = /^[a-z0-9][a-z0-9_-]*$/;

function assertArtifactLint(
  artifact: CompiledArtifact,
  options: { strictEditable?: boolean },
  io: CommandIO,
): void {
  emitDiagnostics(artifact.diagnostics, io);
  if (options.strictEditable) {
    const nonEditable: string[] = [];
    const visit = (
      slideId: string,
      elements: (typeof artifact.deck.slides)[number]["elements"],
    ) => {
      for (const element of elements) {
        if (element.editable === false || element.fallbackReason) {
          nonEditable.push(`${slideId}/${element.id}`);
        }
        if (element.type === "group") {
          visit(slideId, element.children);
        }
      }
    };
    for (const slide of artifact.deck.slides) {
      visit(slide.id, slide.elements);
    }
    if (nonEditable.length > 0) {
      throw new Error(`Strict editable check failed: ${nonEditable.join(", ")}`);
    }
  }
  io.out(
    `OK ${artifact.deck.metadata.id}: ${artifact.deck.slides.length} slides, ${artifact.diagnostics.length} diagnostics`,
  );
}

function mdxPlainText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

function readFrontmatterId(source: string): string | undefined {
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) {
    return undefined;
  }
  try {
    const parsed = parseYaml(match[1]) as { id?: unknown } | undefined;
    return typeof parsed?.id === "string" ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

async function findDeckIdOwner(
  id: string,
  targetDirectory: string,
): Promise<string | undefined> {
  const decksDirectory = path.join(repositoryRoot, "decks");
  const entries = await readdir(decksDirectory, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidateDirectory = path.join(decksDirectory, entry.name);
    if (path.resolve(candidateDirectory) === path.resolve(targetDirectory)) {
      continue;
    }
    const source = await readFile(
      path.join(candidateDirectory, "deck.mdx"),
      "utf8",
    ).catch(() => undefined);
    if (source && readFrontmatterId(source) === id) {
      return candidateDirectory;
    }
  }
  return undefined;
}

function sampleDeckFiles(
  theme: string,
  id: string,
  title: string,
): Record<string, string> {
  const heading = mdxPlainText(title);
  return {
    "deck.mdx": `---
schemaVersion: 1
id: ${id}
title: ${JSON.stringify(title)}
author: Livetoon
company: Livetoon
theme: ${JSON.stringify(theme)}
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: cover
    layout: cover
    notes: |
      表紙です。目的を簡潔に説明します。
    sources: []
  - id: summary
    layout: title-body
    notes: |
      3つの特徴を順番に説明します。
    sources:
      - label: Livetoon Slide
---

<Slide id="cover">

# ${heading}

伝えたい内容から、編集可能なスライドを生成

</Slide>

<Slide id="summary">

# 再現性のあるスライド制作

- MDXを正本としてGitでレビュー
- Web、PDF、PPTXを同じDeckIRから生成
- PowerPoint上でも要素を編集可能

</Slide>
`,
    "layout.overrides.json": `{
  "schemaVersion": 1,
  "slides": {}
}
`,
  };
}

export async function newCommand(
  target: string,
  options: { theme?: string; id?: string; title?: string },
  io: CommandIO = consoleIO,
): Promise<void> {
  const directory = path.resolve(target);
  const id = options.id === undefined ? path.basename(directory) : options.id.trim();
  if (!deckIdPattern.test(id)) {
    throw new Error(
      `Deck id must start with a lowercase letter or number and contain only a-z, 0-9, _ or -. Example: --id sales-kickoff (received: ${id || "empty"})`,
    );
  }
  const owner = await findDeckIdOwner(id, directory);
  if (owner) {
    throw new Error(
      `Deck id "${id}" is already used by ${owner}. Choose another English slug with --id.`,
    );
  }
  const title =
    options.title === undefined
      ? id.replaceAll(/[-_]+/g, " ")
      : options.title.trim().replaceAll(/\s+/g, " ");
  if (!title) {
    throw new Error("Deck title must not be empty");
  }
  const theme = options.theme === undefined ? "company" : options.theme.trim();
  if (!theme) {
    throw new Error("Theme must not be empty");
  }
  await mkdir(directory, { recursive: true });
  const existing = await readdir(directory);
  if (existing.length > 0) {
    throw new Error(`Target directory is not empty: ${directory}`);
  }
  const files = sampleDeckFiles(theme, id, title);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, { encoding: "utf8", flag: "wx" });
  }
  await Promise.all([
    mkdir(path.join(directory, "assets")),
    mkdir(path.join(directory, "data")),
  ]);
  io.out(`Created ${directory} (${id}: ${title})`);
}

function parseFormats(value: string): Set<"pptx" | "pdf"> {
  const formats = new Set(
    value
      .split(",")
      .map((format) => format.trim().toLowerCase())
      .filter(Boolean),
  );
  for (const format of formats) {
    if (format !== "pptx" && format !== "pdf") {
      throw new Error(`Unsupported export format: ${format}`);
    }
  }
  if (formats.size === 0) {
    throw new Error("At least one export format is required");
  }
  return formats as Set<"pptx" | "pdf">;
}

export interface PdfDeckExpectations {
  text: string[];
  fonts: string[];
}

function paragraphText(paragraph: ParagraphIR): string {
  return paragraph.runs.map((run) => run.text).join("");
}

export function collectPdfDeckExpectations(deck: DeckIR): PdfDeckExpectations {
  const text = new Set<string>();
  const fonts = new Set<string>();

  const collectParagraphs = (paragraphs: ParagraphIR[], baseFonts: string[]): void => {
    let baseFontsAdded = false;
    for (const paragraph of paragraphs) {
      const value = paragraphText(paragraph).trim();
      if (value) {
        if (!baseFontsAdded) {
          for (const baseFont of baseFonts) {
            fonts.add(baseFont);
          }
          baseFontsAdded = true;
        }
        text.add(value);
      }
      for (const run of paragraph.runs) {
        if (run.text.trim() && run.fontFace) {
          fonts.add(run.fontFace);
        }
      }
    }
  };

  const visit = (elements: ElementIR[]): void => {
    for (const element of elements) {
      if (element.type === "text") {
        const themeFont =
          element.role === "title" || element.role === "heading"
            ? deck.theme.fonts.heading.family
            : element.role === "code"
              ? deck.theme.fonts.code.family
              : deck.theme.fonts.body.family;
        collectParagraphs(element.paragraphs, [themeFont, element.style.fontFace]);
      } else if (element.type === "table") {
        for (const row of element.rows) {
          for (const cell of row.cells) {
            collectParagraphs(cell.paragraphs, [
              deck.theme.fonts.body.family,
              cell.textStyle?.fontFace ?? element.style.text.fontFace,
            ]);
          }
        }
      } else if (element.type === "group") {
        visit(element.children);
      }
    }
  };

  for (const slide of deck.slides) {
    visit(slide.elements);
  }

  return {
    text: [...text],
    fonts: [...fonts],
  };
}

export async function exportCommand(
  deckDirectory: string,
  options: {
    format?: string;
    strictEditable?: boolean;
    port?: number;
  },
  io: CommandIO = consoleIO,
): Promise<void> {
  const artifact = await compileArtifact(deckDirectory);
  await exportArtifact(artifact, options, io);
}

async function exportArtifact(
  artifact: CompiledArtifact,
  options: {
    format?: string;
    strictEditable?: boolean;
    port?: number;
  },
  io: CommandIO,
): Promise<void> {
  const formats = parseFormats(options.format ?? "pptx,pdf");
  emitDiagnostics(artifact.diagnostics, io);
  const outputs: Record<string, unknown> = {};

  if (formats.has("pptx")) {
    const pptxPath = path.join(
      artifact.outputDirectory,
      `${artifact.deck.metadata.id}.pptx`,
    );
    const rendered = await writePptxFile(artifact.deck, pptxPath, {
      strictEditable: options.strictEditable ?? true,
    });
    const report = await assertPptx(pptxPath, artifact.deck, {
      strictEditable: options.strictEditable ?? true,
      compareText: true,
      compareTextStyles: true,
    });
    outputs.pptx = {
      path: pptxPath,
      slideCount: rendered.slideCount,
      nativeEditabilityRate: report.nativeEditabilityRate,
      semanticHash: report.semanticHash,
    };
    io.out(
      `PPTX ${pptxPath} (${report.verifiedNativeObjects}/${report.expectedEditableObjects} native objects)`,
    );
  }

  if (formats.has("pdf")) {
    const pdfPath = path.join(
      artifact.outputDirectory,
      `${artifact.deck.metadata.id}.pdf`,
    );
    const expectations = collectPdfDeckExpectations(artifact.deck);
    const studio = await startStudio(artifact, { port: options.port });
    try {
      const inspection = await exportPdf({
        url: `${studio.baseUrl}/print/${encodeURIComponent(artifact.deck.metadata.id)}`,
        outputPath: pdfPath,
        expectedPageCount: artifact.deck.slides.length,
        expectedText: expectations.text,
        expectedFonts: expectations.fonts,
        requireEmbeddedFonts: true,
        requireUnicodeFonts: true,
      });
      outputs.pdf = {
        path: pdfPath,
        ...inspection,
      };
      io.out(
        `PDF ${pdfPath} (${inspection.pageCount} pages, ${expectations.text.length} text checks, ${expectations.fonts.length} font checks)`,
      );
    } finally {
      await studio.stop();
    }
  }

  await writeBuildManifest(artifact, outputs);
  io.out(`Build complete: ${artifact.outputDirectory}`);
}

export async function snapshotCommand(
  deckDirectory: string,
  options: { port?: number },
  io: CommandIO = consoleIO,
): Promise<void> {
  const artifact = await compileArtifact(deckDirectory);
  await snapshotArtifact(artifact, options, io);
}

async function snapshotArtifact(
  artifact: CompiledArtifact,
  options: { port?: number },
  io: CommandIO,
): Promise<void> {
  const studio = await startStudio(artifact, { port: options.port });
  const executablePath = detectChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.goto(
      `${studio.baseUrl}/print/${encodeURIComponent(artifact.deck.metadata.id)}`,
      { waitUntil: "networkidle" },
    );
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __SLIDES_READY__?: boolean }).__SLIDES_READY__),
    );
    const pages = page.locator(".lt-print-page");
    const count = await pages.count();
    if (count !== artifact.deck.slides.length) {
      throw new Error(
        `Snapshot page count mismatch: expected ${artifact.deck.slides.length}, got ${count}`,
      );
    }
    const outputDirectory = path.join(artifact.outputDirectory, "slides");
    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });
    const outputPaths: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const outputPath = path.join(
        outputDirectory,
        `${String(index + 1).padStart(3, "0")}.png`,
      );
      await pages.nth(index).screenshot({ path: outputPath });
      outputPaths.push(outputPath);
      io.out(`Snapshot ${outputPath}`);
    }
    const overviewPage = await browser.newPage({
      viewport: { width: 1920, height: 300 },
      deviceScaleFactor: 1,
    });
    try {
      const thumbnails = await Promise.all(
        outputPaths.map(async (outputPath, index) => ({
          number: index + 1,
          source: `data:image/png;base64,${(await readFile(outputPath)).toString(
            "base64",
          )}`,
        })),
      );
      await overviewPage.setContent(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; background: #e9edf2; }
      body {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 24px;
        padding: 24px;
        font-family: Arial, sans-serif;
      }
      figure { margin: 0; min-width: 0; }
      img {
        display: block;
        width: 100%;
        height: auto;
        border: 1px solid #c8ced7;
        box-shadow: 0 4px 14px rgb(15 23 42 / 12%);
      }
      figcaption {
        padding-top: 8px;
        color: #475569;
        font-size: 20px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    ${thumbnails
      .map(
        ({ number, source }) =>
          `<figure><img src="${source}" alt="Slide ${number}" /><figcaption>${number}</figcaption></figure>`,
      )
      .join("\n")}
  </body>
</html>`);
      await overviewPage.evaluate(async () => {
        await Promise.all(
          [...document.images].map((image) =>
            image.complete ? Promise.resolve() : image.decode(),
          ),
        );
      });
      const overviewPath = path.join(outputDirectory, "000-overview.png");
      await overviewPage.screenshot({ path: overviewPath, fullPage: true });
      io.out(`Overview ${overviewPath}`);
    } finally {
      await overviewPage.close();
    }
  } finally {
    await browser.close();
    await studio.stop();
  }
}

export async function releaseCommand(
  deckDirectory: string,
  options: { format?: string; port?: number },
  io: CommandIO = consoleIO,
): Promise<void> {
  const format = options.format ?? "pptx,pdf";
  parseFormats(format);
  let artifact: CompiledArtifact;
  try {
    artifact = await compileArtifact(deckDirectory, { failOnWarnings: true });
    assertArtifactLint(artifact, { strictEditable: true }, io);
  } catch (error) {
    if (error instanceof DeckCompileError) {
      for (const diagnostic of error.diagnostics) {
        io.error(formatDiagnostic(diagnostic));
      }
    }
    throw error;
  }
  await snapshotArtifact(artifact, { port: options.port }, io);
  await exportArtifact(
    artifact,
    {
      format,
      strictEditable: true,
      port: options.port,
    },
    io,
  );
  io.out(`Release complete: ${artifact.outputDirectory}`);
}

export async function inspectCommand(
  deckDirectory: string,
  options: { slide?: string; pptx?: string },
  io: CommandIO = consoleIO,
): Promise<void> {
  const artifact = await compileArtifact(deckDirectory);
  if (options.pptx) {
    const report = await inspectPptx(path.resolve(options.pptx), artifact.deck, {
      strictEditable: true,
      compareText: true,
      compareTextStyles: true,
    });
    io.out(JSON.stringify(report, null, 2));
    if (!report.valid) {
      throw new Error("PPTX inspection failed");
    }
    return;
  }
  if (!options.slide) {
    io.out(serializeDeck(artifact.deck));
    return;
  }
  const slide = artifact.deck.slides.find(
    (candidate) => candidate.id === options.slide,
  );
  if (!slide) {
    throw new Error(`Slide not found: ${options.slide}`);
  }
  io.out(JSON.stringify(slide, null, 2));
}

async function waitForExit(child: RunningStudio): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      void child.stop().then(resolve, reject);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    child.child.once("error", reject);
    child.child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
        resolve();
      } else {
        reject(new Error(`Studio exited with code ${code ?? signal}`));
      }
    });
  });
}

export async function devCommand(
  deckDirectory: string,
  options: { open?: boolean; port?: number },
  io: CommandIO = consoleIO,
): Promise<void> {
  let artifact = await compileArtifact(deckDirectory);
  emitDiagnostics(artifact.diagnostics, io);
  const studio = await startStudio(artifact, {
    open: options.open,
    port: options.port ?? 4173,
    inheritOutput: true,
  });
  io.out(`Editor: ${studio.baseUrl}/edit/${artifact.deck.metadata.id}`);
  io.out(`Print: ${studio.baseUrl}/print/${artifact.deck.metadata.id}`);

  let timer: NodeJS.Timeout | undefined;
  let compiling = false;
  let queued = false;
  const compileAgain = async () => {
    if (compiling) {
      queued = true;
      return;
    }
    compiling = true;
    try {
      artifact = await compileArtifact(deckDirectory);
      emitDiagnostics(artifact.diagnostics, io);
      io.out(`Recompiled ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      if (error instanceof DeckCompileError) {
        for (const diagnostic of error.diagnostics) {
          io.error(formatDiagnostic(diagnostic));
        }
      } else {
        io.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      compiling = false;
      if (queued) {
        queued = false;
        void compileAgain();
      }
    }
  };
  const watcher = chokidar.watch(path.resolve(deckDirectory), {
    ignored: [/(^|[/\\])\../, /node_modules/, /(?:^|[/\\])dist(?:[/\\]|$)/],
    ignoreInitial: true,
  });
  watcher.on("all", () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void compileAgain(), 100);
  });
  try {
    await waitForExit(studio);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    await watcher.close();
    await studio.stop();
  }
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

async function commandVersion(
  command: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
    });
    return `${result.stdout}${result.stderr}`.trim().split(/\r?\n/)[0];
  } catch (error) {
    if (error && typeof error === "object") {
      const candidate = error as {
        code?: string;
        stdout?: string;
        stderr?: string;
      };
      if (candidate.code !== "ENOENT") {
        const output = `${candidate.stdout ?? ""}${candidate.stderr ?? ""}`
          .trim()
          .split(/\r?\n/)[0];
        if (output) {
          return output;
        }
      }
    }
    return undefined;
  }
}

export async function collectDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js",
    status: nodeMajor >= 24 ? "ok" : "error",
    detail: process.version,
  });
  const npm = await commandVersion(process.platform === "win32" ? "npm.cmd" : "npm", [
    "--version",
  ]);
  checks.push({
    name: "npm",
    status: npm ? "ok" : "error",
    detail: npm ?? "not found",
  });
  const chromiumPath = detectChromiumExecutable();
  checks.push({
    name: "Chromium",
    status: chromiumPath ? "ok" : "error",
    detail:
      chromiumPath ?? "not found; run `mise run setup` or set SLIDE_CHROMIUM_PATH",
  });
  const pdfinfo = await commandVersion("pdfinfo", ["-v"]);
  checks.push({
    name: "pdfinfo",
    status: pdfinfo ? "ok" : "warning",
    detail: pdfinfo ?? "not found (optional)",
  });
  const pdfToolProbes = await Promise.all([
    probePdfTool("pdftotext"),
    probePdfTool("pdffonts"),
  ]);
  for (const probe of pdfToolProbes) {
    const isPoppler = probe.implementation === "poppler";
    const remedy =
      "Run `mise run setup`, set SLIDE_POPPLER_BIN, or set the individual PDF tool path";
    checks.push({
      name: `Poppler ${probe.name}`,
      status: isPoppler ? "ok" : "error",
      detail: isPoppler
        ? `${probe.version ?? "Poppler"} (${probe.executable})`
        : probe.implementation === "xpdf"
          ? `${probe.version ?? "Xpdf"} is not supported; ${remedy}`
          : probe.implementation === "missing"
            ? `not found at ${probe.executable}; ${remedy}`
            : `implementation could not be identified at ${probe.executable}; ${remedy}`,
    });
  }
  const libreOffice = await commandVersion("soffice", ["--version"]);
  checks.push({
    name: "LibreOffice",
    status: libreOffice ? "ok" : "warning",
    detail:
      libreOffice ??
      "not found; run `mise run setup:office` on macOS to enable PPTX smoke rendering",
  });
  const powerPointPath =
    process.platform === "darwin"
      ? "/Applications/Microsoft PowerPoint.app"
      : undefined;
  if (powerPointPath) {
    const installed = await access(powerPointPath)
      .then(() => true)
      .catch(() => false);
    checks.push({
      name: "PowerPoint",
      status: installed ? "ok" : "warning",
      detail: installed ? powerPointPath : "not found (optional)",
    });
  }
  const fontListing = await execFileAsync("fc-list", ["--format", "%{family}\n"])
    .then(({ stdout }) => stdout)
    .catch(() => "");
  for (const family of ["Noto Sans JP", "Noto Sans Mono"]) {
    const available = fontListing
      .split(/\r?\n/)
      .flatMap((line) => line.split(","))
      .some((name) => name.trim() === family);
    checks.push({
      name: `Font ${family}`,
      status: available ? "ok" : "warning",
      detail: available
        ? "installed"
        : "not installed; run `mise run setup:office` on macOS for PowerPoint fidelity",
    });
  }
  const writable = await access(repositoryRoot, fsConstants.W_OK)
    .then(() => true)
    .catch(() => false);
  checks.push({
    name: "Workspace write",
    status: writable ? "ok" : "error",
    detail: writable ? repositoryRoot : `not writable: ${repositoryRoot}`,
  });
  return checks;
}

export async function doctorCommand(io: CommandIO = consoleIO): Promise<void> {
  const checks = await collectDoctorChecks();
  for (const check of checks) {
    io.out(
      `${check.status === "ok" ? "✓" : check.status === "warning" ? "!" : "✗"} ${check.name}: ${check.detail}`,
    );
  }
  const failures = checks.filter((check) => check.status === "error");
  if (failures.length > 0) {
    throw new Error(`Doctor found ${failures.length} required dependency problem(s)`);
  }
}

export async function writeCurrentDeckIr(
  deckDirectory: string,
  outputPath: string,
): Promise<void> {
  const artifact = await compileArtifact(deckDirectory);
  await atomicWriteText(outputPath, serializeDeck(artifact.deck));
}
