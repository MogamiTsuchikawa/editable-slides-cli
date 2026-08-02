import { tmpdir } from "node:os";
import path from "node:path";

import { defaultTheme } from "@livetoon/slide-theme-default";
import { describe, expect, it } from "vitest";

import { compileSlide } from "./slide.js";

function source(body: string): string {
  return ["---", "id: details", "layout: blank", "---", "", body].join("\n");
}

describe("detailed table and chart settings", () => {
  it("compiles widths, heights, rich cells, axes, legend, labels and series metadata", async () => {
    const result = await compileSlide(
      source(`
<Table
  id="metrics"
  x={0} y={0} w={900} h={360}
  headers={[{ value: "指標", fill: "#EAF0FF", align: "center", colSpan: 2 }]}
  rows={[[
    { value: 1234.5, numberFormat: "currency-jpy", fill: "#FFF4CC", align: "right", verticalAlign: "bottom" },
    { value: 0.42, numberFormat: "percent" }
  ]]}
  columnWidths={[300, 600]}
  rowHeights={[120, 240]}
/>
<Chart
  id="sales"
  alt="売上グラフ"
  type="combo"
  x={0} y={400} w={900} h={500}
  series={[
    { name: "売上", labels: ["1月", "2月"], values: [10, 20], color: "#3366FF", chartType: "bar" },
    { name: "伸び率", labels: ["1月", "2月"], values: [5, 8], color: "#FF6633", chartType: "line" }
  ]}
  categoryAxisTitle="月"
  valueAxisTitle="売上"
  valueUnit="万円"
  showLegend={true}
  legendPosition="right"
  showValue={true}
  showCategoryName={true}
/>
`),
      path.join(tmpdir(), "livetoon-structured-details.mdx"),
      tmpdir(),
      defaultTheme,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.slide.elements[0]).toMatchObject({
      type: "table",
      headerRows: 1,
      columnWidths: [300, 600],
      rows: [
        {
          height: 120,
          cells: [
            {
              value: "指標",
              colSpan: 2,
              fill: { type: "solid", color: "#EAF0FF" },
              textStyle: { align: "center", fontWeight: 700 },
            },
          ],
        },
        {
          height: 240,
          cells: [
            {
              value: 1234.5,
              numberFormat: "currency-jpy",
              paragraphs: [{ runs: [{ text: "¥1,235" }] }],
              textStyle: { align: "right", verticalAlign: "bottom" },
            },
            {
              value: 0.42,
              numberFormat: "percent",
              paragraphs: [{ runs: [{ text: "42%" }] }],
            },
          ],
        },
      ],
    });
    expect(result.slide.elements[1]).toMatchObject({
      type: "chart",
      chartType: "combo",
      categoryAxisTitle: "月",
      valueAxisTitle: "売上",
      valueUnit: "万円",
      legendPosition: "right",
      series: [
        { color: "#3366FF", chartType: "bar" },
        { color: "#FF6633", chartType: "line" },
      ],
      style: { showLegend: true, showValue: true, showCategoryName: true },
    });
  });

  it("rejects malformed detail settings with actionable diagnostics", async () => {
    const result = await compileSlide(
      source(`
<Table id="bad-table" x={0} y={0} w={500} h={300} rows={[[{ value: "x", numberFormat: "percent" }]]} columnWidths={[0]} />
<Chart id="bad-chart" alt="bad" x={0} y={320} w={500} h={300} series={[{ name: "A", labels: ["A"], values: [1], color: "red" }]} legendPosition="center" />
`),
      path.join(tmpdir(), "livetoon-structured-details-invalid.mdx"),
      tmpdir(),
      defaultTheme,
    );

    expect(
      result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    ).toMatch(/numberFormat requires a numeric value|columnWidths/);
    expect(
      result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    ).toContain("color must use #RRGGBB");
  });

  it("validates empty tables, merged-cell occupancy, bounded spans and exact sizing", async () => {
    const valid = await compileSlide(
      source(`
<Table
  id="valid-grid"
  x={0} y={0} w={200} h={100}
  rows={[[{ value: "A", rowSpan: 2 }, "B"], ["C"]]}
  columnWidths={[100, 100]}
  rowHeights={[50, 50]}
/>
`),
      path.join(tmpdir(), "livetoon-valid-table-grid.mdx"),
      tmpdir(),
      defaultTheme,
    );
    expect(valid.diagnostics).toEqual([]);
    expect(valid.slide.elements[0]).toMatchObject({
      type: "table",
      headerRows: 0,
      columnWidths: [100, 100],
    });

    const invalidSources = [
      `<Table id="empty" x={0} y={0} w={200} h={100} rows={[]} />`,
      `<Table id="empty-row" x={0} y={0} w={200} h={100} rows={[[]]} />`,
      `<Table id="overlap" x={0} y={0} w={200} h={100} rows={[[{ value: "A", rowSpan: 2 }, "B"], ["C", "D"]]} />`,
      `<Table id="past-end" x={0} y={0} w={200} h={100} rows={[[{ value: "A", rowSpan: 2 }]]} />`,
      `<Table id="huge-span" x={0} y={0} w={200} h={100} rows={[[{ value: "A", colSpan: 101 }]]} />`,
      `<Table id="bad-width" x={0} y={0} w={200} h={100} rows={[["A", "B"]]} columnWidths={[90, 90]} />`,
      `<Table id="bad-height" x={0} y={0} w={200} h={100} rows={[["A"], ["B"]]} rowHeights={[40, 40]} />`,
    ];
    const messages: string[] = [];
    for (const [index, body] of invalidSources.entries()) {
      const result = await compileSlide(
        source(body),
        path.join(tmpdir(), `livetoon-invalid-table-grid-${index}.mdx`),
        tmpdir(),
        defaultTheme,
      );
      messages.push(...result.diagnostics.map((diagnostic) => diagnostic.message));
    }
    expect(messages.join("\n")).toMatch(/at least one row/);
    expect(messages.join("\n")).toMatch(/at least one cell/);
    expect(messages.join("\n")).toMatch(/cannot fit/);
    expect(messages.join("\n")).toMatch(/final table row/);
    expect(messages.join("\n")).toMatch(/between 1 and 100/);
    expect(messages.join("\n")).toMatch(/add up to table width 200/);
    expect(messages.join("\n")).toMatch(/add up to table height 100/);
  });
});
