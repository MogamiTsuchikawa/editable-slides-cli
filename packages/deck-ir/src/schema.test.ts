import { describe, expect, it } from "vitest";

import { DeckIRSchema, frameToPptx, WIDE_CANVAS } from "./index.js";

const sourceLocation = {
  file: "/tmp/example.mdx",
  line: 1,
  column: 1,
};

function createDeck() {
  const bodyStyle = {
    fontFace: "Noto Sans JP",
    fontSize: 32,
    color: "#111111",
    fontWeight: 400,
    align: "left" as const,
    verticalAlign: "top" as const,
  };

  return {
    schemaVersion: 1,
    metadata: {
      id: "example",
      title: "Example",
      language: "ja-JP",
    },
    canvas: WIDE_CANVAS,
    theme: {
      id: "default",
      name: "Default",
      colors: { text: "#111111" },
      fonts: {
        heading: { family: "Noto Sans JP", fallbacks: ["Arial"] },
        body: { family: "Noto Sans JP", fallbacks: ["Arial"] },
        code: { family: "Noto Sans Mono", fallbacks: ["monospace"] },
        registered: [
          {
            family: "Noto Sans JP",
            weight: 400,
            style: "normal" as const,
            source: "system" as const,
          },
        ],
      },
      typography: {
        title: bodyStyle,
        heading: bodyStyle,
        body: bodyStyle,
        caption: bodyStyle,
        code: { ...bodyStyle, fontFace: "Noto Sans Mono" },
      },
      safeArea: { x: 96, y: 72, w: 1728, h: 936 },
      layoutIds: ["blank"],
      masters: [
        {
          id: "default",
          background: { type: "solid" as const, color: "#FFFFFF" },
        },
      ],
    },
    slides: [
      {
        id: "slide-1",
        sourcePath: "/tmp/example.mdx",
        layoutId: "blank",
        elements: [
          {
            id: "body",
            type: "text" as const,
            frame: { x: 100, y: 100, w: 500, h: 300 },
            rotation: 0,
            zIndex: 1,
            opacity: 1,
            sourceLocation,
            paragraphs: [{ runs: [{ text: "Hello" }] }],
            style: bodyStyle,
          },
        ],
        notes: { markdown: "", plainText: "", sources: [] },
      },
    ],
    diagnostics: [],
    contentHash: "abc123",
  };
}

describe("DeckIRSchema", () => {
  it("accepts a valid deck", () => {
    expect(DeckIRSchema.parse(createDeck()).slides).toHaveLength(1);
  });

  it("rejects duplicate element ids", () => {
    const deck = createDeck();
    const firstElement = deck.slides[0]?.elements[0];
    if (!firstElement) {
      throw new Error("Fixture must contain one element");
    }
    deck.slides[0]?.elements.push({ ...firstElement });
    expect(() => DeckIRSchema.parse(deck)).toThrow(/Duplicate element id/);
  });

  it("requires a reason for non-editable elements", () => {
    const deck = createDeck();
    const element = deck.slides[0]?.elements[0];
    if (element) {
      element.editable = false;
    }
    expect(() => DeckIRSchema.parse(deck)).toThrow(/requires fallbackReason/);
  });
});

describe("frameToPptx", () => {
  it("maps the logical canvas exactly to wide PPTX dimensions", () => {
    expect(
      frameToPptx({ x: 0, y: 0, w: WIDE_CANVAS.width, h: WIDE_CANVAS.height }),
    ).toEqual({
      x: 0,
      y: 0,
      w: WIDE_CANVAS.pptxWidthInch,
      h: WIDE_CANVAS.pptxHeightInch,
    });
  });
});
