import {
  type AudioElementIR,
  type ChartElementIR,
  type ChartSeriesIR,
  type ConnectorElementIR,
  type Diagnostic,
  type ElementBase,
  type ElementIR,
  type FillIR,
  type FocalPositionIR,
  type FrameIR,
  type GroupElementIR,
  type IconElementIR,
  type ImageCropIR,
  type ImageElementIR,
  type ImageMaskIR,
  type ImageShadowIR,
  type LineElementIR,
  MAX_TABLE_CELL_SPAN,
  type ParagraphIR,
  type ShapeElementIR,
  type StrokeIR,
  type TableCellIR,
  type TableElementIR,
  type TableNumberFormatIR,
  type TableRowIR,
  type TextElementIR,
  type TextStyleIR,
  tableDimensionsMatch,
  type VideoElementIR,
  validateChartContract,
  validateTableGrid,
} from "@livetoon/slide-deck-ir";
import type {
  LayoutDefinition,
  ThemeDefinition,
  TypographyRole,
} from "@livetoon/slide-theme-default";

import { validateVisualAlternative } from "./accessibility.js";
import {
  type CodeBlockInput,
  CodeBlockValidationError,
  expandCodeBlock,
} from "./code-block.js";
import { createDiagnostic } from "./diagnostics.js";
import {
  type DiagramPresetInput,
  DiagramPresetValidationError,
  expandDiagramPreset,
} from "./diagram-presets.js";
import { markdownNodesToParagraphs } from "./markdown.js";
import type { AstNode } from "./mdx-ast.js";
import { parseComponentProps, sourceLocationForNode } from "./mdx-ast.js";
import { readCaptionFile, readMediaFile } from "./media.js";
import {
  DATA_FILE_POLICIES,
  IMAGE_FILE_POLICIES,
  MAX_DATA_SOURCE_BYTES,
  MAX_IMAGE_ASSET_BYTES,
  readSecureDeckFile,
  SecurityValidationError,
  validateEmbeddedAsset,
} from "./security.js";
import type { StaticValue } from "./static-expression.js";
import type { EmbeddedAsset } from "./types.js";

export const ALLOWED_COMPONENTS = new Set([
  "Slot",
  "Text",
  "Image",
  "Video",
  "Audio",
  "Shape",
  "Line",
  "Connector",
  "Group",
  "Table",
  "Chart",
  "Icon",
  "Flow",
  "Timeline",
  "Matrix",
  "Cycle",
  "Funnel",
  "OrgChart",
  "CodeBlock",
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
  Image: new Set([
    ...COMMON_PROPS,
    "src",
    "fit",
    "role",
    "decorative",
    "crop",
    "focalPosition",
    "mask",
    "cornerRadius",
    "border",
    "shadow",
    "posterFrame",
  ]),
  Video: new Set([
    ...COMMON_PROPS,
    "src",
    "poster",
    "fit",
    "transcript",
    "captions",
    "captionLanguage",
    "captionLabel",
  ]),
  Audio: new Set([
    ...COMMON_PROPS,
    "src",
    "poster",
    "transcript",
    "captions",
    "captionLanguage",
    "captionLabel",
  ]),
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
  Table: new Set([
    ...COMMON_PROPS,
    "headers",
    "rows",
    "dataSrc",
    "columnWidths",
    "rowHeights",
  ]),
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
    "showCategoryName",
    "legendPosition",
    "categoryAxisTitle",
    "valueAxisTitle",
    "valueUnit",
  ]),
  Icon: new Set([...COMMON_PROPS, "src", "color", "decorative"]),
  Flow: new Set([...COMMON_PROPS, "items", "direction"]),
  Timeline: new Set([...COMMON_PROPS, "items"]),
  Matrix: new Set([...COMMON_PROPS, "rows", "columns", "cells"]),
  Cycle: new Set([...COMMON_PROPS, "items"]),
  Funnel: new Set([...COMMON_PROPS, "items"]),
  OrgChart: new Set([...COMMON_PROPS, "items"]),
  CodeBlock: new Set([
    ...COMMON_PROPS,
    "code",
    "language",
    "title",
    "showLineNumbers",
    "highlightLines",
    "padding",
  ]),
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

function addSecurityIssues(
  context: ComponentCompilationContext,
  node: AstNode,
  component: string,
  issues: ReadonlyArray<{ code: string; message: string }>,
  elementId?: string,
): void {
  for (const issue of issues) {
    context.diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: issue.code,
        message: `${component}: ${issue.message}`,
        sourceLocation: sourceLocationForNode(node, context.sourcePath),
        slideId: context.slideId,
        elementId,
      }),
    );
  }
}

