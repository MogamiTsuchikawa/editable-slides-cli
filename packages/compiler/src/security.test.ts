import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileDeck } from "./compiler.js";
import { DeckMdxConfigSchema, readLayoutOverrides } from "./config.js";
import { parseDeckMdx } from "./deck-mdx.js";
import { markdownNodesToParagraphs } from "./markdown.js";
import {
  IMAGE_FILE_POLICIES,
  isSafeHyperlink,
  isSafeWebUrl,
  MAX_DECK_SOURCE_BYTES,
  MAX_EMBEDDED_ASSET_BYTES,
  readSecureDeckFile,
  SecurityValidationError,
  validateEmbeddedAsset,
  validateSvgSafety,
} from "./security.js";

async function expectSecurityCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SecurityValidationError);
    if (error instanceof SecurityValidationError) {
      expect(error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })]),
      );
    }
  }
}

function deckSource(imageProps: string): string {
  return [
    "---",
    "schemaVersion: 1",
    "id: security-fixture",
    "title: Security fixture",
    "language: ja-JP",
    "slides:",
    "  - id: first",
    "    layout: blank",
    "---",
    "",
    '<Slide id="first">',
    "",
    `<Image id="visual" src="./safe.svg" x={100} y={100} w={200} h={100} ${imageProps} />`,
    "",
    "</Slide>",
  ].join("\n");
}

