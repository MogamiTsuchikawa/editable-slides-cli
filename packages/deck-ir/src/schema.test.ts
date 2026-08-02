import { describe, expect, it } from "vitest";

import {
  ChartElementIRSchema,
  DeckIRSchema,
  frameToPptx,
  WIDE_CANVAS,
} from "./index.js";

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

  it("accepts optional typed master elements while keeping empty masters valid", () => {
    const deck = createDeck();
    const master = deck.theme.masters[0];
    if (!master) {
      throw new Error("Fixture must contain one master");
    }
    master.elements = [
      {
        id: "master-accent",
        type: "image",
        frame: { x: 0, y: 0, w: 1920, h: 12 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        sourceLocation,
        src: "data:image/png;base64,AA==",
        fit: "stretch",
      },
    ];

    const parsed = DeckIRSchema.parse(deck);
    expect(parsed.theme.masters[0]?.elements?.[0]).toMatchObject({
      id: "master-accent",
      type: "image",
      fit: "stretch",
    });
    expect(DeckIRSchema.parse(createDeck()).theme.masters[0]?.elements).toBeUndefined();
  });

  it("accepts image backgrounds on slides and masters", () => {
    const deck = createDeck();
    const background = {
      type: "image" as const,
      src: "/tmp/background.png",
      mimeType: "image/png",
      fit: "cover" as const,
      focalPosition: { x: 0.25, y: 0.75 },
    };
    const slide = deck.slides[0];
    const master = deck.theme.masters[0];
    if (!slide || !master) {
      throw new Error("Fixture must contain one slide and master");
    }
    slide.background = background;
    master.background = background;

    const parsed = DeckIRSchema.parse(deck);
    expect(parsed.slides[0]?.background).toMatchObject(background);
    expect(parsed.theme.masters[0]?.background).toMatchObject(background);
  });

  it("accepts all chart kinds and per-series combo chart kinds", () => {
    const base = createDeck();
    const chartTypes = [
      "bar",
      "line",
      "pie",
      "doughnut",
      "area",
      "scatter",
      "radar",
      "stacked",
      "combo",
    ] as const;
    const parsed = DeckIRSchema.parse({
      ...base,
      slides: [
        {
          ...base.slides[0],
          elements: chartTypes.map((chartType, index) => ({
            id: `chart-${chartType}`,
            type: "chart",
            chartType,
            frame: { x: index * 10, y: 0, w: 300, h: 200 },
            rotation: 0,
            zIndex: index,
            opacity: 1,
            sourceLocation,
            series: [
              {
                name: "Series 1",
                labels: ["1", "2"],
                values: [10, 20],
                ...(chartType === "combo" ? { chartType: "bar" } : {}),
              },
            ],
            style: {
              colors: ["#3366FF"],
              showLegend: false,
              showTitle: false,
              showValue: false,
              showCategoryName: false,
            },
          })),
        },
      ],
    });

    expect(parsed.slides[0]?.elements.map((element) => element.type)).toHaveLength(9);
  });

  it("rejects empty chart data and multiple pie or doughnut series", () => {
    const chart = {
      id: "chart",
      type: "chart" as const,
      chartType: "bar" as const,
      frame: { x: 0, y: 0, w: 800, h: 400 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      series: [{ name: "A", labels: ["1"], values: [1] }],
      style: {
        colors: ["#3366FF"],
        showLegend: true,
        showTitle: false,
        showValue: false,
        showCategoryName: false,
      },
    };

    expect(() => ChartElementIRSchema.parse({ ...chart, series: [] })).toThrow();
    expect(() =>
      ChartElementIRSchema.parse({
        ...chart,
        series: [{ name: "A", labels: [], values: [] }],
      }),
    ).toThrow();
    for (const chartType of ["pie", "doughnut"] as const) {
      expect(() =>
        ChartElementIRSchema.parse({
          ...chart,
          chartType,
          series: [
            { name: "A", labels: ["1"], values: [1] },
            { name: "B", labels: ["1"], values: [2] },
          ],
        }),
      ).toThrow(/require exactly one series/);
    }
  });

  it("accepts detailed table and chart editing settings", () => {
    const base = createDeck();
    const shared = {
      frame: { x: 0, y: 0, w: 800, h: 400 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
    };
    const parsed = DeckIRSchema.parse({
      ...base,
      slides: [
        {
          ...base.slides[0],
          elements: [
            {
              ...shared,
              id: "details-table",
              type: "table",
              columnWidths: [240, 560],
              rows: [
                {
                  height: 400,
                  cells: [
                    {
                      value: 0.42,
                      numberFormat: "percent",
                      paragraphs: [{ runs: [{ text: "42%" }] }],
                      colSpan: 2,
                      fill: { type: "solid", color: "#EAF0FF" },
                      textStyle: { align: "center", verticalAlign: "middle" },
                    },
                  ],
                },
              ],
              style: {
                border: { color: "#CBD3DF", width: 1 },
                headerFill: { type: "solid", color: "#EAF0FF" },
                bodyFill: { type: "solid", color: "#FFFFFF" },
                text: {
                  fontFace: "Noto Sans JP",
                  fontSize: 22,
                  color: "#172033",
                  fontWeight: 400,
                  align: "left",
                  verticalAlign: "top",
                },
              },
            },
            {
              ...shared,
              id: "details-chart",
              type: "chart",
              chartType: "combo",
              categoryAxisTitle: "月",
              valueAxisTitle: "売上",
              valueUnit: "万円",
              legendPosition: "right",
              series: [
                {
                  name: "売上",
                  labels: ["1月"],
                  values: [10],
                  color: "#3366FF",
                  chartType: "bar",
                },
              ],
              style: {
                colors: ["#999999"],
                showLegend: true,
                showTitle: false,
                showValue: true,
                showCategoryName: true,
              },
            },
          ],
        },
      ],
    });

    expect(parsed.slides[0]?.elements).toMatchObject([
      { type: "table", columnWidths: [240, 560], rows: [{ height: 400 }] },
      {
        type: "chart",
        legendPosition: "right",
        categoryAxisTitle: "月",
        valueUnit: "万円",
      },
    ]);
  });

  it("rejects unsupported detailed table and chart settings", () => {
    const base = createDeck();
    const chart = {
      id: "bad-chart",
      type: "chart",
      chartType: "bar",
      frame: { x: 0, y: 0, w: 800, h: 400 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      legendPosition: "center",
      series: [{ name: "A", labels: ["A"], values: [1] }],
      style: {
        colors: [],
        showLegend: true,
        showTitle: false,
        showValue: false,
        showCategoryName: false,
      },
    };
    expect(() =>
      DeckIRSchema.parse({
        ...base,
        slides: [{ ...base.slides[0], elements: [chart] }],
      }),
    ).toThrow();

    const table = {
      id: "bad-table",
      type: "table",
      frame: { x: 0, y: 0, w: 800, h: 400 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      columnWidths: [800, 100],
      rows: [
        {
          cells: [
            {
              value: "42",
              numberFormat: "percent",
              paragraphs: [{ runs: [{ text: "42%" }] }],
            },
          ],
        },
      ],
      style: {
        border: { color: "#CBD3DF", width: 1 },
        headerFill: { type: "solid", color: "#EAF0FF" },
        bodyFill: { type: "solid", color: "#FFFFFF" },
        text: {
          fontFace: "Noto Sans JP",
          fontSize: 22,
          color: "#172033",
          fontWeight: 400,
          align: "left",
          verticalAlign: "top",
        },
      },
    };
    expect(() =>
      DeckIRSchema.parse({
        ...base,
        slides: [{ ...base.slides[0], elements: [table] }],
      }),
    ).toThrow(/numberFormat|columnWidths/);
  });

  it("enforces cross-output chart data contracts", () => {
    const base = createDeck();
    const chart = (
      chartType: "bar" | "pie" | "doughnut" | "scatter" | "combo",
      series: Array<{
        name: string;
        labels: string[];
        values: number[];
        chartType?: "bar" | "line" | "area" | "scatter";
      }>,
    ) => ({
      id: `chart-${chartType}`,
      type: "chart" as const,
      chartType,
      frame: { x: 0, y: 0, w: 800, h: 400 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      series,
      style: {
        colors: ["#3366FF"],
        showLegend: true,
        showTitle: false,
        showValue: false,
        showCategoryName: false,
      },
    });
    const parseChart = (candidate: ReturnType<typeof chart>) =>
      DeckIRSchema.parse({
        ...base,
        slides: [{ ...base.slides[0], elements: [candidate] }],
      });

    expect(() =>
      parseChart(
        chart("combo", [
          {
            name: "A",
            labels: ["1"],
            values: [1],
            chartType: "scatter",
          },
        ]),
      ),
    ).toThrow(/do not support scatter/);
    expect(() =>
      parseChart(
        chart("bar", [
          { name: "A", labels: ["A", "B"], values: [1, 2] },
          { name: "B", labels: ["A", "C"], values: [3, 4] },
        ]),
      ),
    ).toThrow(/identical labels/);
    expect(() =>
      parseChart(chart("pie", [{ name: "A", labels: ["A"], values: [-1] }])),
    ).toThrow(/non-negative/);
    expect(() =>
      parseChart(chart("doughnut", [{ name: "A", labels: ["A"], values: [0] }])),
    ).toThrow(/greater than zero/);
    expect(() =>
      parseChart(
        chart("scatter", [{ name: "A", labels: ["not-a-number"], values: [1] }]),
      ),
    ).toThrow(/finite numeric strings/);
    expect(() =>
      parseChart(
        chart("scatter", [{ name: "A", labels: ["-1.5", "2e3"], values: [1, 2] }]),
      ),
    ).not.toThrow();
  });

  it("validates merged-cell occupancy, safe span limits and table dimensions", () => {
    const base = createDeck();
    const style = {
      border: { color: "#CBD3DF", width: 1 },
      headerFill: { type: "solid" as const, color: "#EAF0FF" },
      bodyFill: { type: "solid" as const, color: "#FFFFFF" },
      text: {
        fontFace: "Noto Sans JP",
        fontSize: 22,
        color: "#172033",
        fontWeight: 400,
        align: "left" as const,
        verticalAlign: "top" as const,
      },
    };
    const cell = (spans?: { colSpan?: number; rowSpan?: number }) => ({
      paragraphs: [{ runs: [{ text: "cell" }] }],
      ...spans,
    });
    const table = (
      rows: Array<Array<{ colSpan?: number; rowSpan?: number }>>,
      options?: {
        columnWidths?: number[];
        heights?: number[];
        headerRows?: number;
      },
    ) => ({
      id: "grid-table",
      type: "table" as const,
      frame: { x: 0, y: 0, w: 200, h: 100 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      sourceLocation,
      ...(options?.headerRows === undefined ? {} : { headerRows: options.headerRows }),
      ...(options?.columnWidths ? { columnWidths: options.columnWidths } : {}),
      rows: rows.map((entries, rowIndex) => ({
        cells: entries.map(cell),
        ...(options?.heights?.[rowIndex] === undefined
          ? {}
          : { height: options.heights[rowIndex] }),
      })),
      style,
    });
    const parseTable = (candidate: ReturnType<typeof table>) =>
      DeckIRSchema.parse({
        ...base,
        slides: [{ ...base.slides[0], elements: [candidate] }],
      });

    expect(() =>
      parseTable(
        table([[{ rowSpan: 2 }, {}], [{}]], {
          columnWidths: [100, 100],
          heights: [50, 50],
          headerRows: 0,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      parseTable(
        table([
          [{ rowSpan: 2 }, {}],
          [{}, {}],
        ]),
      ),
    ).toThrow(/cannot fit/);
    expect(() => parseTable(table([[{ rowSpan: 2 }]]))).toThrow(/final table row/);
    expect(() => parseTable(table([[{ colSpan: 101 }]]))).toThrow(/100/);
    expect(() => parseTable(table([]))).toThrow();
    expect(() => parseTable(table([[]]))).toThrow();
    expect(() =>
      parseTable(table([[{}, {}]], { columnWidths: [80, 100], heights: [100] })),
    ).toThrow(/add up to table width/);
    expect(() => parseTable(table([[{}], [{}]], { heights: [40, 40] }))).toThrow(
      /add up to table height/,
    );
    expect(() => parseTable(table([[{}]], { headerRows: 2 }))).toThrow();
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

  it("accepts local video and audio elements with static fallback metadata", () => {
    const deck = createDeck();
    deck.slides[0]?.elements.push(
      {
        id: "demo-video",
        type: "video",
        frame: { x: 100, y: 100, w: 800, h: 450 },
        rotation: 0,
        zIndex: 2,
        opacity: 1,
        sourceLocation,
        src: "/tmp/demo.mp4",
        mimeType: "video/mp4",
        byteLength: 1_024,
        posterSrc: "data:image/png;base64,AA==",
        posterMimeType: "image/png",
        captionSrc: "/tmp/demo.ja.vtt",
        captionContentHash: "caption-video-hash",
        captionMimeType: "text/vtt",
        captionLanguage: "ja",
        captionLabel: "日本語字幕",
        fit: "contain",
        alt: "製品デモ動画",
      },
      {
        id: "demo-audio",
        type: "audio",
        frame: { x: 100, y: 600, w: 800, h: 100 },
        rotation: 0,
        zIndex: 2,
        opacity: 1,
        sourceLocation,
        src: "/tmp/demo.mp3",
        mimeType: "audio/mpeg",
        byteLength: 512,
        captionSrc: "/tmp/narration.vtt",
        captionMimeType: "text/vtt",
        transcript: "製品紹介のナレーション",
      },
    );

    const parsed = DeckIRSchema.parse(deck);
    expect(parsed.slides[0]?.elements.at(-2)).toMatchObject({
      type: "video",
      captionSrc: "/tmp/demo.ja.vtt",
      captionMimeType: "text/vtt",
      captionLanguage: "ja",
      captionLabel: "日本語字幕",
    });
    expect(parsed.slides[0]?.elements.at(-1)).toMatchObject({
      type: "audio",
      captionSrc: "/tmp/narration.vtt",
      captionMimeType: "text/vtt",
    });
  });

  it("requires caption source and WebVTT MIME metadata together", () => {
    const withoutMime = createDeck();
    withoutMime.slides[0]?.elements.push({
      id: "bad-caption-video",
      type: "video",
      frame: { x: 100, y: 100, w: 800, h: 450 },
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      sourceLocation,
      src: "/tmp/demo.mp4",
      mimeType: "video/mp4",
      posterSrc: "/tmp/poster.png",
      posterMimeType: "image/png",
      captionSrc: "/tmp/demo.vtt",
      fit: "contain",
      alt: "製品デモ動画",
    });
    expect(() => DeckIRSchema.parse(withoutMime)).toThrow(/captionMimeType/);

    const withoutSource = createDeck();
    withoutSource.slides[0]?.elements.push({
      id: "bad-caption-audio",
      type: "audio",
      frame: { x: 100, y: 600, w: 800, h: 100 },
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      sourceLocation,
      src: "/tmp/demo.mp3",
      mimeType: "audio/mpeg",
      captionLanguage: "ja",
      transcript: "製品紹介のナレーション",
    });
    expect(() => DeckIRSchema.parse(withoutSource)).toThrow(/captionSrc/);
  });

  it("rejects unsupported media MIME types and incomplete poster metadata", () => {
    const deck = createDeck();
    deck.slides[0]?.elements.push({
      id: "bad-audio",
      type: "audio",
      frame: { x: 100, y: 600, w: 800, h: 100 },
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      sourceLocation,
      src: "/tmp/demo.wav",
      mimeType: "audio/wav",
      posterSrc: "data:image/png;base64,AA==",
      alt: "未対応形式の音声",
    });

    expect(() => DeckIRSchema.parse(deck)).toThrow();
  });

  it("accepts focal crop, masks, border, shadow and a deterministic GIF poster", () => {
    const deck = createDeck();
    deck.slides[0]?.elements.push({
      id: "featured-image",
      type: "image",
      frame: { x: 100, y: 100, w: 800, h: 450 },
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      sourceLocation,
      src: "/tmp/demo.gif",
      mimeType: "image/gif",
      decorative: true,
      fit: "crop",
      crop: { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 },
      focalPosition: { x: 0.3, y: 0.7 },
      mask: { type: "roundRect", radius: 24 },
      border: { color: "#3366FF", width: 2, dash: "solid" },
      shadow: {
        color: "#000000",
        opacity: 0.25,
        blur: 12,
        distance: 6,
        angle: 45,
      },
      posterFrame: {
        src: "/tmp/demo-poster.png",
        mimeType: "image/png",
      },
    });

    expect(DeckIRSchema.parse(deck).slides[0]?.elements.at(-1)).toMatchObject({
      type: "image",
      decorative: true,
      mask: { type: "roundRect", radius: 24 },
      posterFrame: { mimeType: "image/png" },
    });
  });

  it("rejects invisible crops and GIF images without a poster frame", () => {
    const deck = createDeck();
    deck.slides[0]?.elements.push({
      id: "invalid-gif",
      type: "image",
      frame: { x: 100, y: 100, w: 800, h: 450 },
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      sourceLocation,
      src: "/tmp/demo.gif",
      mimeType: "image/gif",
      fit: "crop",
      crop: { left: 0.6, top: 0, right: 0.4, bottom: 0 },
    });

    expect(() => DeckIRSchema.parse(deck)).toThrow();
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
