export const MAX_TABLE_CELL_SPAN = 100;
export const MAX_TABLE_GRID_COLUMNS = 100;
export const TABLE_DIMENSION_EPSILON = 0.01;

export interface TableGridCellLike {
  colSpan?: number;
  rowSpan?: number;
}

export interface TableGridRowLike {
  cells: readonly TableGridCellLike[];
}

export type TableGridValidationIssueCode =
  | "empty-table"
  | "empty-row"
  | "invalid-col-span"
  | "invalid-row-span"
  | "column-limit"
  | "row-span-out-of-bounds"
  | "cell-does-not-fit";

export interface TableGridValidationIssue {
  code: TableGridValidationIssueCode;
  message: string;
  rowIndex: number;
  cellIndex?: number;
  property?: "colSpan" | "rowSpan";
}

export type TableGridValidationResult =
  | { success: true; columnCount: number }
  | {
      success: false;
      columnCount: number;
      issue: TableGridValidationIssue;
    };

function spanValue(cell: TableGridCellLike, property: "colSpan" | "rowSpan"): number {
  return cell[property] ?? 1;
}

/**
 * Validates merged-cell placement without expanding spans into a two-dimensional grid.
 * Cells are placed left-to-right in the first contiguous columns not occupied by a
 * rowSpan from an earlier row.
 */
export function validateTableGrid(
  rows: readonly TableGridRowLike[],
): TableGridValidationResult {
  let columnCount = 0;

  if (rows.length === 0) {
    return {
      success: false,
      columnCount,
      issue: {
        code: "empty-table",
        message: "table must contain at least one row",
        rowIndex: 0,
      },
    };
  }

  for (const [rowIndex, row] of rows.entries()) {
    if (row.cells.length === 0) {
      return {
        success: false,
        columnCount,
        issue: {
          code: "empty-row",
          message: "each table row must contain at least one cell",
          rowIndex,
        },
      };
    }
    let rowWidth = 0;
    for (const [cellIndex, cell] of row.cells.entries()) {
      for (const property of ["colSpan", "rowSpan"] as const) {
        const span = spanValue(cell, property);
        if (!Number.isInteger(span) || span < 1 || span > MAX_TABLE_CELL_SPAN) {
          return {
            success: false,
            columnCount,
            issue: {
              code: property === "colSpan" ? "invalid-col-span" : "invalid-row-span",
              message: `${property} must be an integer between 1 and ${MAX_TABLE_CELL_SPAN}`,
              rowIndex,
              cellIndex,
              property,
            },
          };
        }
      }

      const colSpan = spanValue(cell, "colSpan");
      rowWidth += colSpan;
      if (rowWidth > MAX_TABLE_GRID_COLUMNS) {
        return {
          success: false,
          columnCount: Math.max(columnCount, rowWidth),
          issue: {
            code: "column-limit",
            message: `table rows must contain at most ${MAX_TABLE_GRID_COLUMNS} logical columns`,
            rowIndex,
            cellIndex,
            property: "colSpan",
          },
        };
      }

      const rowSpan = spanValue(cell, "rowSpan");
      if (rowIndex + rowSpan > rows.length) {
        return {
          success: false,
          columnCount: Math.max(columnCount, rowWidth),
          issue: {
            code: "row-span-out-of-bounds",
            message: "rowSpan extends past the final table row",
            rowIndex,
            cellIndex,
            property: "rowSpan",
          },
        };
      }
    }
    columnCount = Math.max(columnCount, rowWidth);
  }

  const occupiedUntilRow = Array<number>(columnCount).fill(0);
  for (const [rowIndex, row] of rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      const colSpan = spanValue(cell, "colSpan");
      const rowSpan = spanValue(cell, "rowSpan");
      let startColumn = 0;
      let found = false;

      while (startColumn + colSpan <= columnCount) {
        let conflictColumn = -1;
        for (let offset = 0; offset < colSpan; offset += 1) {
          const column = startColumn + offset;
          if ((occupiedUntilRow[column] ?? 0) > rowIndex) {
            conflictColumn = column;
            break;
          }
        }
        if (conflictColumn === -1) {
          found = true;
          break;
        }
        startColumn = conflictColumn + 1;
      }

      if (!found) {
        return {
          success: false,
          columnCount,
          issue: {
            code: "cell-does-not-fit",
            message: `cell cannot fit in the ${columnCount}-column table grid because merged cells occupy the required columns`,
            rowIndex,
            cellIndex,
          },
        };
      }

      for (let offset = 0; offset < colSpan; offset += 1) {
        occupiedUntilRow[startColumn + offset] = rowIndex + rowSpan;
      }
    }
  }

  return { success: true, columnCount };
}

export function tableDimensionTotal(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function tableDimensionsMatch(
  values: readonly number[],
  expectedTotal: number,
): boolean {
  const tolerance = Math.max(TABLE_DIMENSION_EPSILON, Math.abs(expectedTotal) * 1e-6);
  return Math.abs(tableDimensionTotal(values) - expectedTotal) <= tolerance;
}

export function scaleTableDimensions(
  values: readonly number[],
  sourceTotal: number,
  targetTotal: number,
): number[] {
  if (
    values.length === 0 ||
    !Number.isFinite(sourceTotal) ||
    sourceTotal <= 0 ||
    !Number.isFinite(targetTotal) ||
    targetTotal <= 0
  ) {
    throw new Error("table dimensions require positive source and target totals");
  }
  const ratio = targetTotal / sourceTotal;
  const scaled = values.map((value) => value * ratio);
  const lastIndex = scaled.length - 1;
  const last = scaled[lastIndex];
  if (last !== undefined) {
    scaled[lastIndex] = last + (targetTotal - tableDimensionTotal(scaled));
  }
  return scaled;
}