function addAccessibilityIssues(
  context: ComponentCompilationContext,
  node: AstNode,
  issues: ReadonlyArray<{
    severity: "error" | "warning" | "info";
    code: string;
    message: string;
  }>,
  elementId?: string,
): void {
  for (const issue of issues) {
    context.diagnostics.push(
      createDiagnostic({
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        sourceLocation: sourceLocationForNode(node, context.sourcePath),
        slideId: context.slideId,
        elementId,
      }),
    );
  }
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

function imageObjectProp(
  props: Props,
  name: string,
  node: AstNode,
  context: ComponentCompilationContext,
): Record<string, StaticValue> | undefined {
  const value = props[name];
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    addPropError(context, node, "Image", `"${name}" must be an object`);
    return undefined;
  }
  return value;
}

function unitObjectValue(
  record: Record<string, StaticValue>,
  key: string,
  fallback: number,
  propName: string,
  node: AstNode,
  context: ComponentCompilationContext,
): number | undefined {
  const value = record[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    addPropError(context, node, "Image", `"${propName}.${key}" must be from 0 to 1`);
    return undefined;
  }
  return value;
}

function imageCropProp(
  props: Props,
  node: AstNode,
  context: ComponentCompilationContext,
): ImageCropIR | undefined {
  const record = imageObjectProp(props, "crop", node, context);
  if (!record) {
    return undefined;
  }
  const left = unitObjectValue(record, "left", 0, "crop", node, context);
  const top = unitObjectValue(record, "top", 0, "crop", node, context);
  const right = unitObjectValue(record, "right", 0, "crop", node, context);
  const bottom = unitObjectValue(record, "bottom", 0, "crop", node, context);
  if (
    left === undefined ||
    top === undefined ||
    right === undefined ||
    bottom === undefined
  ) {
    return undefined;
  }
  if (left + right >= 1 || top + bottom >= 1) {
    addPropError(context, node, "Image", '"crop" must leave a visible area');
    return undefined;
  }
  return { left, top, right, bottom };
}

