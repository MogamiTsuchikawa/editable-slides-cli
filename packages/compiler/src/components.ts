import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChartElementIR,
  ChartSeriesIR,
  ConnectorElementIR,
  Diagnostic,
  ElementBase,
  ElementIR,
  FillIR,
  FrameIR,
  GroupElementIR,
  IconElementIR,
  ImageElementIR,
  LineElementIR,
  ParagraphIR,
  ShapeElementIR,
  StrokeIR,
  TableElementIR,
  TextElementIR,
  TextStyleIR,
} from "@livetoon/slide-deck-ir";
import type {
  LayoutDefinition,
  ThemeDefinition,
  TypographyRole,
} from "@livetoon/slide-theme-default";

import { createDiagnostic } from "./diagnostics.js";
import { markdownNodesToParagraphs } from "./markdown.js";
import type { AstNode } from "./mdx-ast.js";
import { parseComponentProps, sourceLocationForNode } from "./mdx-ast.js";
import type { StaticValue } from "./static-expression.js";
import type { EmbeddedAsset } from "./types.js";

export const ALLOWED_COMPONENTS = new Set([
  "Slot",
  "Text",
  "Image",
  "Shape",
  "Line",
  "Connector",
  "Group",
  "Table",
  "Chart",
  "Icon",
  "Spacer",
]);

const COMMON_PROPS = [
  "id",
  "x",
  "y",
  "w",
  "h",
  "slot",
  "rotation",
  "zIndex",
  "opacity",
  "locked",
  "editable",
  "fallbackReason",
  "alt",
] as const;

const COMPONENT_PROPS: Record<string, ReadonlySet<string>> = {
  Text: new Set([
    ...COMMON_PROPS,
    "role",
    "fontFace",
    "fontSize",
    "color",
    "fontWeight",
    "lineHeight",
    "align",
    "verticalAlign",
    "textFit",
  ]),
  Image: new Set([...COMMON_PROPS, "src", "fit", "role"]),
  Shape: new Set([...COMMON_PROPS, "shape", "fill", "noFill", "stroke", "strokeWidth"]),
  Line: new Set([...COMMON_PROPS, "x1", "y1", "x2", "y2", "color", "width"]),
  Connector: new Set([
    ...COMMON_PROPS,
    "x1",
    "y1",
    "x2",
    "y2",
    "color",
    "width",
    "from",
    "to",
  ]),
  Group: new Set(COMMON_PROPS),
  Table: new Set([...COMMON_PROPS, "headers", "rows", "dataSrc"]),
  Chart: new Set([
    ...COMMON_PROPS,
    "type",
    "chartType",
    "data",
    "dataSrc",
    "series",
    "seriesName",
    "title",
    "showLegend",
    "showValue",
  ]),
  Icon: new Set([...COMMON_PROPS, "src", "color"]),
  Spacer: new Set(["size"]),
};

export interface ComponentCompilationContext {
  sourcePath: string;
  deckDirectory: string;
  slideId: string;
  theme: ThemeDefinition;
  layout: LayoutDefinition;
  diagnostics: Diagnostic[];
  defaultSlot?: string;
  embeddedAssets?: ReadonlyMap<string, EmbeddedAsset>;
}

type Props = Record<string, StaticValue>;

function addPropError(
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
  message: string,
  elementId?: string,
): void {
  context.diagnostics.push(
    createDiagnostic({
      severity: "error",
      code: "MDX_COMPONENT_PROPS_INVALID",
      message: `${component}: ${message}`,
      sourceLocation: sourceLocationForNode(node, context.sourcePath),
      slideId: context.slideId,
      elementId,
    }),
  );
}

