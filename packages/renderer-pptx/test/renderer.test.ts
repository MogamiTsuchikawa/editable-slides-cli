import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  type DeckIRInput,
  logicalFontSizeToPoints,
  logicalFrameToInches,
  renderPptx,
  StrictEditableError,
} from "../src/index.js";

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwJ7WQAAAABJRU5ErkJggg==";

function componentDeck(): DeckIRInput {
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
      fonts: {
        heading: { family: "Noto Sans JP" },
        body: { family: "Noto Sans JP" },
      },
      colors: {
        background: "#FFFFFF",
      },
    },
    slides: [
      {
        id: "gallery",
        sourcePath: "slides/gallery.mdx",
        layoutId: "blank",
        elements: [
          {
            id: "connector",
            type: "connector",
            frame: { x: 80, y: 80, w: 400, h: 200 },
            rotation: 0,
            zIndex: 1,
            opacity: 1,
            line: {
              color: "#3366FF",
              width: 2,
              endArrow: "triangle",
            },
          },
          {
            id: "line",
            type: "line",
            frame: { x: 80, y: 320, w: 400, h: 0 },
            rotation: 0,
            zIndex: 2,
            opacity: 1,
            line: {
              color: "#333333",
              width: 1,
            },
          },
          {
            id: "title",
            type: "text",
            frame: { x: 80, y: 30, w: 800, h: 90 },
            rotation: 0,
            zIndex: 10,
            opacity: 1,
            paragraphs: [
              {
                runs: [
                  { text: "編集可能な", bold: true },
                  { text: "テキスト", color: "#3366FF" },
                ],
              },
            ],
            style: {
              fontFace: "Noto Sans JP",
              fontSize: 28,
              lineHeight: 1.2,
            },
          },
          {
            id: "box",
            type: "shape",
            shape: "roundedRectangle",
            frame: { x: 520, y: 150, w: 360, h: 180 },
            rotation: 0,
            zIndex: 10,
            opacity: 1,
            fill: { color: "#EAF0FF" },
            line: { color: "#3366FF", width: 2 },
            text: "ネイティブ図形",
            textStyle: {
              fontFace: "Noto Sans JP",
              fontSize: 20,
              align: "center",
              valign: "middle",
            },
          },
          {
            id: "image",
            type: "image",
            frame: { x: 920, y: 120, w: 240, h: 180 },
            rotation: 0,
            zIndex: 10,
            opacity: 1,
            data: PIXEL_PNG,
            alt: "fixture image",
          },
          {
            id: "table",
            type: "table",
            frame: { x: 80, y: 400, w: 800, h: 260 },
            rotation: 0,
            zIndex: 10,
            opacity: 1,
            rows: [
              [
                {
                  text: "項目",
                  fill: { color: "#3366FF" },
                  style: { color: "#FFFFFF", bold: true },
                },
                {
                  text: "値",
                  fill: { color: "#3366FF" },
                  style: { color: "#FFFFFF", bold: true },
                },
              ],
              ["調査", "80"],
              ["作成", "55"],
            ],
            style: {
              fontFace: "Noto Sans JP",
              fontSize: 16,
            },
            border: {
              color: "#D0D0D0",
              width: 1,
            },
          },
          {
            id: "chart",
            type: "chart",
            chartType: "bar",
            frame: { x: 960, y: 380, w: 760, h: 480 },
            rotation: 0,
            zIndex: 10,
            opacity: 1,
            title: "業務別スコア",
            data: [
              { label: "調査", value: 80 },
              { label: "作成", value: 55 },
            ],
            colors: ["#3366FF"],
            style: {
              fontFace: "Noto Sans JP",
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
  };
}

describe("renderer-pptx", () => {
  it("converts logical canvas coordinates to exact-wide inches", () => {
    expect(
      logicalFrameToInches(
        { x: 960, y: 540, w: 480, h: 270 },
        {
          width: 1920,
          height: 1080,
          pptxWidthInch: 13.333333,
          pptxHeightInch: 7.5,
        },
      ),
    ).toEqual({
      x: 6.6666665,
      y: 3.75,
      w: 3.33333325,
      h: 1.875,
    });
    expect(
      logicalFontSizeToPoints(60, {
        width: 1920,
        height: 1080,
        pptxWidthInch: 13.333333,
        pptxHeightInch: 7.5,
      }),
    ).toBe(30);
  });

  it("exports native text, image, shape, line, connector, table, chart, and notes", async () => {
    const rendered = await renderPptx(componentDeck(), { strictEditable: true });
    const zip = await JSZip.loadAsync(rendered.data);
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const notesXml = await zip.file("ppt/notesSlides/notesSlide1.xml")?.async("string");

    expect(rendered.slideCount).toBe(1);
    expect(rendered.objectNames).toHaveLength(7);
    expect(slideXml).toContain('<p:cNvPr id="');
    expect(slideXml).toContain('name="lt:gallery:title"');
    expect(slideXml).toContain('sz="1400"');
    expect(slideXml).toContain('<a:spcPct val="120000"/>');
    expect(slideXml).not.toContain('<a:spcPts val="120"/>');
    expect(slideXml).not.toContain('lang="ja-JP"');
    expect(slideXml).toContain('name="lt:gallery:image"');
    expect(slideXml).toContain('name="lt:gallery:box"');
    expect(slideXml).toContain('name="lt:gallery:line"');
    expect(slideXml).toContain("<p:cxnSp><p:nvCxnSpPr><p:cNvPr");
    expect(slideXml).toContain('name="lt:gallery:connector"');
    expect(slideXml).toContain('name="lt:gallery:table"');
    expect(slideXml).toContain("<a:tbl>");
    expect(slideXml).toContain('name="lt:gallery:chart"');
    expect(slideXml).toContain("<c:chart ");
    expect(zip.file("ppt/charts/chart1.xml")).not.toBeNull();
    expect(notesXml).toContain("このページでは各要素が編集可能であることを説明する。");
    expect(notesXml).toContain("[Sources]");
    expect(notesXml).toContain("https://example.com/research");
  });

  it("exports paragraph text, data URI images, shapes, and lines on a slide master", async () => {
    const deck = componentDeck();
    deck.theme = {
      fonts: {
        heading: { family: "Noto Sans JP" },
        body: { family: "Noto Sans JP" },
      },
      colors: { background: "#FFFFFF" },
      masters: [
        {
          id: "branded",
          background: { type: "solid", color: "#F7F7F7" },
          elements: [
            {
              id: "brand-title",
              type: "text",
              frame: { x: 80, y: 40, w: 720, h: 80 },
              rotation: 0,
              zIndex: 1,
              opacity: 1,
              paragraphs: [
                {
                  runs: [{ text: "Master paragraph text" }],
                },
              ],
              style: {
                fontFace: "Noto Sans JP",
                fontSize: 24,
                color: "#123456",
                fontWeight: 700,
              },
            },
            {
              id: "brand-image",
              type: "image",
              frame: { x: 0, y: 1050, w: 1920, h: 30 },
              rotation: 0,
              zIndex: 2,
              opacity: 1,
              src: PIXEL_PNG,
              fit: "stretch",
              alt: "brand gradient",
            },
            {
              id: "brand-shape",
              type: "shape",
              shape: "rect",
              frame: { x: 1600, y: 40, w: 200, h: 60 },
              rotation: 0,
              zIndex: 3,
              opacity: 1,
              fill: { type: "solid", color: "#FFCC00" },
              stroke: { color: "#123456", width: 2 },
            },
            {
              id: "brand-round-rect",
              type: "shape",
              shape: "roundRect",
              frame: { x: 1320, y: 40, w: 240, h: 60 },
              rotation: 0,
              zIndex: 3,
              opacity: 1,
              fill: { type: "solid", color: "#F2F2F2" },
            },
            {
              id: "brand-triangle",
              type: "shape",
              shape: "triangle",
              frame: { x: 1280, y: 140, w: 280, h: 60 },
              rotation: 90,
              zIndex: 3,
              opacity: 1,
              fill: { type: "solid", color: "#D9D9D9" },
            },
            {
              id: "brand-line",
              type: "line",
              frame: { x: 80, y: 140, w: 1720, h: 0 },
              rotation: 0,
              zIndex: 4,
              opacity: 1,
              stroke: { color: "#123456", width: 2 },
            },
          ],
        },
      ],
    };
    const firstSlide = deck.slides[0];
    if (!firstSlide) {
      throw new Error("Fixture must contain one slide");
    }
    firstSlide.masterId = "branded";

    const rendered = await renderPptx(deck, { strictEditable: true });
    const zip = await JSZip.loadAsync(rendered.data);
    const masterLayoutPaths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
      .sort();
    const masterLayoutXmlParts = await Promise.all(
      masterLayoutPaths.map((name) => zip.file(name)?.async("string") ?? ""),
    );
    const masterLayoutXml = masterLayoutXmlParts.join("\n");
    const brandedLayoutIndex = masterLayoutXmlParts.findIndex((xml) =>
      xml.includes("Master paragraph text"),
    );
    const brandedLayoutPath = masterLayoutPaths[brandedLayoutIndex];
    const slideRelationships = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      ?.async("string");
    const masterShapeBlock = (name: string): string => {
      const markerIndex = masterLayoutXml.indexOf(`name="${name}"`);
      const start = masterLayoutXml.lastIndexOf("<p:sp>", markerIndex);
      const end = masterLayoutXml.indexOf("</p:sp>", markerIndex);
      return markerIndex >= 0 && start >= 0 && end >= 0
        ? masterLayoutXml.slice(start, end + "</p:sp>".length)
        : "";
    };

    expect(masterLayoutPaths.length).toBeGreaterThanOrEqual(2);
    expect(masterLayoutXml).toContain("Master paragraph text");
    expect(masterLayoutXml).toContain('name="lt:master:brand-title"');
    expect(masterLayoutXml).toContain('name="lt:master:brand-image"');
    expect(masterLayoutXml).toContain('name="lt:master:brand-shape"');
    expect(masterShapeBlock("lt:master:brand-round-rect")).toContain(
      '<a:prstGeom prst="roundRect">',
    );
    expect(masterShapeBlock("lt:master:brand-triangle")).toContain(
      '<a:prstGeom prst="triangle">',
    );
    expect(masterLayoutXml).toContain('name="lt:master:brand-line"');
    expect(brandedLayoutPath).toBeTruthy();
    expect(slideRelationships).toContain(
      `../slideLayouts/${brandedLayoutPath?.split("/").at(-1)}`,
    );
    expect(
      Object.keys(zip.files).some((name) => /^ppt\/media\/.*\.png$/.test(name)),
    ).toBe(true);
  });

  it("rejects an explicit raster fallback in strict-editable mode", async () => {
    const deck = componentDeck();
    const element = deck.slides[0]?.elements[0] as Record<string, unknown>;
    element.editable = false;
    element.fallbackReason = "unsupported custom component";

    await expect(renderPptx(deck, { strictEditable: true })).rejects.toBeInstanceOf(
      StrictEditableError,
    );
  });

  it("never silently rasterizes an unknown element", async () => {
    const deck = componentDeck();
    deck.slides[0]?.elements.push({
      id: "html",
      type: "html",
      frame: { x: 0, y: 0, w: 100, h: 100 },
    });

    await expect(renderPptx(deck)).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "element.unsupported",
          elementId: "html",
        }),
      ],
    });
  });
});
