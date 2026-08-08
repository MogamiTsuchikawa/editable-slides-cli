import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DECK_IR_SCHEMA_VERSION,
  type DeckIR,
  type ElementIR,
  WIDE_CANVAS,
} from "@editable-slides/slide-deck-ir";
import { defaultTheme } from "@editable-slides/slide-theme-default";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_STUDIO_DECK_SOURCE_BYTES,
  mutateSlideSource,
  readDeckSourceState,
  updateSlideMetadataSource,
  updateStructuredElementSource,
} from "./deck-source.js";

const temporaryDirectories: string[] = [];

function baseSource(body?: string): string {
  return `---
title: Studio fixture
slides:
  - id: intro
    layout: "blank"
    notes: ""
    sources: []
  - id: closing
    layout: "blank"
    notes: ""
    sources: []
---

<Slide id="intro">

# Intro
${body ?? ""}
</Slide>

<Slide id="closing">

# Closing

</Slide>
`;
}

async function fixture(options?: { source?: string; introElements?: ElementIR[] }) {
  const directory = await mkdtemp(join(tmpdir(), "livetoon-deck-source-"));
  temporaryDirectories.push(directory);
  const sourcePath = join(directory, "deck.mdx");
  const deckIrPath = join(directory, ".editable-slides", "deck.ir.json");
  const source = options?.source ?? baseSource();
  await mkdir(dirname(deckIrPath), { recursive: true });
  await writeFile(sourcePath, source, "utf8");
  const deck: DeckIR = {
    schemaVersion: DECK_IR_SCHEMA_VERSION,
    metadata: { id: "fixture", title: "Studio fixture", language: "ja-JP" },
    canvas: WIDE_CANVAS,
    theme: structuredClone(defaultTheme.ir),
    slides: [
      {
        id: "intro",
        sourcePath,
        layoutId: "blank",
        elements: options?.introElements ?? [],
        notes: { markdown: "", plainText: "", sources: [] },
      },
      {
        id: "closing",
        sourcePath,
        layoutId: "blank",
        elements: [],
        notes: { markdown: "", plainText: "", sources: [] },
      },
    ],
    diagnostics: [],
    contentHash: "fixture",
  };
  await writeFile(deckIrPath, `${JSON.stringify(deck)}\n`, "utf8");
  return { directory, sourcePath, deckIrPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deck.mdx page operations", () => {
  it("refuses to edit a deck.mdx symlink that resolves outside the deck", async () => {
    const files = await fixture();
    const outsideDirectory = await mkdtemp(
      join(tmpdir(), "livetoon-deck-source-outside-"),
    );
    temporaryDirectories.push(outsideDirectory);
    const outsideSource = join(outsideDirectory, "deck.mdx");
    await writeFile(outsideSource, baseSource(), "utf8");
    await rm(files.sourcePath);
    await symlink(outsideSource, files.sourcePath);

    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    expect(state).toMatchObject({ editable: false, sourceHash: "" });
    expect(state.reason).toContain("資料フォルダの外");
    await expect(
      mutateSlideSource(files.directory, files.deckIrPath, "irrelevant", {
        type: "delete",
        slideId: "intro",
      }),
    ).rejects.toThrow("資料フォルダの外");
  });

  it("refuses to edit a deck.mdx over the source size limit", async () => {
    const files = await fixture();
    await writeFile(files.sourcePath, Buffer.alloc(MAX_STUDIO_DECK_SOURCE_BYTES + 1));

    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    expect(state).toMatchObject({ editable: false, sourceHash: "" });
    expect(state.reason).toContain("編集上限");
  });

  it("adds a stable page after the selected page", async () => {
    const files = await fixture();
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    const saved = await mutateSlideSource(
      files.directory,
      files.deckIrPath,
      state.sourceHash,
      {
        type: "add",
        title: "New metrics",
        afterSlideId: "intro",
      },
    );

    expect(saved.slideIds).toEqual(["intro", "new-metrics", "closing"]);
    expect(saved.selectedSlideId).toBe("new-metrics");
    const source = await readFile(files.sourcePath, "utf8");
    expect(source.indexOf('<Slide id="intro">')).toBeLessThan(
      source.indexOf('<Slide id="new-metrics">'),
    );
    expect(source).toContain("# New metrics");
  });

  it("duplicates, reorders, and deletes whole Slide blocks independently", async () => {
    const duplicateFiles = await fixture();
    const duplicateState = await readDeckSourceState(
      duplicateFiles.directory,
      duplicateFiles.deckIrPath,
    );
    const duplicate = await mutateSlideSource(
      duplicateFiles.directory,
      duplicateFiles.deckIrPath,
      duplicateState.sourceHash,
      { type: "duplicate", slideId: "intro" },
    );
    expect(duplicate.slideIds).toEqual(["intro", "intro-copy", "closing"]);
    expect(await readFile(duplicateFiles.sourcePath, "utf8")).toContain(
      '<Slide id="intro-copy">',
    );

    const moveFiles = await fixture();
    const moveState = await readDeckSourceState(
      moveFiles.directory,
      moveFiles.deckIrPath,
    );
    const moved = await mutateSlideSource(
      moveFiles.directory,
      moveFiles.deckIrPath,
      moveState.sourceHash,
      { type: "move", slideId: "intro", toIndex: 1 },
    );
    expect(moved.slideIds).toEqual(["closing", "intro"]);

    const deleteFiles = await fixture();
    const deleteState = await readDeckSourceState(
      deleteFiles.directory,
      deleteFiles.deckIrPath,
    );
    const deleted = await mutateSlideSource(
      deleteFiles.directory,
      deleteFiles.deckIrPath,
      deleteState.sourceHash,
      { type: "delete", slideId: "intro" },
    );
    expect(deleted.slideIds).toEqual(["closing"]);
    expect(deleted.selectedSlideId).toBe("closing");
    expect(await readFile(deleteFiles.sourcePath, "utf8")).not.toContain(
      '<Slide id="intro">',
    );
  });

  it("saves speaker notes and sources and rejects an external edit", async () => {
    const files = await fixture();
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    const saved = await updateSlideMetadataSource(
      files.directory,
      files.deckIrPath,
      state.sourceHash,
      {
        slideId: "intro",
        notes: "最初に結論を伝える。\n次に根拠を示す。",
        sources: [{ label: "調査資料", url: "https://example.com/report" }],
      },
    );
    expect(saved.sourceHash).not.toBe(state.sourceHash);
    expect(await readDeckSourceState(files.directory, files.deckIrPath)).toMatchObject({
      editable: false,
      reason: "直前の変更を反映中です。少し待ってから再読み込みしてください。",
    });
    const source = await readFile(files.sourcePath, "utf8");
    expect(source).toContain("最初に結論を伝える。");
    expect(source).toContain('label: "調査資料"');

    await writeFile(files.sourcePath, `${source}\n{/* external */}\n`, "utf8");
    await expect(
      updateSlideMetadataSource(files.directory, files.deckIrPath, saved.sourceHash, {
        slideId: "intro",
        notes: "競合",
        sources: [],
      }),
    ).rejects.toThrow("別の場所で資料が更新されています");
  });
});