function focalPositionProp(
  props: Props,
  node: AstNode,
  context: ComponentCompilationContext,
): FocalPositionIR | undefined {
  const record = imageObjectProp(props, "focalPosition", node, context);
  if (!record) {
    return undefined;
  }
  const x = unitObjectValue(record, "x", 0.5, "focalPosition", node, context);
  const y = unitObjectValue(record, "y", 0.5, "focalPosition", node, context);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function imageMaskProp(
  props: Props,
  node: AstNode,
  context: ComponentCompilationContext,
): ImageMaskIR | undefined {
  const mask = stringProp(props, "mask", context, node, "Image");
  const radius = numberProp(props, "cornerRadius", context, node, "Image");
  if (mask === undefined) {
    if (radius !== undefined) {
      addPropError(context, node, "Image", '"cornerRadius" requires mask="roundRect"');
    }
    return undefined;
  }
  if (mask === "circle") {
    if (radius !== undefined) {
      addPropError(
        context,
        node,
        "Image",
        '"cornerRadius" is not used by circle masks',
      );
    }
    return { type: "circle" };
  }
  if (mask === "roundRect") {
    if (radius !== undefined && radius <= 0) {
      addPropError(context, node, "Image", '"cornerRadius" must be positive');
      return undefined;
    }
    return radius === undefined ? { type: "roundRect" } : { type: "roundRect", radius };
  }
  addPropError(context, node, "Image", `"mask" has unsupported value ${mask}`);
  return undefined;
}

function imageBorderProp(
  props: Props,
  node: AstNode,
  context: ComponentCompilationContext,
): StrokeIR | undefined {
  const record = imageObjectProp(props, "border", node, context);
  if (!record) {
    return undefined;
  }
  const color = typeof record.color === "string" ? record.color : "#000000";
  const width = typeof record.width === "number" ? record.width : 1;
  const transparency =
    typeof record.transparency === "number" ? record.transparency : undefined;
  const dash = typeof record.dash === "string" ? record.dash : undefined;
  if (!isColor(color) || !Number.isFinite(width) || width < 0) {
    addPropError(context, node, "Image", '"border" needs a valid color and width');
    return undefined;
  }
  if (
    transparency !== undefined &&
    (!Number.isFinite(transparency) || transparency < 0 || transparency > 1)
  ) {
    addPropError(context, node, "Image", '"border.transparency" must be from 0 to 1');
    return undefined;
  }
  if (dash !== undefined && dash !== "solid" && dash !== "dash" && dash !== "dot") {
    addPropError(context, node, "Image", '"border.dash" is unsupported');
    return undefined;
  }
  return {
    color,
    width,
    ...(transparency === undefined ? {} : { transparency }),
    ...(dash === undefined ? {} : { dash }),
  };
}

function imageShadowProp(
  props: Props,
  node: AstNode,
  context: ComponentCompilationContext,
): ImageShadowIR | undefined {
  const record = imageObjectProp(props, "shadow", node, context);
  if (!record) {
    return undefined;
  }
  const color = typeof record.color === "string" ? record.color : "#000000";
  const opacity = typeof record.opacity === "number" ? record.opacity : 0.25;
  const blur = typeof record.blur === "number" ? record.blur : 12;
  const distance = typeof record.distance === "number" ? record.distance : 6;
  const angle = typeof record.angle === "number" ? record.angle : 45;
  if (
    !isColor(color) ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1 ||
    !Number.isFinite(blur) ||
    blur < 0 ||
    !Number.isFinite(distance) ||
    distance < 0 ||
    !Number.isFinite(angle)
  ) {
    addPropError(context, node, "Image", '"shadow" contains an invalid value');
    return undefined;
  }
  return { color, opacity, blur, distance, angle };
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
  if (alt?.trim()) {
    base.alt = alt.trim();
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
    const issues = validateEmbeddedAsset(embedded.data, embedded.mimeType);
    if (issues.length > 0) {
      addSecurityIssues(context, node, component, issues);
      return undefined;
    }
    return {
      src: embedded.dataUri,
      contentHash: embedded.contentHash,
      mimeType: embedded.mimeType,
    };
  }
  try {
    const asset = await readSecureDeckFile({
      deckDirectory: context.deckDirectory,
      sourcePath: context.sourcePath,
      reference: rawSource,
      allowedExtensions: IMAGE_FILE_POLICIES,
      defaultMaxBytes: MAX_IMAGE_ASSET_BYTES,
    });
    const result: { src: string; contentHash: string; mimeType?: string } = {
      src: asset.path,
      contentHash: asset.contentHash,
    };
    if (asset.mimeType) {
      result.mimeType = asset.mimeType;
    }
    return result;
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      addSecurityIssues(context, node, component, error.issues);
      return undefined;
    }
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
  try {
    const dataFile = await readSecureDeckFile({
      deckDirectory: context.deckDirectory,
      sourcePath: context.sourcePath,
      reference: dataSource,
      allowedExtensions: DATA_FILE_POLICIES,
      defaultMaxBytes: MAX_DATA_SOURCE_BYTES,
    });
    const source = dataFile.data.toString("utf8");
    if (dataFile.extension === ".json") {
      return JSON.parse(source) as StaticValue;
    }
    if (dataFile.extension === ".csv") {
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
    if (error instanceof SecurityValidationError) {
      addSecurityIssues(context, node, component, error.issues);
      return undefined;
    }
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
    { codeFontFace: context.theme.ir.fonts.code.family },
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
  const crop = imageCropProp(props, node, context);
  const focalPosition = focalPositionProp(props, node, context);
  const mask = imageMaskProp(props, node, context);
  const border = imageBorderProp(props, node, context);
  const shadow = imageShadowProp(props, node, context);
  const fit =
    stringProp(props, "fit", context, node, "Image") ?? (crop ? "crop" : "contain");
  if (fit !== "stretch" && fit !== "contain" && fit !== "cover" && fit !== "crop") {
    addPropError(context, node, "Image", `"fit" has unsupported value ${fit}`);
    return undefined;
  }
  if (crop && fit !== "crop") {
    addPropError(context, node, "Image", '"fit" must be "crop" when crop is provided');
    return undefined;
  }
  const role = stringProp(props, "role", context, node, "Image");
  if (role !== undefined && role !== "content" && role !== "background") {
    addPropError(context, node, "Image", `"role" has unsupported value ${role}`);
  }
  const decorative = booleanProp(props, "decorative", context, node, "Image");
  addAccessibilityIssues(
    context,
    node,
    validateVisualAlternative({
      component: "Image",
      alt: typeof props.alt === "string" ? props.alt : undefined,
      decorative,
      background: role === "background",
    }),
    base.id,
  );
  const posterFrameSource = stringProp(props, "posterFrame", context, node, "Image");
  if (props.posterFrame !== undefined && !posterFrameSource) {
    return undefined;
  }
  if (asset.mimeType === "image/gif" && !posterFrameSource) {
    addPropError(
      context,
      node,
      "Image",
      'GIF images require a PNG "posterFrame" for print and PDF output',
      base.id,
    );
    return undefined;
  }
  const posterFrame = posterFrameSource
    ? await resolveAsset(posterFrameSource, node, "Image", context)
    : undefined;
  if (posterFrameSource && !posterFrame) {
    return undefined;
  }
  if (posterFrame && posterFrame.mimeType !== "image/png") {
    addPropError(context, node, "Image", '"posterFrame" must be a PNG image', base.id);
    return undefined;
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
  if (decorative === true || role === "background") {
    image.decorative = true;
  }
  if (crop) {
    image.crop = crop;
  }
  if (focalPosition) {
    image.focalPosition = focalPosition;
  }
  if (mask) {
    image.mask = mask;
  }
  if (border) {
    image.border = border;
  }
  if (shadow) {
    image.shadow = shadow;
  }
  if (posterFrame) {
    image.posterFrame = {
      src: posterFrame.src,
      contentHash: posterFrame.contentHash,
      mimeType: "image/png",
    };
  }
  return image;
}

interface CompiledCaptionTrack {
  captionSrc: string;
  captionContentHash?: string;
  captionMimeType: "text/vtt";
  captionLanguage?: string;
  captionLabel?: string;
}

async function compileCaptionTrack(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
  component: "Video" | "Audio",
  elementId: string,
): Promise<CompiledCaptionTrack | null | undefined> {
  const rawSource = stringProp(props, "captions", context, node, component);
  const rawLanguage = stringProp(props, "captionLanguage", context, node, component);
  const rawLabel = stringProp(props, "captionLabel", context, node, component);

  if (props.captions === undefined) {
    if (props.captionLanguage !== undefined || props.captionLabel !== undefined) {
      addPropError(
        context,
        node,
        component,
        '"captions" is required when caption metadata is provided',
        elementId,
      );
      return null;
    }
    return undefined;
  }
  if (!rawSource?.trim()) {
    if (typeof props.captions === "string") {
      addPropError(
        context,
        node,
        component,
        '"captions" must be a non-empty string',
        elementId,
      );
    }
    return null;
  }
  const captionLanguage = rawLanguage?.trim();
  if (props.captionLanguage !== undefined && !captionLanguage) {
    if (typeof props.captionLanguage === "string") {
      addPropError(
        context,
        node,
        component,
        '"captionLanguage" must be a non-empty string',
        elementId,
      );
    }
    return null;
  }
  const captionLabel = rawLabel?.trim();
  if (props.captionLabel !== undefined && !captionLabel) {
    if (typeof props.captionLabel === "string") {
      addPropError(
        context,
        node,
        component,
        '"captionLabel" must be a non-empty string',
        elementId,
      );
    }
    return null;
  }

  try {
    const caption = await readCaptionFile({
      deckDirectory: context.deckDirectory,
      sourcePath: context.sourcePath,
      reference: rawSource.trim(),
    });
    return {
      captionSrc: caption.path,
      captionContentHash: caption.contentHash,
      captionMimeType: "text/vtt",
      ...(captionLanguage ? { captionLanguage } : {}),
      ...(captionLabel ? { captionLabel } : {}),
    };
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      addSecurityIssues(context, node, component, error.issues, elementId);
    } else {
      addPropError(
        context,
        node,
        component,
        `cannot read captions: ${String(error)}`,
        elementId,
      );
    }
    return null;
  }
}

async function compileVideo(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<VideoElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Video", context);
  const rawSource = stringProp(props, "src", context, node, "Video", true);
  const posterSource = stringProp(props, "poster", context, node, "Video", true);
  if (!resolvedFrame || !rawSource || !posterSource) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Video",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) {
    return undefined;
  }
  const caption = await compileCaptionTrack(node, props, context, "Video", base.id);
  if (caption === null) {
    return undefined;
  }
  const transcript = stringProp(props, "transcript", context, node, "Video")?.trim();
  addAccessibilityIssues(
    context,
    node,
    validateVisualAlternative({
      component: "Video",
      alt: base.alt,
      transcript,
    }),
    base.id,
  );

  let media: Awaited<ReturnType<typeof readMediaFile>>;
  try {
    media = await readMediaFile({
      component: "Video",
      deckDirectory: context.deckDirectory,
      sourcePath: context.sourcePath,
      reference: rawSource,
    });
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      addSecurityIssues(context, node, "Video", error.issues, base.id);
    } else {
      addPropError(
        context,
        node,
        "Video",
        `cannot read media: ${String(error)}`,
        base.id,
      );
    }
    return undefined;
  }
  addAccessibilityIssues(context, node, media.issues, base.id);

  const poster = await resolveAsset(posterSource, node, "Video", context);
  if (!poster) {
    return undefined;
  }
  if (poster.mimeType !== "image/png") {
    addPropError(context, node, "Video", '"poster" must be a PNG image', base.id);
    return undefined;
  }
  if (media.mimeType !== "video/mp4") {
    addPropError(context, node, "Video", '"src" must be an MP4 file', base.id);
    return undefined;
  }
  const fit = stringProp(props, "fit", context, node, "Video") ?? "contain";
  if (fit !== "contain" && fit !== "cover") {
    addPropError(context, node, "Video", `"fit" has unsupported value ${fit}`, base.id);
    return undefined;
  }
  return {
    ...base,
    type: "video",
    src: media.path,
    contentHash: media.contentHash,
    mimeType: "video/mp4",
    byteLength: media.data.byteLength,
    posterSrc: poster.src,
    posterContentHash: poster.contentHash,
    posterMimeType: "image/png",
    ...(caption ?? {}),
    fit,
    ...(transcript ? { transcript } : {}),
  };
}

async function compileAudio(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): Promise<AudioElementIR | undefined> {
  const resolvedFrame = resolveFrame(props, node, "Audio", context);
  const rawSource = stringProp(props, "src", context, node, "Audio", true);
  const posterSource = stringProp(props, "poster", context, node, "Audio");
  if (!resolvedFrame || !rawSource || (props.poster !== undefined && !posterSource)) {
    return undefined;
  }
  const base = createBase(
    props,
    node,
    "Audio",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) {
    return undefined;
  }
  const caption = await compileCaptionTrack(node, props, context, "Audio", base.id);
  if (caption === null) {
    return undefined;
  }
  const transcript = stringProp(props, "transcript", context, node, "Audio")?.trim();
  addAccessibilityIssues(
    context,
    node,
    validateVisualAlternative({
      component: "Audio",
      alt: base.alt,
      transcript,
    }),
    base.id,
  );

  let media: Awaited<ReturnType<typeof readMediaFile>>;
  try {
    media = await readMediaFile({
      component: "Audio",
      deckDirectory: context.deckDirectory,
      sourcePath: context.sourcePath,
      reference: rawSource,
    });
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      addSecurityIssues(context, node, "Audio", error.issues, base.id);
    } else {
      addPropError(
        context,
        node,
        "Audio",
        `cannot read media: ${String(error)}`,
        base.id,
      );
    }
    return undefined;
  }
  addAccessibilityIssues(context, node, media.issues, base.id);
  if (media.mimeType !== "audio/mp4" && media.mimeType !== "audio/mpeg") {
    addPropError(context, node, "Audio", '"src" must be an M4A or MP3 file', base.id);
    return undefined;
  }

  const audio: AudioElementIR = {
    ...base,
    type: "audio",
    src: media.path,
    contentHash: media.contentHash,
    mimeType: media.mimeType,
    byteLength: media.data.byteLength,
    ...(caption ?? {}),
    ...(transcript ? { transcript } : {}),
  };
  if (posterSource) {
    const poster = await resolveAsset(posterSource, node, "Audio", context);
    if (!poster) {
      return undefined;
    }
    if (poster.mimeType !== "image/png") {
      addPropError(context, node, "Audio", '"poster" must be a PNG image', base.id);
      return undefined;
    }
    audio.posterSrc = poster.src;
    audio.posterContentHash = poster.contentHash;
    audio.posterMimeType = "image/png";
  }
  return audio;
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
      rows: objects.map((row) =>
        headers.map((header) => {
          const key =
            isObject(header) &&
            (typeof header.value === "string" ||
              typeof header.value === "number" ||
              typeof header.value === "boolean")
              ? String(header.value)
              : String(header);
          return row[key] ?? null;
        }),
      ),
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

const TABLE_CELL_DESCRIPTOR_KEYS = new Set([
  "value",
  "fill",
  "backgroundColor",
  "align",
  "verticalAlign",
  "colSpan",
  "rowSpan",
  "numberFormat",
]);

const TABLE_NUMBER_FORMATS = new Set<TableNumberFormatIR>([
  "integer",
  "decimal",
  "percent",
  "currency-jpy",
]);

function tableNumberText(value: number, format: TableNumberFormatIR): string {
  const groupedInteger = (input: number): string => {
    const rounded = Math.round(input);
    const sign = rounded < 0 ? "-" : "";
    const digits = String(Math.abs(rounded));
    return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  };
  if (format === "integer") {
    return groupedInteger(value);
  }
  if (format === "decimal") {
    const [integer = "0", fraction = "00"] = Math.abs(value).toFixed(2).split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${value < 0 ? "-" : ""}${grouped}.${fraction}`;
  }
  if (format === "percent") {
    const formatted = (value * 100).toFixed(1).replace(/\.0$/, "");
    return `${formatted}%`;
  }
  return `¥${groupedInteger(value)}`;
}

function positiveNumberArrayProp(
  props: Props,
  name: string,
  node: AstNode,
  component: string,
  context: ComponentCompilationContext,
): number[] | undefined {
  const value = props[name];
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (item) => typeof item === "number" && Number.isFinite(item) && item > 0,
    )
  ) {
    addPropError(
      context,
      node,
      component,
      `"${name}" must be a non-empty array of positive numbers`,
    );
    return undefined;
  }
  return value as number[];
}

function compileTableCell(
  input: StaticValue,
  node: AstNode,
  context: ComponentCompilationContext,
  header: boolean,
): TableCellIR | undefined {
  const baseTextStyle: Partial<TextStyleIR> | undefined = header
    ? { fontWeight: 700 }
    : undefined;
  if (!isObject(input)) {
    if (
      input !== null &&
      typeof input !== "string" &&
      typeof input !== "number" &&
      typeof input !== "boolean"
    ) {
      addPropError(
        context,
        node,
        "Table",
        "cell values must be scalar values or cell descriptor objects",
      );
      return undefined;
    }
    return {
      paragraphs: [cellParagraph(input)],
      value: input,
      ...(baseTextStyle ? { textStyle: baseTextStyle } : {}),
    };
  }

  const unknownKey = Object.keys(input).find(
    (key) => !TABLE_CELL_DESCRIPTOR_KEYS.has(key),
  );
  if (unknownKey) {
    addPropError(
      context,
      node,
      "Table",
      `cell descriptor has unsupported property "${unknownKey}"`,
    );
    return undefined;
  }
  const value = input.value ?? null;
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    addPropError(
      context,
      node,
      "Table",
      "cell descriptor value must be a string, number, boolean or null",
    );
    return undefined;
  }

  const format = input.numberFormat;
  if (
    format !== undefined &&
    (typeof format !== "string" ||
      !TABLE_NUMBER_FORMATS.has(format as TableNumberFormatIR))
  ) {
    addPropError(
      context,
      node,
      "Table",
      "cell numberFormat must be integer, decimal, percent or currency-jpy",
    );
    return undefined;
  }
  if (format !== undefined && typeof value !== "number") {
    addPropError(context, node, "Table", "cell numberFormat requires a numeric value");
    return undefined;
  }

  const fillValue = input.fill ?? input.backgroundColor;
  if (
    fillValue !== undefined &&
    (typeof fillValue !== "string" || !isColor(fillValue))
  ) {
    addPropError(context, node, "Table", "cell fill must use #RRGGBB or #RRGGBBAA");
    return undefined;
  }
  const align = input.align;
  if (
    align !== undefined &&
    align !== "left" &&
    align !== "center" &&
    align !== "right"
  ) {
    addPropError(context, node, "Table", "cell align must be left, center or right");
    return undefined;
  }
  const verticalAlign = input.verticalAlign;
  if (
    verticalAlign !== undefined &&
    verticalAlign !== "top" &&
    verticalAlign !== "middle" &&
    verticalAlign !== "bottom"
  ) {
    addPropError(
      context,
      node,
      "Table",
      "cell verticalAlign must be top, middle or bottom",
    );
    return undefined;
  }
  const spans = ["colSpan", "rowSpan"] as const;
  for (const span of spans) {
    const spanValue = input[span];
    if (
      spanValue !== undefined &&
      (typeof spanValue !== "number" ||
        !Number.isInteger(spanValue) ||
        spanValue <= 0 ||
        spanValue > MAX_TABLE_CELL_SPAN)
    ) {
      addPropError(
        context,
        node,
        "Table",
        `cell ${span} must be an integer between 1 and ${MAX_TABLE_CELL_SPAN}`,
      );
      return undefined;
    }
  }

  const textStyle: Partial<TextStyleIR> = {
    ...(baseTextStyle ?? {}),
    ...(align ? { align } : {}),
    ...(verticalAlign ? { verticalAlign } : {}),
  };
  const text =
    format !== undefined && typeof value === "number"
      ? tableNumberText(value, format as TableNumberFormatIR)
      : undefined;
  return {
    paragraphs: [text === undefined ? cellParagraph(value) : { runs: [{ text }] }],
    value,
    ...(format ? { numberFormat: format as TableNumberFormatIR } : {}),
    ...(typeof input.colSpan === "number" ? { colSpan: input.colSpan } : {}),
    ...(typeof input.rowSpan === "number" ? { rowSpan: input.rowSpan } : {}),
    ...(typeof fillValue === "string"
      ? { fill: { type: "solid" as const, color: fillValue } }
      : {}),
    ...(Object.keys(textStyle).length > 0 ? { textStyle } : {}),
  };
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
  const rows: TableRowIR[] = [];
  if (data.headers.length > 0) {
    const cells = data.headers.map((value) =>
      compileTableCell(value, node, context, true),
    );
    if (cells.some((cell) => cell === undefined)) {
      return undefined;
    }
    rows.push({ cells: cells as TableCellIR[] });
  }
  for (const sourceRow of data.rows) {
    const cells = sourceRow.map((value) =>
      compileTableCell(value, node, context, false),
    );
    if (cells.some((cell) => cell === undefined)) {
      return undefined;
    }
    rows.push({ cells: cells as TableCellIR[] });
  }

  const grid = validateTableGrid(rows);
  if (!grid.success) {
    addPropError(context, node, "Table", grid.issue.message);
    return undefined;
  }

  const columnWidths = positiveNumberArrayProp(
    props,
    "columnWidths",
    node,
    "Table",
    context,
  );
  if (props.columnWidths !== undefined && columnWidths === undefined) {
    return undefined;
  }
  if (columnWidths && columnWidths.length !== grid.columnCount) {
    addPropError(
      context,
      node,
      "Table",
      `"columnWidths" must contain ${grid.columnCount} values`,
    );
    return undefined;
  }
  if (columnWidths && !tableDimensionsMatch(columnWidths, resolvedFrame.frame.w)) {
    addPropError(
      context,
      node,
      "Table",
      `"columnWidths" values must add up to table width ${resolvedFrame.frame.w}`,
    );
    return undefined;
  }
  const rowHeights = positiveNumberArrayProp(
    props,
    "rowHeights",
    node,
    "Table",
    context,
  );
  if (props.rowHeights !== undefined && rowHeights === undefined) {
    return undefined;
  }
  if (rowHeights && rowHeights.length !== rows.length) {
    addPropError(
      context,
      node,
      "Table",
      `"rowHeights" must contain ${rows.length} values`,
    );
    return undefined;
  }
  if (rowHeights && !tableDimensionsMatch(rowHeights, resolvedFrame.frame.h)) {
    addPropError(
      context,
      node,
      "Table",
      `"rowHeights" values must add up to table height ${resolvedFrame.frame.h}`,
    );
    return undefined;
  }
  rowHeights?.forEach((height, index) => {
    const row = rows[index];
    if (row) {
      row.height = height;
    }
  });

  const table: TableElementIR = {
    ...base,
    type: "table",
    rows,
    headerRows: data.headers.length > 0 ? 1 : 0,
    style: structuredClone(context.theme.defaults.table),
  };
  if (columnWidths) {
    table.columnWidths = columnWidths;
  }
  return table;
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
    if (raw.color !== undefined) {
      if (typeof raw.color !== "string" || !isColor(raw.color)) {
        addPropError(
          context,
          node,
          "Chart",
          `series "${raw.name}" color must use #RRGGBB or #RRGGBBAA`,
        );
        return undefined;
      }
      series.color = raw.color;
    }
    const seriesChartType = raw.chartType ?? raw.type;
    if (seriesChartType !== undefined) {
      if (
        seriesChartType !== "bar" &&
        seriesChartType !== "line" &&
        seriesChartType !== "area" &&
        seriesChartType !== "scatter"
      ) {
        addPropError(
          context,
          node,
          "Chart",
          `series "${raw.name}" has unsupported chart type ${String(seriesChartType)}`,
        );
        return undefined;
      }
      series.chartType = seriesChartType;
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
  if (
    chartType !== "bar" &&
    chartType !== "line" &&
    chartType !== "pie" &&
    chartType !== "doughnut" &&
    chartType !== "area" &&
    chartType !== "scatter" &&
    chartType !== "radar" &&
    chartType !== "stacked" &&
    chartType !== "combo"
  ) {
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
  if (series.length === 0) {
    addPropError(context, node, "Chart", '"series" must contain at least one series');
    return undefined;
  }
  const emptySeries = series.find((item) => item.values.length === 0);
  if (emptySeries) {
    addPropError(
      context,
      node,
      "Chart",
      `series "${emptySeries.name}" must contain at least one label and value`,
    );
    return undefined;
  }
  const contract = validateChartContract(chartType, series);
  if (!contract.success) {
    addPropError(context, node, "Chart", contract.issue.message);
    return undefined;
  }
  const title = stringProp(props, "title", context, node, "Chart");
  const categoryAxisTitle = stringProp(
    props,
    "categoryAxisTitle",
    context,
    node,
    "Chart",
  );
  const valueAxisTitle = stringProp(props, "valueAxisTitle", context, node, "Chart");
  const valueUnit = stringProp(props, "valueUnit", context, node, "Chart");
  const legendPosition = stringProp(props, "legendPosition", context, node, "Chart");
  if (
    legendPosition !== undefined &&
    legendPosition !== "top" &&
    legendPosition !== "bottom" &&
    legendPosition !== "left" &&
    legendPosition !== "right"
  ) {
    addPropError(
      context,
      node,
      "Chart",
      '"legendPosition" must be top, bottom, left or right',
    );
    return undefined;
  }
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
      showCategoryName:
        booleanProp(props, "showCategoryName", context, node, "Chart") ??
        context.theme.defaults.chart.showCategoryName,
    },
  };
  if (title) {
    chart.title = title;
    chart.style.showTitle = true;
  }
  if (categoryAxisTitle) {
    chart.categoryAxisTitle = categoryAxisTitle;
  }
  if (valueAxisTitle) {
    chart.valueAxisTitle = valueAxisTitle;
  }
  if (valueUnit) {
    chart.valueUnit = valueUnit;
  }
  if (legendPosition) {
    chart.legendPosition = legendPosition;
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
  const decorative = booleanProp(props, "decorative", context, node, "Icon");
  addAccessibilityIssues(
    context,
    node,
    validateVisualAlternative({
      component: "Icon",
      alt: typeof props.alt === "string" ? props.alt : undefined,
      decorative,
    }),
    base.id,
  );
  const icon: IconElementIR = {
    ...base,
    type: "icon",
    src: asset.src,
    contentHash: asset.contentHash,
  };
  if (decorative === true) {
    icon.decorative = true;
  }
  const colorValue = stringProp(props, "color", context, node, "Icon");
  if (colorValue && isColor(colorValue)) {
    icon.color = colorValue;
  } else if (colorValue) {
    addPropError(context, node, "Icon", '"color" must use #RRGGBB');
  }
  return icon;
}

