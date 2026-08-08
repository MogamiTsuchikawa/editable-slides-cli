import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { companyTheme } from "@editable-slides/slide-theme-company";
import { defaultTheme } from "@editable-slides/slide-theme-default";
import { describe, expect, it } from "vitest";

import {
  compileDeck,
  compileDeckDirectory,
  DeckCompileError,
  readDeckSourceConfig,
  serializeDeck,
} from "./index.js";

const packageDirectory = path.dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const exampleDirectory = path.resolve(packageDirectory, "../../decks/example");
const fixtureConfig = (name: "minimal" | "component-gallery") =>
  path.join(packageDirectory, "fixtures", name, "deck.yaml");
const singleFileFixture = path.join(
  packageDirectory,
  "fixtures",
  "single-file",
  "deck.mdx",
);
const compileExample = () =>
  compileDeckDirectory(exampleDirectory, { theme: companyTheme });

function sourceRange(
  source: string,
  location: {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  },
): string {
  const lines = source.split("\n");
  const endLine = location.endLine ?? location.line;
  const endColumn = location.endColumn ?? location.column;
  return lines
    .slice(location.line - 1, endLine)
    .map((line, index, selected) => {
      const from = index === 0 ? location.column - 1 : 0;
      const to = index === selected.length - 1 ? endColumn - 1 : line.length;
      return line.slice(from, to);
    })
    .join("\n");
}

