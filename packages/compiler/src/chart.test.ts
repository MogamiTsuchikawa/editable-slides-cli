import { tmpdir } from "node:os";
import path from "node:path";

import { defaultTheme } from "@livetoon/slide-theme-default";
import { describe, expect, it } from "vitest";

import { compileSlide } from "./slide.js";

describe("Chart components", () => {
  it("compiles all chart kinds and combo series kinds", async () => {
    const types = [
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
    const body = types
      .map((type, index) => {
        const series =
          type === "combo"
            ? '[{ name: "売上", labels: ["1", "2"], values: [10, 20], chartType: "bar" }, { name: "成長率", labels: ["1", "2"], values: [15, 25], chartType: "line" }]'
            : '[{ name: "売上", labels: ["1", "2"], values: [10, 20] }]';
        return `<Chart id="chart-${type}" alt="${type} chart" type="${type}" series={${series}} x={${index * 10}} y={0} w={300} h={200} />`;
      })
      .join("\n");
    const result = await compileSlide(
      ["---", "id: charts", "layout: blank", "---", "", body].join("\n"),
      path.join(tmpdir(), "livetoon-chart-contract.mdx"),
      tmpdir(),
      defaultTheme,
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      result.slide.elements.map((element) =>
        element.type === "chart" ? element.chartType : element.type,
      ),
    ).toEqual(types);
    expect(result.slide.elements.at(-1)).toMatchObject({
      type: "chart",
      chartType: "combo",
      series: [{ chartType: "bar" }, { chartType: "line" }],
    });
  });

  it("rejects empty chart data and multiple pie or doughnut series", async () => {
    const body = [
      '<Chart id="empty" alt="empty" type="bar" series={[]} x={0} y={0} w={300} h={200} />',
      '<Chart id="empty-points" alt="empty points" type="line" series={[{ name: "空", labels: [], values: [] }]} x={320} y={0} w={300} h={200} />',
      '<Chart id="multi-pie" alt="multi pie" type="pie" series={[{ name: "A", labels: ["1"], values: [1] }, { name: "B", labels: ["1"], values: [2] }]} x={0} y={220} w={300} h={200} />',
      '<Chart id="multi-doughnut" alt="multi doughnut" type="doughnut" series={[{ name: "A", labels: ["1"], values: [1] }, { name: "B", labels: ["1"], values: [2] }]} x={320} y={220} w={300} h={200} />',
    ].join("\n");
    const result = await compileSlide(
      ["---", "id: invalid-charts", "layout: blank", "---", "", body].join("\n"),
      path.join(tmpdir(), "livetoon-invalid-chart-contract.mdx"),
      tmpdir(),
      defaultTheme,
    );

    expect(result.slide.elements).toEqual([]);
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      '"series" must contain at least one series',
    );
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      'series "空" must contain at least one label and value',
    );
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      '"pie" charts require exactly one series',
    );
    expect(result.diagnostics.map((item) => item.message).join("\n")).toContain(
      '"doughnut" charts require exactly one series',
    );
  });

  it("rejects chart combinations that render differently across outputs", async () => {
    const body = [
      '<Chart id="combo-scatter" alt="combo scatter" type="combo" series={[{ name: "A", labels: ["1"], values: [1], chartType: "scatter" }]} x={0} y={0} w={300} h={200} />',
      '<Chart id="labels" alt="labels" type="bar" series={[{ name: "A", labels: ["1", "2"], values: [1, 2] }, { name: "B", labels: ["1", "3"], values: [3, 4] }]} x={310} y={0} w={300} h={200} />',
      '<Chart id="negative-pie" alt="negative pie" type="pie" series={[{ name: "A", labels: ["1", "2"], values: [1, -1] }]} x={0} y={210} w={300} h={200} />',
      '<Chart id="zero-doughnut" alt="zero doughnut" type="doughnut" series={[{ name: "A", labels: ["1", "2"], values: [0, 0] }]} x={310} y={210} w={300} h={200} />',
      '<Chart id="bad-scatter" alt="bad scatter" type="scatter" series={[{ name: "A", labels: ["not-a-number"], values: [1] }]} x={620} y={0} w={300} h={200} />',
    ].join("\n");
    const result = await compileSlide(
      ["---", "id: invalid-chart-boundaries", "layout: blank", "---", "", body].join(
        "\n",
      ),
      path.join(tmpdir(), "livetoon-invalid-chart-boundaries.mdx"),
      tmpdir(),
      defaultTheme,
    );
    const messages = result.diagnostics.map((item) => item.message).join("\n");

    expect(result.slide.elements).toEqual([]);
    expect(messages).toContain("combo charts do not support scatter series");
    expect(messages).toContain(
      "category chart series must use identical labels in the same order",
    );
    expect(messages).toContain("pie chart values must be non-negative");
    expect(messages).toContain(
      "doughnut charts require at least one value greater than zero",
    );
    expect(messages).toContain("scatter chart labels must be finite numeric strings");
  });
});
