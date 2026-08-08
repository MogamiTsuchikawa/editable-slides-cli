import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import { DeckCompileError, serializeDeck } from "@editable-slides/slide-compiler";
import type { DeckIR, ElementIR, ParagraphIR } from "@editable-slides/slide-deck-ir";
import {
  detectChromiumExecutable,
  exportPdf,
  probePdfTool,
} from "@editable-slides/slide-exporter-pdf";
import { assertPptx, inspectPptx } from "@editable-slides/slide-qa-pptx";
import { writePptxFile } from "@editable-slides/slide-renderer-pptx";
import chokidar from "chokidar";
import { chromium, type Page } from "playwright";
import { parse as parseYaml } from "yaml";
import { renameStableId } from "./id-rename.js";
import { bakeLayoutOverrides } from "./layout-bake.js";
import { migrateLegacyDeckSource, readDeckLocalText } from "./migrate.js";
import {
  atomicWriteText,
  type CompiledArtifact,
  compileArtifact,
  formatDiagnostic,
  publishStagedOutput,
  type RunningStudio,
  repositoryRoot,
  startStudio,
  writeBuildManifest,
} from "./runtime.js";
import {
  addTemplateFromUrl,
  listTemplates,
  materializeTemplate,
  removeTemplate,
  resolveTemplate,
} from "./templates.js";

const execFileAsync = promisify(execFile);

export interface CommandIO {
  out(message: string): void;
  error(message: string): void;
}

export const consoleIO: CommandIO = {
  out: (message) => console.log(message),
  error: (message) => console.error(message),
};

export async function setupCommand(io: CommandIO = consoleIO): Promise<void> {
  const require = createRequire(import.meta.url);
  const playwrightCli = path.join(
    path.dirname(require.resolve("playwright/package.json")),
    "cli.js",
  );
  io.out("Chromiumを準備しています…");
  await execFileAsync(process.execPath, [playwrightCli, "install", "chromium"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  io.out("Chromiumの準備が完了しました。`slide doctor`で環境を確認できます。");
  io.out(
    "PDF検査にはPopplerも必要です（macOS: brew install poppler、Ubuntu/Debian: apt install poppler-utils、Windows/共通: mise use -g conda:poppler@26.07.0）。",
  );
}

function percentile(values: number[], position: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * position) - 1),
  );
  return sorted[index] ?? 0;
}

export async function benchmarkCommand(
  deckDirectory: string,
  options: { runs?: number },
  io: CommandIO = consoleIO,
): Promise<void> {
  const runs = options.runs ?? 5;
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) {
    throw new Error("--runsは1から20の整数で指定してください。");
  }
  const durations: number[] = [];
  let artifact: CompiledArtifact | undefined;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    artifact = await compileArtifact(deckDirectory);
    durations.push(performance.now() - started);
  }
  if (!artifact) throw new Error("性能計測を完了できませんでした。");
  const result = {
    deckId: artifact.deck.metadata.id,
    slides: artifact.deck.slides.length,
    runs,
    compileMilliseconds: {
      median: Math.round(percentile(durations, 0.5) * 100) / 100,
      p95: Math.round(percentile(durations, 0.95) * 100) / 100,
      min: Math.round(Math.min(...durations) * 100) / 100,
      max: Math.round(Math.max(...durations) * 100) / 100,
    },
    deckIrBytes: Buffer.byteLength(serializeDeck(artifact.deck), "utf8"),
  };
  io.out(JSON.stringify(result, null, 2));
}

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

function defaultDeckId(directory: string): string {
  const baseName = path.basename(directory);
  if ([...baseName].every((character) => (character.codePointAt(0) ?? 128) <= 127)) {
    const slug = baseName
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 64)
      .replaceAll(/-+$/g, "");
    if (deckIdPattern.test(slug)) return slug;
  }
  const relativeDirectory = path.relative(repositoryRoot, directory);
  const hashSource =
    relativeDirectory &&
    !relativeDirectory.startsWith(`..${path.sep}`) &&
    relativeDirectory !== ".." &&
    !path.isAbsolute(relativeDirectory)
      ? relativeDirectory.split(path.sep).join("/")
      : baseName;
  const suffix = createHash("sha256")
    .update(hashSource.normalize("NFC"), "utf8")
    .digest("hex")
    .slice(0, 8);
  return `deck-${suffix}`;
}

