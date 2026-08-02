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
  chartType:
    | "bar"
    | "line"
    | "pie"
    | "doughnut"
    | "area"
    | "scatter"
    | "radar"
    | "stacked"
    | "combo",
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
      labels: seriesValues.map((_, valueIndex) =>
        chartType === "scatter" ? String(valueIndex + 1) : `Category ${valueIndex + 1}`,
      ),
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

function videoElement(): ElementIR {
  return {
    type: "video",
    id: "demo-video",
    frame: { x: 100, y: 100, w: 800, h: 450 },
    rotation: 0,
    zIndex: 2,
    opacity: 1,
    sourceLocation,
    src: "/api/assets/example?path=assets%2Fdemo.mp4",
    mimeType: "video/mp4",
    posterSrc: "data:image/png;base64,AA==",
    posterMimeType: "image/png",
    captionSrc: "/api/assets/example?path=assets%2Fdemo.ja.vtt",
    captionMimeType: "text/vtt",
    captionLanguage: "ja",
    captionLabel: "日本語字幕",
    fit: "contain",
    alt: "製品デモ動画",
  };
}

function audioElement(): ElementIR {
  return {
    type: "audio",
    id: "demo-audio",
    frame: { x: 100, y: 600, w: 800, h: 120 },
    rotation: 0,
    zIndex: 2,
    opacity: 1,
    sourceLocation,
    src: "/api/assets/example?path=assets%2Fdemo.mp3",
    mimeType: "audio/mpeg",
    captionSrc: "/api/assets/example?path=assets%2Fnarration.vtt",
    captionMimeType: "text/vtt",
    transcript: "ナレーション",
  };
}

