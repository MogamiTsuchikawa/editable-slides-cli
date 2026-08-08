import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECK_IR_SCHEMA_VERSION,
  type DeckIR,
  WIDE_CANVAS,
} from "@editable-slides/slide-deck-ir";
import { defaultTheme } from "@editable-slides/slide-theme-default";
import pixelmatch from "pixelmatch";
import { type Browser, chromium, type Page } from "playwright";
import { PNG } from "pngjs";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DECK_ID = "studio-e2e";
const SLIDE_ID = "intro";
const TEXT_ID = "headline";
const NOTES_SENTINEL = "PRESENTER-NOTES-SENTINEL";
const SOURCE_LABEL = "E2E source";
const E2E_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const EXPECTED_VISUAL_PATH = join(E2E_DIRECTORY, "baselines", "studio-print.png");
const VISUAL_ARTIFACT_DIRECTORY = join(
  REPOSITORY_ROOT,
  "output",
  "playwright",
  "visual-regression",
);
const MAX_VISUAL_DIFF_RATIO = 0.0025;
const VISUAL_STABILIZATION_CSS = `
  *,
  *::before,
  *::after {
    animation: none !important;
    caret-color: transparent !important;
    transition: none !important;
  }

  html {
    color-scheme: light !important;
  }

  .lt-slide-canvas,
  .lt-slide-canvas * {
    -webkit-font-smoothing: antialiased !important;
    font-family: "Noto Sans JP Variable", "Noto Sans JP", sans-serif !important;
    font-kerning: none !important;
    font-synthesis: none !important;
    text-rendering: geometricPrecision !important;
  }
`;

let browser: Browser | undefined;
let page: Page | undefined;
let server: ViteDevServer | undefined;
let baseUrl = "";
let temporaryDirectory = "";
let overridePath = "";
let previousDeckDirectory: string | undefined;
let previousDeckIr: string | undefined;
const consoleErrors: string[] = [];

function browserExecutable(): string | undefined {
  return process.env.SLIDE_CHROMIUM_PATH;
}

