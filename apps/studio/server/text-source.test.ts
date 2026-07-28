import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DECK_IR_SCHEMA_VERSION,
  type DeckIR,
  WIDE_CANVAS,
} from "@livetoon/slide-deck-ir";
import { defaultTheme } from "@livetoon/slide-theme-default";
import { afterEach, describe, expect, it } from "vitest";

import { updateTextElementSource } from "./text-source.js";

const temporaryDirectories: string[] = [];

async function fixture(source: string, role: "title" | "body" = "body") {
  const directory = await mkdtemp(join(tmpdir(), "livetoon-text-source-"));
  temporaryDirectories.push(directory);
  const sourcePath = join(directory, "deck.mdx");
  const deckIrPath = join(directory, ".livetoon", "deck.ir.json");
  await mkdir(dirname(deckIrPath), { recursive: true });
  await writeFile(sourcePath, source, "utf8");
  const firstLine = source.split("\n")[0] ?? "";
  const deck: DeckIR = {
    schemaVersion: DECK_IR_SCHEMA_VERSION,
    metadata: { id: "example", title: "Example", language: "ja-JP" },
    canvas: WIDE_CANVAS,
    theme: structuredClone(defaultTheme.ir),
    slides: [
      {
        id: "intro",
        sourcePath,
        layoutId: "blank",
        elements: [
          {
            id: role === "title" ? "intro--title" : "intro--body",
            type: "text",
            role,
            frame: { x: 0, y: 0, w: 800, h: 200 },
            rotation: 0,
            zIndex: 1,
            opacity: 1,
            editable: true,
            sourceLocation: {
              file: sourcePath,
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: firstLine.length + 1,
            },
            paragraphs: [{ runs: [{ text: "Before" }] }],
            style: structuredClone(defaultTheme.ir.typography.body),
          },
        ],
        notes: { markdown: "", plainText: "", sources: [] },
      },
    ],
    diagnostics: [],
    contentHash: "fixture",
  };
  await writeFile(deckIrPath, `${JSON.stringify(deck)}\n`, "utf8");
  return { directory, sourcePath, deckIrPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("updateTextElementSource", () => {
  it("preserves the Markdown heading marker", async () => {
    const files = await fixture("# Before\n\nAfter\n", "title");

    await updateTextElementSource(files.directory, files.deckIrPath, {
      slideId: "intro",
      elementId: "intro--title",
      text: "Updated title",
    });

    expect(await readFile(files.sourcePath, "utf8")).toBe("# Updated title\n\nAfter\n");
  });

  it("can edit the same title twice before DeckIR is regenerated", async () => {
    const files = await fixture("# Before\n\nAfter\n", "title");

    await updateTextElementSource(files.directory, files.deckIrPath, {
      slideId: "intro",
      elementId: "intro--title",
      text: "A much longer title",
    });
    await updateTextElementSource(files.directory, files.deckIrPath, {
      slideId: "intro",
      elementId: "intro--title",
      text: "Before",
    });

    expect(await readFile(files.sourcePath, "utf8")).toBe("# Before\n\nAfter\n");
  });

  it("replaces a Markdown body range and keeps the rest of the file", async () => {
    const files = await fixture(
      '- Before\n\n<Text id="other" x={0} y={0} w={10} h={10}>Untouched</Text>\n',
    );

    await updateTextElementSource(files.directory, files.deckIrPath, {
      slideId: "intro",
      elementId: "intro--body",
      text: "- Updated\n- Added",
    });

    expect(await readFile(files.sourcePath, "utf8")).toBe(
      '- Updated\n- Added\n\n<Text id="other" x={0} y={0} w={10} h={10}>Untouched</Text>\n',
    );
  });

  it("updates the children of an explicit Text component", async () => {
    const source = '<Text id="caption" x={0} y={0} w={100} h={40}>Before</Text>\n';
    const files = await fixture(source);
    const deck = JSON.parse(await readFile(files.deckIrPath, "utf8")) as DeckIR;
    const element = deck.slides[0]?.elements[0];
    if (!element) throw new Error("fixture element missing");
    element.id = "caption";
    element.sourceLocation.endColumn = source.trimEnd().length + 1;
    await writeFile(files.deckIrPath, `${JSON.stringify(deck)}\n`, "utf8");

    await updateTextElementSource(files.directory, files.deckIrPath, {
      slideId: "intro",
      elementId: "caption",
      text: "Updated caption",
    });

    expect(await readFile(files.sourcePath, "utf8")).toBe(
      [
        '<Text id="caption" x={0} y={0} w={100} h={40}>',
        "",
        "Updated caption",
        "",
        "</Text>",
        "",
      ].join("\n"),
    );
  });

  it("updates Markdown inside a named Slot without removing the wrapper", async () => {
    const source = '<Slot name="left">\n\n- Before\n\n</Slot>\n';
    const files = await fixture(source);
    const deck = JSON.parse(await readFile(files.deckIrPath, "utf8")) as DeckIR;
    const element = deck.slides[0]?.elements[0];
    if (!element) throw new Error("fixture element missing");
    element.id = "intro--left";
    await writeFile(files.deckIrPath, `${JSON.stringify(deck)}\n`, "utf8");

    await updateTextElementSource(files.directory, files.deckIrPath, {
      slideId: "intro",
      elementId: "intro--left",
      text: "- Updated\n- Added",
    });

    expect(await readFile(files.sourcePath, "utf8")).toBe(
      '<Slot name="left">\n\n- Updated\n- Added\n\n</Slot>\n',
    );
  });

  it("rejects a source path outside the deck", async () => {
    const files = await fixture("# Before\n", "title");
    const deck = JSON.parse(await readFile(files.deckIrPath, "utf8")) as DeckIR;
    const element = deck.slides[0]?.elements[0];
    if (!element) throw new Error("fixture element missing");
    element.sourceLocation.file = join(files.directory, "..", "outside.mdx");
    await writeFile(files.deckIrPath, `${JSON.stringify(deck)}\n`, "utf8");

    await expect(
      updateTextElementSource(files.directory, files.deckIrPath, {
        slideId: "intro",
        elementId: "intro--title",
        text: "Nope",
      }),
    ).rejects.toThrow("outside");
  });
});