function stringProp(
  props: Props,
  name: string,
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
  required = false,
): string | undefined {
  const value = props[name];
  if (value === undefined) {
    if (required) {
      addPropError(context, node, component, `"${name}" is required`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    addPropError(context, node, component, `"${name}" must be a string`);
    return undefined;
  }
  return value;
}

function numberProp(
  props: Props,
  name: string,
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
): number | undefined {
  const value = props[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addPropError(context, node, component, `"${name}" must be a finite number`);
    return undefined;
  }
  return value;
}

function booleanProp(
  props: Props,
  name: string,
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
): boolean | undefined {
  const value = props[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    addPropError(context, node, component, `"${name}" must be a boolean`);
    return undefined;
  }
  return value;
}

function isObject(value: StaticValue | undefined): value is {
  [key: string]: StaticValue;
} {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isColor(value: string): boolean {
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
}

function colorProp(
  props: Props,
  name: string,
  fallback: string,
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
): string {
  const value = stringProp(props, name, context, node, component);
  if (value === undefined) {
    return fallback;
  }
  if (!isColor(value)) {
    addPropError(context, node, component, `"${name}" must use #RRGGBB or #RRGGBBAA`);
    return fallback;
  }
  return value;
}

function resolveFrame(
  props: Props,
  node: AstNode,
  component: string,
  context: ComponentCompilationContext,
): { frame: FrameIR; zIndex: number } | undefined {
  const x = numberProp(props, "x", context, node, component);
  const y = numberProp(props, "y", context, node, component);
  const w = numberProp(props, "w", context, node, component);
  const h = numberProp(props, "h", context, node, component);
  const explicit = [x, y, w, h].filter((value) => value !== undefined).length;
  if (explicit > 0) {
    if (explicit !== 4 || x === undefined || y === undefined || !w || !h) {
      addPropError(
        context,
        node,
        component,
        "x, y, w and h must be specified together and w/h must be positive",
      );
      return undefined;
    }
    return {
      frame: { x, y, w, h },
      zIndex: numberProp(props, "zIndex", context, node, component) ?? 20,
    };
  }

  const slotName =
    stringProp(props, "slot", context, node, component) ?? context.defaultSlot;
  if (!slotName) {
    addPropError(
      context,
      node,
      component,
      "provide x/y/w/h or assign the element to a layout slot",
    );
    return undefined;
  }
  const slot = context.layout.slots[slotName];
  if (!slot) {
    addPropError(
      context,
      node,
      component,
      `layout "${context.layout.id}" has no slot "${slotName}"`,
    );
    return undefined;
  }
  return {
    frame: { ...slot.frame },
    zIndex: numberProp(props, "zIndex", context, node, component) ?? slot.zIndex,
  };
}

function createBase(
  props: Props,
  node: AstNode,
  component: string,
  context: ComponentCompilationContext,
  frame: FrameIR,
  zIndex: number,
): ElementBase | undefined {
  const id = stringProp(props, "id", context, node, component, true);
  if (!id) {
    return undefined;
  }
  const editable = booleanProp(props, "editable", context, node, component) ?? true;
  const fallbackReason = stringProp(props, "fallbackReason", context, node, component);
  if (!editable && !fallbackReason) {
    addPropError(
      context,
      node,
      component,
      'editable={false} requires a non-empty "fallbackReason"',
      id,
    );
  }

  const base: ElementBase = {
    id,
    frame,
    rotation: numberProp(props, "rotation", context, node, component) ?? 0,
    zIndex,
    opacity: numberProp(props, "opacity", context, node, component) ?? 1,
    editable,
    sourceLocation: sourceLocationForNode(node, context.sourcePath),
  };
  const locked = booleanProp(props, "locked", context, node, component);
  const alt = stringProp(props, "alt", context, node, component);
  if (locked !== undefined) {
    base.locked = locked;
  }
  if (fallbackReason) {
    base.fallbackReason = fallbackReason;
  }
  if (alt) {
    base.alt = alt;
  }
  return base;
}

function roleFor(
  props: Props,
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
): TypographyRole {
  const value = stringProp(props, "role", context, node, component);
  if (
    value === "title" ||
    value === "heading" ||
    value === "body" ||
    value === "caption" ||
    value === "code"
  ) {
    return value;
  }
  if (value !== undefined) {
    addPropError(context, node, component, `"role" has unsupported value ${value}`);
  }
  const slotName =
    stringProp(props, "slot", context, node, component) ?? context.defaultSlot;
  return slotName ? (context.layout.slots[slotName]?.typography ?? "body") : "body";
}

function textStyleFromProps(
  props: Props,
  base: TextStyleIR,
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
): TextStyleIR {
  const align = stringProp(props, "align", context, node, component);
  const verticalAlign = stringProp(props, "verticalAlign", context, node, component);
  const textFit = stringProp(props, "textFit", context, node, component);
  const style: TextStyleIR = {
    ...base,
    fontFace: stringProp(props, "fontFace", context, node, component) ?? base.fontFace,
    fontSize: numberProp(props, "fontSize", context, node, component) ?? base.fontSize,
    color: colorProp(props, "color", base.color, context, node, component),
    fontWeight:
      numberProp(props, "fontWeight", context, node, component) ?? base.fontWeight,
    lineHeight:
      numberProp(props, "lineHeight", context, node, component) ?? base.lineHeight,
  };
  if (
    align === "left" ||
    align === "center" ||
    align === "right" ||
    align === "justify"
  ) {
    style.align = align;
  } else if (align !== undefined) {
    addPropError(context, node, component, `"align" has unsupported value ${align}`);
  }
  if (
    verticalAlign === "top" ||
    verticalAlign === "middle" ||
    verticalAlign === "bottom"
  ) {
    style.verticalAlign = verticalAlign;
  } else if (verticalAlign !== undefined) {
    addPropError(
      context,
      node,
      component,
      `"verticalAlign" has unsupported value ${verticalAlign}`,
    );
  }
  if (textFit === "none" || textFit === "shrink") {
    style.textFit = textFit;
  } else if (textFit !== undefined) {
    addPropError(
      context,
      node,
      component,
      `"textFit" has unsupported value ${textFit}`,
    );
  }
  return style;
}

async function resolveAsset(
  rawSource: string,
  node: AstNode,
  component: string,
  context: ComponentCompilationContext,
): Promise<{ src: string; contentHash: string; mimeType?: string } | undefined> {
  if (rawSource.startsWith("asset:")) {
    const assetId = rawSource.slice("asset:".length);
    const embedded = context.embeddedAssets?.get(assetId);
    if (!embedded) {
      addPropError(
        context,
        node,
        component,
        `embedded asset "${assetId}" is not declared in Assets`,
      );
      return undefined;
    }
    return {
      src: embedded.dataUri,
      contentHash: embedded.contentHash,
      mimeType: embedded.mimeType,
    };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawSource) || rawSource.startsWith("//")) {
    addPropError(
      context,
      node,
      component,
      "remote URLs are forbidden; store the asset inside the deck directory",
    );
    return undefined;
  }
  const resolved = path.resolve(path.dirname(context.sourcePath), rawSource);
  const relative = path.relative(context.deckDirectory, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    addPropError(
      context,
      node,
      component,
      "asset paths must stay inside the deck directory",
    );
    return undefined;
  }
  try {
    const data = await readFile(resolved);
    const extension = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    const result: { src: string; contentHash: string; mimeType?: string } = {
      src: resolved,
      contentHash: createHash("sha256").update(data).digest("hex"),
    };
    const mimeType = mimeTypes[extension];
    if (mimeType) {
      result.mimeType = mimeType;
    }
    return result;
  } catch (error) {
    addPropError(
      context,
      node,
      component,
      `cannot read asset "${rawSource}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw new Error("CSV contains an unterminated quoted field");
  }
  row.push(cell);
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }
  return rows;
}

async function loadDataSource(
  dataSource: string,
  node: AstNode,
  component: string,
  context: ComponentCompilationContext,
): Promise<StaticValue | undefined> {
  const resolved = path.resolve(path.dirname(context.sourcePath), dataSource);
  const relative = path.relative(context.deckDirectory, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    addPropError(
      context,
      node,
      component,
      "dataSrc must stay inside the deck directory",
    );
    return undefined;
  }
  try {
    const source = await readFile(resolved, "utf8");
    if (path.extname(resolved).toLowerCase() === ".json") {
      return JSON.parse(source) as StaticValue;
    }
    if (path.extname(resolved).toLowerCase() === ".csv") {
      const rows = csvRows(source);
      const headers = rows.shift() ?? [];
      return rows.map((row) =>
        Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
      );
    }
    addPropError(
      context,
      node,
      component,
      "dataSrc must point to a .json or .csv file",
    );
  } catch (error) {
    addPropError(
      context,
      node,
      component,
      `cannot read dataSrc "${dataSource}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return undefined;
}

function cellParagraph(value: StaticValue): ParagraphIR {
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : value === null
        ? ""
        : JSON.stringify(value);
  return { runs: [{ text }] };
}

async function compileText(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<TextElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Text", context);
  if (!resolvedFrame) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Text",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) {
    return undefined;
  }
  const role = roleFor(props, context, node, "Text");
  const conversion = markdownNodesToParagraphs(
    node.children ?? [],
    context.sourcePath,
    context.slideId,
  );
  context.diagnostics.push(...conversion.diagnostics);
  return {
    ...base,
    type: "text",
    role,
    paragraphs: conversion.paragraphs,
    style: textStyleFromProps(
      props,
      context.theme.ir.typography[role],
      context,
      node,
      "Text",
    ),
  };
}

async function compileImage(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<ImageElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Image", context);
  const rawSource = stringProp(props, "src", context, node, "Image", true);
  if (!resolvedFrame || !rawSource) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Image",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  const asset = await resolveAsset(rawSource, node, "Image", context);
  if (!base || !asset) {
    return undefined;
  }
  const fit = stringProp(props, "fit", context, node, "Image") ?? "contain";
  if (fit !== "contain" && fit !== "cover" && fit !== "crop") {
    addPropError(context, node, "Image", `"fit" has unsupported value ${fit}`);
    return undefined;
  }
  const role = stringProp(props, "role", context, node, "Image");
  if (role !== undefined && role !== "content" && role !== "background") {
    addPropError(context, node, "Image", `"role" has unsupported value ${role}`);
  }
  const image: ImageElementIR = {
    ...base,
    type: "image",
    src: asset.src,
    contentHash: asset.contentHash,
    fit,
  };
  if (asset.mimeType) {
    image.mimeType = asset.mimeType;
  }
  if (role === "content" || role === "background") {
    image.role = role;
  }
  return image;
}

function compileShape(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): ShapeElementIR | undefined {
  const resolvedFrame = resolveFrame(props, node, "Shape", context);
  if (!resolvedFrame) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Shape",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) {
    return undefined;
  }
  const shape = stringProp(props, "shape", context, node, "Shape") ?? "rect";
  if (
    shape !== "rect" &&
    shape !== "roundRect" &&
    shape !== "ellipse" &&
    shape !== "triangle"
  ) {
    addPropError(context, node, "Shape", `"shape" has unsupported value ${shape}`);
    return undefined;
  }
  const fill: FillIR =
    booleanProp(props, "noFill", context, node, "Shape") === true
      ? { type: "none" }
      : {
          type: "solid",
          color: colorProp(
            props,
            "fill",
            context.theme.ir.colors.brandSoft ?? "#EAF0FF",
            context,
            node,
            "Shape",
          ),
        };
  const strokeWidth =
    numberProp(props, "strokeWidth", context, node, "Shape") ??
    context.theme.defaults.shape.stroke.width;
  const shapeElement: ShapeElementIR = {
    ...base,
    type: "shape",
    shape,
    fill,
  };
  if (strokeWidth > 0) {
    shapeElement.stroke = {
      color: colorProp(
        props,
        "stroke",
        context.theme.defaults.shape.stroke.color,
        context,
        node,
        "Shape",
      ),
      width: strokeWidth,
      dash: context.theme.defaults.shape.stroke.dash,
    };
  }
  return shapeElement;
}

function lineCoordinates(
  props: Props,
  node: AstNode,
  component: string,
  context: ComponentCompilationContext,
):
  | {
      start: { x: number; y: number };
      end: { x: number; y: number };
      frame: FrameIR;
    }
  | undefined {
  const x1 = numberProp(props, "x1", context, node, component);
  const y1 = numberProp(props, "y1", context, node, component);
  const x2 = numberProp(props, "x2", context, node, component);
  const y2 = numberProp(props, "y2", context, node, component);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    addPropError(context, node, component, "x1, y1, x2 and y2 are required");
    return undefined;
  }
  return {
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    frame: {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.max(1, Math.abs(x2 - x1)),
      h: Math.max(1, Math.abs(y2 - y1)),
    },
  };
}

function lineStroke(
  props: Props,
  node: AstNode,
  component: string,
  context: ComponentCompilationContext,
): StrokeIR {
  return {
    color: colorProp(
      props,
      "color",
      context.theme.ir.colors.text ?? "#172033",
      context,
      node,
      component,
    ),
    width: numberProp(props, "width", context, node, component) ?? 2,
    dash: "solid",
  };
}

function compileLine(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): LineElementIR | undefined {
  const coordinates = lineCoordinates(props, node, "Line", context);
  if (!coordinates) {
    return undefined;
  }
  const zIndex = numberProp(props, "zIndex", context, node, "Line") ?? 20;
  const base = createBase(props, node, "Line", context, coordinates.frame, zIndex);
  if (!base) {
    return undefined;
  }
  return {
    ...base,
    type: "line",
    start: coordinates.start,
    end: coordinates.end,
    stroke: lineStroke(props, node, "Line", context),
  };
}

function compileConnector(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): ConnectorElementIR | undefined {
  const coordinates = lineCoordinates(props, node, "Connector", context);
  if (!coordinates) {
    return undefined;
  }
  const zIndex = numberProp(props, "zIndex", context, node, "Connector") ?? 5;
  const base = createBase(props, node, "Connector", context, coordinates.frame, zIndex);
  if (!base) {
    return undefined;
  }
  const connector: ConnectorElementIR = {
    ...base,
    type: "connector",
    start: coordinates.start,
    end: coordinates.end,
    stroke: lineStroke(props, node, "Connector", context),
    endArrow: "triangle",
  };
  const fromElementId = stringProp(props, "from", context, node, "Connector");
  const toElementId = stringProp(props, "to", context, node, "Connector");
  if (fromElementId) {
    connector.fromElementId = fromElementId;
  }
  if (toElementId) {
    connector.toElementId = toElementId;
  }
  return connector;
}

async function tableData(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<{ headers: StaticValue[]; rows: StaticValue[][] } | undefined> {
  let data = props.rows;
  const dataSource = stringProp(props, "dataSrc", context, node, "Table");
  if (dataSource) {
    data = await loadDataSource(dataSource, node, "Table", context);
  }
  const headerProp = props.headers;
  if (Array.isArray(data) && data.every((row) => Array.isArray(row))) {
    return {
      headers: Array.isArray(headerProp) ? headerProp : [],
      rows: data as StaticValue[][],
    };
  }
  if (Array.isArray(data) && data.every((row) => isObject(row))) {
    const objects = data as Array<Record<string, StaticValue>>;
    const headers = Array.isArray(headerProp)
      ? headerProp
      : Object.keys(objects[0] ?? {});
    return {
      headers,
      rows: objects.map((row) => headers.map((header) => row[String(header)] ?? null)),
    };
  }
  addPropError(
    context,
    node,
    "Table",
    'provide "rows" as an array of arrays/objects or use dataSrc',
  );
  return undefined;
}

async function compileTable(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<TableElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Table", context);
  const data = await tableData(node, props, context);
  if (!resolvedFrame || !data) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Table",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) {
    return undefined;
  }
  const rows = data.rows.map((row) => ({
    cells: row.map((value) => ({ paragraphs: [cellParagraph(value)] })),
  }));
  if (data.headers.length > 0) {
    rows.unshift({
      cells: data.headers.map((value) => ({
        paragraphs: [cellParagraph(value)],
        textStyle: { fontWeight: 700 },
      })),
    });
  }
  return {
    ...base,
    type: "table",
    rows,
    style: structuredClone(context.theme.defaults.table),
  };
}

function chartSeriesFromData(
  data: StaticValue | undefined,
  props: Props,
  node: AstNode,
  context: ComponentCompilationContext,
): ChartSeriesIR[] | undefined {
  if (Array.isArray(data) && data.every((row) => isObject(row))) {
    const rows = data as Array<Record<string, StaticValue>>;
    const labels: string[] = [];
    const values: number[] = [];
    for (const row of rows) {
      const label = row.label ?? row.category ?? row.name;
      const value = row.value;
      if (
        !(
          typeof label === "string" ||
          typeof label === "number" ||
          typeof label === "boolean"
        ) ||
        (typeof value !== "number" && typeof value !== "string")
      ) {
        addPropError(
          context,
          node,
          "Chart",
          "data rows require label/category/name and numeric value",
        );
        return undefined;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        addPropError(context, node, "Chart", `value is not numeric: ${value}`);
        return undefined;
      }
      labels.push(String(label));
      values.push(numeric);
    }
    return [
      {
        name: typeof props.seriesName === "string" ? props.seriesName : "Series 1",
        labels,
        values,
      },
    ];
  }
  addPropError(
    context,
    node,
    "Chart",
    "data must be an array of { label, value } objects",
  );
  return undefined;
}

function chartSeriesFromSeriesProp(
  data: StaticValue,
  node: AstNode,
  context: ComponentCompilationContext,
): ChartSeriesIR[] | undefined {
  if (!Array.isArray(data) || !data.every((series) => isObject(series))) {
    addPropError(context, node, "Chart", "series must be an array of objects");
    return undefined;
  }
  const result: ChartSeriesIR[] = [];
  for (const raw of data as Array<Record<string, StaticValue>>) {
    if (
      typeof raw.name !== "string" ||
      !Array.isArray(raw.labels) ||
      !Array.isArray(raw.values) ||
      !raw.labels.every(
        (value) =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      ) ||
      !raw.values.every((value) => typeof value === "number")
    ) {
      addPropError(
        context,
        node,
        "Chart",
        "each series requires name, labels[] and numeric values[]",
      );
      return undefined;
    }
    if (raw.labels.length !== raw.values.length) {
      addPropError(
        context,
        node,
        "Chart",
        `series "${raw.name}" labels and values must have equal length`,
      );
      return undefined;
    }
    const series: ChartSeriesIR = {
      name: raw.name,
      labels: raw.labels.map(String),
      values: raw.values as number[],
    };
    if (typeof raw.color === "string" && isColor(raw.color)) {
      series.color = raw.color;
    }
    result.push(series);
  }
  return result;
}

async function compileChart(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<ChartElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Chart", context);
  if (!resolvedFrame) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Chart",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) {
    return undefined;
  }
  const chartType =
    stringProp(props, "type", context, node, "Chart") ??
    stringProp(props, "chartType", context, node, "Chart") ??
    "bar";
  if (chartType !== "bar" && chartType !== "line" && chartType !== "pie") {
    addPropError(context, node, "Chart", `"type" has unsupported value ${chartType}`);
    return undefined;
  }

  let data = props.data;
  const dataSource = stringProp(props, "dataSrc", context, node, "Chart");
  if (dataSource) {
    data = await loadDataSource(dataSource, node, "Chart", context);
  }
  const series =
    props.series !== undefined
      ? chartSeriesFromSeriesProp(props.series, node, context)
      : chartSeriesFromData(data, props, node, context);
  if (!series) {
    return undefined;
  }
  const title = stringProp(props, "title", context, node, "Chart");
  const chart: ChartElementIR = {
    ...base,
    type: "chart",
    chartType,
    series,
    style: {
      ...structuredClone(context.theme.defaults.chart),
      showLegend:
        booleanProp(props, "showLegend", context, node, "Chart") ??
        context.theme.defaults.chart.showLegend,
      showValue:
        booleanProp(props, "showValue", context, node, "Chart") ??
        context.theme.defaults.chart.showValue,
    },
  };
  if (title) {
    chart.title = title;
    chart.style.showTitle = true;
  }
  return chart;
}

