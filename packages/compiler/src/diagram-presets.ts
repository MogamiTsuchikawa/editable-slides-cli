import {
  type ConnectorElementIR,
  type FillIR,
  type FrameIR,
  type GroupElementIR,
  type ShapeElementIR,
  type SourceLocation,
  type StrokeIR,
  type TextElementIR,
  type TextStyleIR,
  WIDE_CANVAS,
} from "@editable-slides/slide-deck-ir";
import type { ThemeDefinition } from "@editable-slides/slide-theme-default";

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_ITEMS = 12;

export interface DiagramValidationIssue {
  path: Array<string | number>;
  message: string;
}

export class DiagramPresetValidationError extends Error {
  readonly issues: DiagramValidationIssue[];

  constructor(issues: DiagramValidationIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path.join(".") || "diagram"}: ${issue.message}`)
        .join("; "),
    );
    this.name = "DiagramPresetValidationError";
    this.issues = issues;
  }
}

export interface DiagramItemInput {
  /** Stable, author-provided key used to derive every child element ID. */
  key: string;
  label: string;
  description?: string;
  color?: string;
}

export interface DiagramBaseInput {
  id: string;
  frame: FrameIR;
  sourceLocation: SourceLocation;
  zIndex?: number;
  alt?: string;
}

export interface FlowDiagramInput extends DiagramBaseInput {
  kind: "flow";
  items: DiagramItemInput[];
  direction?: "horizontal" | "vertical";
}

export interface TimelineItemInput extends DiagramItemInput {
  date?: string;
}

export interface TimelineDiagramInput extends DiagramBaseInput {
  kind: "timeline";
  items: TimelineItemInput[];
}

export interface MatrixAxisInput {
  key: string;
  label: string;
}

export interface MatrixCellInput extends DiagramItemInput {
  rowKey: string;
  columnKey: string;
}

export interface MatrixDiagramInput extends DiagramBaseInput {
  kind: "matrix";
  rows: MatrixAxisInput[];
  columns: MatrixAxisInput[];
  cells: MatrixCellInput[];
}

export interface CycleDiagramInput extends DiagramBaseInput {
  kind: "cycle";
  items: DiagramItemInput[];
}

export interface FunnelDiagramInput extends DiagramBaseInput {
  kind: "funnel";
  items: DiagramItemInput[];
}

export interface OrgChartItemInput extends DiagramItemInput {
  parentKey?: string;
}

export interface OrgChartDiagramInput extends DiagramBaseInput {
  kind: "orgChart";
  items: OrgChartItemInput[];
}

export type DiagramPresetInput =
  | FlowDiagramInput
  | TimelineDiagramInput
  | MatrixDiagramInput
  | CycleDiagramInput
  | FunnelDiagramInput
  | OrgChartDiagramInput;

type DiagramChild = ShapeElementIR | TextElementIR | ConnectorElementIR;

function round(value: number): number {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function frame(x: number, y: number, w: number, h: number): FrameIR {
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

function cloneFrame(value: FrameIR): FrameIR {
  return frame(value.x, value.y, value.w, value.h);
}

function location(value: SourceLocation): SourceLocation {
  return { ...value };
}

function color(theme: ThemeDefinition, name: string, fallback: string): string {
  const value = theme.ir.colors[name];
  return typeof value === "string" && COLOR.test(value) ? value : fallback;
}

function solidFill(value: string): FillIR {
  return { type: "solid", color: value };
}

function itemFill(item: DiagramItemInput, theme: ThemeDefinition): FillIR {
  return item.color
    ? solidFill(item.color)
    : structuredClone(theme.defaults.shape.fill);
}

function stroke(theme: ThemeDefinition): StrokeIR {
  return structuredClone(theme.defaults.shape.stroke);
}

function connectorStroke(theme: ThemeDefinition): StrokeIR {
  return {
    ...stroke(theme),
    color: color(theme, "brand", theme.defaults.shape.stroke.color),
    width: Math.max(2, theme.defaults.shape.stroke.width),
  };
}

function readableTextColor(fill: FillIR, theme: ThemeDefinition): string {
  if (fill.type !== "solid" || !COLOR.test(fill.color)) {
    return color(theme, "text", "#172033");
  }
  const value = fill.color.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1_000;
  return luminance < 145
    ? color(theme, "canvas", "#FFFFFF")
    : color(theme, "text", "#172033");
}

function fitStyle(source: TextStyleIR, values: Partial<TextStyleIR> = {}): TextStyleIR {
  return {
    ...structuredClone(source),
    ...values,
    textFit: "shrink",
  };
}

function shape(
  input: DiagramBaseInput,
  id: string,
  shapeFrame: FrameIR,
  shapeType: ShapeElementIR["shape"],
  fill: FillIR,
  shapeStroke: StrokeIR,
  zIndex = 2,
): ShapeElementIR {
  return {
    id,
    type: "shape",
    frame: cloneFrame(shapeFrame),
    rotation: 0,
    zIndex,
    opacity: 1,
    editable: true,
    sourceLocation: location(input.sourceLocation),
    shape: shapeType,
    fill: structuredClone(fill),
    stroke: structuredClone(shapeStroke),
  };
}

function itemText(
  input: DiagramBaseInput,
  id: string,
  textFrame: FrameIR,
  item: Pick<DiagramItemInput, "label" | "description">,
  theme: ThemeDefinition,
  textColor: string,
  options: { align?: TextStyleIR["align"]; fontSize?: number } = {},
): TextElementIR {
  const paragraphs: TextElementIR["paragraphs"] = [
    { runs: [{ text: item.label, bold: true }] },
  ];
  if (item.description) {
    paragraphs.push({
      runs: [
        {
          text: item.description,
          fontSize: Math.max(
            14,
            (options.fontSize ?? theme.ir.typography.body.fontSize) * 0.7,
          ),
        },
      ],
      spaceBefore: 5,
    });
  }
  return {
    id,
    type: "text",
    role: "body",
    frame: cloneFrame(textFrame),
    rotation: 0,
    zIndex: 3,
    opacity: 1,
    editable: true,
    sourceLocation: location(input.sourceLocation),
    paragraphs,
    style: fitStyle(theme.ir.typography.body, {
      align: options.align ?? "center",
      verticalAlign: "middle",
      color: textColor,
      fontSize: options.fontSize ?? Math.min(theme.ir.typography.body.fontSize, 30),
    }),
  };
}

function simpleText(
  input: DiagramBaseInput,
  id: string,
  textFrame: FrameIR,
  text: string,
  theme: ThemeDefinition,
  options: Partial<TextStyleIR> = {},
): TextElementIR {
  return {
    id,
    type: "text",
    role: "body",
    frame: cloneFrame(textFrame),
    rotation: 0,
    zIndex: 3,
    opacity: 1,
    editable: true,
    sourceLocation: location(input.sourceLocation),
    paragraphs: [{ runs: [{ text, bold: true }] }],
    style: fitStyle(theme.ir.typography.body, {
      align: "center",
      verticalAlign: "middle",
      fontSize: Math.min(theme.ir.typography.body.fontSize, 28),
      ...options,
    }),
  };
}

function connector(
  input: DiagramBaseInput,
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  theme: ThemeDefinition,
  references: { from?: string; to?: string } = {},
  endArrow: ConnectorElementIR["endArrow"] = "triangle",
): ConnectorElementIR {
  const resolvedStart = { x: round(start.x), y: round(start.y) };
  const resolvedEnd = { x: round(end.x), y: round(end.y) };
  return {
    id,
    type: "connector",
    frame: frame(
      Math.min(resolvedStart.x, resolvedEnd.x),
      Math.min(resolvedStart.y, resolvedEnd.y),
      Math.max(1, Math.abs(resolvedEnd.x - resolvedStart.x)),
      Math.max(1, Math.abs(resolvedEnd.y - resolvedStart.y)),
    ),
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    editable: true,
    sourceLocation: location(input.sourceLocation),
    start: resolvedStart,
    end: resolvedEnd,
    stroke: connectorStroke(theme),
    beginArrow: "none",
    endArrow,
    ...(references.from ? { fromElementId: references.from } : {}),
    ...(references.to ? { toElementId: references.to } : {}),
  };
}

function nodeId(input: DiagramBaseInput, key: string): string {
  return `${input.id}--node-${key}`;
}

function textId(input: DiagramBaseInput, key: string): string {
  return `${input.id}--text-${key}`;
}

function validateFrame(
  value: FrameIR | undefined,
  issues: DiagramValidationIssue[],
): void {
  if (!value || ![value.x, value.y, value.w, value.h].every(Number.isFinite)) {
    issues.push({ path: ["frame"], message: "must contain finite numbers" });
    return;
  }
  if (value.w < 240 || value.h < 160) {
    issues.push({
      path: ["frame"],
      message: "must be at least 240 wide and 160 high",
    });
  }
  if (
    value.x < 0 ||
    value.y < 0 ||
    value.x + value.w > WIDE_CANVAS.width ||
    value.y + value.h > WIDE_CANVAS.height
  ) {
    issues.push({ path: ["frame"], message: "must stay inside the 1920x1080 canvas" });
  }
}

function validateLocation(
  value: SourceLocation | undefined,
  issues: DiagramValidationIssue[],
): void {
  if (
    !value ||
    typeof value.file !== "string" ||
    !value.file ||
    !Number.isInteger(value.line) ||
    value.line < 1 ||
    !Number.isInteger(value.column) ||
    value.column < 1
  ) {
    issues.push({
      path: ["sourceLocation"],
      message: "requires file and positive line/column numbers",
    });
  }
}

function validateItems(
  items: DiagramItemInput[] | undefined,
  issues: DiagramValidationIssue[],
  minimum: number,
  path = "items",
  maximum = MAX_ITEMS,
): void {
  if (!Array.isArray(items)) {
    issues.push({ path: [path], message: "must be an array" });
    return;
  }
  if (items.length < minimum || items.length > maximum) {
    issues.push({
      path: [path],
      message: `must contain between ${minimum} and ${maximum} items`,
    });
  }
  const keys = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      issues.push({ path: [path, index], message: "must be an object" });
      continue;
    }
    const key = typeof item.key === "string" ? item.key : "";
    if (!SAFE_ID.test(key)) {
      issues.push({
        path: [path, index, "key"],
        message: "must use lowercase letters, numbers, _ or -",
      });
    } else if (keys.has(key)) {
      issues.push({ path: [path, index, "key"], message: "must be unique" });
    }
    keys.add(key);
    if (typeof item.label !== "string" || !item.label.trim()) {
      issues.push({ path: [path, index, "label"], message: "is required" });
    } else if (item.label.length > 200) {
      issues.push({
        path: [path, index, "label"],
        message: "must be 200 characters or less",
      });
    }
    if (item.description !== undefined && typeof item.description !== "string") {
      issues.push({ path: [path, index, "description"], message: "must be text" });
    } else if ((item.description?.length ?? 0) > 500) {
      issues.push({
        path: [path, index, "description"],
        message: "must be 500 characters or less",
      });
    }
    if (
      item.color !== undefined &&
      (typeof item.color !== "string" || !COLOR.test(item.color))
    ) {
      issues.push({ path: [path, index, "color"], message: "must use #RRGGBB" });
    }
  }
}

function validateMatrix(
  input: MatrixDiagramInput,
  issues: DiagramValidationIssue[],
): void {
  const validateAxes = (
    axes: MatrixAxisInput[] | undefined,
    path: "rows" | "columns",
  ) => {
    if (!Array.isArray(axes) || axes.length < 1 || axes.length > 6) {
      issues.push({ path: [path], message: "must contain between 1 and 6 labels" });
      return;
    }
    const keys = new Set<string>();
    for (const [index, axis] of axes.entries()) {
      const key =
        axis && typeof axis === "object" && typeof axis.key === "string"
          ? axis.key
          : "";
      if (!SAFE_ID.test(key)) {
        issues.push({ path: [path, index, "key"], message: "must be a safe ID" });
      } else if (keys.has(key)) {
        issues.push({ path: [path, index, "key"], message: "must be unique" });
      }
      keys.add(key);
      if (
        !axis ||
        typeof axis !== "object" ||
        typeof axis.label !== "string" ||
        !axis.label.trim()
      ) {
        issues.push({ path: [path, index, "label"], message: "is required" });
      }
    }
  };
  validateAxes(input.rows, "rows");
  validateAxes(input.columns, "columns");
  validateItems(input.cells, issues, 0, "cells", 36);
  if (!Array.isArray(input.cells)) return;
  const rowKeys = new Set<string>();
  if (Array.isArray(input.rows)) {
    for (const row of input.rows) {
      if (row && typeof row === "object" && typeof row.key === "string") {
        rowKeys.add(row.key);
      }
    }
  }
  const columnKeys = new Set<string>();
  if (Array.isArray(input.columns)) {
    for (const column of input.columns) {
      if (column && typeof column === "object" && typeof column.key === "string") {
        columnKeys.add(column.key);
      }
    }
  }
  const coordinates = new Set<string>();
  for (const [index, cell] of input.cells.entries()) {
    if (!cell || typeof cell !== "object") continue;
    if (!rowKeys.has(cell.rowKey)) {
      issues.push({ path: ["cells", index, "rowKey"], message: "does not exist" });
    }
    if (!columnKeys.has(cell.columnKey)) {
      issues.push({ path: ["cells", index, "columnKey"], message: "does not exist" });
    }
    const coordinate = `${cell.rowKey}\u0000${cell.columnKey}`;
    if (coordinates.has(coordinate)) {
      issues.push({ path: ["cells", index], message: "duplicates a matrix position" });
    }
    coordinates.add(coordinate);
  }
}

function validateOrgChart(
  input: OrgChartDiagramInput,
  issues: DiagramValidationIssue[],
): void {
  validateItems(input.items, issues, 1);
  if (!Array.isArray(input.items)) return;
  const items = input.items.filter((item): item is OrgChartItemInput =>
    Boolean(item && typeof item === "object"),
  );
  const keys = new Set(items.map((item) => item.key));
  const roots = items.filter((item) => item.parentKey === undefined);
  if (roots.length !== 1) {
    issues.push({ path: ["items"], message: "must contain exactly one root" });
  }
  for (const [index, item] of input.items.entries()) {
    if (!item || typeof item !== "object") continue;
    if (item.parentKey !== undefined && !keys.has(item.parentKey)) {
      issues.push({ path: ["items", index, "parentKey"], message: "does not exist" });
    }
    if (item.parentKey === item.key) {
      issues.push({
        path: ["items", index, "parentKey"],
        message: "cannot reference itself",
      });
    }
  }
  for (const item of items) {
    const seen = new Set<string>();
    let current: OrgChartItemInput | undefined = item;
    while (current?.parentKey) {
      if (seen.has(current.parentKey)) {
        issues.push({ path: ["items"], message: "must not contain a cycle" });
        return;
      }
      seen.add(current.parentKey);
      current = items.find((candidate) => candidate.key === current?.parentKey);
    }
  }
}

export function validateDiagramPresetInput(
  input: DiagramPresetInput,
): DiagramValidationIssue[] {
  const issues: DiagramValidationIssue[] = [];
  if (!input || typeof input !== "object") {
    return [{ path: [], message: "must be an object" }];
  }
  if (!SAFE_ID.test(input.id ?? "")) {
    issues.push({ path: ["id"], message: "must be a safe, lowercase ID" });
  }
  validateFrame(input.frame, issues);
  validateLocation(input.sourceLocation, issues);
  if (
    input.zIndex !== undefined &&
    (!Number.isSafeInteger(input.zIndex) || input.zIndex < 0)
  ) {
    issues.push({ path: ["zIndex"], message: "must be a non-negative integer" });
  }
  if (input.alt !== undefined && (typeof input.alt !== "string" || !input.alt.trim())) {
    issues.push({ path: ["alt"], message: "must be non-empty text" });
  }
  switch (input.kind) {
    case "flow":
      validateItems(input.items, issues, 2);
      if (
        input.direction !== undefined &&
        input.direction !== "horizontal" &&
        input.direction !== "vertical"
      ) {
        issues.push({ path: ["direction"], message: "must be horizontal or vertical" });
      }
      break;
    case "timeline":
      validateItems(input.items, issues, 2);
      if (Array.isArray(input.items)) {
        for (const [index, item] of input.items.entries()) {
          if (
            item &&
            typeof item === "object" &&
            item.date !== undefined &&
            typeof item.date !== "string"
          ) {
            issues.push({ path: ["items", index, "date"], message: "must be text" });
          }
        }
      }
      break;
    case "matrix":
      validateMatrix(input, issues);
      break;
    case "cycle":
      validateItems(input.items, issues, 3);
      break;
    case "funnel":
      validateItems(input.items, issues, 2);
      break;
    case "orgChart":
      validateOrgChart(input, issues);
      break;
    default:
      issues.push({ path: ["kind"], message: "is not a supported diagram preset" });
  }
  return issues;
}

function expandFlow(input: FlowDiagramInput, theme: ThemeDefinition): DiagramChild[] {
  const horizontal = input.direction !== "vertical";
  const padding = Math.min(54, (horizontal ? input.frame.w : input.frame.h) * 0.06);
  const gap = Math.min(72, (horizontal ? input.frame.w : input.frame.h) * 0.045);
  const count = input.items.length;
  const nodeWidth = horizontal
    ? (input.frame.w - padding * 2 - gap * (count - 1)) / count
    : Math.min(input.frame.w * 0.72, 600);
  const nodeHeight = horizontal
    ? Math.min(input.frame.h * 0.62, 260)
    : (input.frame.h - padding * 2 - gap * (count - 1)) / count;
  const nodes = input.items.map((item, index) => {
    const x = horizontal
      ? input.frame.x + padding + index * (nodeWidth + gap)
      : input.frame.x + (input.frame.w - nodeWidth) / 2;
    const y = horizontal
      ? input.frame.y + (input.frame.h - nodeHeight) / 2
      : input.frame.y + padding + index * (nodeHeight + gap);
    return { item, frame: frame(x, y, nodeWidth, nodeHeight) };
  });
  const children: DiagramChild[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    if (!previous || !current) continue;
    children.push(
      connector(
        input,
        `${input.id}--connector-${index - 1}-${index}`,
        horizontal
          ? {
              x: previous.frame.x + previous.frame.w,
              y: previous.frame.y + previous.frame.h / 2,
            }
          : {
              x: previous.frame.x + previous.frame.w / 2,
              y: previous.frame.y + previous.frame.h,
            },
        horizontal
          ? { x: current.frame.x, y: current.frame.y + current.frame.h / 2 }
          : { x: current.frame.x + current.frame.w / 2, y: current.frame.y },
        theme,
        {
          from: nodeId(input, previous.item.key),
          to: nodeId(input, current.item.key),
        },
      ),
    );
  }
  for (const node of nodes) {
    const fill = itemFill(node.item, theme);
    children.push(
      shape(
        input,
        nodeId(input, node.item.key),
        node.frame,
        "roundRect",
        fill,
        stroke(theme),
      ),
      itemText(
        input,
        textId(input, node.item.key),
        frame(
          node.frame.x + 16,
          node.frame.y + 12,
          Math.max(1, node.frame.w - 32),
          Math.max(1, node.frame.h - 24),
        ),
        node.item,
        theme,
        readableTextColor(fill, theme),
      ),
    );
  }
  return children;
}

function expandTimeline(
  input: TimelineDiagramInput,
  theme: ThemeDefinition,
): DiagramChild[] {
  const slotWidth = input.frame.w / input.items.length;
  const paddingX = slotWidth / 2;
  const baseline = input.frame.y + input.frame.h / 2;
  const step = slotWidth;
  const cardWidth = Math.max(1, Math.min(300, slotWidth - 12));
  const cardHeight = Math.min(190, input.frame.h * 0.32);
  const stemGap = Math.min(54, input.frame.h * 0.08);
  const pointSize = Math.min(28, Math.max(6, slotWidth * 0.5));
  const brand = color(theme, "brand", "#2857D9");
  const surface = solidFill(color(theme, "surface", "#F5F7FA"));
  const children: DiagramChild[] = [
    connector(
      input,
      `${input.id}--axis`,
      { x: input.frame.x + paddingX, y: baseline },
      { x: input.frame.x + input.frame.w - paddingX, y: baseline },
      theme,
      {},
      "none",
    ),
  ];
  input.items.forEach((item, index) => {
    const centerX = input.frame.x + paddingX + step * index;
    const above = index % 2 === 0;
    const cardY = above ? baseline - cardHeight - stemGap : baseline + stemGap;
    const cardFrame = frame(centerX - cardWidth / 2, cardY, cardWidth, cardHeight);
    const pointFrame = frame(
      centerX - pointSize / 2,
      baseline - pointSize / 2,
      pointSize,
      pointSize,
    );
    const pointId = `${input.id}--point-${item.key}`;
    const stemEnd = above ? cardY + cardHeight : cardY;
    children.push(
      connector(
        input,
        `${input.id}--stem-${item.key}`,
        { x: centerX, y: baseline },
        { x: centerX, y: stemEnd },
        theme,
        { from: pointId, to: nodeId(input, item.key) },
        "none",
      ),
      shape(input, pointId, pointFrame, "ellipse", solidFill(brand), stroke(theme)),
      shape(
        input,
        nodeId(input, item.key),
        cardFrame,
        "roundRect",
        surface,
        stroke(theme),
      ),
    );
    const paragraphs: TextElementIR["paragraphs"] = [];
    if (item.date)
      paragraphs.push({ runs: [{ text: item.date, bold: true, color: brand }] });
    paragraphs.push({ runs: [{ text: item.label, bold: true }] });
    if (item.description) {
      paragraphs.push({
        runs: [{ text: item.description, fontSize: 18 }],
        spaceBefore: 4,
      });
    }
    const textPaddingX = Math.min(14, cardFrame.w * 0.2);
    const textPaddingY = Math.min(10, cardFrame.h * 0.12);
    children.push({
      ...simpleText(
        input,
        textId(input, item.key),
        frame(
          cardFrame.x + textPaddingX,
          cardFrame.y + textPaddingY,
          Math.max(1, cardFrame.w - textPaddingX * 2),
          Math.max(1, cardFrame.h - textPaddingY * 2),
        ),
        "",
        theme,
        { color: color(theme, "text", "#172033"), fontSize: 25 },
      ),
      paragraphs,
    });
  });
  return children;
}

function expandMatrix(
  input: MatrixDiagramInput,
  theme: ThemeDefinition,
): DiagramChild[] {
  const headerWidth = Math.min(230, input.frame.w * 0.2);
  const headerHeight = Math.min(100, input.frame.h * 0.18);
  const cellWidth = (input.frame.w - headerWidth) / input.columns.length;
  const cellHeight = (input.frame.h - headerHeight) / input.rows.length;
  const brandFill = solidFill(color(theme, "brand", "#2857D9"));
  const surfaceFill = solidFill(color(theme, "surface", "#F5F7FA"));
  const canvasText = color(theme, "canvas", "#FFFFFF");
  const bodyText = color(theme, "text", "#172033");
  const cells = new Map(
    input.cells.map((cell) => [`${cell.rowKey}\u0000${cell.columnKey}`, cell]),
  );
  const children: DiagramChild[] = [];
  input.columns.forEach((column, columnIndex) => {
    const cellFrame = frame(
      input.frame.x + headerWidth + columnIndex * cellWidth,
      input.frame.y,
      cellWidth,
      headerHeight,
    );
    const key = `column-${column.key}`;
    children.push(
      shape(input, nodeId(input, key), cellFrame, "rect", brandFill, stroke(theme)),
      simpleText(input, textId(input, key), cellFrame, column.label, theme, {
        color: canvasText,
        fontSize: 24,
      }),
    );
  });
  input.rows.forEach((row, rowIndex) => {
    const rowFrame = frame(
      input.frame.x,
      input.frame.y + headerHeight + rowIndex * cellHeight,
      headerWidth,
      cellHeight,
    );
    const rowKey = `row-${row.key}`;
    children.push(
      shape(input, nodeId(input, rowKey), rowFrame, "rect", brandFill, stroke(theme)),
      simpleText(input, textId(input, rowKey), rowFrame, row.label, theme, {
        color: canvasText,
        fontSize: 24,
      }),
    );
    input.columns.forEach((column, columnIndex) => {
      const cell = cells.get(`${row.key}\u0000${column.key}`);
      const value: DiagramItemInput = cell ?? {
        key: `${row.key}-${column.key}`,
        label: "",
      };
      const key = `cell-${row.key}-${column.key}`;
      const cellFrame = frame(
        input.frame.x + headerWidth + columnIndex * cellWidth,
        input.frame.y + headerHeight + rowIndex * cellHeight,
        cellWidth,
        cellHeight,
      );
      const fill = cell?.color ? solidFill(cell.color) : surfaceFill;
      children.push(
        shape(input, nodeId(input, key), cellFrame, "rect", fill, stroke(theme)),
        itemText(
          input,
          textId(input, key),
          frame(cellFrame.x + 10, cellFrame.y + 8, cellFrame.w - 20, cellFrame.h - 16),
          value,
          theme,
          cell ? readableTextColor(fill, theme) : bodyText,
          { fontSize: 23 },
        ),
      );
    });
  });
  return children;
}

function expandCycle(input: CycleDiagramInput, theme: ThemeDefinition): DiagramChild[] {
  const count = input.items.length;
  const nodeWidth = Math.min(280, Math.max(120, input.frame.w * 0.22));
  const nodeHeight = Math.min(160, Math.max(90, input.frame.h * 0.2));
  const centerX = input.frame.x + input.frame.w / 2;
  const centerY = input.frame.y + input.frame.h / 2;
  const radiusX = Math.max(1, (input.frame.w - nodeWidth) / 2 - 20);
  const radiusY = Math.max(1, (input.frame.h - nodeHeight) / 2 - 20);
  const nodes = input.items.map((item, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    const x = centerX + Math.cos(angle) * radiusX - nodeWidth / 2;
    const y = centerY + Math.sin(angle) * radiusY - nodeHeight / 2;
    return {
      item,
      center: { x: x + nodeWidth / 2, y: y + nodeHeight / 2 },
      frame: frame(x, y, nodeWidth, nodeHeight),
    };
  });
  const children: DiagramChild[] = [];
  nodes.forEach((node, index) => {
    const next = nodes[(index + 1) % nodes.length];
    if (!next) return;
    children.push(
      connector(
        input,
        `${input.id}--connector-${node.item.key}-${next.item.key}`,
        node.center,
        next.center,
        theme,
        { from: nodeId(input, node.item.key), to: nodeId(input, next.item.key) },
      ),
    );
  });
  for (const node of nodes) {
    const fill = itemFill(node.item, theme);
    children.push(
      shape(
        input,
        nodeId(input, node.item.key),
        node.frame,
        "ellipse",
        fill,
        stroke(theme),
      ),
      itemText(
        input,
        textId(input, node.item.key),
        frame(
          node.frame.x + 18,
          node.frame.y + 12,
          node.frame.w - 36,
          node.frame.h - 24,
        ),
        node.item,
        theme,
        readableTextColor(fill, theme),
        { fontSize: 24 },
      ),
    );
  }
  return children;
}

function expandFunnel(
  input: FunnelDiagramInput,
  theme: ThemeDefinition,
): DiagramChild[] {
  const count = input.items.length;
  const gap = Math.min(28, input.frame.h * 0.025);
  const stageHeight = (input.frame.h - gap * (count - 1)) / count;
  const palette = [
    color(theme, "brand", "#2857D9"),
    color(theme, "accent", "#00A58E"),
    color(theme, "brandSoft", "#EAF0FF"),
    color(theme, "surface", "#F5F7FA"),
  ];
  const nodes = input.items.map((item, index) => {
    const progress = count === 1 ? 0 : index / (count - 1);
    const width = input.frame.w * (0.94 - progress * 0.46);
    return {
      item,
      frame: frame(
        input.frame.x + (input.frame.w - width) / 2,
        input.frame.y + index * (stageHeight + gap),
        width,
        stageHeight,
      ),
      fill: solidFill(item.color ?? palette[index % palette.length] ?? "#EAF0FF"),
    };
  });
  const children: DiagramChild[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    if (!previous || !current) continue;
    children.push(
      connector(
        input,
        `${input.id}--connector-${index - 1}-${index}`,
        {
          x: previous.frame.x + previous.frame.w / 2,
          y: previous.frame.y + previous.frame.h,
        },
        { x: current.frame.x + current.frame.w / 2, y: current.frame.y },
        theme,
        { from: nodeId(input, previous.item.key), to: nodeId(input, current.item.key) },
      ),
    );
  }
  for (const node of nodes) {
    children.push(
      shape(
        input,
        nodeId(input, node.item.key),
        node.frame,
        "roundRect",
        node.fill,
        stroke(theme),
      ),
      itemText(
        input,
        textId(input, node.item.key),
        frame(
          node.frame.x + 18,
          node.frame.y + Math.min(8, node.frame.h * 0.15),
          Math.max(1, node.frame.w - 36),
          Math.max(1, node.frame.h - Math.min(16, node.frame.h * 0.3)),
        ),
        node.item,
        theme,
        readableTextColor(node.fill, theme),
        { fontSize: 25 },
      ),
    );
  }
  return children;
}

function orgLevels(input: OrgChartDiagramInput): OrgChartItemInput[][] {
  const root = input.items.find((item) => item.parentKey === undefined);
  if (!root) return [];
  const levels: OrgChartItemInput[][] = [[root]];
  const visited = new Set([root.key]);
  for (let depth = 0; depth < input.items.length; depth += 1) {
    const current = levels[depth];
    if (!current) break;
    const next = current.flatMap((parent) =>
      input.items.filter(
        (candidate) =>
          candidate.parentKey === parent.key && !visited.has(candidate.key),
      ),
    );
    if (next.length === 0) break;
    for (const item of next) visited.add(item.key);
    levels.push(next);
  }
  return levels;
}

function expandOrgChart(
  input: OrgChartDiagramInput,
  theme: ThemeDefinition,
): DiagramChild[] {
  const levels = orgLevels(input);
  const verticalGap = Math.min(
    70,
    input.frame.h * 0.06,
    input.frame.h / Math.max(1, levels.length * 4),
  );
  const nodeHeight = Math.min(
    150,
    (input.frame.h - verticalGap * Math.max(0, levels.length - 1)) / levels.length,
  );
  const maxAcross = Math.max(...levels.map((level) => level.length));
  const horizontalGap = Math.min(54, input.frame.w * 0.035);
  const nodeWidth = Math.min(
    300,
    (input.frame.w - horizontalGap * Math.max(0, maxAcross - 1)) / maxAcross,
  );
  const nodeFrames = new Map<string, FrameIR>();
  levels.forEach((level, depth) => {
    const totalWidth =
      level.length * nodeWidth + Math.max(0, level.length - 1) * horizontalGap;
    const startX = input.frame.x + (input.frame.w - totalWidth) / 2;
    const y = input.frame.y + depth * (nodeHeight + verticalGap);
    level.forEach((item, index) => {
      nodeFrames.set(
        item.key,
        frame(startX + index * (nodeWidth + horizontalGap), y, nodeWidth, nodeHeight),
      );
    });
  });
  const children: DiagramChild[] = [];
  for (const item of input.items) {
    if (!item.parentKey) continue;
    const parentFrame = nodeFrames.get(item.parentKey);
    const childFrame = nodeFrames.get(item.key);
    if (!parentFrame || !childFrame) continue;
    children.push(
      connector(
        input,
        `${input.id}--connector-${item.parentKey}-${item.key}`,
        { x: parentFrame.x + parentFrame.w / 2, y: parentFrame.y + parentFrame.h },
        { x: childFrame.x + childFrame.w / 2, y: childFrame.y },
        theme,
        { from: nodeId(input, item.parentKey), to: nodeId(input, item.key) },
        "none",
      ),
    );
  }
  for (const [depth, level] of levels.entries()) {
    for (const item of level) {
      const nodeFrame = nodeFrames.get(item.key);
      if (!nodeFrame) continue;
      const fill = item.color
        ? solidFill(item.color)
        : depth === 0
          ? solidFill(color(theme, "brand", "#2857D9"))
          : depth === 1
            ? solidFill(color(theme, "brandSoft", "#EAF0FF"))
            : solidFill(color(theme, "surface", "#F5F7FA"));
      children.push(
        shape(
          input,
          nodeId(input, item.key),
          nodeFrame,
          "roundRect",
          fill,
          stroke(theme),
        ),
        itemText(
          input,
          textId(input, item.key),
          frame(
            nodeFrame.x + Math.min(16, nodeFrame.w * 0.08),
            nodeFrame.y + Math.min(10, nodeFrame.h * 0.15),
            Math.max(1, nodeFrame.w - Math.min(32, nodeFrame.w * 0.16)),
            Math.max(1, nodeFrame.h - Math.min(20, nodeFrame.h * 0.3)),
          ),
          item,
          theme,
          readableTextColor(fill, theme),
          { fontSize: 24 },
        ),
      );
    }
  }
  return children;
}

/**
 * Expands a semantic diagram preset into editable native Group/Shape/Text/Connector IR.
 * Child frames are absolute canvas coordinates; the Group is a logical container only.
 */
export function expandDiagramPreset(
  input: DiagramPresetInput,
  theme: ThemeDefinition,
): GroupElementIR {
  const issues = validateDiagramPresetInput(input);
  if (issues.length > 0) throw new DiagramPresetValidationError(issues);

  let children: DiagramChild[];
  switch (input.kind) {
    case "flow":
      children = expandFlow(input, theme);
      break;
    case "timeline":
      children = expandTimeline(input, theme);
      break;
    case "matrix":
      children = expandMatrix(input, theme);
      break;
    case "cycle":
      children = expandCycle(input, theme);
      break;
    case "funnel":
      children = expandFunnel(input, theme);
      break;
    case "orgChart":
      children = expandOrgChart(input, theme);
      break;
  }

  return {
    id: input.id,
    type: "group",
    frame: cloneFrame(input.frame),
    rotation: 0,
    zIndex: input.zIndex ?? 20,
    opacity: 1,
    editable: true,
    ...(input.alt ? { alt: input.alt } : {}),
    sourceLocation: location(input.sourceLocation),
    children,
  };
}
