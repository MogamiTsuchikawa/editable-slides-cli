import { describe, expect, it } from "vitest";

import {
  MAX_TABLE_CELL_SPAN,
  scaleTableDimensions,
  tableDimensionsMatch,
  validateTableGrid,
} from "./table-grid.js";

describe("validateTableGrid", () => {
  it("places cells around row spans without overlap", () => {
    expect(
      validateTableGrid([{ cells: [{ rowSpan: 2 }, {}] }, { cells: [{}] }]),
    ).toEqual({ success: true, columnCount: 2 });
  });

  it("rejects cells that cannot fit around occupied columns", () => {
    const result = validateTableGrid([
      { cells: [{ rowSpan: 2 }, {}] },
      { cells: [{}, {}] },
    ]);
    expect(result).toMatchObject({
      success: false,
      issue: { code: "cell-does-not-fit", rowIndex: 1, cellIndex: 1 },
    });
  });

  it("rejects empty grids, out-of-bounds row spans and extreme spans", () => {
    expect(validateTableGrid([])).toMatchObject({
      success: false,
      issue: { code: "empty-table" },
    });
    expect(validateTableGrid([{ cells: [] }])).toMatchObject({
      success: false,
      issue: { code: "empty-row" },
    });
    expect(validateTableGrid([{ cells: [{ rowSpan: 2 }] }])).toMatchObject({
      success: false,
      issue: { code: "row-span-out-of-bounds" },
    });
    expect(
      validateTableGrid([{ cells: [{ colSpan: MAX_TABLE_CELL_SPAN + 1 }] }]),
    ).toMatchObject({
      success: false,
      issue: { code: "invalid-col-span" },
    });
  });
});

describe("tableDimensionsMatch", () => {
  it("allows small floating point error but rejects different totals", () => {
    expect(tableDimensionsMatch([0.1, 0.2], 0.3)).toBe(true);
    expect(tableDimensionsMatch([100, 99], 200)).toBe(false);
  });

  it("scales dimensions and absorbs floating point error in the final value", () => {
    const scaled = scaleTableDimensions([1, 2, 3], 6, 10);
    expect(tableDimensionsMatch(scaled, 10)).toBe(true);
    expect(scaled[0]).toBeCloseTo(10 / 6);
    expect(scaled[2]).toBeCloseTo(5);
  });
});
