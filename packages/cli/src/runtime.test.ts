import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Diagnostic } from "@livetoon/slide-deck-ir";
import { describe, expect, it } from "vitest";

import {
  collectBuildAssets,
  compileArtifact,
  formatDiagnostic,
  loadTheme,
  publishStagedOutput,
  resolveRepositoryRoot,
  sanitizeArtifactPaths,
} from "./runtime.js";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwJ7WQAAAABJRU5ErkJggg==",
  "base64",
);

function isoBox(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.byteLength + payload.byteLength, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function videoFixture(): Buffer {
  const handler = Buffer.alloc(12);
  handler.write("vide", 8, 4, "ascii");
  return Buffer.concat([
    isoBox("ftyp", Buffer.from("mp42\0\0\0\0mp42", "binary")),
    isoBox("moov", isoBox("trak", isoBox("mdia", isoBox("hdlr", handler)))),
    isoBox("free", Buffer.from("avc1", "ascii")),
  ]);
}

describe("resolveRepositoryRoot", () => {
  it("prefers an explicit workspace root", () => {
    expect(
      resolveRepositoryRoot({
        explicitRoot: "/workspace/explicit",
        initialDirectory: "/workspace/initial",
        currentDirectory: "/workspace/current",
      }),
    ).toBe("/workspace/explicit");
  });

  it("uses the current invocation directory instead of an inherited npm directory", () => {
    expect(
      resolveRepositoryRoot({
        initialDirectory: "/workspace/invocation",
        currentDirectory: "/workspace/current",
      }),
    ).toBe("/workspace/current");
  });
});

describe("built-in themes", () => {
  it("loads tsuchikawa-shuron without enabling executable custom themes", async () => {
    const first = await loadTheme("tsuchikawa-shuron", process.cwd());
    first.ir.name = "mutated";

    const second = await loadTheme("tsuchikawa-shuron", process.cwd());

    expect(second.ir.id).toBe("tsuchikawa-shuron");
    expect(second.ir.name).toBe("Tsuchikawa Shuron");
  });
});

describe("staged release publication", () => {
  it("replaces an existing output only after the staging directory is complete", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-release-"));
    const destination = path.join(root, "example");
    const staging = path.join(root, ".example.release-test");
    try {
      await Promise.all([mkdir(destination), mkdir(staging)]);
      await Promise.all([
        writeFile(path.join(destination, "old.txt"), "old"),
        writeFile(path.join(staging, "new.txt"), "new"),
      ]);

      await publishStagedOutput(staging, destination);

      expect(await readFile(path.join(destination, "new.txt"), "utf8")).toBe("new");
      await expect(
        readFile(path.join(destination, "old.txt"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("public artifact paths", () => {
  it("removes user-specific absolute paths without changing ordinary text", () => {
    expect(
      sanitizeArtifactPaths(
        {
          sourceLocation: { file: "/Users/alice/work/decks/demo/deck.mdx" },
          src: "/Users/alice/work/decks/demo/assets/hero.png",
          captionSrc: "/Users/alice/work/decks/demo/assets/demo.ja.vtt",
          theme: { path: "/Users/alice/work/themes/company/logo.svg" },
          output: { path: "/Users/alice/work/dist/demo/demo.pptx" },
          text: "/Users/alice should remain ordinary slide text",
        },
        {
          deckDirectory: "/Users/alice/work/decks/demo",
          outputDirectory: "/Users/alice/work/dist/demo",
          workspaceDirectory: "/Users/alice/work",
        },
      ),
    ).toEqual({
      sourceLocation: { file: "./deck.mdx" },
      src: "./assets/hero.png",
      captionSrc: "./assets/demo.ja.vtt",
      theme: { path: "workspace/themes/company/logo.svg" },
      output: { path: "./demo.pptx" },
      text: "/Users/alice should remain ordinary slide text",
    });
  });
});

describe("canonical deck paths", () => {
  it("compiles media through a symlinked deck directory without losing its poster", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-path-alias-"));
    const physicalDirectory = path.join(root, "physical");
    const aliasDirectory = path.join(root, "alias");
    const deckId = `alias-media-${path
      .basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")}`;
    let stagingDirectory: string | undefined;
    try {
      await mkdir(path.join(physicalDirectory, "assets"), { recursive: true });
      await symlink(
        physicalDirectory,
        aliasDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
      await Promise.all([
        writeFile(path.join(physicalDirectory, "assets", "demo.mp4"), videoFixture()),
        writeFile(path.join(physicalDirectory, "assets", "poster.png"), PIXEL_PNG),
        writeFile(
          path.join(physicalDirectory, "deck.mdx"),
          `---
schemaVersion: 1
id: ${deckId}
title: Alias media
theme: default
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: media
    layout: blank
    notes: 動画ポスターの確認
    sources: []
---

<Slide id="media">

<Video id="demo" alt="製品デモ" src="./assets/demo.mp4" poster="./assets/poster.png" x={100} y={100} w={800} h={450} />

</Slide>
`,
          "utf8",
        ),
      ]);

      const artifact = await compileArtifact(aliasDirectory, { staging: true });
      stagingDirectory = artifact.outputDirectory;
      const canonicalDirectory = await realpath(physicalDirectory);
      const video = artifact.deck.slides[0]?.elements.find(
        (element) => element.type === "video",
      );
      const publicDeck = JSON.parse(
        await readFile(artifact.publicDeckIrPath, "utf8"),
      ) as { slides?: Array<{ elements?: Array<{ posterSrc?: string }> }> };

      expect(artifact.deckDirectory).toBe(canonicalDirectory);
      expect(video).toMatchObject({
        type: "video",
        src: path.join(canonicalDirectory, "assets", "demo.mp4"),
        posterSrc: path.join(canonicalDirectory, "assets", "poster.png"),
      });
      expect(publicDeck.slides?.[0]?.elements?.[0]?.posterSrc).toBe(
        "./assets/poster.png",
      );
    } finally {
      if (stagingDirectory) {
        await rm(stagingDirectory, { recursive: true, force: true });
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("formatDiagnostic", () => {
  it("includes source and element context", () => {
    const diagnostic: Diagnostic = {
      severity: "warning",
      code: "ORPHAN_OVERRIDE",
      message: "Unknown element",
      sourceLocation: {
        file: "/deck/layout.overrides.json",
        line: 3,
        column: 5,
      },
      slideId: "summary",
      elementId: "missing",
    };

    expect(formatDiagnostic(diagnostic)).toBe(
      "WARNING ORPHAN_OVERRIDE /deck/layout.overrides.json:3:5 [missing] Unknown element",
    );
  });
});

describe("collectBuildAssets", () => {
  it("records media files and their poster metadata", () => {
    const assets = collectBuildAssets({
      slides: [
        {
          id: "demo",
          elements: [
            {
              id: "video",
              type: "video",
              src: "/deck/demo.mp4",
              contentHash: "video-hash",
              mimeType: "video/mp4",
              byteLength: 123,
              posterSrc: "/deck/poster.png",
              posterContentHash: "poster-hash",
              posterMimeType: "image/png",
              captionSrc: "/deck/demo.ja.vtt",
              captionContentHash: "caption-hash",
              captionMimeType: "text/vtt",
              captionLanguage: "ja",
              captionLabel: "日本語字幕",
              fit: "contain",
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof collectBuildAssets>[0]);

    expect(assets).toEqual([
      {
        kind: "video",
        slideId: "demo",
        elementId: "video",
        source: "/deck/demo.mp4",
        sha256: "video-hash",
        mimeType: "video/mp4",
        byteLength: 123,
        poster: {
          source: "/deck/poster.png",
          sha256: "poster-hash",
          mimeType: "image/png",
        },
        caption: {
          source: "/deck/demo.ja.vtt",
          sha256: "caption-hash",
          mimeType: "text/vtt",
          language: "ja",
          label: "日本語字幕",
        },
      },
    ]);
  });
});
