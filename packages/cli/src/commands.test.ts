import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DeckIR } from "@livetoon/slide-deck-ir";
import { afterEach, describe, expect, it } from "vitest";

import { collectPdfDeckExpectations, newCommand } from "./commands.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("collectPdfDeckExpectations", () => {
  it("collects paragraph text plus used theme and exception fonts", () => {
    const deck = {
      theme: {
        fonts: {
          heading: { family: "Noto Sans JP" },
          body: { family: "Noto Sans JP" },
          code: { family: "Noto Sans Mono" },
        },
      },
      slides: [
        {
          elements: [
            {
              type: "text",
              role: "heading",
              style: { fontFace: "Noto Sans JP" },
              paragraphs: [{ runs: [{ text: "見出し" }] }],
            },
            {
              type: "text",
              role: "code",
              style: { fontFace: "Noto Sans Mono" },
              paragraphs: [
                {
                  runs: [
                    { text: "npm run slide" },
                    { text: " -- export", fontFace: "Custom Mono" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as DeckIR;

    expect(collectPdfDeckExpectations(deck)).toEqual({
      text: ["見出し", "npm run slide -- export"],
      fonts: ["Noto Sans JP", "Noto Sans Mono", "Custom Mono"],
    });
  });
});

describe("newCommand", () => {
  it("creates a single-file deck.mdx authoring source", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "livetoon-slide-new-"));
    temporaryDirectories.push(parent);
    const target = path.join(parent, "deck");

    await newCommand(target, { theme: "company" }, { out: () => {}, error: () => {} });

    const source = await readFile(path.join(target, "deck.mdx"), "utf8");
    expect(source).toContain("theme: company");
    expect(source).toContain('<Slide id="cover">');
    expect(source).toContain('<Slide id="summary">');
    await expect(readFile(path.join(target, "deck.yaml"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });
});
