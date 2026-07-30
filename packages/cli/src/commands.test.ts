import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileDeckDirectory } from "@livetoon/slide-compiler";
import type { DeckIR } from "@livetoon/slide-deck-ir";
import { companyTheme } from "@livetoon/slide-theme-company";
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
    const target = path.join(parent, "sales-kickoff");

    await newCommand(
      target,
      { theme: "company", title: "営業キックオフ" },
      { out: () => {}, error: () => {} },
    );

    const source = await readFile(path.join(target, "deck.mdx"), "utf8");
    expect(source).toContain("id: sales-kickoff");
    expect(source).toContain('title: "営業キックオフ"');
    expect(source).toContain("# 営業キックオフ");
    expect(source).toContain('theme: "company"');
    expect(source).toContain('<Slide id="cover">');
    expect(source).toContain('<Slide id="summary">');
    expect((await stat(path.join(target, "assets"))).isDirectory()).toBe(true);
    expect((await stat(path.join(target, "data"))).isDirectory()).toBe(true);
    const result = await compileDeckDirectory(target, { theme: companyTheme });
    expect(result.deck.metadata.id).toBe("sales-kickoff");
    expect(result.deck.slides).toHaveLength(2);
    await expect(readFile(path.join(target, "deck.yaml"), "utf8")).rejects.toEqual(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

  it("escapes MDX punctuation and normalizes line breaks in the title", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "livetoon-slide-new-"));
    temporaryDirectories.push(parent);
    const target = path.join(parent, "safe-title");

    await newCommand(
      target,
      { title: "AI <活用> {2026}\n全社" },
      { out: () => {}, error: () => {} },
    );

    const source = await readFile(path.join(target, "deck.mdx"), "utf8");
    expect(source).toContain('title: "AI <活用> {2026} 全社"');
    expect(source).toContain("# AI &lt;活用&gt; &#123;2026&#125; 全社");
    await expect(
      compileDeckDirectory(target, { theme: companyTheme }),
    ).resolves.toEqual(
      expect.objectContaining({
        deck: expect.objectContaining({
          metadata: expect.objectContaining({ title: "AI <活用> {2026} 全社" }),
        }),
      }),
    );
  });

  it("rejects an invalid deck id before creating files", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "livetoon-slide-new-"));
    temporaryDirectories.push(parent);
    const target = path.join(parent, "日本語の資料");

    await expect(
      newCommand(target, {}, { out: () => {}, error: () => {} }),
    ).rejects.toThrow("Deck id must start");
  });
});
