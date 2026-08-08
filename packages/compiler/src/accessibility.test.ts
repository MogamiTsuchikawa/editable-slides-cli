import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ShapeElementIR,
  SlideIR,
  SourceLocation,
  TextElementIR,
} from "@editable-slides/slide-deck-ir";
import { defaultTheme } from "@editable-slides/slide-theme-default";
import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  validateSlideAccessibility,
  validateVisualAlternative,
} from "./accessibility.js";
import { compileDeck } from "./compiler.js";
import { validateSlides } from "./validate.js";

const sourceLocation: SourceLocation = {
  file: "/deck/deck.mdx",
  line: 1,
  column: 1,
};

function textElement(
  id: string,
  frame: { x: number; y: number; w: number; h: number },
  color = "#111111",
): TextElementIR {
  return {
    id,
    type: "text",
    role: "body",
    frame,
    rotation: 0,
    zIndex: 20,
    opacity: 1,
    editable: true,
    sourceLocation,
    paragraphs: [{ runs: [{ text: id }] }],
    style: {
      ...structuredClone(defaultTheme.ir.typography.body),
      color,
    },
  };
}

function slide(elements: SlideIR["elements"]): SlideIR {
  return {
    id: "accessibility",
    sourcePath: sourceLocation.file,
    layoutId: "blank",
    background: { type: "solid", color: "#FFFFFF" },
    elements,
    notes: { markdown: "", plainText: "", sources: [] },
  };
}

describe("visual alternatives", () => {
  it("requires alt text unless decorative content is explicit", () => {
    expect(validateVisualAlternative({ component: "Image" })).toEqual([
      expect.objectContaining({ code: "ACCESSIBILITY_ALT_REQUIRED" }),
    ]);
    expect(validateVisualAlternative({ component: "Image", decorative: true })).toEqual(
      [],
    );
    expect(validateVisualAlternative({ component: "Image", background: true })).toEqual(
      [],
    );
    expect(
      validateVisualAlternative({
        component: "Image",
        background: true,
        alt: "Background photo",
      }),
    ).toEqual([
      expect.objectContaining({ code: "ACCESSIBILITY_DECORATIVE_ALT_CONFLICT" }),
    ]);
    expect(
      validateVisualAlternative({
        component: "Icon",
        decorative: true,
        alt: "Meaningful icon",
      }),
    ).toEqual([
      expect.objectContaining({ code: "ACCESSIBILITY_DECORATIVE_ALT_CONFLICT" }),
    ]);
    expect(validateVisualAlternative({ component: "Video" })).toEqual([
      expect.objectContaining({ code: "ACCESSIBILITY_ALT_REQUIRED" }),
    ]);
    expect(
      validateVisualAlternative({ component: "Audio", transcript: "ナレーション" }),
    ).toEqual([]);
  });
});