type DiagramComponent =
  | "Flow"
  | "Timeline"
  | "Matrix"
  | "Cycle"
  | "Funnel"
  | "OrgChart";

function compileDiagramPreset(
  component: DiagramComponent,
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): GroupElementIR | undefined {
  const resolvedFrame = resolveFrame(props, node, component, context);
  if (!resolvedFrame) return undefined;
  const base = createBase(
    props,
    node,
    component,
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) return undefined;

  const shared = {
    id: base.id,
    frame: base.frame,
    sourceLocation: base.sourceLocation,
    zIndex: base.zIndex,
    ...(base.alt ? { alt: base.alt } : {}),
  };
  let input: DiagramPresetInput;
  switch (component) {
    case "Flow": {
      const direction = stringProp(props, "direction", context, node, component);
      input = {
        ...shared,
        kind: "flow",
        items: props.items,
        ...(direction ? { direction } : {}),
      } as unknown as DiagramPresetInput;
      break;
    }
    case "Timeline":
      input = {
        ...shared,
        kind: "timeline",
        items: props.items,
      } as unknown as DiagramPresetInput;
      break;
    case "Matrix":
      input = {
        ...shared,
        kind: "matrix",
        rows: props.rows,
        columns: props.columns,
        cells: props.cells,
      } as unknown as DiagramPresetInput;
      break;
    case "Cycle":
      input = {
        ...shared,
        kind: "cycle",
        items: props.items,
      } as unknown as DiagramPresetInput;
      break;
    case "Funnel":
      input = {
        ...shared,
        kind: "funnel",
        items: props.items,
      } as unknown as DiagramPresetInput;
      break;
    case "OrgChart":
      input = {
        ...shared,
        kind: "orgChart",
        items: props.items,
      } as unknown as DiagramPresetInput;
      break;
  }

  try {
    const expanded = expandDiagramPreset(input, context.theme);
    return { ...expanded, ...base, type: "group", children: expanded.children };
  } catch (error) {
    addPropError(
      context,
      node,
      component,
      error instanceof DiagramPresetValidationError
        ? error.message
        : `cannot expand diagram: ${error instanceof Error ? error.message : String(error)}`,
      base.id,
    );
    return undefined;
  }
}