async function compileIcon(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<IconElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Icon", context);
  const rawSource = stringProp(props, "src", context, node, "Icon", true);
  if (!resolvedFrame || !rawSource) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Icon",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  const asset = await resolveAsset(rawSource, node, "Icon", context);
  if (!base || !asset) {
    return undefined;
  }
  const icon: IconElementIR = {
    ...base,
    type: "icon",
    src: asset.src,
    contentHash: asset.contentHash,
  };
  const colorValue = stringProp(props, "color", context, node, "Icon");
  if (colorValue && isColor(colorValue)) {
    icon.color = colorValue;
  } else if (colorValue) {
    addPropError(context, node, "Icon", '"color" must use #RRGGBB');
  }
  return icon;
}

async function compileGroup(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<GroupElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Group", context);
  if (!resolvedFrame) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Group",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) {
    return undefined;
  }
  const children: ElementIR[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== "mdxJsxFlowElement" && child.type !== "mdxJsxTextElement") {
      if (child.type !== "text" || (child.value ?? "").trim() !== "") {
        addPropError(
          context,
          child,
          "Group",
          "groups may contain only supported JSX elements",
          base.id,
        );
      }
      continue;
    }
    const element = await compileComponent(child, {
      ...context,
      defaultSlot: undefined,
    });
    if (element) {
      children.push(element);
    }
  }
  return { ...base, type: "group", children };
}