describe("slide accessibility diagnostics", () => {
  it("calculates basic WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("warns about low text contrast and a clear reading-order inversion", () => {
    const candidate = slide([
      textElement("lower-first", { x: 200, y: 600, w: 500, h: 120 }),
      textElement("upper-second", { x: 200, y: 200, w: 500, h: 120 }, "#AAAAAA"),
    ]);
    const issues = validateSlideAccessibility(candidate, defaultTheme);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ACCESSIBILITY_TEXT_CONTRAST_LOW",
          elementId: "upper-second",
        }),
        expect.objectContaining({
          code: "ACCESSIBILITY_READING_ORDER_SUSPECT",
          elementId: "upper-second",
        }),
      ]),
    );
  });

  it("uses solid master shapes when checking text contrast", () => {
    const theme = structuredClone(defaultTheme);
    theme.ir.masters.push({
      id: "teal-title-master",
      background: { type: "solid", color: "#FFFFFF" },
      elements: [
        {
          id: "teal-title-band",
          type: "shape",
          shape: "rect",
          frame: { x: 0, y: 0, w: 1920, h: 170 },
          rotation: 0,
          zIndex: 100,
          opacity: 1,
          locked: true,
          editable: false,
          sourceLocation,
          fill: { type: "solid", color: "#3494BA" },
        },
      ],
    });
    const candidate = slide([
      textElement("white-title", { x: 61, y: 0, w: 1658, h: 170 }, "#FFFFFF"),
    ]);
    candidate.masterId = "teal-title-master";
    const title = candidate.elements[0];
    if (title?.type === "text") {
      title.style.fontSize = 88;
      title.style.fontWeight = 700;
    }

    expect(validateSlideAccessibility(candidate, theme)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ACCESSIBILITY_TEXT_CONTRAST_LOW",
          elementId: "white-title",
        }),
      ]),
    );
  });

  it("prioritizes slide shapes over master shapes regardless of layer z-index", () => {
    const theme = structuredClone(defaultTheme);
    theme.ir.masters.push({
      id: "layered-title-master",
      background: { type: "solid", color: "#FFFFFF" },
      elements: [
        {
          id: "master-black-band",
          type: "shape",
          shape: "rect",
          frame: { x: 0, y: 0, w: 1920, h: 170 },
          rotation: 0,
          zIndex: 19,
          opacity: 1,
          locked: true,
          editable: false,
          sourceLocation,
          fill: { type: "solid", color: "#000000" },
        },
      ],
    });
    const whiteOverlay: ShapeElementIR = {
      id: "slide-white-overlay",
      type: "shape",
      shape: "rect",
      frame: { x: 0, y: 0, w: 1920, h: 170 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
      fill: { type: "solid", color: "#FFFFFF" },
    };
    const title = textElement(
      "white-title-over-slide-shape",
      { x: 61, y: 0, w: 1658, h: 170 },
      "#FFFFFF",
    );
    title.style.fontSize = 88;
    title.style.fontWeight = 700;
    const candidate = slide([whiteOverlay, title]);
    candidate.masterId = "layered-title-master";

    expect(validateSlideAccessibility(candidate, theme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ACCESSIBILITY_TEXT_CONTRAST_LOW",
          elementId: "white-title-over-slide-shape",
        }),
      ]),
    );
  });

  it("warns when semantic content is entirely outside the theme safe area", () => {
    const candidate = slide([
      textElement("edge-content", { x: 0, y: 0, w: 80, h: 60 }),
    ]);
    expect(validateSlideAccessibility(candidate, defaultTheme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ACCESSIBILITY_ELEMENT_OUTSIDE_SAFE_AREA",
          elementId: "edge-content",
        }),
      ]),
    );
  });

  it("keeps canvas-boundary failures as release-blocking errors", () => {
    const outOfBounds: ShapeElementIR = {
      id: "outside",
      type: "shape",
      shape: "rect",
      frame: { x: 1900, y: 100, w: 80, h: 80 },
      rotation: 0,
      zIndex: 10,
      opacity: 1,
      editable: true,
      sourceLocation,
      fill: { type: "solid", color: "#FFFFFF" },
    };
    expect(validateSlides([slide([outOfBounds])], defaultTheme)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "ELEMENT_OUT_OF_BOUNDS",
          elementId: "outside",
        }),
      ]),
    );
  });

  it("lets release mode promote accessibility warnings to a failure", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-a11y-"));
    const deckPath = path.join(directory, "deck.mdx");
    try {
      await writeFile(
        deckPath,
        [
          "---",
          "schemaVersion: 1",
          "id: low-contrast",
          "title: Low contrast",
          "language: en-US",
          "slides:",
          "  - id: first",
          "    layout: blank",
          "---",
          "",
          '<Slide id="first">',
          "",
          '<Text id="copy" x={200} y={200} w={800} h={200} color="#AAAAAA">',
          "  Low contrast copy",
          "</Text>",
          "",
          "</Slide>",
        ].join("\n"),
      );
      const compiled = await compileDeck(deckPath);
      expect(compiled.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "warning",
            code: "ACCESSIBILITY_TEXT_CONTRAST_LOW",
          }),
        ]),
      );
      await expect(compileDeck(deckPath, { failOnWarnings: true })).rejects.toEqual(
        expect.objectContaining({
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: "WARNINGS_AS_ERRORS" }),
          ]),
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