function codeNodeContent(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): { code: string; language?: string } | undefined {
  const propCode = stringProp(props, "code", context, node, "CodeBlock");
  const codeNodes = (node.children ?? []).filter((child) => child.type === "code");
  const unexpected = (node.children ?? []).filter(
    (child) =>
      child.type !== "code" &&
      !(child.type === "text" && (child.value ?? "").trim() === ""),
  );
  if (unexpected.length > 0) {
    addPropError(
      context,
      unexpected[0] ?? node,
      "CodeBlock",
      "content must be one fenced code block, or use the code prop",
    );
    return undefined;
  }
  if (propCode !== undefined && codeNodes.length > 0) {
    addPropError(
      context,
      node,
      "CodeBlock",
      "use either the code prop or a fenced code block, not both",
    );
    return undefined;
  }
  if (codeNodes.length > 1) {
    addPropError(context, node, "CodeBlock", "only one fenced code block is allowed");
    return undefined;
  }
  const codeNode = codeNodes[0];
  const code = propCode ?? codeNode?.value;
  if (code === undefined || code.length === 0) {
    addPropError(context, node, "CodeBlock", "code content is required");
    return undefined;
  }
  const languageProp = stringProp(props, "language", context, node, "CodeBlock");
  const language = languageProp ?? codeNode?.lang ?? undefined;
  return {
    code,
    ...(language ? { language } : {}),
  };
}