export async function newCommand(
  target: string,
  options: { theme?: string; id?: string; title?: string; template?: string },
  io: CommandIO = consoleIO,
): Promise<void> {
  const directory = path.resolve(target);
  const id = options.id === undefined ? defaultDeckId(directory) : options.id.trim();
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
      ? (options.id === undefined ? path.basename(directory) : id)
          .replaceAll(/[-_]+/g, " ")
          .trim()
          .replaceAll(/\s+/g, " ")
      : options.title.trim().replaceAll(/\s+/g, " ");
  if (!title) {
    throw new Error("Deck title must not be empty");
  }
  const theme = options.theme?.trim();
  if (options.theme !== undefined && !theme) {
    throw new Error("Theme must not be empty");
  }
  const template = await resolveTemplate(options.template);
  const existingStats = await lstat(directory).catch(() => undefined);
  if (existingStats && !existingStats.isDirectory()) {
    throw new Error(`Target is not a directory: ${directory}`);
  }
  if (existingStats && (await readdir(directory)).length > 0) {
    throw new Error(`Target directory is not empty: ${directory}`);
  }
  const parent = path.dirname(directory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(
    path.join(parent, `.${path.basename(directory)}-slide-new-`),
  );
  try {
    await materializeTemplate(template, staging, { id, title, theme });
    if (existingStats) {
      await rmdir(directory);
    }
    try {
      await rename(staging, directory);
    } catch (error) {
      if (existingStats) await mkdir(directory).catch(() => undefined);
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  io.out(`Created ${directory} (${id}: ${title}, template: ${template.registryName})`);
}

export async function templateAddCommand(
  source: string,
  options: {
    name?: string;
    sha256?: string;
    force?: boolean;
    allowHttp?: boolean;
  },
  io: CommandIO = consoleIO,
): Promise<void> {
  const added = await addTemplateFromUrl(source, options);
  if (added.alreadyInstalled) {
    io.out(
      `Template ${added.summary.id} is already installed (${added.summary.version}).`,
    );
    return;
  }
  io.out(
    `Added template ${added.summary.id} (${added.summary.name} ${added.summary.version}).`,
  );
  io.out(`SHA-256: ${added.summary.archiveSha256}`);
}

export async function templateListCommand(io: CommandIO = consoleIO): Promise<void> {
  const templates = await listTemplates();
  for (const template of templates) {
    io.out(
      `${template.id}\t${template.builtIn ? "built-in" : "installed"}\t${template.name}\t${template.version}\t${template.theme}`,
    );
  }
}

export async function templateRemoveCommand(
  name: string,
  io: CommandIO = consoleIO,
): Promise<void> {
  await removeTemplate(name);
  io.out(`Removed template ${name}. Existing decks were not changed.`);
}

export async function migrateCommand(
  deckDirectory: string,
  io: CommandIO = consoleIO,
): Promise<void> {
  const directory = path.resolve(deckDirectory);
  const target = path.join(directory, "deck.mdx");
  if (
    await access(target)
      .then(() => true)
      .catch(() => false)
  ) {
    throw new Error(`移行先が既に存在するため変更しません: ${target}`);
  }
  const migrated = await migrateLegacyDeckSource(directory);
  await writeFile(target, migrated.source, { encoding: "utf8", flag: "wx" });
  io.out(
    `Migrated ${migrated.slideCount} slides to ${target}. 元のdeck.yamlとページファイルは残しています。`,
  );
}

export async function layoutBakeCommand(
  deckDirectory: string,
  io: CommandIO = consoleIO,
): Promise<void> {
  const directory = path.resolve(deckDirectory);
  const sourcePath = path.join(directory, "deck.mdx");
  const overridePath = path.join(directory, "layout.overrides.json");
  const source = await readDeckLocalText(directory, "deck.mdx").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("layout bakeは単一ファイル形式のdeck.mdxで利用できます。");
    }
    throw error;
  });
  const rawOverrides = await readDeckLocalText(
    directory,
    "layout.overrides.json",
  ).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return '{"schemaVersion":1,"slides":{}}\n';
    }
    throw error;
  });
  const baked = bakeLayoutOverrides(source, JSON.parse(rawOverrides), sourcePath);
  if (baked.baked.length === 0) {
    io.out(
      baked.skipped.length > 0
        ? `Baked 0 elements. 自動生成要素の調整 ${baked.skipped.length}件は補助ファイルへ残しました。`
        : "Baked 0 elements. 反映する位置調整はありません。",
    );
    return;
  }
  await atomicWriteText(sourcePath, baked.source);
  await atomicWriteText(overridePath, `${JSON.stringify(baked.overrides, null, 2)}\n`);
  io.out(
    `Baked ${baked.baked.length} elements into ${sourcePath}. 自動生成要素 ${baked.skipped.length}件は補助ファイルへ残しました。`,
  );
}