async function compareVisualBaseline(actual: Buffer): Promise<void> {
  if (process.env.UPDATE_VISUAL_BASELINES === "1") {
    await mkdir(dirname(EXPECTED_VISUAL_PATH), { recursive: true });
    await writeFile(EXPECTED_VISUAL_PATH, actual);
  }

  let expected: Buffer;
  try {
    expected = await readFile(EXPECTED_VISUAL_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Visual baseline is missing: ${EXPECTED_VISUAL_PATH}. ` +
          "Run `UPDATE_VISUAL_BASELINES=1 npm run test:visual` and review the generated image.",
      );
    }
    throw error;
  }

  const actualImage = PNG.sync.read(actual);
  const expectedImage = PNG.sync.read(expected);
  const width = Math.max(actualImage.width, expectedImage.width);
  const height = Math.max(actualImage.height, expectedImage.height);
  const dimensionsMatch =
    actualImage.width === expectedImage.width &&
    actualImage.height === expectedImage.height;
  const diffImage = new PNG({ width, height });
  let differentPixels = width * height;

  if (dimensionsMatch) {
    differentPixels = pixelmatch(
      expectedImage.data,
      actualImage.data,
      diffImage.data,
      width,
      height,
      {
        alpha: 0.7,
        diffColor: [220, 38, 38],
        diffColorAlt: [37, 99, 235],
        includeAA: false,
        threshold: 0.1,
      },
    );
  } else {
    for (let index = 0; index < diffImage.data.length; index += 4) {
      diffImage.data[index] = 220;
      diffImage.data[index + 1] = 38;
      diffImage.data[index + 2] = 38;
      diffImage.data[index + 3] = 255;
    }
  }

  const diffRatio = differentPixels / (width * height);
  await mkdir(VISUAL_ARTIFACT_DIRECTORY, { recursive: true });
  await Promise.all([
    writeFile(join(VISUAL_ARTIFACT_DIRECTORY, "expected.png"), expected),
    writeFile(join(VISUAL_ARTIFACT_DIRECTORY, "actual.png"), actual),
    writeFile(join(VISUAL_ARTIFACT_DIRECTORY, "diff.png"), PNG.sync.write(diffImage)),
    writeFile(
      join(VISUAL_ARTIFACT_DIRECTORY, "comparison.json"),
      `${JSON.stringify(
        {
          actual: {
            width: actualImage.width,
            height: actualImage.height,
          },
          expected: {
            width: expectedImage.width,
            height: expectedImage.height,
          },
          differentPixels,
          diffRatio,
          maxDiffRatio: MAX_VISUAL_DIFF_RATIO,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);

  expect(
    dimensionsMatch,
    `Visual dimensions changed. Artifacts: ${VISUAL_ARTIFACT_DIRECTORY}`,
  ).toBe(true);
  expect(
    diffRatio,
    `Web visual changed by ${(diffRatio * 100).toFixed(4)}% ` +
      `(allowed ${(MAX_VISUAL_DIFF_RATIO * 100).toFixed(4)}%). ` +
      `Artifacts: ${VISUAL_ARTIFACT_DIRECTORY}`,
  ).toBeLessThanOrEqual(MAX_VISUAL_DIFF_RATIO);
}

async function waitForOverrideX(expected: number): Promise<void> {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    try {
      const document = JSON.parse(await readFile(overridePath, "utf8")) as {
        slides?: Record<string, Record<string, { x?: number }>>;
      };
      if (document.slides?.[SLIDE_ID]?.[TEXT_ID]?.x === expected) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${TEXT_ID}.x to become ${expected}.`);
}

function createDeck(assetPath: string, sourcePath: string): DeckIR {
  const sourceLocation = {
    file: sourcePath,
    line: 1,
    column: 1,
  };
  return {
    schemaVersion: DECK_IR_SCHEMA_VERSION,
    metadata: {
      id: DECK_ID,
      title: "Studio browser E2E",
      language: "ja",
    },
    canvas: WIDE_CANVAS,
    theme: structuredClone(defaultTheme.ir),
    slides: [
      {
        id: SLIDE_ID,
        sourcePath,
        layoutId: "blank",
        masterId: "default",
        elements: [
          {
            id: TEXT_ID,
            type: "text",
            role: "title",
            frame: { x: 100, y: 120, w: 760, h: 180 },
            rotation: 0,
            zIndex: 10,
            opacity: 1,
            editable: true,
            paragraphs: [{ runs: [{ text: "Studio E2E title" }] }],
            style: structuredClone(defaultTheme.ir.typography.title),
            sourceLocation,
          },
          {
            id: "hero-image",
            type: "image",
            frame: { x: 1040, y: 220, w: 640, h: 480 },
            rotation: 0,
            zIndex: 20,
            opacity: 1,
            editable: true,
            alt: "Local E2E asset",
            src: assetPath,
            mimeType: "image/svg+xml",
            fit: "contain",
            sourceLocation,
          },
        ],
        notes: {
          markdown: NOTES_SENTINEL,
          plainText: NOTES_SENTINEL,
          sources: [{ label: SOURCE_LABEL, url: "https://example.com/source" }],
        },
      },
    ],
    diagnostics: [],
    contentHash: "studio-browser-e2e",
  };
}

beforeAll(async () => {
  await rm(VISUAL_ARTIFACT_DIRECTORY, { recursive: true, force: true });
  temporaryDirectory = await mkdtemp(join(tmpdir(), "livetoon-studio-e2e-"));
  const sourcePath = join(temporaryDirectory, "slides", "intro.mdx");
  const assetPath = join(temporaryDirectory, "assets", "hero.svg");
  const deckIrPath = join(temporaryDirectory, ".editable-slides", "deck.ir.json");
  overridePath = join(temporaryDirectory, "layout.overrides.json");

  await Promise.all([
    mkdir(dirname(sourcePath), { recursive: true }),
    mkdir(dirname(assetPath), { recursive: true }),
    mkdir(dirname(deckIrPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(sourcePath, "# Studio E2E title\n", "utf8"),
    writeFile(
      assetPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"><rect width="100" height="60" rx="8" fill="#2857D9"/><circle cx="50" cy="30" r="16" fill="#FFFFFF"/></svg>',
      "utf8",
    ),
  ]);
  await writeFile(
    deckIrPath,
    `${JSON.stringify(createDeck(assetPath, sourcePath), null, 2)}\n`,
    "utf8",
  );

  previousDeckDirectory = process.env.EDITABLE_SLIDES_DECK_DIR;
  previousDeckIr = process.env.EDITABLE_SLIDES_DECK_IR;
  process.env.EDITABLE_SLIDES_DECK_DIR = temporaryDirectory;
  process.env.EDITABLE_SLIDES_DECK_IR = deckIrPath;

  const configFile = fileURLToPath(new URL("../vite.config.ts", import.meta.url));
  server = await createServer({
    configFile,
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: true,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite did not expose a TCP address.");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  const executablePath = browserExecutable();
  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-lcd-text",
      "--font-render-hinting=none",
      "--force-color-profile=srgb",
    ],
    ...(executablePath ? { executablePath } : {}),
  });
  page = await browser.newPage({
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "ja-JP",
    reducedMotion: "reduce",
    timezoneId: "UTC",
    viewport: { width: 1920, height: 1080 },
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();

  if (previousDeckDirectory === undefined) delete process.env.EDITABLE_SLIDES_DECK_DIR;
  else process.env.EDITABLE_SLIDES_DECK_DIR = previousDeckDirectory;
  if (previousDeckIr === undefined) delete process.env.EDITABLE_SLIDES_DECK_IR;
  else process.env.EDITABLE_SLIDES_DECK_IR = previousDeckIr;

  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("Studio browser workflow", () => {
  it("keeps print clean, normalizes legacy routes, and saves editor overrides", async () => {
    if (!page) throw new Error("Browser page was not initialized.");

    await page.goto(`${baseUrl}/print/${DECK_ID}`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () =>
        Reflect.get(
          window as unknown as Record<string, unknown>,
          "__SLIDES_READY__",
        ) === true,
    );
    expect(await page.getByText("Studio E2E title").isVisible()).toBe(true);
    expect((await page.locator("body").innerText()).includes(NOTES_SENTINEL)).toBe(
      false,
    );
    const imageWidth = await page
      .locator("[data-slide-element-id='hero-image'] img")
      .evaluate((element) => (element as HTMLImageElement).naturalWidth);
    expect(imageWidth).toBe(100);
    const slideCanvas = page.locator(".lt-slide-canvas");
    await page.addStyleTag({ content: VISUAL_STABILIZATION_CSS });
    const visualFontReady = await page.evaluate(async () => {
      const descriptor = '700 60px "Noto Sans JP Variable"';
      const sample = "Studio E2E title";
      await document.fonts.load(descriptor, sample);
      await document.fonts.ready;
      return document.fonts.check(descriptor, sample);
    });
    expect(visualFontReady).toBe(true);
    const canvasBounds = await slideCanvas.boundingBox();
    expect(canvasBounds?.width).toBeCloseTo(1280, 0);
    expect(canvasBounds?.height).toBeCloseTo(720, 0);
    const visualScreenshot = await slideCanvas.screenshot({
      animations: "disabled",
      caret: "hide",
      scale: "css",
      type: "png",
    });
    expect(visualScreenshot.byteLength).toBeGreaterThan(10_000);
    await compareVisualBaseline(visualScreenshot);

    await page.goto(`${baseUrl}/presenter/${DECK_ID}`, {
      waitUntil: "networkidle",
    });
    expect(page.url()).toBe(`${baseUrl}/presenter/${DECK_ID}`);
    expect(await page.locator(".studio-presenter").count()).toBe(1);
    expect((await page.locator("body").innerText()).includes(NOTES_SENTINEL)).toBe(
      true,
    );
    expect(await page.getByText(SOURCE_LABEL).isVisible()).toBe(true);

    await page.goto(`${baseUrl}/edit/${DECK_ID}`, { waitUntil: "networkidle" });
    expect(
      await page.getByRole("navigation", { name: "スライド一覧" }).isVisible(),
    ).toBe(true);
    expect(
      await page.getByRole("button", { name: `1枚目: ${SLIDE_ID}` }).isVisible(),
    ).toBe(true);
    await page.getByRole("button", { name: "デバッグを表示" }).click();
    const debugDrawer = page.getByRole("dialog", {
      name: "スライドのデバッグ情報",
    });
    expect(await debugDrawer.isVisible()).toBe(true);
    expect(await debugDrawer.getByText(SLIDE_ID, { exact: true }).isVisible()).toBe(
      true,
    );
    await debugDrawer.getByRole("button", { name: "デバッグを閉じる" }).click();
    expect(await debugDrawer.count()).toBe(0);

    await page.goto(`${baseUrl}/edit/${DECK_ID}/${SLIDE_ID}`, {
      waitUntil: "networkidle",
    });
    const headline = page.locator(
      `.studio-canvas-shell [data-slide-element-id='${TEXT_ID}']`,
    );
    await headline.click({ position: { x: 20, y: 20 } });
    expect(await headline.getAttribute("data-selected")).toBe("true");
    await page.keyboard.press("ArrowRight");
    await waitForOverrideX(101);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      ({ elementId, expectedLeft }) => {
        const element = document.querySelector(
          `.studio-canvas-shell [data-slide-element-id='${elementId}']`,
        );
        return element ? getComputedStyle(element).left === expectedLeft : false;
      },
      { elementId: TEXT_ID, expectedLeft: "101px" },
    );
    const persistedLeft = await page
      .locator(`.studio-canvas-shell [data-slide-element-id='${TEXT_ID}']`)
      .evaluate((element) => getComputedStyle(element).left);
    expect(persistedLeft).toBe("101px");

    const files = await readdir(temporaryDirectory);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    expect(consoleErrors).toEqual([]);
  }, 30_000);
});
