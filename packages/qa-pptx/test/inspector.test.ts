import type { DeckIR, ElementBase, TextStyleIR } from "@livetoon/slide-deck-ir";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderPptx } from "../../renderer-pptx/src/index.js";
import {
  assertPptx,
  findLibreOfficeBinary,
  inspectPptx,
  PptxInspectionError,
  smokeTestPptxWithLibreOffice,
} from "../src/index.js";

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwJ7WQAAAABJRU5ErkJggg==";

const sourceLocation = {
  file: "slides/gallery.mdx",
  line: 1,
  column: 1,
};

const bodyStyle: TextStyleIR = {
  fontFace: "Noto Sans JP",
  fontSize: 18,
  color: "#111111",
  fontWeight: 400,
  align: "left",
  verticalAlign: "top",
  lineHeight: 24,
  letterSpacing: 0,
  textFit: "none",
};

function base(id: string, frame: ElementBase["frame"], zIndex = 10): ElementBase {
  return {
    id,
    frame,
    rotation: 0,
    zIndex,
    opacity: 1,
    sourceLocation,
  };
}

function coreDeck(): DeckIR {
  return {
    schemaVersion: 1,
    metadata: {
      id: "component-gallery",
      title: "Component Gallery",
      author: "Livetoon",
      company: "Livetoon",
      language: "ja-JP",
    },
    canvas: {
      width: 1920,
      height: 1080,
      pptxWidthInch: 13.333333,
      pptxHeightInch: 7.5,
    },
    theme: {
      id: "fixture",
      name: "Fixture",
      colors: {
        background: "#FFFFFF",
        primary: "#3366FF",
      },
      fonts: {
        heading: { family: "Noto Sans JP", fallbacks: [] },
        body: { family: "Noto Sans JP", fallbacks: [] },
        code: { family: "Noto Sans Mono", fallbacks: [] },
        registered: [],
      },
      typography: {
        title: { ...bodyStyle, fontSize: 36, fontWeight: 700 },
        heading: { ...bodyStyle, fontSize: 28, fontWeight: 700 },
        body: bodyStyle,
        caption: { ...bodyStyle, fontSize: 14 },
        code: { ...bodyStyle, fontFace: "Noto Sans Mono", fontSize: 16 },
      },
      safeArea: { x: 60, y: 60, w: 1800, h: 960 },
      layoutIds: ["blank"],
      masters: [
        {
          id: "default",
          background: { type: "solid", color: "#FFFFFF" },
        },
      ],
    },
    slides: [
      {
        id: "gallery",
        sourcePath: "slides/gallery.mdx",
        layoutId: "blank",
        masterId: "default",
        elements: [
          {
            ...base("connector", { x: 80, y: 100, w: 400, h: 180 }, 1),
            type: "connector",
            start: { x: 80, y: 100 },
            end: { x: 480, y: 280 },
            stroke: { color: "#3366FF", width: 2 },
            beginArrow: "none",
            endArrow: "triangle",
            fromElementId: "shape",
            toElementId: "title",
          },
          {
            ...base("line", { x: 80, y: 330, w: 400, h: 0 }, 2),
            type: "line",
            start: { x: 80, y: 330 },
            end: { x: 480, y: 330 },
            stroke: { color: "#333333", width: 1, dash: "dot" },
            beginArrow: "oval",
            endArrow: "stealth",
          },
          {
            ...base("title", { x: 80, y: 30, w: 800, h: 90 }),
            type: "text",
            role: "title",
            paragraphs: [
              {
                runs: [
                  { text: "編集可能な", bold: true },
                  { text: "テキスト", color: "#3366FF" },
                ],
              },
            ],
            style: {
              ...bodyStyle,
              fontSize: 28,
              fontWeight: 700,
            },
          },
          {
            ...base("shape", { x: 520, y: 150, w: 360, h: 180 }),
            type: "shape",
            shape: "roundRect",
            fill: { type: "solid", color: "#EAF0FF" },
            stroke: { color: "#3366FF", width: 2 },
          },
          {
            ...base("image", { x: 920, y: 120, w: 240, h: 180 }),
            type: "image",
            src: PIXEL_PNG,
            fit: "contain",
            role: "content",
            alt: "fixture image",
          },
          {
            ...base("icon", { x: 1200, y: 120, w: 120, h: 120 }),
            type: "icon",
            src: PIXEL_PNG,
            color: "#3366FF",
            alt: "fixture icon",
          },
          {
            ...base("table", { x: 80, y: 400, w: 800, h: 260 }),
            type: "table",
            rows: [
              {
                height: 80,
                cells: [
                  {
                    paragraphs: [{ runs: [{ text: "項目" }] }],
                    fill: { type: "solid", color: "#3366FF" },
                    textStyle: { color: "#FFFFFF", fontWeight: 700 },
                  },
                  {
                    paragraphs: [{ runs: [{ text: "値" }] }],
                    fill: { type: "solid", color: "#3366FF" },
                    textStyle: { color: "#FFFFFF", fontWeight: 700 },
                  },
                ],
              },
              {
                height: 80,
                cells: [
                  { paragraphs: [{ runs: [{ text: "調査" }] }] },
                  { paragraphs: [{ runs: [{ text: "80" }] }] },
                ],
              },
              {
                height: 80,
                cells: [
                  { paragraphs: [{ runs: [{ text: "作成" }] }] },
                  { paragraphs: [{ runs: [{ text: "55" }] }] },
                ],
              },
            ],
            columnWidths: [400, 400],
            style: {
              border: { color: "#D0D0D0", width: 1 },
              headerFill: { type: "solid", color: "#3366FF" },
              bodyFill: { type: "solid", color: "#FFFFFF" },
              text: bodyStyle,
            },
          },
          {
            ...base("bar-chart", { x: 920, y: 360, w: 300, h: 280 }),
            type: "chart",
            chartType: "bar",
            title: "棒",
            series: [
              {
                name: "スコア",
                labels: ["調査", "作成"],
                values: [80, 55],
                color: "#3366FF",
              },
            ],
            style: {
              colors: ["#3366FF"],
              showLegend: false,
              showTitle: true,
              showValue: true,
              showCategoryName: false,
            },
          },
          {
            ...base("line-chart", { x: 1240, y: 360, w: 300, h: 280 }),
            type: "chart",
            chartType: "line",
            title: "線",
            series: [
              {
                name: "スコア",
                labels: ["調査", "作成"],
                values: [80, 55],
              },
            ],
            style: {
              colors: ["#22AA88"],
              showLegend: false,
              showTitle: true,
              showValue: false,
              showCategoryName: false,
            },
          },
          {
            ...base("pie-chart", { x: 1560, y: 360, w: 280, h: 280 }),
            type: "chart",
            chartType: "pie",
            title: "円",
            series: [
              {
                name: "構成",
                labels: ["調査", "作成"],
                values: [80, 55],
              },
            ],
            style: {
              colors: ["#3366FF", "#22AA88"],
              showLegend: true,
              showTitle: true,
              showValue: false,
              showCategoryName: true,
            },
          },
        ],
        notes: {
          markdown: "",
          plainText: "このページでは各要素が編集可能であることを説明する。",
          sources: [
            {
              label: "社内AI活用調査 2026",
              url: "https://example.com/research",
            },
          ],
        },
      },
    ],
    diagnostics: [],
    contentHash: "fixture",
  };
}

