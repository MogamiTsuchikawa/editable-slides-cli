import {
  type ConnectorElementIR,
  type ElementIR,
  type GroupElementIR,
  GroupElementIRSchema,
} from "@editable-slides/slide-deck-ir";
import { defaultTheme } from "@editable-slides/slide-theme-default";
import { describe, expect, it } from "vitest";

import {
  type DiagramPresetInput,
  DiagramPresetValidationError,
  expandDiagramPreset,
  validateDiagramPresetInput,
} from "./diagram-presets.js";

const base = {
  id: "diagram",
  frame: { x: 180, y: 160, w: 1_420, h: 700 },
  sourceLocation: { file: "/deck/deck.mdx", line: 12, column: 1 },
} as const;

const presets: Array<{
  input: DiagramPresetInput;
  expectedChildren: number;
}> = [
  {
    input: {
      ...base,
      kind: "flow",
      items: [
        { key: "discover", label: "発見" },
        { key: "design", label: "設計", description: "仮説を形にする" },
        { key: "deliver", label: "提供" },
      ],
    },
    expectedChildren: 8,
  },
  {
    input: {
      ...base,
      kind: "timeline",
      items: [
        { key: "q1", date: "Q1", label: "調査" },
        { key: "q2", date: "Q2", label: "試作" },
        { key: "q3", date: "Q3", label: "公開" },
      ],
    },
    expectedChildren: 13,
  },
  {
    input: {
      ...base,
      kind: "matrix",
      rows: [
        { key: "high", label: "効果 高" },
        { key: "low", label: "効果 低" },
      ],
      columns: [
        { key: "easy", label: "実行しやすい" },
        { key: "hard", label: "実行しにくい" },
      ],
      cells: [
        {
          key: "priority",
          rowKey: "high",
          columnKey: "easy",
          label: "優先施策",
          color: "#EAF0FF",
        },
      ],
    },
    expectedChildren: 16,
  },
  {
    input: {
      ...base,
      kind: "cycle",
      items: [
        { key: "plan", label: "計画" },
        { key: "do", label: "実行" },
        { key: "check", label: "確認" },
        { key: "act", label: "改善" },
      ],
    },
    expectedChildren: 12,
  },
  {
    input: {
      ...base,
      kind: "funnel",
      items: [
        { key: "reach", label: "認知" },
        { key: "interest", label: "関心" },
        { key: "purchase", label: "購入" },
      ],
    },
    expectedChildren: 8,
  },
  {
    input: {
      ...base,
      kind: "orgChart",
      items: [
        { key: "ceo", label: "代表" },
        { key: "sales", label: "営業", parentKey: "ceo" },
        { key: "product", label: "開発", parentKey: "ceo" },
        { key: "design", label: "デザイン", parentKey: "product" },
      ],
    },
    expectedChildren: 11,
  },
];

const compactBase = {
  ...base,
  frame: { x: 0, y: 0, w: 240, h: 160 },
};
const compactItems = Array.from({ length: 12 }, (_, index) => ({
  key: `item-${index + 1}`,
  label: `Item ${index + 1}`,
}));
const compactPresets: DiagramPresetInput[] = [
  { ...compactBase, kind: "flow", items: compactItems },
  { ...compactBase, kind: "timeline", items: compactItems },
  {
    ...compactBase,
    kind: "matrix",
    rows: Array.from({ length: 6 }, (_, index) => ({
      key: `row-${index + 1}`,
      label: `Row ${index + 1}`,
    })),
    columns: Array.from({ length: 6 }, (_, index) => ({
      key: `column-${index + 1}`,
      label: `Column ${index + 1}`,
    })),
    cells: [],
  },
  { ...compactBase, kind: "cycle", items: compactItems },
  { ...compactBase, kind: "funnel", items: compactItems },
  {
    ...compactBase,
    kind: "orgChart",
    items: [
      { key: "root", label: "Root" },
      ...compactItems.slice(1).map((item) => ({ ...item, parentKey: "root" })),
    ],
  },
];

function flatten(group: GroupElementIR): ElementIR[] {
  return [group, ...group.children];
}

function expectAbsoluteCanvasFrames(group: GroupElementIR): void {
  for (const element of group.children) {
    expect(element.frame.w, element.id).toBeGreaterThan(0);
    expect(element.frame.h, element.id).toBeGreaterThan(0);
    expect(element.frame.x, element.id).toBeGreaterThanOrEqual(group.frame.x);
    expect(element.frame.y, element.id).toBeGreaterThanOrEqual(group.frame.y);
    expect(element.frame.x + element.frame.w, element.id).toBeLessThanOrEqual(
      group.frame.x + group.frame.w + 0.001,
    );
    expect(element.frame.y + element.frame.h, element.id).toBeLessThanOrEqual(
      group.frame.y + group.frame.h + 0.001,
    );
  }
}