function compileCodeBlock(
  node: AstNode,
  props: Props,
  context: ComponentCompilationContext,
): GroupElementIR | undefined {
  const resolvedFrame = resolveFrame(props, node, "CodeBlock", context);
  const content = codeNodeContent(node, props, context);
  if (!resolvedFrame || !content) return undefined;
  const base = createBase(
    props,
    node,
    "CodeBlock",
    context,
    resolvedFrame.frame,
    resolvedFrame.zIndex,
  );
  if (!base) return undefined;
  const title = stringProp(props, "title", context, node, "CodeBlock");
  const padding = numberProp(props, "padding", context, node, "CodeBlock");
  const input = {
    id: base.id,
    frame: base.frame,
    sourceLocation: base.sourceLocation,
    zIndex: base.zIndex,
    code: content.code,
    ...(content.language ? { language: content.language } : {}),
    ...(title ? { title } : {}),
    showLineNumbers:
      booleanProp(props, "showLineNumbers", context, node, "CodeBlock") ?? true,
    ...(props.highlightLines !== undefined
      ? { highlightLines: props.highlightLines }
      : {}),
    ...(padding !== undefined ? { padding } : {}),
    ...(base.alt ? { alt: base.alt } : {}),
  } as unknown as CodeBlockInput;
  try {
    const expanded = expandCodeBlock(input, context.theme);
    return { ...expanded, ...base, type: "group", children: expanded.children };
  } catch (error) {
    addPropError(
      context,
      node,
      "CodeBlock",
      error instanceof CodeBlockValidationError
        ? error.message
        : `cannot expand code block: ${error instanceof Error ? error.message : String(error)}`,
      base.id,
    );
    return undefined;
  }
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
    case "Video":
      return compileVideo(node, props, context);
    case "Audio":
      return compileAudio(node, props, context);
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
    case "Flow":
    case "Timeline":
    case "Matrix":
    case "Cycle":
    case "Funnel":
    case "OrgChart":
      return compileDiagramPreset(component, node, props, context);
    case "CodeBlock":
      return compileCodeBlock(node, props, context);
    case "Group":
      return compileGroup(node, props, context);
    case "Slot":
      addPropError(context, node, component, "nested Slot is not allowed");
      return undefined;
    case "Spacer":
      return undefined;
  }
}
