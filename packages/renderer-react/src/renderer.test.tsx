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

function chartElement(
  id: string,
  chartType: "bar" | "line" | "pie",
  values: number[][],
  colors: string[],
): ElementIR {
  return {
    type: "chart",
    id,
    chartType,
    frame: { x: 100, y: 100, w: 800, h: 500 },
    rotation: 0,
    zIndex: 2,
    opacity: 1,
    sourceLocation,
    series: values.map((seriesValues, index) => ({
      name: `Series ${index + 1}`,
      labels: seriesValues.map((_, valueIndex) => `Category ${valueIndex + 1}`),
      values: seriesValues,
    })),
    style: {
      colors,
      showLegend: false,
      showTitle: false,
      showValue: false,
      showCategoryName: false,
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

  it("renders the selected master's elements behind locked slide elements", () => {
    const themedDeck = deck();
    themedDeck.theme = {
      masters: [
        {
          id: "branded",
          background: { type: "solid", color: "#FFFFFF" },
          elements: [
            {
              ...textElement(),
              id: "master-label",
              paragraphs: [{ runs: [{ text: "Master label" }] }],
              zIndex: 999,
            },
            {
              type: "image",
              id: "master-gradient",
              frame: { x: 0, y: 0, w: 1920, h: 12 },
              rotation: 0,
              zIndex: 1000,
              opacity: 1,
              sourceLocation,
              src: "data:image/png;base64,AA==",
              fit: "stretch",
            },
          ],
        },
      ],
    } as DeckIR["theme"];
    const brandedSlide = { ...slide(), masterId: "branded" };

    render(<SlideCanvas deck={themedDeck} mode="edit" slide={brandedSlide} />);

    const masterLayer = document.querySelector(".lt-master-elements");
    const slideLayer = document.querySelector(".lt-slide-elements");
    const masterLabel = document.querySelector(
      "[data-master-element='true'][data-slide-element-id='master-label']",
    );
    const gradient = document.querySelector(
      "[data-master-element='true'][data-slide-element-id='master-gradient'] img",
    ) as HTMLImageElement | null;
    expect(masterLayer).not.toBeNull();
    expect(slideLayer).not.toBeNull();
    expect(
      masterLayer && slideLayer
        ? masterLayer.compareDocumentPosition(slideLayer) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();
    expect(masterLabel?.getAttribute("data-locked")).toBe("true");
    expect(masterLabel?.getAttribute("data-selected")).toBe("false");
    expect(gradient?.style.objectFit).toBe("fill");
  });

  it("uses chart palettes by category for pie and single-series bars, and by series for lines", () => {
    const multiSeriesBar = chartElement(
      "multi-bar-chart",
      "bar",
      [
        [10, 20],
        [20, 10],
      ],
      [],
    ) as ElementIR & { colors: string[] };
    multiSeriesBar.colors = ["#777777", "#888888"];
    const chartSlide = {
      ...slide(),
      elements: [
        chartElement("bar-chart", "bar", [[10, 20, 30]], ["#111111", "#222222"]),
        multiSeriesBar,
        chartElement("pie-chart", "pie", [[10, 20, 30]], ["#333333", "#444444"]),
        chartElement(
          "line-chart",
          "line",
          [
            [10, 20],
            [20, 10],
          ],
          ["#555555", "#666666"],
        ),
      ],
    };

    render(<SlideCanvas deck={deck()} mode="normal" slide={chartSlide} />);

    const barFills = [
      ...document.querySelectorAll("[data-slide-element-id='bar-chart'] rect"),
    ].map((node) => node.getAttribute("fill"));
    const pieFills = [
      ...document.querySelectorAll("[data-slide-element-id='pie-chart'] path"),
    ].map((node) => node.getAttribute("fill"));
    const lineStrokes = [
      ...document.querySelectorAll("[data-slide-element-id='line-chart'] polyline"),
    ].map((node) => node.getAttribute("stroke"));
    const multiBarFills = [
      ...document.querySelectorAll("[data-slide-element-id='multi-bar-chart'] rect"),
    ].map((node) => node.getAttribute("fill"));

    expect(barFills).toEqual(["#111111", "#222222", "#111111"]);
    expect(multiBarFills).toEqual(["#777777", "#777777", "#888888", "#888888"]);
    expect(pieFills).toEqual(["#333333", "#444444", "#333333"]);
    expect(lineStrokes).toEqual(["#555555", "#666666"]);
  });
});
