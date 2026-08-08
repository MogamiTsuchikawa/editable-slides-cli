import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseDeckMdx } from "@editable-slides/slide-compiler";
import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacyDeckSource } from "./migrate.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "livetoon-migrate-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, "slides"));
  await writeFile(
    path.join(directory, "deck.yaml"),
    [
      "schemaVersion: 1",
      "id: legacy",
      "title: Legacy deck",
      "theme: default",
      "canvas: wide",
      "language: ja-JP",
      "strictEditable: true",
      "slides:",
      "  - slides/cover.mdx",
      "  - slides/detail.mdx",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(directory, "slides", "cover.mdx"),
    [
      "---",
      "id: cover",
      "layout: cover",
      "notes: 表紙を説明します。",
      "sources: []",
      "---",
      "",
      "# 表紙",
      "",
      "副題",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(directory, "slides", "detail.mdx"),
    [
      "---",
      "id: detail",
      "layout: title-body",
      "notes: 詳細を説明します。",
      "sources:",
      "  - label: 根拠資料",
      "---",
      "",
      "# 詳細",
      "",
      "本文です。",
      "",
    ].join("\n"),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("legacy deck migration", () => {
  it("combines legacy config and slide files without changing the originals", async () => {
    const directory = await fixture();
    const before = await readFile(path.join(directory, "slides", "cover.mdx"), "utf8");

    const result = await migrateLegacyDeckSource(directory);
    const parsed = parseDeckMdx(result.source, path.join(directory, "deck.mdx"));

    expect(result.slideCount).toBe(2);
    expect(result.sourceFiles).toEqual([
      "deck.yaml",
      "slides/cover.mdx",
      "slides/detail.mdx",
    ]);
    expect(parsed.config.slides.map((slide) => slide.id)).toEqual(["cover", "detail"]);
    expect(parsed.slides).toHaveLength(2);
    expect(await readFile(path.join(directory, "slides", "cover.mdx"), "utf8")).toBe(
      before,
    );
  });

  it("rejects symlinked legacy slide files", async () => {
    const directory = await fixture();
    const outside = path.join(directory, "outside.mdx");
    await writeFile(outside, "---\nid: outside\n---\n\n# Outside\n");
    await rm(path.join(directory, "slides", "detail.mdx"));
    await symlink(outside, path.join(directory, "slides", "detail.mdx"));

    await expect(migrateLegacyDeckSource(directory)).rejects.toThrow(
      "シンボリックリンク",
    );
  });
});
