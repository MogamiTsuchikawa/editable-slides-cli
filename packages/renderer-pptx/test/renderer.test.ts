import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const PIXEL_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

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

function chartBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<c:${tag}>[\\s\\S]*?</c:${tag}>`, "g"))].map(
    (match) => match[0],
  );
}

function seriesBlocks(xml: string): string[] {
  return [...xml.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((match) => match[0]);
}

function axisValues(seriesXml: string, axis: "xVal" | "yVal"): number[] {
  const axisXml = new RegExp(`<c:${axis}>[\\s\\S]*?</c:${axis}>`).exec(seriesXml)?.[0];
  if (!axisXml) return [];
  return [...axisXml.matchAll(/<c:pt idx="\d+"><c:v>([^<]*)<\/c:v><\/c:pt>/g)].map(
    (match) => Number(match[1]),
  );
}

function namedObjectBlock(xml: string, name: string): string {
  const markerIndex = xml.indexOf(`name="${name}"`);
  const tags = ["p:sp", "p:pic", "p:cxnSp", "p:graphicFrame"];
  let tag = "";
  let start = -1;
  for (const candidate of tags) {
    const candidateStart = xml.lastIndexOf(`<${candidate}>`, markerIndex);
    if (candidateStart > start) {
      tag = candidate;
      start = candidateStart;
    }
  }
  const endStart = tag ? xml.indexOf(`</${tag}>`, markerIndex) : -1;
  return markerIndex >= 0 && start >= 0 && endStart >= 0
    ? xml.slice(start, endStart + `</${tag}>`.length)
    : "";
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
    const titleBlock = namedObjectBlock(slideXml ?? "", "lt:gallery:title");
    const boxBlock = namedObjectBlock(slideXml ?? "", "lt:gallery:box");
    const lineBlock = namedObjectBlock(slideXml ?? "", "lt:gallery:line");
    const connectorBlock = namedObjectBlock(slideXml ?? "", "lt:gallery:connector");
    const tableBlock = namedObjectBlock(slideXml ?? "", "lt:gallery:table");
    const chartBlock = namedObjectBlock(slideXml ?? "", "lt:gallery:chart");
    expect(titleBlock).toContain('<p:ph type="title"/>');
    expect(titleBlock).toContain('txBox="1"');
    expect(lineBlock).toContain(
      '<adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/>',
    );
    expect(connectorBlock).toContain(
      '<adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/>',
    );
    expect(boxBlock).not.toContain("adec:decorative");
    expect(tableBlock).toContain('<a:tblPr firstRow="1"/>');
    expect(chartBlock).toContain('descr="業務別スコア — 調査 80, 作成 55"');
    expect(slideXml?.indexOf('name="lt:gallery:title"')).toBeLessThan(
      slideXml?.indexOf('name="lt:gallery:box"') ?? 0,
    );
    expect(zip.file("ppt/charts/chart1.xml")).not.toBeNull();
    expect(notesXml).toContain("このページでは各要素が編集可能であることを説明する。");
    expect(notesXml).toContain("[Sources]");
    expect(notesXml).toContain("https://example.com/research");
  });

  it("orders same-row non-overlapping objects left-to-right without changing overlapping z-order", async () => {
    const deck = componentDeck();
    const slide = deck.slides[0];
    if (!slide) throw new Error("Fixture slide is missing");
    slide.elements = [
      {
        id: "title",
        type: "text",
        role: "title",
        frame: { x: 80, y: 30, w: 1600, h: 90 },
        rotation: 0,
        zIndex: 20,
        opacity: 1,
        text: "読み上げ順",
      },
      {
        id: "right-body",
        type: "text",
        frame: { x: 1010, y: 242, w: 820, h: 500 },
        rotation: 0,
        zIndex: 20,
        opacity: 1,
        text: "右側の本文",
      },
      {
        id: "left-image",
        type: "image",
        frame: { x: 90, y: 237, w: 820, h: 500 },
        rotation: 0,
        zIndex: 20,
        opacity: 1,
        data: PIXEL_PNG,
        alt: "左側の画像",
      },
      {
        id: "overlap-source-first",
        type: "shape",
        shape: "rect",
        frame: { x: 700, y: 810, w: 300, h: 180 },
        rotation: 0,
        zIndex: 30,
        opacity: 1,
      },
      {
        id: "overlap-source-second",
        type: "shape",
        shape: "rect",
        frame: { x: 650, y: 780, w: 300, h: 180 },
        rotation: 0,
        zIndex: 30,
        opacity: 1,
      },
    ];

    const rendered = await renderPptx(deck, { strictEditable: true });
    const zip = await JSZip.loadAsync(rendered.data);
    const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    const title = xml.indexOf('name="lt:gallery:title"');
    const left = xml.indexOf('name="lt:gallery:left-image"');
    const right = xml.indexOf('name="lt:gallery:right-body"');
    const overlapFirst = xml.indexOf('name="lt:gallery:overlap-source-first"');
    const overlapSecond = xml.indexOf('name="lt:gallery:overlap-source-second"');

    expect(title).toBeGreaterThanOrEqual(0);
    expect(title).toBeLessThan(left);
    expect(left).toBeLessThan(right);
    expect(overlapFirst).toBeLessThan(overlapSecond);
  });

  it("exports every supported chart kind as native PowerPoint chart XML", async () => {
    const contracts = [
      ["doughnut", ["<c:doughnutChart"]],
      ["area", ["<c:areaChart"]],
      ["scatter", ["<c:scatterChart"]],
      ["radar", ["<c:radarChart"]],
      ["stacked", ["<c:barChart", '<c:grouping val="stacked"/>']],
      ["combo", ["<c:barChart", "<c:lineChart"]],
    ] as const;

    for (const [chartType, expectedXml] of contracts) {
      const deck = componentDeck();
      const slide = deck.slides[0];
      if (!slide) {
        throw new Error("Fixture slide is missing");
      }
      slide.elements = [
        {
          id: `chart-${chartType}`,
          type: "chart",
          chartType,
          frame: { x: 100, y: 100, w: 800, h: 500 },
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          series: [
            {
              name: "Sales",
              labels: ["1", "2", "3"],
              values: [10, 20, 15],
              ...(chartType === "combo" ? { chartType: "bar" } : {}),
            },
            ...(chartType === "doughnut"
              ? []
              : [
                  {
                    name: "Growth",
                    labels: ["1", "2", "3"],
                    values: [15, 18, 25],
                    ...(chartType === "combo" ? { chartType: "line" as const } : {}),
                  },
                ]),
          ],
        },
      ];

      let rendered: Awaited<ReturnType<typeof renderPptx>>;
      try {
        rendered = await renderPptx(deck, { strictEditable: true });
      } catch (error) {
        throw new Error(`Unable to render ${chartType} chart`, { cause: error });
      }
      const zip = await JSZip.loadAsync(rendered.data);
      const chartPath = Object.keys(zip.files).find((path) =>
        /^ppt\/charts\/chart\d+\.xml$/.test(path),
      );
      const chartXml = chartPath
        ? await zip.file(chartPath)?.async("string")
        : undefined;
      expect(chartXml, `${chartType} chart XML`).toBeDefined();
      for (const marker of expectedXml) {
        expect(chartXml, chartType).toContain(marker);
      }
    }
  });

  it("keeps every standalone scatter series with its authored X and Y values", async () => {
    const deck = componentDeck();
    const slide = deck.slides[0];
    if (!slide) throw new Error("Fixture slide is missing");
    slide.elements = [
      {
        id: "scatter-data",
        type: "chart",
        chartType: "scatter",
        frame: { x: 100, y: 100, w: 900, h: 520 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        categoryAxisTitle: "時間",
        valueAxisTitle: "測定値",
        legendPosition: "right",
        series: [
          {
            name: "計画",
            labels: ["0.5", "1.5", "3"],
            values: [10, 20, 15],
            color: "#123456",
          },
          {
            name: "実績",
            labels: ["0.75", "2", "4.5"],
            values: [8, 18, 25],
            color: "#ABCDEF",
          },
        ],
      },
    ];

    const rendered = await renderPptx(deck, { strictEditable: true });
    const zip = await JSZip.loadAsync(rendered.data);
    const chartPath = Object.keys(zip.files).find((path) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(path),
    );
    const chartXml = chartPath ? await zip.file(chartPath)?.async("string") : undefined;
    const workbookPath = Object.keys(zip.files).find((path) =>
      /^ppt\/embeddings\/.*\.xlsx$/.test(path),
    );
    const workbookBytes = workbookPath
      ? await zip.file(workbookPath)?.async("uint8array")
      : undefined;
    const workbook = workbookBytes ? await JSZip.loadAsync(workbookBytes) : undefined;
    const worksheetXml = await workbook
      ?.file("xl/worksheets/sheet1.xml")
      ?.async("string");
    expect(chartXml).toBeDefined();
    const scatter = chartBlocks(chartXml ?? "", "scatterChart");
    expect(scatter).toHaveLength(1);
    const scatterSeries = seriesBlocks(scatter[0] ?? "");
    expect(scatterSeries).toHaveLength(2);
    expect(scatterSeries.map((item) => axisValues(item, "xVal"))).toEqual([
      [0.5, 1.5, 3],
      [0.75, 2, 4.5],
    ]);
    expect(scatterSeries.map((item) => axisValues(item, "yVal"))).toEqual([
      [10, 20, 15],
      [8, 18, 25],
    ]);
    expect(chartBlocks(chartXml ?? "", "catAx")).toHaveLength(0);
    expect(chartBlocks(chartXml ?? "", "valAx")).toHaveLength(2);
    expect(scatterSeries[0]).toContain("<c:f>Sheet1!$B$1</c:f>");
    expect(scatterSeries[0]).toContain("<c:f>Sheet1!$A$2:$A$4</c:f>");
    expect(scatterSeries[0]).toContain("<c:f>Sheet1!$B$2:$B$4</c:f>");
    expect(scatterSeries[1]).toContain("<c:f>Sheet1!$D$1</c:f>");
    expect(scatterSeries[1]).toContain("<c:f>Sheet1!$C$2:$C$4</c:f>");
    expect(scatterSeries[1]).toContain("<c:f>Sheet1!$D$2:$D$4</c:f>");
    expect(worksheetXml).toContain('<c r="A2"><v>0.5</v></c>');
    expect(worksheetXml).toContain('<c r="B2"><v>10</v></c>');
    expect(worksheetXml).toContain('<c r="C2"><v>0.75</v></c>');
    expect(worksheetXml).toContain('<c r="D2"><v>8</v></c>');
    expect(chartXml).toContain("123456");
    expect(chartXml).toContain("ABCDEF");
    expect(chartXml).toContain('<c:legendPos val="r"/>');
    expect(chartXml).toContain("時間");
    expect(chartXml).toContain("測定値");
  });

  it("rejects combo charts that mix scatter and category-based series", async () => {
    const deck = componentDeck();
    const slide = deck.slides[0];
    if (!slide) throw new Error("Fixture slide is missing");
    slide.elements = [
      {
        id: "combo-scatter-data",
        type: "chart",
        chartType: "combo",
        frame: { x: 100, y: 100, w: 900, h: 520 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        categoryAxisTitle: "距離",
        valueAxisTitle: "結果",
        showLegend: true,
        series: [
          {
            name: "基準",
            labels: ["1", "2", "3"],
            values: [4, 6, 9],
            chartType: "line",
            color: "#345678",
          },
          {
            name: "観測",
            labels: ["0.25", "1.25", "2.75"],
            values: [7, 11, 13],
            chartType: "scatter",
            color: "#FEDCBA",
          },
        ],
      },
    ];

    await expect(renderPptx(deck, { strictEditable: true })).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "chart.unsupported-combo-scatter",
          elementId: "combo-scatter-data",
        }),
      ],
    });
  });

  it("exports detailed table and chart settings as native editable XML", async () => {
    const deck = componentDeck();
    const slide = deck.slides[0];
    if (!slide) throw new Error("Fixture slide is missing");
    slide.elements = [
      {
        id: "details-table",
        type: "table",
        frame: { x: 80, y: 80, w: 800, h: 320 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        columnWidths: [200, 600],
        rows: [
          {
            height: 80,
            cells: [
              {
                text: "見出し",
                colSpan: 2,
                fill: { color: "#FFF4CC" },
                textStyle: { align: "right", verticalAlign: "bottom" },
              },
            ],
          },
          { height: 240, cells: ["A", "B"] },
        ],
      },
      {
        id: "details-chart",
        type: "chart",
        chartType: "combo",
        frame: { x: 920, y: 80, w: 800, h: 520 },
        rotation: 0,
        zIndex: 2,
        opacity: 1,
        categoryAxisTitle: "月",
        valueAxisTitle: "売上",
        valueUnit: "万円",
        legendPosition: "right",
        series: [
          {
            name: "売上",
            labels: ["1月", "2月"],
            values: [10, 20],
            color: "#123456",
            chartType: "bar",
          },
          {
            name: "伸び率",
            labels: ["1月", "2月"],
            values: [5, 8],
            color: "#ABCDEF",
            chartType: "line",
          },
        ],
        style: {
          colors: ["#999999", "#888888"],
          showLegend: true,
          showValue: true,
          showCategoryName: true,
        },
      },
    ];

    const rendered = await renderPptx(deck, { strictEditable: true });
    const zip = await JSZip.loadAsync(rendered.data);
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const chartPath = Object.keys(zip.files).find((path) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(path),
    );
    const chartXml = chartPath ? await zip.file(chartPath)?.async("string") : undefined;

    expect(slideXml).toContain('<a:tc gridSpan="2">');
    expect(slideXml).toContain('<a:tr h="');
    expect(slideXml).toContain("FFF4CC");
    expect(slideXml).toContain('anchor="b"');
    expect(chartXml).toContain('<c:legendPos val="r"/>');
    expect(chartXml).toContain('<c:showVal val="1"/>');
    expect(chartXml).toContain('<c:showCatName val="1"/>');
    expect(chartXml).toContain("123456");
    expect(chartXml).toContain("ABCDEF");
    expect(chartXml).toContain("売上（万円）");
    expect(chartXml).toContain("月");
  });

  it("embeds local MP4 and MP3 files as native PowerPoint media", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "livetoon-media-"));
    const videoPath = join(fixtureDirectory, "sample.mp4");
    const audioPath = join(fixtureDirectory, "sample.mp3");
    const videoBytes = Buffer.from("00000018667479706d70343200000000", "hex");
    const audioBytes = Buffer.from("49443304000000000000", "hex");

    try {
      await Promise.all([
        writeFile(videoPath, videoBytes),
        writeFile(audioPath, audioBytes),
      ]);
      const deck = componentDeck();
      const slide = deck.slides[0];
      if (!slide) {
        throw new Error("Fixture must contain one slide");
      }
      slide.elements = [
        {
          id: "video",
          type: "video",
          frame: { x: 80, y: 100, w: 800, h: 450 },
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          src: videoPath,
          mimeType: "video/mp4",
          posterSrc: PIXEL_PNG,
          posterMimeType: "image/png",
          fit: "contain",
          alt: "製品デモ動画",
        },
        {
          id: "audio",
          type: "audio",
          frame: { x: 80, y: 600, w: 800, h: 120 },
          rotation: 0,
          zIndex: 2,
          opacity: 1,
          src: audioPath,
          mimeType: "audio/mpeg",
          transcript: "製品紹介のナレーション",
        },
      ];

      const rendered = await renderPptx(deck, { strictEditable: true });
      const zip = await JSZip.loadAsync(rendered.data);
      const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
      const relationships = await zip
        .file("ppt/slides/_rels/slide1.xml.rels")
        ?.async("string");
      const contentTypes = await zip.file("[Content_Types].xml")?.async("string");
      const embeddedVideo = Object.keys(zip.files).find((name) =>
        /^ppt\/media\/.*\.mp4$/.test(name),
      );
      const embeddedAudio = Object.keys(zip.files).find((name) =>
        /^ppt\/media\/.*\.mp3$/.test(name),
      );
      const videoMarker = slideXml?.indexOf('name="lt:gallery:video"') ?? -1;
      const videoStart = slideXml?.lastIndexOf("<p:pic>", videoMarker) ?? -1;
      const videoEnd = slideXml?.indexOf("</p:pic>", videoMarker) ?? -1;
      const videoBlock =
        slideXml && videoStart >= 0 && videoEnd >= 0
          ? slideXml.slice(videoStart, videoEnd)
          : "";
      const audioMarker = slideXml?.indexOf('name="lt:gallery:audio"') ?? -1;
      const audioStart = slideXml?.lastIndexOf("<p:pic>", audioMarker) ?? -1;
      const audioEnd = slideXml?.indexOf("</p:pic>", audioMarker) ?? -1;
      const audioBlock =
        slideXml && audioStart >= 0 && audioEnd >= 0
          ? slideXml.slice(audioStart, audioEnd)
          : "";

      expect(rendered.objectNames).toEqual(["lt:gallery:video", "lt:gallery:audio"]);
      expect(slideXml).toContain('name="lt:gallery:video"');
      expect(slideXml).toContain('name="lt:gallery:audio"');
      expect(slideXml).toContain('descr="製品デモ動画"');
      expect(slideXml).toContain('descr="製品紹介のナレーション"');
      expect(videoBlock).toContain('<a:srcRect l="-38889" r="-38889" t="0" b="0"/>');
      expect(videoBlock).toContain("<a:videoFile");
      expect(audioBlock).toContain("<a:audioFile");
      expect(audioBlock).not.toContain("<a:videoFile");
      expect(slideXml).toContain("<p14:media");
      expect(slideXml).toContain('action="ppaction://media"');
      expect(slideXml).not.toContain("<p:timing");
      expect(relationships).toContain(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video",
      );
      expect(relationships).toContain(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio",
      );
      expect(relationships).not.toContain(
        "http://schemas.microsoft.com/office/2017/04/relationships/track",
      );
      expect(slideXml).not.toContain("<p173:tracksInfo");
      expect(contentTypes).not.toContain('Extension="vtt"');
      expect(
        Object.keys(zip.files).some((name) => /^ppt\/media\/track\d+\.vtt$/.test(name)),
      ).toBe(false);
      expect(embeddedVideo).toBeTruthy();
      expect(embeddedAudio).toBeTruthy();
      expect(
        Buffer.from((await zip.file(embeddedVideo ?? "")?.async("uint8array")) ?? []),
      ).toEqual(videoBytes);
      expect(
        Buffer.from((await zip.file(embeddedAudio ?? "")?.async("uint8array")) ?? []),
      ).toEqual(audioBytes);
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("uses PowerPoint-native audio metadata for M4A files", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "livetoon-m4a-"));
    const audioPath = join(fixtureDirectory, "sample.m4a");
    const audioBytes = Buffer.from("00000018667479704d34412000000000", "hex");

    try {
      await writeFile(audioPath, audioBytes);
      const deck = componentDeck();
      const slide = deck.slides[0];
      if (!slide) throw new Error("Fixture must contain one slide");
      slide.elements = [
        {
          id: "m4a-audio",
          type: "audio",
          frame: { x: 80, y: 100, w: 800, h: 120 },
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          src: audioPath,
          mimeType: "audio/mp4",
          transcript: "M4A音声",
        },
      ];

      const rendered = await renderPptx(deck, { strictEditable: true });
      const zip = await JSZip.loadAsync(rendered.data);
      const slideXml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
      const contentTypes =
        (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
      const audioBlock = namedObjectBlock(slideXml, "lt:gallery:m4a-audio");

      expect(audioBlock).toContain("<a:audioFile");
      expect(audioBlock).not.toContain("<a:videoFile");
      expect(contentTypes).toContain(
        '<Default Extension="m4a" ContentType="audio/mp4"/>',
      );
      expect(contentTypes).not.toContain('ContentType="audio/m4a"');
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("embeds deterministic WebVTT tracks for both video and audio", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "livetoon-captions-"));
    const videoPath = join(fixtureDirectory, "sample.mp4");
    const audioPath = join(fixtureDirectory, "sample.mp3");
    const videoCaptionPath = join(fixtureDirectory, "video.ja.vtt");
    const audioCaptionPath = join(fixtureDirectory, "audio.vtt");
    const videoBytes = Buffer.from("00000018667479706d70343200000000", "hex");
    const audioBytes = Buffer.from("49443304000000000000", "hex");
    const videoCaptionBytes = Buffer.from(
      "\uFEFFWEBVTT\r\n\r\n00:00.000 --> 00:01.250\r\n動画字幕です。\r\n",
      "utf8",
    );
    const audioCaptionBytes = Buffer.from(
      "WEBVTT\n\n00:00.000 --> 00:01.000\n音声字幕です。\n",
      "utf8",
    );

    try {
      await Promise.all([
        writeFile(videoPath, videoBytes),
        writeFile(audioPath, audioBytes),
        writeFile(videoCaptionPath, videoCaptionBytes),
        writeFile(audioCaptionPath, audioCaptionBytes),
      ]);
      const deck = componentDeck();
      const slide = deck.slides[0];
      if (!slide) throw new Error("Fixture must contain one slide");
      slide.elements = [
        {
          id: "captioned-video",
          type: "video",
          frame: { x: 80, y: 100, w: 800, h: 450 },
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          src: videoPath,
          mimeType: "video/mp4",
          posterSrc: PIXEL_PNG,
          posterMimeType: "image/png",
          fit: "contain",
          alt: "字幕付き動画",
          captionSrc: videoCaptionPath,
          captionContentHash: createHash("sha256")
            .update(videoCaptionBytes)
            .digest("hex"),
          captionMimeType: "text/vtt",
          captionLanguage: "ja",
          captionLabel: "日本語字幕",
        },
        {
          id: "captioned-audio",
          type: "audio",
          frame: { x: 80, y: 600, w: 800, h: 120 },
          rotation: 0,
          zIndex: 2,
          opacity: 1,
          src: audioPath,
          mimeType: "audio/mpeg",
          transcript: "字幕付き音声",
          captionSrc: audioCaptionPath,
          captionContentHash: createHash("sha256")
            .update(audioCaptionBytes)
            .digest("hex"),
          captionMimeType: "text/vtt",
        },
      ];

      const first = await renderPptx(deck, { strictEditable: true });
      const second = await renderPptx(deck, { strictEditable: true });
      const firstZip = await JSZip.loadAsync(first.data);
      const secondZip = await JSZip.loadAsync(second.data);
      const slideXml =
        (await firstZip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
      const relationships =
        (await firstZip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string")) ??
        "";
      const contentTypes =
        (await firstZip.file("[Content_Types].xml")?.async("string")) ?? "";
      const videoBlock = namedObjectBlock(slideXml, "lt:gallery:captioned-video");
      const audioBlock = namedObjectBlock(slideXml, "lt:gallery:captioned-audio");
      const trackRelationships = [
        ...relationships.matchAll(
          /<Relationship Id="(rId\d+)" Type="http:\/\/schemas\.microsoft\.com\/office\/2017\/04\/relationships\/track" Target="\.\.\/media\/(track\d+\.vtt)"\/>/g,
        ),
      ];
      const allRelationshipIds = [
        ...relationships.matchAll(/<Relationship Id="([^"]+)"/g),
      ].map((match) => match[1]);
      const relationshipTargets = new Map(
        trackRelationships.map((match) => [match[1], match[2]]),
      );
      const videoRelationshipId = /<p173:track\b[^>]*\br:embed="(rId\d+)"/.exec(
        videoBlock,
      )?.[1];
      const audioRelationshipId = /<p173:track\b[^>]*\br:embed="(rId\d+)"/.exec(
        audioBlock,
      )?.[1];
      const videoTrack = relationshipTargets.get(videoRelationshipId ?? "");
      const audioTrack = relationshipTargets.get(audioRelationshipId ?? "");
      const firstSignature = {
        tracks: [videoBlock, audioBlock].flatMap(
          (block) => block.match(/<p173:track\b[^>]*\/>/g) ?? [],
        ),
        relationships: trackRelationships.map((match) => match[0]),
        files: Object.keys(firstZip.files)
          .filter((name) => /^ppt\/media\/track\d+\.vtt$/.test(name))
          .sort(),
      };
      const secondSlideXml =
        (await secondZip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
      const secondRelationships =
        (await secondZip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string")) ??
        "";
      const secondSignature = {
        tracks: secondSlideXml.match(/<p173:track\b[^>]*\/>/g) ?? [],
        relationships:
          secondRelationships.match(
            /<Relationship Id="rId\d+" Type="http:\/\/schemas\.microsoft\.com\/office\/2017\/04\/relationships\/track" Target="\.\.\/media\/track\d+\.vtt"\/>/g,
          ) ?? [],
        files: Object.keys(secondZip.files)
          .filter((name) => /^ppt\/media\/track\d+\.vtt$/.test(name))
          .sort(),
      };

      expect(trackRelationships).toHaveLength(2);
      expect(new Set(allRelationshipIds).size).toBe(allRelationshipIds.length);
      expect(videoRelationshipId).toBeTruthy();
      expect(audioRelationshipId).toBeTruthy();
      expect(videoRelationshipId).not.toBe(audioRelationshipId);
      expect(videoTrack).toBe("track1.vtt");
      expect(audioTrack).toBe("track2.vtt");
      expect(videoBlock).toContain(
        '<p173:tracksInfo xmlns:p173="http://schemas.microsoft.com/office/powerpoint/2017/3/main" displayLoc="media">',
      );
      expect(videoBlock).toContain("<a:videoFile");
      expect(audioBlock).toContain("<a:audioFile");
      expect(audioBlock).not.toContain("<a:videoFile");
      expect(videoBlock).toContain(
        '<p:ext uri="{3AFAAA56-56D3-431D-BCD4-E75A35582382}">',
      );
      expect(videoBlock).toContain('label="日本語字幕" lang="ja"');
      expect(audioBlock).toContain('label="字幕" lang="ja-JP"');
      expect(videoBlock).toMatch(
        /<p173:track id="\{[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}"/,
      );
      expect(audioBlock).toMatch(
        /<p173:track id="\{[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}"/,
      );
      expect(
        contentTypes.match(/<Default Extension="vtt" ContentType="text\/vtt"\/>/g),
      ).toHaveLength(1);
      expect(
        Buffer.from(
          (await firstZip.file(`ppt/media/${videoTrack}`)?.async("uint8array")) ?? [],
        ),
      ).toEqual(videoCaptionBytes);
      expect(
        Buffer.from(
          (await firstZip.file(`ppt/media/${audioTrack}`)?.async("uint8array")) ?? [],
        ),
      ).toEqual(audioCaptionBytes);
      expect(secondSignature).toEqual(firstSignature);

      const audioElement = slide.elements.find((element) => element.type === "audio");
      if (audioElement?.type !== "audio") {
        throw new Error("Fixture must contain an audio element");
      }
      audioElement.captionSrc = videoCaptionPath;
      audioElement.captionContentHash = createHash("sha256")
        .update(videoCaptionBytes)
        .digest("hex");
      slide.elements = slide.elements.filter((element) => element !== audioElement);
      deck.slides.push({
        ...structuredClone(slide),
        id: "audio-gallery",
        sourcePath: "slides/audio-gallery.mdx",
        elements: [audioElement],
      });
      const deduplicated = await renderPptx(deck, { strictEditable: true });
      const deduplicatedZip = await JSZip.loadAsync(deduplicated.data);
      const deduplicatedRelationships = await Promise.all(
        [1, 2].map(
          async (slideNumber) =>
            (await deduplicatedZip
              .file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`)
              ?.async("string")) ?? "",
        ),
      );
      const deduplicatedTargets = deduplicatedRelationships.flatMap(
        (relationshipsXml) =>
          [
            ...relationshipsXml.matchAll(
              /Type="http:\/\/schemas\.microsoft\.com\/office\/2017\/04\/relationships\/track" Target="\.\.\/media\/(track\d+\.vtt)"/g,
            ),
          ].map((match) => match[1]),
      );
      const deduplicatedFiles = Object.keys(deduplicatedZip.files).filter((name) =>
        /^ppt\/media\/track\d+\.vtt$/.test(name),
      );
      expect(deduplicatedTargets).toEqual(["track1.vtt", "track1.vtt"]);
      expect(deduplicatedFiles).toEqual(["ppt/media/track1.vtt"]);
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("keeps GIF images and applies deterministic crop, mask, border and shadow", async () => {
    const deck = componentDeck();
    const slide = deck.slides[0];
    if (!slide) {
      throw new Error("Fixture must contain one slide");
    }
    slide.elements = [
      {
        id: "featured-image",
        type: "image",
        frame: { x: 80, y: 100, w: 800, h: 450 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        src: PIXEL_GIF,
        mimeType: "image/gif",
        fit: "crop",
        crop: { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 },
        focalPosition: { x: 0.3, y: 0.7 },
        mask: { type: "roundRect", radius: 32 },
        border: { color: "#3366FF", width: 3, dash: "dash" },
        shadow: {
          color: "#000000",
          opacity: 0.25,
          blur: 12,
          distance: 6,
          angle: 45,
        },
        posterFrame: { src: PIXEL_PNG, mimeType: "image/png" },
        decorative: true,
      },
    ];

    const rendered = await renderPptx(deck, { strictEditable: true });
    const zip = await JSZip.loadAsync(rendered.data);
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const imageMarker = slideXml?.indexOf('name="lt:gallery:featured-image"') ?? -1;
    const imageStart = slideXml?.lastIndexOf("<p:pic>", imageMarker) ?? -1;
    const imageEnd = slideXml?.indexOf("</p:pic>", imageMarker) ?? -1;
    const imageBlock =
      imageStart >= 0 && imageEnd >= 0
        ? slideXml?.slice(imageStart, imageEnd + "</p:pic>".length)
        : "";

    expect(rendered.objectNames).toEqual(["lt:gallery:featured-image"]);
    expect(imageBlock).toContain('<a:srcRect l="10000" r="20000" t="5000" b="15000"/>');
    expect(imageBlock).toContain('<a:prstGeom prst="roundRect">');
    expect(imageBlock).toContain("<a:outerShdw");
    expect(imageBlock).toContain("adec:decorative");
    expect(imageBlock).not.toContain(" descr=");
    expect(slideXml).toContain('name="aux:lt:gallery:featured-image:border"');
    expect(
      namedObjectBlock(slideXml ?? "", "aux:lt:gallery:featured-image:border"),
    ).toContain("adec:decorative");
    expect(slideXml).toContain('<a:prstGeom prst="roundRect">');
    expect(
      Object.keys(zip.files).some((name) => /^ppt\/media\/.*\.gif$/.test(name)),
    ).toBe(true);
    expect(
      Object.keys(zip.files).some((name) => /^ppt\/media\/.*poster.*\.png$/.test(name)),
    ).toBe(false);
  });

  it("renders a formal slide image background behind editable objects", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "livetoon-background-"));
    const backgroundPath = join(fixtureDirectory, "background.png");
    try {
      await writeFile(
        backgroundPath,
        Buffer.from(PIXEL_PNG.slice(PIXEL_PNG.indexOf(",") + 1), "base64"),
      );
      const deck = componentDeck();
      const slide = deck.slides[0];
      if (!slide) {
        throw new Error("Fixture must contain one slide");
      }
      slide.background = {
        type: "image",
        src: backgroundPath,
        mimeType: "image/png",
        fit: "cover",
        focalPosition: { x: 0.25, y: 0.75 },
      };

      const rendered = await renderPptx(deck, { strictEditable: true });
      const zip = await JSZip.loadAsync(rendered.data);
      const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
      const backgroundMarker = slideXml?.indexOf('name="background:gallery"') ?? -1;
      const titleMarker = slideXml?.indexOf('name="lt:gallery:title"') ?? -1;
      const backgroundStart = slideXml?.lastIndexOf("<p:pic>", backgroundMarker) ?? -1;
      const backgroundEnd = slideXml?.indexOf("</p:pic>", backgroundMarker) ?? -1;
      const backgroundBlock =
        backgroundStart >= 0 && backgroundEnd >= 0
          ? slideXml?.slice(backgroundStart, backgroundEnd + "</p:pic>".length)
          : "";

      expect(backgroundMarker).toBeGreaterThanOrEqual(0);
      expect(backgroundMarker).toBeLessThan(titleMarker);
      expect(backgroundBlock).toMatch(/<a:srcRect l="0" r="0" t="32\d+" b="10\d+"\/>/);
      expect(rendered.objectNames).not.toContain("background:gallery");
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("rejects remote media sources", async () => {
    const deck = componentDeck();
    const slide = deck.slides[0];
    if (!slide) {
      throw new Error("Fixture must contain one slide");
    }
    slide.elements = [
      {
        id: "remote-video",
        type: "video",
        frame: { x: 80, y: 100, w: 800, h: 450 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        src: "https://example.com/sample.mp4",
        mimeType: "video/mp4",
        posterSrc: PIXEL_PNG,
        posterMimeType: "image/png",
        fit: "contain",
        alt: "remote video",
      },
    ];

    await expect(renderPptx(deck)).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "media.invalid-source",
          elementId: "remote-video",
        }),
      ],
    });
  });

  it("rejects remote WebVTT caption sources before rendering", async () => {
    const deck = componentDeck();
    const slide = deck.slides[0];
    if (!slide) throw new Error("Fixture must contain one slide");
    slide.elements = [
      {
        id: "remote-captions",
        type: "video",
        frame: { x: 80, y: 100, w: 800, h: 450 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        src: "/tmp/sample.mp4",
        mimeType: "video/mp4",
        posterSrc: PIXEL_PNG,
        posterMimeType: "image/png",
        fit: "contain",
        alt: "caption validation",
        captionSrc: "https://example.com/sample.vtt",
        captionMimeType: "text/vtt",
      },
    ];

    await expect(renderPptx(deck)).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "media.caption-invalid-source",
          elementId: "remote-captions",
        }),
      ],
    });
  });

  it("rejects a WebVTT file that does not match captionContentHash", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "livetoon-caption-hash-"));
    const videoPath = join(fixtureDirectory, "sample.mp4");
    const captionPath = join(fixtureDirectory, "sample.vtt");
    try {
      await Promise.all([
        writeFile(videoPath, Buffer.from("00000018667479706d70343200000000", "hex")),
        writeFile(captionPath, "WEBVTT\n\n00:00.000 --> 00:01.000\n字幕\n", "utf8"),
      ]);
      const deck = componentDeck();
      const slide = deck.slides[0];
      if (!slide) throw new Error("Fixture must contain one slide");
      slide.elements = [
        {
          id: "mismatched-caption-hash",
          type: "video",
          frame: { x: 80, y: 100, w: 800, h: 450 },
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          src: videoPath,
          mimeType: "video/mp4",
          posterSrc: PIXEL_PNG,
          posterMimeType: "image/png",
          fit: "contain",
          alt: "caption hash validation",
          captionSrc: captionPath,
          captionContentHash: "0".repeat(64),
          captionMimeType: "text/vtt",
        },
      ];

      await expect(renderPptx(deck)).rejects.toMatchObject({
        diagnostics: [
          expect.objectContaining({
            code: "media.caption-content-hash-mismatch",
            elementId: "mismatched-caption-hash",
          }),
        ],
      });
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
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