describe("expandDiagramPreset", () => {
  it.each(presets)(
    "expands $input.kind into native elements with deterministic IDs",
    ({ input, expectedChildren }) => {
      const first = expandDiagramPreset(input, defaultTheme);
      const second = expandDiagramPreset(structuredClone(input), defaultTheme);

      expect(first).toEqual(second);
      expect(first.type).toBe("group");
      expect(first.children).toHaveLength(expectedChildren);
      expect(new Set(flatten(first).map((element) => element.id)).size).toBe(
        expectedChildren + 1,
      );
      const nativeTypes = new Set(["shape", "text", "connector"]);
      expect(first.children.every((element) => nativeTypes.has(element.type))).toBe(
        true,
      );
      expect(first.children.every((element) => element.editable === true)).toBe(true);
      expectAbsoluteCanvasFrames(first);
      expect(() => GroupElementIRSchema.parse(first)).not.toThrow();
    },
  );

  it("uses theme shape, connector, font, and color defaults", () => {
    const result = expandDiagramPreset(
      presets[0]?.input as DiagramPresetInput,
      defaultTheme,
    );
    const shape = result.children.find((element) => element.type === "shape");
    const text = result.children.find((element) => element.type === "text");
    const link = result.children.find(
      (element): element is ConnectorElementIR => element.type === "connector",
    );

    expect(shape?.fill).toEqual(defaultTheme.defaults.shape.fill);
    expect(shape?.stroke).toEqual(defaultTheme.defaults.shape.stroke);
    expect(text?.style.fontFace).toBe(defaultTheme.ir.typography.body.fontFace);
    expect(link?.stroke.color).toBe(defaultTheme.ir.colors.brand);
    expect(link?.stroke.width).toBeGreaterThanOrEqual(
      defaultTheme.defaults.shape.stroke.width,
    );
  });

  it("keeps every connector reference attached to a generated native shape", () => {
    for (const { input } of presets) {
      const result = expandDiagramPreset(input, defaultTheme);
      const shapes = new Set(
        result.children
          .filter((element) => element.type === "shape")
          .map((element) => element.id),
      );
      for (const element of result.children) {
        if (element.type !== "connector") continue;
        if (element.fromElementId) expect(shapes.has(element.fromElementId)).toBe(true);
        if (element.toElementId) expect(shapes.has(element.toElementId)).toBe(true);
      }
    }
  });

  it("supports vertical flow without switching to relative coordinates", () => {
    const flow = presets[0]?.input;
    if (flow?.kind !== "flow") throw new Error("flow fixture missing");
    const result = expandDiagramPreset(
      { ...flow, direction: "vertical" },
      defaultTheme,
    );
    const nodes = result.children.filter((element) => element.type === "shape");
    expect(nodes.map((node) => node.frame.y)).toEqual(
      [...nodes.map((node) => node.frame.y)].sort((left, right) => left - right),
    );
    expectAbsoluteCanvasFrames(result);
  });

  it.each(compactPresets)(
    "keeps compact maximum-size $kind content inside its absolute group frame",
    (input) => {
      const result = expandDiagramPreset(input, defaultTheme);
      expectAbsoluteCanvasFrames(result);
      expect(() => GroupElementIRSchema.parse(result)).not.toThrow();
    },
  );
});

describe("diagram input validation", () => {
  it("reports paths for unsafe IDs, duplicate keys, colors, and canvas overflow", () => {
    const invalid = {
      ...base,
      id: "Bad ID",
      frame: { x: 1_800, y: 900, w: 300, h: 300 },
      kind: "flow",
      items: [
        { key: "same", label: "A", color: "blue" },
        { key: "same", label: "" },
      ],
    } as unknown as DiagramPresetInput;
    const issues = validateDiagramPresetInput(invalid);

    expect(issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining([
        "id",
        "frame",
        "items.0.color",
        "items.1.key",
        "items.1.label",
      ]),
    );
    expect(() => expandDiagramPreset(invalid, defaultTheme)).toThrow(
      DiagramPresetValidationError,
    );
  });

  it("rejects missing matrix coordinates and organization cycles", () => {
    const matrix = presets.find((preset) => preset.input.kind === "matrix")?.input;
    if (matrix?.kind !== "matrix") throw new Error("matrix fixture missing");
    expect(
      validateDiagramPresetInput({
        ...matrix,
        cells: [
          {
            key: "missing",
            rowKey: "unknown",
            columnKey: "easy",
            label: "Missing",
          },
        ],
      }).map((issue) => issue.path.join(".")),
    ).toContain("cells.0.rowKey");

    const organization = presets.find(
      (preset) => preset.input.kind === "orgChart",
    )?.input;
    if (organization?.kind !== "orgChart") {
      throw new Error("organization fixture missing");
    }
    const issues = validateDiagramPresetInput({
      ...organization,
      items: [
        { key: "root", label: "Root" },
        { key: "a", label: "A", parentKey: "b" },
        { key: "b", label: "B", parentKey: "a" },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("cycle"))).toBe(true);
  });

  it("returns validation issues instead of throwing for absent base fields", () => {
    const issues = validateDiagramPresetInput({
      kind: "flow",
      items: [],
    } as unknown as DiagramPresetInput);
    expect(issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["id", "frame", "sourceLocation", "items"]),
    );
  });

  it("reports malformed nested values without throwing", () => {
    expect(() =>
      validateDiagramPresetInput({
        ...base,
        kind: "matrix",
        rows: [null],
        columns: { invalid: true },
        cells: [null],
      } as unknown as DiagramPresetInput),
    ).not.toThrow();
    expect(() =>
      validateDiagramPresetInput({
        ...base,
        kind: "orgChart",
        items: [null, "invalid"],
      } as unknown as DiagramPresetInput),
    ).not.toThrow();
  });
});