export async function compileComponent(
  node: AstNode,
  context: ComponentCompilationContext,
): Promise<ElementIR | undefined> {
  const component = node.name;
  if (!component || !ALLOWED_COMPONENTS.has(component)) {
    context.diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "MDX_COMPONENT_UNKNOWN",
        message: `Unknown component: ${component ?? "<anonymous>"}`,
        sourceLocation: sourceLocationForNode(node, context.sourcePath),
        slideId: context.slideId,
      }),
    );
    return undefined;
  }

  const parsed = parseComponentProps(node, context.sourcePath, context.slideId);
  context.diagnostics.push(...parsed.diagnostics);
  const props = parsed.props;
  const allowedProps = COMPONENT_PROPS[component];
  for (const name of Object.keys(props)) {
    if (!allowedProps?.has(name)) {
      context.diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_COMPONENT_PROP_UNKNOWN",
          message: `${component}: unknown prop "${name}"`,
          sourceLocation: sourceLocationForNode(node, context.sourcePath),
          slideId: context.slideId,
          elementId: typeof props.id === "string" ? props.id : undefined,
        }),
      );
    }
  }

  switch (component) {
    case "Text":
      return compileText(node, props, context);
    case "Image":
      return compileImage(node, props, context);
    case "Shape":
      return compileShape(node, props, context);
    case "Line":
      return compileLine(node, props, context);
    case "Connector":
      return compileConnector(node, props, context);
    case "Table":
      return compileTable(node, props, context);
    case "Chart":
      return compileChart(node, props, context);
    case "Icon":
      return compileIcon(node, props, context);
    case "Group":
      return compileGroup(node, props, context);
    case "Slot":
      addPropError(context, node, component, "nested Slot is not allowed");
      return undefined;
    case "Spacer":
      return undefined;
  }
}