export async function renameIdCommand(
  deckDirectory: string,
  options: {
    kind?: string;
    from?: string;
    to?: string;
    slide?: string;
  },
  io: CommandIO = consoleIO,
): Promise<void> {
  if (options.kind !== "slide" && options.kind !== "element") {
    throw new Error('--kindには"slide"または"element"を指定してください。');
  }
  if (!options.from || !options.to) {
    throw new Error("--fromと--toの両方を指定してください。");
  }
  if (options.kind === "element" && !options.slide) {
    throw new Error("要素IDを変更するときは--slideでページIDを指定してください。");
  }
  const directory = path.resolve(deckDirectory);
  const sourcePath = path.join(directory, "deck.mdx");
  const overridePath = path.join(directory, "layout.overrides.json");
  const source = await readDeckLocalText(directory, "deck.mdx");
  const rawOverrides = await readDeckLocalText(
    directory,
    "layout.overrides.json",
  ).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return '{"schemaVersion":1,"slides":{}}\n';
    }
    throw error;
  });
  const renamed = renameStableId(
    source,
    JSON.parse(rawOverrides),
    sourcePath,
    options.kind === "slide"
      ? { kind: "slide", from: options.from, to: options.to }
      : {
          kind: "element",
          slideId: options.slide ?? "",
          from: options.from,
          to: options.to,
        },
  );
  await atomicWriteText(sourcePath, renamed.source);
  await atomicWriteText(
    overridePath,
    `${JSON.stringify(renamed.overrides, null, 2)}\n`,
  );
  io.out(
    `Renamed ${options.kind} ID ${options.from} → ${options.to} (${renamed.renamedReferences} references updated).`,
  );
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
    const layoutIssues = await inspectBrowserLayout(page);
    if (layoutIssues.length > 0) {
      const details = layoutIssues
        .slice(0, 12)
        .map((issue) => `${issue.slideId}/${issue.elementId}: ${issue.kind}`)
        .join(", ");
      throw new Error(
        `Browser layout check failed (${layoutIssues.length} issue(s)): ${details}`,
      );
    }
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

export interface BrowserLayoutIssue {
  slideId: string;
  elementId: string;
  kind: "text-overflow" | "title-wrap" | "outside-slide";
}

export async function inspectBrowserLayout(page: Page): Promise<BrowserLayoutIssue[]> {
  return page.evaluate(() => {
    const issues: Array<{
      slideId: string;
      elementId: string;
      kind: "text-overflow" | "title-wrap" | "outside-slide";
    }> = [];
    const tolerance = 1.5;
    for (const slide of document.querySelectorAll<HTMLElement>(".lt-slide-canvas")) {
      const slideId = slide.dataset.slideId ?? "unknown";
      const slideRect = slide.getBoundingClientRect();
      for (const element of slide.querySelectorAll<HTMLElement>(
        "[data-slide-element-id]",
      )) {
        const elementId = element.dataset.slideElementId ?? "unknown";
        const rect = element.getBoundingClientRect();
        if (
          rect.left < slideRect.left - tolerance ||
          rect.top < slideRect.top - tolerance ||
          rect.right > slideRect.right + tolerance ||
          rect.bottom > slideRect.bottom + tolerance
        ) {
          issues.push({ slideId, elementId, kind: "outside-slide" });
        }

        const textFrame = element.querySelector<HTMLElement>(".lt-text-element");
        const textContent = element.querySelector<HTMLElement>(".lt-text-content");
        if (textFrame && textContent) {
          if (
            textContent.scrollWidth > textFrame.clientWidth + tolerance ||
            textContent.scrollHeight > textFrame.clientHeight + tolerance
          ) {
            issues.push({ slideId, elementId, kind: "text-overflow" });
          }
          if (elementId.endsWith("--title") || textFrame.dataset.textRole === "title") {
            const paragraph = textContent.querySelector("p");
            if (paragraph) {
              const range = document.createRange();
              range.selectNodeContents(paragraph);
              const lineTops = new Set(
                [...range.getClientRects()]
                  .filter((line) => line.width > 0 && line.height > 0)
                  .map((line) => Math.round(line.top)),
              );
              if (lineTops.size > 1) {
                issues.push({ slideId, elementId, kind: "title-wrap" });
              }
            }
          }
        }
      }
    }
    return issues;
  });
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
    artifact = await compileArtifact(deckDirectory, {
      failOnWarnings: true,
      staging: true,
    });
    assertArtifactLint(artifact, { strictEditable: true }, io);
  } catch (error) {
    if (error instanceof DeckCompileError) {
      for (const diagnostic of error.diagnostics) {
        io.error(formatDiagnostic(diagnostic));
      }
    }
    throw error;
  }
  const stagedIo: CommandIO = {
    out: (message) =>
      io.out(
        message.replaceAll(artifact.outputDirectory, artifact.finalOutputDirectory),
      ),
    error: (message) =>
      io.error(
        message.replaceAll(artifact.outputDirectory, artifact.finalOutputDirectory),
      ),
  };
  try {
    await snapshotArtifact(artifact, { port: options.port }, stagedIo);
    await exportArtifact(
      artifact,
      {
        format,
        strictEditable: true,
        port: options.port,
      },
      stagedIo,
    );
    await publishStagedOutput(artifact.outputDirectory, artifact.finalOutputDirectory);
  } catch (error) {
    await rm(artifact.outputDirectory, { recursive: true, force: true });
    throw error;
  }
  io.out(`Release complete: ${artifact.finalOutputDirectory}`);
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
    void child.closed.then(resolve, reject);
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
    port: options.port,
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
      studio.notify("deck");
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
    detail: chromiumPath ?? "not found; run `slide setup` or set SLIDE_CHROMIUM_PATH",
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
      "install Poppler so pdftotext/pdffonts are on PATH, set SLIDE_POPPLER_BIN, or set the individual PDF tool path";
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
      "not found (optional; install LibreOffice only for PPTX smoke rendering)",
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
        : "not installed (optional; install Noto Sans JP / Noto Sans Mono for PowerPoint fidelity)",
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
