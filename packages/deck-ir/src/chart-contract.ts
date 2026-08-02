import type { ChartSeriesIR, ChartTypeIR } from "./types.js";

export type ChartContractIssueCode =
  | "single-series-required"
  | "combo-scatter-unsupported"
  | "category-labels-mismatch"
  | "pie-negative-value"
  | "pie-all-zero"
  | "scatter-label-not-numeric";

export interface ChartContractIssue {
  code: ChartContractIssueCode;
  message: string;
  seriesIndex?: number;
  pointIndex?: number;
}

export type ChartContractResult =
  | { success: true }
  | { success: false; issue: ChartContractIssue };

type ChartContractSeries = Pick<ChartSeriesIR, "labels" | "values" | "chartType">;

const CATEGORY_CHART_TYPES = new Set<ChartTypeIR>([
  "bar",
  "line",
  "area",
  "radar",
  "stacked",
  "combo",
]);

function labelsEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((label, index) => label === right[index])
  );
}

export function validateChartContract(
  chartType: ChartTypeIR,
  series: readonly ChartContractSeries[],
): ChartContractResult {
  if ((chartType === "pie" || chartType === "doughnut") && series.length !== 1) {
    return {
      success: false,
      issue: {
        code: "single-series-required",
        message: `"${chartType}" charts require exactly one series`,
      },
    };
  }

  if (chartType === "combo") {
    const scatterIndex = series.findIndex((item) => item.chartType === "scatter");
    if (scatterIndex >= 0) {
      return {
        success: false,
        issue: {
          code: "combo-scatter-unsupported",
          message: "combo charts do not support scatter series",
          seriesIndex: scatterIndex,
        },
      };
    }
  }

  if (chartType === "pie" || chartType === "doughnut") {
    const values = series[0]?.values ?? [];
    const negativeIndex = values.findIndex((value) => value < 0);
    if (negativeIndex >= 0) {
      return {
        success: false,
        issue: {
          code: "pie-negative-value",
          message: `${chartType} chart values must be non-negative`,
          seriesIndex: 0,
          pointIndex: negativeIndex,
        },
      };
    }
    if (!values.some((value) => value > 0)) {
      return {
        success: false,
        issue: {
          code: "pie-all-zero",
          message: `${chartType} charts require at least one value greater than zero`,
          seriesIndex: 0,
        },
      };
    }
  }

  if (chartType === "scatter") {
    for (const [seriesIndex, item] of series.entries()) {
      const pointIndex = item.labels.findIndex(
        (label) => label.trim() === "" || !Number.isFinite(Number(label)),
      );
      if (pointIndex >= 0) {
        return {
          success: false,
          issue: {
            code: "scatter-label-not-numeric",
            message: "scatter chart labels must be finite numeric strings",
            seriesIndex,
            pointIndex,
          },
        };
      }
    }
  }

  if (CATEGORY_CHART_TYPES.has(chartType) && series.length > 1) {
    const firstLabels = series[0]?.labels ?? [];
    const mismatchIndex = series.findIndex(
      (item, index) => index > 0 && !labelsEqual(firstLabels, item.labels),
    );
    if (mismatchIndex >= 0) {
      return {
        success: false,
        issue: {
          code: "category-labels-mismatch",
          message: "category chart series must use identical labels in the same order",
          seriesIndex: mismatchIndex,
        },
      };
    }
  }

  return { success: true };
}