describe("structured element editing", () => {
  it("writes table cells and chart series into their source components", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const elements: ElementIR[] = [
      {
        id: "scores",
        type: "table",
        frame: { x: 0, y: 0, w: 600, h: 300 },
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        editable: true,
        sourceLocation,
        rows: [
          {
            cells: [
              {
                paragraphs: [{ runs: [{ text: "Before" }] }],
                textStyle: { fontWeight: 700 },
              },
            ],
          },
        ],
        style: structuredClone(defaultTheme.defaults.table),
      },
      {
        id: "sales",
        type: "chart",
        frame: { x: 700, y: 0, w: 600, h: 300 },
        rotation: 0,
        zIndex: 2,
        opacity: 1,
        editable: true,
        sourceLocation,
        chartType: "bar",
        series: [{ name: "Before", labels: ["A"], values: [1] }],
        style: structuredClone(defaultTheme.defaults.chart),
      },
    ];
    const files = await fixture({
      introElements: elements,
      source: baseSource(`
<Table id="scores" x={0} y={0} w={600} h={300} headers={["Before"]} rows={[]} />
<Chart id="sales" x={700} y={0} w={600} h={300} series={[{ name: "Before", labels: ["A"], values: [1] }]} />
`),
    });
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    const tableSaved = await updateStructuredElementSource(
      files.directory,
      files.deckIrPath,
      state.sourceHash,
      { slideId: "intro", elementId: "scores", data: [["After", 42]] },
    );
    const compiledDeck = JSON.parse(await readFile(files.deckIrPath, "utf8")) as DeckIR;
    compiledDeck.contentHash = "compiled-after-table";
    await writeFile(files.deckIrPath, `${JSON.stringify(compiledDeck)}\n`, "utf8");
    await updateStructuredElementSource(
      files.directory,
      files.deckIrPath,
      tableSaved.sourceHash,
      {
        slideId: "intro",
        elementId: "sales",
        data: [{ name: "売上", labels: ["1月", "2月"], values: [10, 20] }],
      },
    );

    const source = await readFile(files.sourcePath, "utf8");
    expect(source).toContain('"After"');
    expect(source).toContain("headers={[");
    expect(source).toContain("42");
    expect(source).toContain('"売上"');
    expect(source).toContain('"2月"');
  });

  it("preserves detailed table metadata in deck.mdx", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const table: ElementIR = {
      id: "details-table",
      type: "table",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
      headerRows: 1,
      columnWidths: [200, 400],
      rows: [
        {
          height: 140,
          cells: [
            {
              value: "指標",
              paragraphs: [{ runs: [{ text: "指標" }] }],
              colSpan: 2,
              fill: { type: "solid", color: "#EAF0FF" },
              textStyle: { fontWeight: 700, align: "center" },
            },
          ],
        },
        {
          height: 160,
          cells: [
            {
              value: 1200,
              numberFormat: "currency-jpy",
              paragraphs: [{ runs: [{ text: "¥1,200" }] }],
              fill: { type: "solid", color: "#FFF4CC" },
              textStyle: { align: "right", verticalAlign: "bottom" },
            },
            { value: true, paragraphs: [{ runs: [{ text: "true" }] }] },
          ],
        },
      ],
      style: structuredClone(defaultTheme.defaults.table),
    };
    const files = await fixture({
      introElements: [table],
      source: baseSource(`
<Table id="details-table" x={0} y={0} w={600} h={300} headers={["Before"]} rows={[]} />
`),
    });
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    await updateStructuredElementSource(
      files.directory,
      files.deckIrPath,
      state.sourceHash,
      {
        slideId: "intro",
        elementId: "details-table",
        data: {
          rows: [
            [
              {
                value: "指標",
                fill: "#EAF0FF",
                align: "center",
                colSpan: 2,
              },
            ],
            [
              {
                value: 2500,
                fill: "#FFF4CC",
                align: "right",
                verticalAlign: "bottom",
                numberFormat: "currency-jpy",
              },
              true,
            ],
          ],
          columnWidths: [200, 400],
          rowHeights: [140, 160],
        },
      },
    );

    const source = await readFile(files.sourcePath, "utf8");
    expect(source).toMatch(/columnWidths=\{\[\s*200,\s*400\s*\]\}/);
    expect(source).toMatch(/rowHeights=\{\[\s*140,\s*160\s*\]\}/);
    expect(source).toContain('"fill": "#FFF4CC"');
    expect(source).toContain('"verticalAlign": "bottom"');
    expect(source).toContain('"numberFormat": "currency-jpy"');
    expect(source).toContain('"colSpan": 2');
  });

  it("rejects unsafe merged grids and dimension totals before changing deck.mdx", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const table: ElementIR = {
      id: "grid-table",
      type: "table",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
      headerRows: 0,
      rows: [
        {
          cells: [
            { value: "A", paragraphs: [{ runs: [{ text: "A" }] }] },
            { value: "B", paragraphs: [{ runs: [{ text: "B" }] }] },
          ],
        },
        {
          cells: [
            { value: "C", paragraphs: [{ runs: [{ text: "C" }] }] },
            { value: "D", paragraphs: [{ runs: [{ text: "D" }] }] },
          ],
        },
      ],
      style: structuredClone(defaultTheme.defaults.table),
    };
    const files = await fixture({
      introElements: [table],
      source: baseSource(`
<Table id="grid-table" x={0} y={0} w={600} h={300} rows={[["A", "B"], ["C", "D"]]} />
`),
    });
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    const update = (data: unknown) =>
      updateStructuredElementSource(
        files.directory,
        files.deckIrPath,
        state.sourceHash,
        { slideId: "intro", elementId: "grid-table", data },
      );

    await expect(
      update({
        rows: [
          [{ value: "A", rowSpan: 2 }, "B"],
          ["C", "D"],
        ],
      }),
    ).rejects.toThrow(/重なる|はみ出し/);
    await expect(update({ rows: [[{ value: "A", rowSpan: 2 }]] })).rejects.toThrow(
      /最終行/,
    );
    await expect(update({ rows: [[{ value: "A", colSpan: 101 }]] })).rejects.toThrow(
      /1〜100/,
    );
    await expect(update({ rows: [[]] })).rejects.toThrow(/1つ以上のセル/);
    await expect(
      update({
        rows: [
          ["A", "B"],
          ["C", "D"],
        ],
        columnWidths: [100, 100],
      }),
    ).rejects.toThrow(/幅600/);
    await expect(
      update({
        rows: [
          ["A", "B"],
          ["C", "D"],
        ],
        rowHeights: [100, 100],
      }),
    ).rejects.toThrow(/高さ300/);

    const unchanged = await readFile(files.sourcePath, "utf8");
    expect(unchanged).toContain('rows={[["A", "B"], ["C", "D"]]}');

    await update({
      rows: [[{ value: "A", rowSpan: 2 }, "B"], ["C"]],
      columnWidths: [300, 300],
      rowHeights: [150, 150],
    });
    const saved = await readFile(files.sourcePath, "utf8");
    expect(saved).not.toContain("headers={");
    expect(saved).toContain('"rowSpan": 2');
    expect(saved).toMatch(/columnWidths=\{\[\s*300,\s*300\s*\]\}/);
  });

  it("round-trips combo series color, chartType, legend and data-label settings", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const chart: ElementIR = {
      id: "details-chart",
      type: "chart",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
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
          color: "#123456",
          chartType: "bar",
        },
        {
          name: "伸び率",
          labels: ["1月"],
          values: [5],
          color: "#ABCDEF",
          chartType: "line",
        },
      ],
      style: {
        ...structuredClone(defaultTheme.defaults.chart),
        showLegend: true,
        showValue: true,
        showCategoryName: true,
      },
    };
    const files = await fixture({
      introElements: [chart],
      source: baseSource(`
<Chart id="details-chart" type="combo" x={0} y={0} w={600} h={300} series={[{ name: "Before", labels: ["A"], values: [1], chartType: "bar" }]} />
`),
    });
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    await updateStructuredElementSource(
      files.directory,
      files.deckIrPath,
      state.sourceHash,
      {
        slideId: "intro",
        elementId: "details-chart",
        data: {
          series: chart.series,
          categoryAxisTitle: "月",
          valueAxisTitle: "売上",
          valueUnit: "万円",
          showLegend: true,
          legendPosition: "right",
          showValue: true,
          showCategoryName: true,
        },
      },
    );

    const source = await readFile(files.sourcePath, "utf8");
    expect(source).toContain('"color": "#123456"');
    expect(source).toContain('"chartType": "bar"');
    expect(source).toContain('"color": "#ABCDEF"');
    expect(source).toContain('"chartType": "line"');
    expect(source).toContain('categoryAxisTitle={"月"}');
    expect(source).toContain('valueAxisTitle={"売上"}');
    expect(source).toContain('valueUnit={"万円"}');
    expect(source).toContain("showLegend={true}");
    expect(source).toContain('legendPosition={"right"}');
    expect(source).toContain("showValue={true}");
    expect(source).toContain("showCategoryName={true}");
  });

  it("rejects empty chart points and multiple pie series before changing deck.mdx", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const chart: ElementIR = {
      id: "pie-chart",
      type: "chart",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
      chartType: "pie",
      series: [{ name: "構成", labels: ["A"], values: [1] }],
      style: structuredClone(defaultTheme.defaults.chart),
    };
    const originalComponent =
      '<Chart id="pie-chart" type="pie" x={0} y={0} w={600} h={300} series={[{ name: "構成", labels: ["A"], values: [1] }]} />';
    const files = await fixture({
      introElements: [chart],
      source: baseSource(originalComponent),
    });
    const state = await readDeckSourceState(files.directory, files.deckIrPath);

    await expect(
      updateStructuredElementSource(
        files.directory,
        files.deckIrPath,
        state.sourceHash,
        {
          slideId: "intro",
          elementId: "pie-chart",
          data: {
            series: [
              { name: "A", labels: ["1"], values: [1] },
              { name: "B", labels: ["1"], values: [2] },
            ],
          },
        },
      ),
    ).rejects.toThrow("1系列");
    await expect(
      updateStructuredElementSource(
        files.directory,
        files.deckIrPath,
        state.sourceHash,
        {
          slideId: "intro",
          elementId: "pie-chart",
          data: { series: [{ name: "空", labels: [], values: [] }] },
        },
      ),
    ).rejects.toThrow("1件以上");

    expect(await readFile(files.sourcePath, "utf8")).toContain(originalComponent);
  });

  it("rejects chart data that would render differently before changing deck.mdx", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const chart = (
      id: string,
      chartType: "bar" | "pie" | "doughnut" | "scatter" | "combo",
      series: Extract<ElementIR, { type: "chart" }>["series"],
    ): ElementIR => ({
      id,
      type: "chart",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
      chartType,
      series,
      style: structuredClone(defaultTheme.defaults.chart),
    });
    const elements: ElementIR[] = [
      chart("combo", "combo", [
        { name: "A", labels: ["1"], values: [1], chartType: "bar" },
      ]),
      chart("category", "bar", [
        { name: "A", labels: ["A"], values: [1] },
        { name: "B", labels: ["A"], values: [2] },
      ]),
      chart("pie", "pie", [{ name: "A", labels: ["A"], values: [1] }]),
      chart("doughnut", "doughnut", [{ name: "A", labels: ["A"], values: [1] }]),
      chart("scatter", "scatter", [{ name: "A", labels: ["1"], values: [1] }]),
    ];
    const original = `
<Chart id="combo" type="combo" x={0} y={0} w={600} h={300} series={[{ name: "A", labels: ["1"], values: [1], chartType: "bar" }]} />
<Chart id="category" type="bar" x={0} y={0} w={600} h={300} series={[{ name: "A", labels: ["A"], values: [1] }, { name: "B", labels: ["A"], values: [2] }]} />
<Chart id="pie" type="pie" x={0} y={0} w={600} h={300} series={[{ name: "A", labels: ["A"], values: [1] }]} />
<Chart id="doughnut" type="doughnut" x={0} y={0} w={600} h={300} series={[{ name: "A", labels: ["A"], values: [1] }]} />
<Chart id="scatter" type="scatter" x={0} y={0} w={600} h={300} series={[{ name: "A", labels: ["1"], values: [1] }]} />
`;
    const files = await fixture({
      introElements: elements,
      source: baseSource(original),
    });
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    const update = (elementId: string, series: unknown) =>
      updateStructuredElementSource(
        files.directory,
        files.deckIrPath,
        state.sourceHash,
        { slideId: "intro", elementId, data: { series } },
      );

    await expect(
      update("combo", [
        { name: "A", labels: ["1"], values: [1], chartType: "scatter" },
      ]),
    ).rejects.toThrow(/散布図系列/);
    await expect(
      update("category", [
        { name: "A", labels: ["A", "B"], values: [1, 2] },
        { name: "B", labels: ["A", "C"], values: [3, 4] },
      ]),
    ).rejects.toThrow(/同じ順序・内容/);
    await expect(
      update("pie", [{ name: "A", labels: ["A"], values: [-1] }]),
    ).rejects.toThrow(/0以上/);
    await expect(
      update("doughnut", [{ name: "A", labels: ["A", "B"], values: [0, 0] }]),
    ).rejects.toThrow(/0より大きい値/);
    await expect(
      update("scatter", [{ name: "A", labels: ["not-a-number"], values: [1] }]),
    ).rejects.toThrow(/有限の数値/);

    expect(await readFile(files.sourcePath, "utf8")).toContain(original.trim());
  });

  it("writes override-scaled table dimensions back in source coordinates", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const table: ElementIR = {
      id: "scaled-table",
      type: "table",
      frame: { x: 0, y: 0, w: 900, h: 450 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
      headerRows: 0,
      columnWidths: [300, 600],
      rows: [
        {
          height: 150,
          cells: [
            { value: "A", paragraphs: [{ runs: [{ text: "A" }] }] },
            { value: "B", paragraphs: [{ runs: [{ text: "B" }] }] },
          ],
        },
        {
          height: 300,
          cells: [
            { value: "C", paragraphs: [{ runs: [{ text: "C" }] }] },
            { value: "D", paragraphs: [{ runs: [{ text: "D" }] }] },
          ],
        },
      ],
      style: structuredClone(defaultTheme.defaults.table),
    };
    const files = await fixture({
      introElements: [table],
      source: baseSource(`
<Table id="scaled-table" x={0} y={0} w={600} h={300} rows={[["A", "B"], ["C", "D"]]} columnWidths={[200, 400]} rowHeights={[100, 200]} />
`),
    });
    const state = await readDeckSourceState(files.directory, files.deckIrPath);
    await updateStructuredElementSource(
      files.directory,
      files.deckIrPath,
      state.sourceHash,
      {
        slideId: "intro",
        elementId: "scaled-table",
        data: {
          rows: [
            ["A", "B"],
            ["C", "D"],
          ],
          columnWidths: [300, 600],
          rowHeights: [150, 300],
        },
      },
    );
    const source = await readFile(files.sourcePath, "utf8");
    expect(source).toMatch(/columnWidths=\{\[\s*200,\s*400\s*\]\}/);
    expect(source).toMatch(/rowHeights=\{\[\s*100,\s*200\s*\]\}/);
  });

  it("removes stale legacy dimensions and handles slot sizing safely", async () => {
    const sourceLocation = { file: "deck.mdx", line: 15, column: 1 };
    const table: ElementIR = {
      id: "legacy-table",
      type: "table",
      frame: { x: 0, y: 0, w: 600, h: 300 },
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      editable: true,
      sourceLocation,
      headerRows: 0,
      columnWidths: [200, 400],
      rows: [
        {
          height: 300,
          cells: [
            { value: "A", paragraphs: [{ runs: [{ text: "A" }] }] },
            { value: "B", paragraphs: [{ runs: [{ text: "B" }] }] },
          ],
        },
      ],
      style: structuredClone(defaultTheme.defaults.table),
    };
    const legacyFiles = await fixture({
      introElements: [table],
      source: baseSource(`
<Table id="legacy-table" x={0} y={0} w={600} h={300} rows={[["A", "B"]]} columnWidths={[200, 400]} rowHeights={[300]} />
`),
    });
    const legacyState = await readDeckSourceState(
      legacyFiles.directory,
      legacyFiles.deckIrPath,
    );
    await updateStructuredElementSource(
      legacyFiles.directory,
      legacyFiles.deckIrPath,
      legacyState.sourceHash,
      {
        slideId: "intro",
        elementId: "legacy-table",
        data: [["A"]],
      },
    );
    const legacySource = await readFile(legacyFiles.sourcePath, "utf8");
    expect(legacySource).not.toContain("columnWidths");
    expect(legacySource).not.toContain("rowHeights");

    const slotFiles = await fixture({
      introElements: [table],
      source: baseSource('<Table id="legacy-table" rows={[["A", "B"]]} />'),
    });
    const slotState = await readDeckSourceState(
      slotFiles.directory,
      slotFiles.deckIrPath,
    );
    await updateStructuredElementSource(
      slotFiles.directory,
      slotFiles.deckIrPath,
      slotState.sourceHash,
      {
        slideId: "intro",
        elementId: "legacy-table",
        data: {
          rows: [["A", "B"]],
          columnWidths: [200, 400],
        },
      },
    );
    expect(await readFile(slotFiles.sourcePath, "utf8")).toContain("columnWidths={");

    const overriddenTable = structuredClone(table);
    overriddenTable.frame.w = 900;
    overriddenTable.columnWidths = [300, 600];
    const overriddenFiles = await fixture({
      introElements: [overriddenTable],
      source: baseSource('<Table id="legacy-table" rows={[["A", "B"]]} />'),
    });
    await writeFile(
      join(overriddenFiles.directory, "layout.overrides.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        slides: { intro: { "legacy-table": { w: 900 } } },
      })}\n`,
      "utf8",
    );
    const overriddenState = await readDeckSourceState(
      overriddenFiles.directory,
      overriddenFiles.deckIrPath,
    );
    await expect(
      updateStructuredElementSource(
        overriddenFiles.directory,
        overriddenFiles.deckIrPath,
        overriddenState.sourceHash,
        {
          slideId: "intro",
          elementId: "legacy-table",
          data: {
            rows: [["A", "B"]],
            columnWidths: [300, 600],
          },
        },
      ),
    ).rejects.toThrow(/元の表幅/);
    expect(await readFile(overriddenFiles.sourcePath, "utf8")).toContain(
      '<Table id="legacy-table" rows={[["A", "B"]]} />',
    );
  });
});