describe("secure deck files", () => {
  it.each(["deck.mdx", "deck.yaml"])(
    "rejects a symlinked %s entry that resolves outside the deck",
    async (entryName) => {
      const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
      const deckDirectory = path.join(root, "deck");
      try {
        await mkdir(deckDirectory);
        const outside = path.join(root, entryName);
        await writeFile(outside, "outside\n");
        const entryPath = path.join(deckDirectory, entryName);
        await symlink(outside, entryPath);
        await expect(compileDeck(entryPath)).rejects.toEqual(
          expect.objectContaining({
            name: "DeckCompileError",
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: "ASSET_SYMLINK_OUTSIDE_DECK" }),
            ]),
          }),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["deck.mdx", "deck.yaml"])(
    "rejects an oversized %s entry before parsing",
    async (entryName) => {
      const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
      try {
        const entryPath = path.join(root, entryName);
        await writeFile(entryPath, Buffer.alloc(MAX_DECK_SOURCE_BYTES + 1));
        await expect(compileDeck(entryPath)).rejects.toEqual(
          expect.objectContaining({
            name: "DeckCompileError",
            diagnostics: expect.arrayContaining([
              expect.objectContaining({ code: "ASSET_SIZE_LIMIT_EXCEEDED" }),
            ]),
          }),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["https://example.com/image.png", "ASSET_REMOTE_REFERENCE_FORBIDDEN"],
    ["data:image/png;base64,AAAA", "ASSET_SCHEME_FORBIDDEN"],
    ["javascript:alert(1)", "ASSET_SCHEME_FORBIDDEN"],
    ["file:///tmp/image.png", "ASSET_SCHEME_FORBIDDEN"],
  ])("rejects unsafe reference %s", async (reference, code) => {
    await expectSecurityCode(
      readSecureDeckFile({
        deckDirectory: "/tmp/deck",
        sourcePath: "/tmp/deck/deck.mdx",
        reference,
        allowedExtensions: IMAGE_FILE_POLICIES,
      }),
      code,
    );
  });

  it("rejects lexical traversal outside the deck", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
    const deckDirectory = path.join(root, "deck");
    try {
      await mkdir(deckDirectory);
      await writeFile(path.join(root, "outside.svg"), "<svg/>");
      await expectSecurityCode(
        readSecureDeckFile({
          deckDirectory,
          sourcePath: path.join(deckDirectory, "deck.mdx"),
          reference: "../outside.svg",
          allowedExtensions: IMAGE_FILE_POLICIES,
        }),
        "ASSET_PATH_OUTSIDE_DECK",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlink that resolves outside the deck", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
    const deckDirectory = path.join(root, "deck");
    try {
      await mkdir(path.join(deckDirectory, "assets"), { recursive: true });
      const outside = path.join(root, "outside.svg");
      await writeFile(outside, '<svg xmlns="http://www.w3.org/2000/svg"/>');
      await symlink(outside, path.join(deckDirectory, "assets", "escape.svg"));
      await expectSecurityCode(
        readSecureDeckFile({
          deckDirectory,
          sourcePath: path.join(deckDirectory, "deck.mdx"),
          reference: "assets/escape.svg",
          allowedExtensions: IMAGE_FILE_POLICIES,
        }),
        "ASSET_SYMLINK_OUTSIDE_DECK",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("also rejects symlinked layout override files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
    const deckDirectory = path.join(root, "deck");
    try {
      await mkdir(deckDirectory);
      const outside = path.join(root, "outside.json");
      await writeFile(outside, '{"schemaVersion":1,"slides":{}}');
      await symlink(outside, path.join(deckDirectory, "layout.overrides.json"));
      await expect(readLayoutOverrides(deckDirectory)).rejects.toEqual(
        expect.objectContaining({
          name: "DeckCompileError",
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: "ASSET_SYMLINK_OUTSIDE_DECK" }),
          ]),
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces the configured file-size limit before reading", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
    try {
      await writeFile(path.join(root, "large.png"), Buffer.alloc(4));
      await expectSecurityCode(
        readSecureDeckFile({
          deckDirectory: root,
          sourcePath: path.join(root, "deck.mdx"),
          reference: "large.png",
          allowedExtensions: { ".png": { mimeType: "image/png", maxBytes: 3 } },
        }),
        "ASSET_SIZE_LIMIT_EXCEEDED",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an asset whose contents do not match its extension", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
    try {
      await writeFile(path.join(root, "fake.png"), Buffer.from("not a PNG"));
      await expectSecurityCode(
        readSecureDeckFile({
          deckDirectory: root,
          sourcePath: path.join(root, "deck.mdx"),
          reference: "fake.png",
          allowedExtensions: IMAGE_FILE_POLICIES,
        }),
        "ASSET_SIGNATURE_MISMATCH",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("SVG and URL security", () => {
  it("allows local SVG fragment references", () => {
    expect(
      validateSvgSafety(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="mark"/></defs><use href="#mark"/></svg>',
      ),
    ).toEqual([]);
  });

  it("rejects SVG scripts, event handlers and external references", () => {
    const issues = validateSvgSafety(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="run()"><script>run()</script><image href="https://example.com/a.png"/></svg>',
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SVG_SCRIPT_FORBIDDEN" }),
        expect.objectContaining({ code: "SVG_EXTERNAL_REFERENCE_FORBIDDEN" }),
      ]),
    );
  });

  it("checks embedded asset size and SVG content", () => {
    expect(
      validateEmbeddedAsset(Buffer.alloc(MAX_EMBEDDED_ASSET_BYTES + 1), "image/png"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ASSET_SIZE_LIMIT_EXCEEDED" }),
      ]),
    );
    expect(
      validateEmbeddedAsset(
        Buffer.from("<svg><foreignObject/></svg>"),
        "image/svg+xml",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SVG_FOREIGN_OBJECT_FORBIDDEN" }),
      ]),
    );
  });

  it("allows only explicitly supported external link protocols", () => {
    expect(isSafeWebUrl("https://example.com/source")).toBe(true);
    expect(isSafeWebUrl("https://user:pass@example.com/source")).toBe(false);
    expect(isSafeWebUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHyperlink("mailto:slides@example.com")).toBe(true);
    expect(isSafeHyperlink("data:text/html,unsafe")).toBe(false);
  });

  it("diagnoses unsafe Markdown links", () => {
    const conversion = markdownNodesToParagraphs(
      [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "javascript:alert(1)",
              children: [{ type: "text", value: "unsafe" }],
            },
          ],
        },
      ],
      "/deck/deck.mdx",
      "first",
    );
    expect(conversion.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MARKDOWN_LINK_URL_UNSAFE" }),
      ]),
    );
    expect(conversion.paragraphs[0]?.runs[0]?.href).toBeUndefined();
  });
});

describe("configuration and embedded assets", () => {
  it("requires a well-formed deck language and safe source URLs", () => {
    const base = {
      schemaVersion: 1 as const,
      id: "language-fixture",
      title: "Language fixture",
      theme: "default",
      canvas: "wide" as const,
      strictEditable: true,
      slides: [{ id: "first", layout: "blank", notes: "", sources: [] }],
    };
    expect(DeckMdxConfigSchema.safeParse({ ...base, language: "ja-JP" }).success).toBe(
      true,
    );
    expect(DeckMdxConfigSchema.safeParse({ ...base, language: "ja_JP" }).success).toBe(
      false,
    );
    expect(
      DeckMdxConfigSchema.safeParse({
        ...base,
        language: "ja-JP",
        slides: [
          {
            id: "first",
            layout: "blank",
            notes: "",
            sources: [{ label: "unsafe", url: "javascript:alert(1)" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe embedded SVG content", () => {
    const encoded = Buffer.from("<svg><script>alert(1)</script></svg>").toString(
      "base64",
    );
    const parsed = parseDeckMdx(
      [
        "---",
        "schemaVersion: 1",
        "id: embedded-svg",
        "title: Embedded SVG",
        "slides:",
        "  - id: first",
        "    layout: blank",
        "---",
        "",
        '<Slide id="first"></Slide>',
        "",
        "<Assets>",
        '  <Asset id="unsafe" mimeType="image/svg+xml" encoding="base64">',
        `    ${encoded}`,
        "  </Asset>",
        "</Assets>",
      ].join("\n"),
      "/deck/deck.mdx",
    );
    expect(parsed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SVG_SCRIPT_FORBIDDEN" }),
      ]),
    );
    expect(parsed.assets.size).toBe(0);
  });

  it("requires alt text or an explicit decorative marker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "livetoon-security-"));
    const deckPath = path.join(root, "deck.mdx");
    try {
      await writeFile(
        path.join(root, "safe.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
      );
      await writeFile(deckPath, deckSource(""));
      await expect(compileDeck(deckPath)).rejects.toEqual(
        expect.objectContaining({
          name: "DeckCompileError",
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: "ACCESSIBILITY_ALT_REQUIRED" }),
          ]),
        }),
      );

      await writeFile(deckPath, deckSource("decorative={true}"));
      const compiled = await compileDeck(deckPath);
      const visual = compiled.deck.slides[0]?.elements.find(
        (element) => element.id === "visual",
      );
      expect(visual?.alt).toBeUndefined();
      expect(visual?.decorative).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