describe("qa-pptx", () => {
  it("accepts all core DeckIR components as native editable OOXML", async () => {
    const deck = coreDeck();
    const rendered = await renderPptx(deck, { strictEditable: true });
    const report = await inspectPptx(rendered.data, deck, {
      strictEditable: true,
    });

    expect(report.valid, JSON.stringify(report.issues, null, 2)).toBe(true);
    expect(report.slideCount).toBe(1);
    expect(report.notesSlideCount).toBe(1);
    expect(report.expectedEditableObjects).toBe(10);
    expect(report.verifiedNativeObjects).toBe(10);
    expect(report.nativeEditabilityRate).toBe(1);
    expect(report.semanticHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.slides[0]?.objects.map((object) => object.nativeKind)).toEqual(
      expect.arrayContaining([
        "text",
        "shape",
        "line",
        "connector",
        "image",
        "table",
        "chart",
      ]),
    );
    expect(report.slides[0]?.notesText).toContain("[Sources]");
  });

  it("detects a connector flattened back to a normal line shape", async () => {
    const deck = coreDeck();
    const rendered = await renderPptx(deck);
    const zip = await JSZip.loadAsync(rendered.data);
    const file = zip.file("ppt/slides/slide1.xml");
    expect(file).not.toBeNull();
    if (!file) {
      throw new Error("slide1.xml is missing");
    }
    const xml = await file.async("string");
    zip.file(
      "ppt/slides/slide1.xml",
      xml
        .replace("<p:cxnSp>", "<p:sp>")
        .replace("</p:cxnSp>", "</p:sp>")
        .replace("<p:nvCxnSpPr>", "<p:nvSpPr>")
        .replace("</p:nvCxnSpPr>", "</p:nvSpPr>")
        .replace("<p:cNvCxnSpPr/>", "<p:cNvSpPr/>"),
    );
    const tampered = await zip.generateAsync({ type: "uint8array" });

    const report = await inspectPptx(tampered, deck, { strictEditable: true });

    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "element.wrong-native-kind",
        elementId: "connector",
        expected: "connector",
        actual: "line",
      }),
    );
  });

  it("rejects an implicit full-slide raster image", async () => {
    const deck = coreDeck();
    const slide = deck.slides[0];
    if (!slide) {
      throw new Error("fixture slide is missing");
    }
    slide.elements = [
      {
        ...base("screenshot", { x: 0, y: 0, w: 1920, h: 1080 }),
        type: "image",
        src: PIXEL_PNG,
        fit: "cover",
        role: "content",
      },
    ];
    slide.notes = {
      markdown: "",
      plainText: "",
      sources: [],
    };
    const rendered = await renderPptx(deck);

    const report = await inspectPptx(rendered.data, deck);

    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "image.implicit-full-slide-raster",
        elementId: "screenshot",
      }),
    );
  });

  it("assertPptx throws a report-bearing error for a malformed package", async () => {
    await expect(
      assertPptx(new TextEncoder().encode("not a pptx")),
    ).rejects.toBeInstanceOf(PptxInspectionError);
  });

  it("opens and renders through LibreOffice when it is available", async () => {
    const binary = await findLibreOfficeBinary();
    const rendered = await renderPptx(coreDeck());
    const result = await smokeTestPptxWithLibreOffice(rendered.data, {
      binary,
      required: Boolean(binary),
    });

    if (binary) {
      expect(result.success, result.error ?? result.output).toBe(true);
      expect(result.generatedPdfBytes).toBeGreaterThan(0);
    } else {
      expect(result.available).toBe(false);
    }
  }, 40_000);
});
