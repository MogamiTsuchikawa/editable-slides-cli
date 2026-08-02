import { describe, expect, it } from "vitest";

import { validateChartContract } from "./chart-contract.js";

describe("validateChartContract", () => {
  it("rejects scatter series in combo charts and mismatched category labels", () => {
    expect(
      validateChartContract("combo", [
        { labels: ["A"], values: [1], chartType: "scatter" },
      ]),
    ).toMatchObject({
      success: false,
      issue: { code: "combo-scatter-unsupported" },
    });
    expect(
      validateChartContract("bar", [
        { labels: ["A", "B"], values: [1, 2] },
        { labels: ["A", "C"], values: [3, 4] },
      ]),
    ).toMatchObject({
      success: false,
      issue: { code: "category-labels-mismatch", seriesIndex: 1 },
    });
  });

  it("requires meaningful non-negative pie and doughnut values", () => {
    expect(
      validateChartContract("pie", [{ labels: ["A"], values: [-1] }]),
    ).toMatchObject({
      success: false,
      issue: { code: "pie-negative-value" },
    });
    expect(
      validateChartContract("doughnut", [{ labels: ["A", "B"], values: [0, 0] }]),
    ).toMatchObject({
      success: false,
      issue: { code: "pie-all-zero" },
    });
  });

  it("requires finite numeric labels for standalone scatter charts", () => {
    expect(
      validateChartContract("scatter", [{ labels: ["1", "x"], values: [2, 3] }]),
    ).toMatchObject({
      success: false,
      issue: { code: "scatter-label-not-numeric", pointIndex: 1 },
    });
    expect(
      validateChartContract("scatter", [{ labels: ["-1.5", "2e3"], values: [2, 3] }]),
    ).toEqual({ success: true });
  });
});
