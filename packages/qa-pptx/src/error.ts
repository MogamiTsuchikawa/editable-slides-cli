import type { PptxInspectionReport } from "./types.js";

export class PptxInspectionError extends Error {
  readonly report: PptxInspectionReport;

  constructor(report: PptxInspectionReport) {
    const errorCount = report.issues.filter(
      (issue) => issue.severity === "error",
    ).length;
    super(`PPTX inspection failed with ${errorCount} error(s).`);
    this.name = "PptxInspectionError";
    this.report = report;
  }
}