describe("compileDeck", () => {
  it("compiles the real-file minimal MDX fixture", async () => {
    const result = await compileDeck(fixtureConfig("minimal"));

    expect(result.diagnostics).toEqual([]);
    expect(result.deck.metadata.id).toBe("fixture-minimal");
    expect(result.deck.slides).toHaveLength(1);
    expect(result.deck.slides[0]).toEqual(
      expect.objectContaining({
        id: "minimal",
        layoutId: "title-body",
        notes: expect.objectContaining({
          plainText: "最小構成の発表者原稿です。",
        }),
      }),
    );
    expect(result.deck.slides[0]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", id: "minimal--title" }),
        expect.objectContaining({ type: "text", id: "minimal--body" }),
      ]),
    );
  });

  it("lets the theme control the title font weight", async () => {
    const regularTitleTheme = structuredClone(defaultTheme);
    const titleSlot = regularTitleTheme.layouts["title-body"]?.slots.title;
    if (!titleSlot) {
      throw new Error("title-body must define a title slot");
    }
    titleSlot.textStyle = {
      ...titleSlot.textStyle,
      fontWeight: 400,
    };

    const result = await compileDeck(fixtureConfig("minimal"), {
      theme: regularTitleTheme,
    });
    const title = result.deck.slides[0]?.elements.find(
      (element) => element.id === "minimal--title" && element.type === "text",
    );

    expect(title?.style?.fontWeight).toBe(400);
    expect(
      title?.type === "text" ? title.paragraphs?.[0]?.runs[0]?.bold : undefined,
    ).toBeUndefined();
  });

  it("compiles the real-file component gallery into native DeckIR elements", async () => {
    const result = await compileDeck(fixtureConfig("component-gallery"));
    const slide = result.deck.slides[0];

    expect(result.diagnostics).toEqual([]);
    expect(slide?.id).toBe("component-gallery");
    expect(slide?.elements.map((element) => element.type)).toEqual(
      expect.arrayContaining([
        "text",
        "image",
        "shape",
        "line",
        "table",
        "chart",
        "group",
        "icon",
        "connector",
      ]),
    );

    const image = slide?.elements.find((element) => element.id === "gallery-image");
    expect(image).toEqual(
      expect.objectContaining({
        type: "image",
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    if (image?.type === "image") {
      expect(path.isAbsolute(image.src)).toBe(true);
    }

    const group = slide?.elements.find((element) => element.id === "gallery-group");
    expect(group?.type).toBe("group");
    if (group?.type === "group") {
      expect(group.children.map((element) => element.id)).toEqual([
        "group-card",
        "group-label",
      ]);
    }

    const connector = slide?.elements.find(
      (element) => element.id === "gallery-connector",
    );
    expect(connector).toEqual(
      expect.objectContaining({
        type: "connector",
        fromElementId: "group-card",
        toElementId: "gallery-shape",
      }),
    );
  });

  it("compiles an entire deck from one deck.mdx with embedded base64 assets", async () => {
    const result = await compileDeck(singleFileFixture);

    expect(result.diagnostics).toEqual([]);
    expect(result.deck.metadata.id).toBe("fixture-single-file");
    expect(result.deck.slides.map((slide) => slide.id)).toEqual([
      "single-intro",
      "single-visual",
    ]);
    expect(result.deck.slides[0]?.notes.plainText).toBe(
      "単一ファイルの発表者原稿です。",
    );
    const body = result.deck.slides[0]?.elements.find(
      (element) => element.id === "single-intro--body",
    );
    expect(body?.sourceLocation).toEqual(
      expect.objectContaining({
        file: singleFileFixture,
        line: 27,
        column: 1,
        endLine: 29,
      }),
    );
    const source = await readFile(singleFileFixture, "utf8");
    expect(body && sourceRange(source, body.sourceLocation)).toBe(
      [
        "スライド本体と設定を同じファイルで管理します。",
        "",
        "編集位置には実際のMarkdown本文だけを記録します。",
      ].join("\n"),
    );

    const image = result.deck.slides[1]?.elements.find(
      (element) => element.id === "single-visual-image",
    );
    expect(image).toEqual(
      expect.objectContaining({
        type: "image",
        src: expect.stringMatching(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/),
        mimeType: "image/svg+xml",
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        fit: "stretch",
      }),
    );
    expect(
      result.deck.slides.every((slide) => slide.sourcePath === singleFileFixture),
    ).toBe(true);
  });

  it("compileDeckDirectory prefers deck.mdx over deck.yaml", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "editable-slides-cli-"));
    await writeFile(
      path.join(directory, "deck.mdx"),
      [
        "---",
        "schemaVersion: 1",
        "id: preferred-mdx",
        "title: Preferred MDX",
        "slides:",
        "  - id: first",
        "    layout: title-body",
        "---",
        "",
        '<Slide id="first">',
        "",
        "# First",
        "",
        "</Slide>",
      ].join("\n"),
    );
    await writeFile(
      path.join(directory, "deck.yaml"),
      [
        "schemaVersion: 1",
        "id: fallback-yaml",
        "title: Fallback YAML",
        "slides:",
        "  - missing.mdx",
      ].join("\n"),
    );

    const result = await compileDeckDirectory(directory);

    expect(result.deck.metadata.id).toBe("preferred-mdx");
    expect(result.deck.slides.map((slide) => slide.id)).toEqual(["first"]);
    await expect(
      readDeckSourceConfig(path.join(directory, "deck.mdx")),
    ).resolves.toEqual(
      expect.objectContaining({ id: "preferred-mdx", theme: "default" }),
    );
  });

  it("reports undeclared embedded asset references", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "editable-slides-cli-"));
    const deckPath = path.join(directory, "deck.mdx");
    await writeFile(
      deckPath,
      [
        "---",
        "schemaVersion: 1",
        "id: missing-asset",
        "title: Missing asset",
        "slides:",
        "  - id: first",
        "    layout: blank",
        "---",
        "",
        '<Slide id="first">',
        "",
        '<Image id="image" src="asset:not-found" x={0} y={0} w={100} h={100} />',
        "",
        "</Slide>",
      ].join("\n"),
    );

    await expect(compileDeck(deckPath)).rejects.toEqual(
      expect.objectContaining({
        name: "DeckCompileError",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "MDX_COMPONENT_PROPS_INVALID",
            message: expect.stringContaining(
              'embedded asset "not-found" is not declared',
            ),
          }),
        ]),
      }),
    );
  });

  it("compiles the example deck into validated DeckIR", async () => {
    const result = await compileExample();

    expect(result.deck.slides).toHaveLength(10);
    expect(result.deck.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.diagnostics).toEqual([]);

    const summary = result.deck.slides.find((slide) => slide.id === "adoption-summary");
    expect(summary?.notes.plainText).toContain("左側では導入原則");
    expect(summary?.notes.sources).toEqual([
      {
        label: "社内AI活用調査 2026",
      },
    ]);
    const image = summary?.elements.find((element) => element.type === "image");
    expect(image?.type).toBe("image");
    if (image?.type === "image") {
      expect(image.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(image.src).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(image.mimeType).toBe("image/svg+xml");
    }

    const chartSlide = result.deck.slides.find(
      (slide) => slide.id === "adoption-chart",
    );
    const chart = chartSlide?.elements.find(
      (element) => element.id === "adoption-chart-main",
    );
    expect(chart?.frame).toEqual({
      x: 720,
      y: 260,
      w: 1050,
      h: 620,
    });
    expect(chart?.zIndex).toBe(20);
  });

  it("serializes DeckIR deterministically", async () => {
    const first = await compileExample();
    const second = await compileExample();
    expect(serializeDeck(first.deck)).toBe(serializeDeck(second.deck));
  });

  it("rejects unknown components instead of executing them", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "editable-slides-cli-"));
    await mkdir(path.join(directory, "slides"));
    await writeFile(
      path.join(directory, "deck.yaml"),
      [
        "schemaVersion: 1",
        "id: invalid",
        "title: Invalid",
        "theme: default",
        "slides:",
        "  - slides/001.mdx",
      ].join("\n"),
    );
    await writeFile(
      path.join(directory, "slides/001.mdx"),
      [
        "---",
        "id: invalid-slide",
        "layout: blank",
        "---",
        "",
        "# Invalid",
        "",
        '<ExecuteShell id="bad" command="whoami" />',
      ].join("\n"),
    );

    await expect(compileDeck(path.join(directory, "deck.yaml"))).rejects.toEqual(
      expect.objectContaining({
        name: "DeckCompileError",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "MDX_COMPONENT_UNKNOWN" }),
        ]),
      }),
    );
  });

  it("rejects executable JSX expressions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "editable-slides-cli-"));
    await mkdir(path.join(directory, "slides"));
    await writeFile(
      path.join(directory, "deck.yaml"),
      [
        "schemaVersion: 1",
        "id: dynamic",
        "title: Dynamic",
        "theme: default",
        "slides:",
        "  - slides/001.mdx",
      ].join("\n"),
    );
    await writeFile(
      path.join(directory, "slides/001.mdx"),
      [
        "---",
        "id: dynamic-slide",
        "layout: blank",
        "---",
        "",
        "# Dynamic",
        "",
        '<Text id="bad" x={loadX()} y={100} w={400} h={200}>Bad</Text>',
      ].join("\n"),
    );

    try {
      await compileDeck(path.join(directory, "deck.yaml"));
      throw new Error("Expected compileDeck to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DeckCompileError);
      if (error instanceof DeckCompileError) {
        expect(error.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "MDX_DYNAMIC_EXPRESSION_FORBIDDEN",
            }),
          ]),
        );
      }
    }
  });
});