function imageElement(): ElementIR {
  return {
    type: "image",
    id: "hero-image",
    frame: { x: 100, y: 100, w: 800, h: 450 },
    rotation: 0,
    zIndex: 2,
    opacity: 1,
    sourceLocation,
    src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
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
    posterFrame: {
      src: "data:image/png;base64,AA==",
      mimeType: "image/png",
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

  it("renders click-controlled local media without autoplay in normal mode", () => {
    const mediaSlide = { ...slide(), elements: [videoElement(), audioElement()] };
    const { container } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={mediaSlide} />,
    );
    const video = container.querySelector("video");
    const audio = container.querySelector("audio");
    expect(video?.controls).toBe(true);
    expect(video?.autoplay).toBe(false);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.getAttribute("poster")).toContain("data:image/png");
    expect(audio?.controls).toBe(true);
    expect(audio?.autoplay).toBe(false);
    expect(audio?.getAttribute("preload")).toBe("metadata");
    const videoTrack = video?.querySelector("track");
    expect(videoTrack?.getAttribute("kind")).toBe("captions");
    expect(videoTrack?.getAttribute("src")).toContain("demo.ja.vtt");
    expect(videoTrack?.getAttribute("srclang")).toBe("ja");
    expect(videoTrack?.getAttribute("label")).toBe("日本語字幕");
    expect(videoTrack?.default).toBe(true);
    const audioTrack = audio?.querySelector("track");
    expect(audioTrack?.getAttribute("kind")).toBe("captions");
    expect(audioTrack?.getAttribute("src")).toContain("narration.vtt");
    expect(audioTrack?.getAttribute("srclang")).toBe("ja");
    expect(audioTrack?.getAttribute("label")).toBe("字幕");
    expect(audioTrack?.default).toBe(true);
    expect(video?.parentElement?.classList.contains("lt-video-content")).toBe(true);
    expect(audio?.parentElement?.classList.contains("lt-audio-content")).toBe(true);
    expect(
      container
        .querySelector("[data-element-type='video']")
        ?.classList.contains("lt-video-element"),
    ).toBe(true);
  });

  it("uses static poster fallbacks for print and overview modes", () => {
    const mediaSlide = { ...slide(), elements: [videoElement(), audioElement()] };
    const { container, rerender } = render(
      <SlideCanvas deck={deck()} mode="print" slide={mediaSlide} />,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("audio")).toBeNull();
    expect(container.querySelector(".lt-video-poster img")).not.toBeNull();
    expect(screen.getByText("ナレーション")).toBeTruthy();

    rerender(<SlideCanvas deck={deck()} mode="overview" slide={mediaSlide} />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("audio")).toBeNull();
  });

  it("shares image crop, mask, border and shadow styles and prints GIF posters", () => {
    const imageSlide = { ...slide(), elements: [imageElement()] };
    const { container, rerender } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={imageSlide} />,
    );
    const wrapper = container.querySelector<HTMLElement>("[data-image-source]");
    const image = wrapper?.querySelector<HTMLImageElement>("img");

    expect(wrapper?.dataset.imageSource).toBe("original");
    expect(wrapper?.style.borderRadius).toBe("32px");
    expect(wrapper?.style.borderStyle).toBe("dashed");
    expect(wrapper?.style.boxShadow).toContain("12px");
    expect(image?.style.objectFit).toBe("cover");
    expect(image?.style.objectPosition).toBe("30% 70%");
    expect(image?.src).toContain("data:image/gif");

    rerender(<SlideCanvas deck={deck()} mode="print" slide={imageSlide} />);
    const printed = container.querySelector<HTMLElement>("[data-image-source]");
    expect(printed?.dataset.imageSource).toBe("posterFrame");
    expect(printed?.querySelector("img")?.getAttribute("src")).toContain(
      "data:image/png",
    );
  });

  it("renders formal image backgrounds with a focal position", () => {
    const backgroundSlide: SlideIR = {
      ...slide(),
      background: {
        type: "image",
        src: "data:image/png;base64,AA==",
        mimeType: "image/png",
        fit: "cover",
        focalPosition: { x: 0.25, y: 0.75 },
      },
    };
    const { container } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={backgroundSlide} />,
    );
    const canvas = container.querySelector<HTMLElement>(".lt-slide-canvas");

    expect(canvas?.style.backgroundImage).toContain("data:image/png");
    expect(canvas?.style.backgroundPosition).toBe("25% 75%");
    expect(canvas?.style.backgroundSize).toBe("cover");
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

  it("renders detailed table sizing, spans, fill and alignment", () => {
    const table = tableElement();
    if (table.type !== "table") throw new Error("Expected table fixture");
    table.frame.h = 72;
    table.columnWidths = [200, 600];
    table.rows = [
      {
        height: 72,
        cells: [
          {
            paragraphs: [{ runs: [{ text: "Merged" }] }],
            colSpan: 2,
            fill: { type: "solid", color: "#FFF4CC" },
            textStyle: { align: "right", verticalAlign: "bottom" },
          },
        ],
      },
    ];
    const tableSlide = { ...slide(), elements: [table] };
    const { container } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={tableSlide} />,
    );
    const columns = container.querySelectorAll<HTMLTableColElement>("colgroup col");
    const row = container.querySelector<HTMLTableRowElement>("tbody tr");
    const cell = container.querySelector<HTMLTableCellElement>("tbody th");

    expect(columns[0]?.style.width).toBe("25%");
    expect(columns[1]?.style.width).toBe("75%");
    expect(row?.style.height).toBe("72px");
    expect(cell?.colSpan).toBe(2);
    expect(cell?.style.background).toBe("rgb(255, 244, 204)");
    expect(cell?.style.textAlign).toBe("right");
    expect(cell?.style.verticalAlign).toBe("bottom");
  });

  it("keeps headerless tables as data cells and applies theme alignment", () => {
    const table = tableElement();
    if (table.type !== "table") throw new Error("Expected table fixture");
    Object.assign(table, { headerRows: 0 });
    table.rows = [
      {
        cells: [{ paragraphs: [{ runs: [{ text: "DATA" }] }] }],
      },
    ];
    table.style.text.align = "right";
    table.style.text.verticalAlign = "bottom";
    const tableSlide = { ...slide(), elements: [table] };
    const { container } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={tableSlide} />,
    );
    const cell = container.querySelector<HTMLTableCellElement>("tbody td");

    expect(container.querySelector("tbody th")).toBeNull();
    expect(cell?.style.background).toBe("rgb(255, 255, 255)");
    expect(cell?.style.textAlign).toBe("right");
    expect(cell?.style.verticalAlign).toBe("bottom");
  });

  it("honors series colors, legend placement, axes and data-label switches", () => {
    const chart = chartElement("detailed-chart", "bar", [[10, 20]], ["#999999"]);
    if (chart.type !== "chart") throw new Error("Expected chart fixture");
    const firstSeries = chart.series[0];
    if (!firstSeries) throw new Error("Expected chart series");
    firstSeries.color = "#123456";
    chart.categoryAxisTitle = "月";
    chart.valueAxisTitle = "売上";
    chart.valueUnit = "万円";
    chart.legendPosition = "right";
    chart.style.showLegend = true;
    chart.style.showValue = true;
    chart.style.showCategoryName = true;
    const chartSlide = { ...slide(), elements: [chart] };
    const { container } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={chartSlide} />,
    );

    expect(
      container.querySelector("[data-chart-legend='true']")?.textContent,
    ).toContain("Series 1");
    expect(
      container.querySelector(".lt-chart-body")?.getAttribute("data-legend-position"),
    ).toBe("right");
    expect(container.querySelector(".lt-chart-category-axis-title")?.textContent).toBe(
      "月",
    );
    expect(container.querySelector(".lt-chart-value-axis-title")?.textContent).toBe(
      "売上（万円）",
    );
    expect(container.querySelector(".lt-chart-data-label")?.textContent).toBe(
      "Category 1 · 10",
    );
    expect(
      container.querySelector("[data-chart-kind='bar'] rect")?.getAttribute("fill"),
    ).toBe("#123456");
  });

  it("uses category labels and slice colors in pie and doughnut legends", () => {
    const pie = chartElement(
      "pie-legend",
      "pie",
      [[10, 20, 30]],
      ["#111111", "#222222", "#333333"],
    );
    const doughnut = chartElement(
      "doughnut-legend",
      "doughnut",
      [[30, 20, 10]],
      ["#444444", "#555555", "#666666"],
    );
    if (pie.type !== "chart" || doughnut.type !== "chart") {
      throw new Error("Expected chart fixtures");
    }
    pie.style.showLegend = true;
    doughnut.style.showLegend = true;
    const chartSlide = { ...slide(), elements: [pie, doughnut] };
    const { container } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={chartSlide} />,
    );

    const pieLegend = container.querySelector(
      "[data-slide-element-id='pie-legend'] [data-chart-legend='true']",
    );
    const doughnutLegend = container.querySelector(
      "[data-slide-element-id='doughnut-legend'] [data-chart-legend='true']",
    );
    expect(pieLegend?.textContent).toBe("Category 1Category 2Category 3");
    expect(doughnutLegend?.textContent).toBe("Category 1Category 2Category 3");
    expect(pieLegend?.textContent).not.toContain("Series 1");
    expect(
      [
        ...(pieLegend?.querySelectorAll<HTMLElement>(".lt-chart-legend-swatch") ?? []),
      ].map((item) => item.style.backgroundColor),
    ).toEqual(["rgb(17, 17, 17)", "rgb(34, 34, 34)", "rgb(51, 51, 51)"]);
  });

  it("renders every supported chart contract in the web renderer", () => {
    const types = ["doughnut", "area", "scatter", "radar", "stacked", "combo"] as const;
    const chartSlide = {
      ...slide(),
      elements: types.map((type) =>
        chartElement(
          `chart-${type}`,
          type,
          type === "doughnut"
            ? [[10, 20, 30]]
            : [
                [10, 20, 30],
                [20, 10, 25],
              ],
          ["#2563eb", "#f97316"],
        ),
      ),
    };

    render(<SlideCanvas deck={deck()} mode="normal" slide={chartSlide} />);

    for (const type of types) {
      expect(
        document.querySelector(
          `[data-slide-element-id='chart-${type}'] [data-chart-kind='${type}']`,
        ),
      ).not.toBeNull();
    }
    expect(
      document.querySelector("[data-slide-element-id='chart-doughnut'] circle"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-slide-element-id='chart-area'] polygon"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-slide-element-id='chart-scatter'] circle"),
    ).not.toBeNull();
  });

  it("uses one shared axis, scale and palette in combo charts", () => {
    const combo = chartElement(
      "combo-details",
      "combo",
      [
        [10, 20, 30],
        [5, 10, 15],
        [8, 12, 18],
      ],
      ["#111111", "#222222", "#333333"],
    );
    if (combo.type !== "chart") throw new Error("Expected chart fixture");
    const [bars, line, area] = combo.series;
    if (!bars || !line || !area) throw new Error("Expected three series");
    bars.chartType = "bar";
    line.chartType = "line";
    area.chartType = "area";
    const comboSlide = { ...slide(), elements: [combo] };
    const { container } = render(
      <SlideCanvas deck={deck()} mode="normal" slide={comboSlide} />,
    );

    expect(container.querySelectorAll(".lt-chart-category-label")).toHaveLength(3);
    expect(
      [...container.querySelectorAll("rect")].map((node) => node.getAttribute("fill")),
    ).toEqual(["#111111", "#111111", "#111111"]);
    expect(
      [...container.querySelectorAll("polyline")].map((node) =>
        node.getAttribute("stroke"),
      ),
    ).toEqual(["#333333", "#222222"]);
    expect(container.querySelector("polygon")?.getAttribute("fill")).toBe("#333333");
  });
});
