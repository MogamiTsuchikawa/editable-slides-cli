import type { SlideIR, TableElementIR } from "@editable-slides/slide-deck-ir";
import { describe, expect, it } from "vitest";

import { applyLayoutOverrides } from "./overrides.js";

function table(options?: {
  columnWidths?: number[];
  rowHeights?: number[];
  merged?: boolean;
}): TableElementIR {
  return {
    id: "metrics",
    type: "table",
    frame: { x: 0, y: 0, w: 600, h: 300 },
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    sourceLocation: { file: "deck.mdx", line: 1, column: 1 },
    headerRows: 0,
    rows: [
      {
        ...(options?.rowHeights ? { height: options.rowHeights[0] } : {}),
        cells: [
          {
            paragraphs: [{ runs: [{ text: "A" }] }],
            ...(options?.merged ? { colSpan: 2 } : {}),
          },
          ...(options?.merged ? [] : [{ paragraphs: [{ runs: [{ text: "B" }] }] }]),
        ],
      },
      {
        ...(options?.rowHeights ? { height: options.rowHeights[1] } : {}),
        cells: [
          { paragraphs: [{ runs: [{ text: "C" }] }] },
          { paragraphs: [{ runs: [{ text: "D" }] }] },
        ],
      },
    ],
    ...(options?.columnWidths ? { columnWidths: options.columnWidths } : {}),
    style: {
      border: { color: "#CCCCCC", width: 1 },
      headerFill: { type: "solid", color: "#EEEEEE" },
      bodyFill: { type: "solid", color: "#FFFFFF" },
      text: {
        fontFace: "Arial",
        fontSize: 20,
        color: "#111111",
        fontWeight: 400,
        align: "left",
        verticalAlign: "top",
      },
    },
  };
}

function slides(element: TableElementIR): SlideIR[] {
  return [
    {
      id: "page",
      sourcePath: "deck.mdx",
      layoutId: "blank",
      elements: [element],
      notes: { markdown: "", plainText: "", sources: [] },
    },
  ];
}

describe("table layout overrides", () => {
  it("scales explicit widths and heights independently, including merged tables", () => {
    const element = table({
      columnWidths: [200, 400],
      rowHeights: [100, 200],
      merged: true,
    });
    const deckSlides = slides(element);

    applyLayoutOverrides(deckSlides, {
      schemaVersion: 1,
      slides: { page: { metrics: { w: 900 } } },
    });
    expect(element.frame).toMatchObject({ w: 900, h: 300 });
    expect(element.columnWidths).toEqual([300, 600]);
    expect(element.rows.map((row) => row.height)).toEqual([100, 200]);

    applyLayoutOverrides(deckSlides, {
      schemaVersion: 1,
      slides: { page: { metrics: { h: 600 } } },
    });
    expect(element.frame).toMatchObject({ w: 900, h: 600 });
    expect(element.columnWidths).toEqual([300, 600]);
    expect(element.rows.map((row) => row.height)).toEqual([200, 400]);
  });

  it("uses the current frame for consecutive overrides and leaves implicit sizing alone", () => {
    const explicit = table({ columnWidths: [200, 400], rowHeights: [100, 200] });
    const explicitSlides = slides(explicit);
    applyLayoutOverrides(explicitSlides, {
      schemaVersion: 1,
      slides: { page: { metrics: { w: 900, h: 450 } } },
    });
    applyLayoutOverrides(explicitSlides, {
      schemaVersion: 1,
      slides: { page: { metrics: { w: 450, h: 225 } } },
    });
    expect(explicit.columnWidths).toEqual([150, 300]);
    expect(explicit.rows.map((row) => row.height)).toEqual([75, 150]);

    const implicit = table();
    applyLayoutOverrides(slides(implicit), {
      schemaVersion: 1,
      slides: { page: { metrics: { w: 900, h: 450 } } },
    });
    expect(implicit.columnWidths).toBeUndefined();
    expect(implicit.rows.every((row) => row.height === undefined)).toBe(true);
  });
});
