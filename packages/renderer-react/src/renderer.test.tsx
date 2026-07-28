// @vitest-environment jsdom
import type { DeckIR, ElementIR, SlideIR } from "@livetoon/slide-deck-ir";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  applyFrameOverride,
  elementFrameStyle,
  elementType,
  SlideCanvas,
} from "./renderer.js";

const sourceLocation = {
  file: "slides/example.mdx",
  line: 1,
  column: 1,
};

function textElement(): ElementIR {
  return {
    type: "text",
    id: "headline",
    frame: { x: 100, y: 120, w: 800, h: 160 },
    rotation: 0,
    zIndex: 2,
    opacity: 1,
    sourceLocation,
    paragraphs: [{ runs: [{ text: "DeckIR headline", bold: true }] }],
    style: {
      fontFace: "Noto Sans JP",
      fontSize: 48,
      color: "#123456",
      fontWeight: 700,
      align: "left",
      verticalAlign: "top",
      textFit: "none",
    },
  };
}

function tableElement(): ElementIR {
  return {
    type: "table",
    id: "metrics",
    frame: { x: 100, y: 320, w: 800, h: 300 },
    rotation: 0,
    zIndex: 2,
    opacity: 1,
    sourceLocation,
    rows: [
      {
        cells: [
          {
            paragraphs: [{ runs: [{ text: "Header" }] }],
            textStyle: { fontWeight: 700 },
          },
        ],
      },
    ],
    style: {
      border: { color: "#CBD3DF", width: 1, dash: "solid" },
      headerFill: { type: "solid", color: "#EAF0FF" },
      bodyFill: { type: "solid", color: "#FFFFFF" },
      text: {
        fontFace: "Noto Sans JP",
        fontSize: 22,
        color: "#172033",
        fontWeight: 400,
        align: "left",
        verticalAlign: "top",
        textFit: "none",
      },
    },
  };
}

function slide(): SlideIR {
  return {
    id: "intro",
    sourcePath: "slides/example.mdx",
    layoutId: "blank",
    elements: [textElement()],
    notes: { markdown: "SECRET NOTE", plainText: "SECRET NOTE", sources: [] },
  } as SlideIR;
}

function deck(): DeckIR {
  return {
    schemaVersion: 1,
    metadata: { id: "example", title: "Example", language: "ja-JP" },
    canvas: {
      width: 1920,
      height: 1080,
      pptxWidthInch: 13.333333,
      pptxHeightInch: 7.5,
    },
    theme: {} as DeckIR["theme"],
    slides: [slide()],
    diagnostics: [],
    contentHash: "fixture",
  };
}

describe("renderer-react", () => {
  it("uses overrides without mutating the source element", () => {
    const element = textElement();
    const resolved = applyFrameOverride(element, { x: 240, rotation: 15 });
    expect(resolved).toMatchObject({ x: 240, y: 120, w: 800, rotation: 15 });
    expect(element.frame.x).toBe(100);
    expect(elementFrameStyle(resolved).transform).toBe("rotate(15deg)");
  });

  it("renders DeckIR text while keeping presenter notes out of slide DOM", () => {
    render(<SlideCanvas deck={deck()} mode="normal" slide={slide()} />);
    expect(screen.getByText("DeckIR headline")).toBeTruthy();
    expect(screen.queryByText("SECRET NOTE")).toBeNull();
    expect(document.querySelector("[data-slide-element-id='headline']")).toBeTruthy();
  });

  it("recognizes element discriminants", () => {
    expect(elementType(textElement())).toBe("text");
  });

  it("applies per-cell table text styles", () => {
    const tableSlide = { ...slide(), elements: [tableElement()] };
    render(<SlideCanvas deck={deck()} mode="normal" slide={tableSlide} />);
    const header = screen.getByText("Header").closest("th");
    expect(header?.style.fontWeight).toBe("700");
  });
});
