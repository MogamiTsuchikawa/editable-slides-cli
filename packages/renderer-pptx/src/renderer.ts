import { writeFile } from "node:fs/promises";
import JSZip from "jszip";
import PptxGenJSModule from "pptxgenjs";
import { PptxRenderError, StrictEditableError } from "./errors.js";
import type {
  ChartElementIR,
  DeckIRInput,
  ElementIR,
  FillIR,
  FrameIR,
  GroupElementIR,
  ImageElementIR,
  LineElementIR,
  ParagraphIR,
  RenderedPptx,
  RendererDiagnostic,
  RenderPptxOptions,
  ShapeElementIR,
  SourceIR,
  StrokeIR,
  TableCellIR,
  TableElementIR,
  TextElementIR,
  TextStyleIR,
} from "./types.js";

const LAYOUT_NAME = "LIVETOON_WIDE";
const DEFAULT_MASTER = "LT_DEFAULT_MASTER";
const DEFAULT_WIDTH_INCH = 13.333333;
const DEFAULT_HEIGHT_INCH = 7.5;
const SUPPORTED_TYPES = new Set([
  "text",
  "image",
  "icon",
  "shape",
  "line",
  "connector",
  "group",
  "table",
  "chart",
]);

type UnknownRecord = Record<string, unknown>;
type PptxOptionRecord = Record<string, unknown>;

interface PptxTextRun {
  text: string;
  options: PptxOptionRecord;
}

interface PptxTableCell {
  text: string;
  options: PptxOptionRecord;
}

interface PptxSlide {
  background: PptxOptionRecord;
  addText(text: string | PptxTextRun[], options?: PptxOptionRecord): unknown;
  addImage(options: PptxOptionRecord): unknown;
  addShape(shapeName: string, options?: PptxOptionRecord): unknown;
  addTable(rows: PptxTableCell[][], options?: PptxOptionRecord): unknown;
  addChart(type: string, data: unknown[], options?: PptxOptionRecord): unknown;
  addNotes(notes: string): unknown;
}

interface PptxPresentation {
  layout: string;
  author: string;
  company: string;
  title: string;
  subject: string;
  revision: string;
  theme: {
    headFontFace?: string;
    bodyFontFace?: string;
  };
  defineLayout(layout: { name: string; width: number; height: number }): void;
  defineSlideMaster(master: {
    title: string;
    background?: PptxOptionRecord;
    objects?: PptxOptionRecord[];
  }): void;
  addSlide(options?: { masterName?: string }): PptxSlide;
  write(options: {
    outputType: "uint8array";
    compression?: boolean;
  }): Promise<string | ArrayBuffer | Blob | Uint8Array>;
}

const PptxGenJS = PptxGenJSModule as unknown as new () => PptxPresentation;

interface CanvasMetrics {
  width: number;
  height: number;
  widthInch: number;
  heightInch: number;
}

interface FlattenedElement {
  element: ElementIR;
  frame: FrameIR;
  rotation: number;
  zIndex: number;
}

interface RenderContext {
  slideId: string;
  canvas: CanvasMetrics;
  defaultBodyFont: string;
  defaultHeadingFont: string;
  objectNames: string[];
  connectorNames: string[];
}

export async function renderPptx(
  deck: DeckIRInput,
  options: RenderPptxOptions = {},
): Promise<RenderedPptx> {
  const diagnostics = validateDeck(deck, options.strictEditable === true);
  if (diagnostics.length > 0) {
    if (
      options.strictEditable &&
      diagnostics.some((item) => item.code.startsWith("strict."))
    ) {
      throw new StrictEditableError(diagnostics);
    }
    throw new PptxRenderError(
      `PPTX rendering validation failed with ${diagnostics.length} error(s).`,
      diagnostics,
    );
  }

  const canvas = getCanvas(deck);
  const theme = asRecord(deck.theme);
  const bodyFont = readFontFamily(theme, "body") ?? "Noto Sans JP";
  const headingFont = readFontFamily(theme, "heading") ?? bodyFont;
  const presentation = new PptxGenJS();
  presentation.defineLayout({
    name: LAYOUT_NAME,
    width: canvas.widthInch,
    height: canvas.heightInch,
  });
  presentation.layout = LAYOUT_NAME;
  presentation.author = deck.metadata.author ?? "";
  presentation.company = deck.metadata.company ?? "";
  presentation.title = deck.metadata.title;
  presentation.subject = options.subject ?? deck.metadata.subject ?? "";
  presentation.revision = options.revision ?? "1";
  presentation.theme = {
    headFontFace: headingFont,
    bodyFontFace: bodyFont,
  };

  const masters = defineMasters(presentation, deck, canvas, bodyFont);
  const allObjectNames: string[] = [];
  const connectorsBySlide: string[][] = [];

  for (const slideIR of deck.slides) {
    const masterName = masters.get(slideIR.masterId ?? "") ?? DEFAULT_MASTER;
    const slide = presentation.addSlide({ masterName });
    applySlideBackground(slide, slideIR.background);

    const context: RenderContext = {
      slideId: slideIR.id,
      canvas,
      defaultBodyFont: bodyFont,
      defaultHeadingFont: headingFont,
      objectNames: allObjectNames,
      connectorNames: [],
    };
    const elements = flattenElements(slideIR.elements);
    elements.sort((left, right) => {
      const leftConnector = left.element.type === "connector" ? 0 : 1;
      const rightConnector = right.element.type === "connector" ? 0 : 1;
      return leftConnector - rightConnector || left.zIndex - right.zIndex;
    });

    for (const flattened of elements) {
      renderElement(slide, flattened, context);
    }

    const noteText = formatNotes(
      slideIR.notes?.plainText ?? slideIR.notes?.markdown ?? "",
      slideIR.notes?.sources ?? [],
    );
    if (noteText.length > 0) {
      slide.addNotes(noteText);
    }
    connectorsBySlide.push(context.connectorNames);
  }

  const generated = await presentation.write({
    outputType: "uint8array",
    compression: options.compression ?? true,
  });
  const bytes = toUint8Array(generated);
  const postprocessed = await convertNamedLinesToConnectors(bytes, connectorsBySlide);
  return {
    data: postprocessed,
    slideCount: deck.slides.length,
    objectNames: allObjectNames,
  };
}

export async function writePptxFile(
  deck: DeckIRInput,
  filePath: string,
  options: RenderPptxOptions = {},
): Promise<RenderedPptx> {
  const rendered = await renderPptx(deck, options);
  await writeFile(filePath, rendered.data);
  return rendered;
}

export function objectName(slideId: string, elementId: string): string {
  return `lt:${slideId}:${elementId}`;
}

export function logicalFrameToInches(
  frame: FrameIR,
  canvas: DeckIRInput["canvas"],
): FrameIR {
  const widthInch = canvas.pptxWidthInch ?? DEFAULT_WIDTH_INCH;
  const heightInch = canvas.pptxHeightInch ?? DEFAULT_HEIGHT_INCH;
  return {
    x: (frame.x * widthInch) / canvas.width,
    y: (frame.y * heightInch) / canvas.height,
    w: (frame.w * widthInch) / canvas.width,
    h: (frame.h * heightInch) / canvas.height,
  };
}

export function logicalFontSizeToPoints(
  fontSize: number,
  canvas: DeckIRInput["canvas"],
): number {
  const heightInch = canvas.pptxHeightInch ?? DEFAULT_HEIGHT_INCH;
  return Math.round(((fontSize * heightInch * 72) / canvas.height) * 100) / 100;
}

function validateDeck(deck: DeckIRInput, strict: boolean): RendererDiagnostic[] {
  const diagnostics: RendererDiagnostic[] = [];
  if (
    !Number.isFinite(deck.canvas.width) ||
    deck.canvas.width <= 0 ||
    !Number.isFinite(deck.canvas.height) ||
    deck.canvas.height <= 0
  ) {
    diagnostics.push({
      code: "deck.invalid-canvas",
      message: "Deck canvas width and height must be positive finite numbers.",
    });
  }

  const slideIds = new Set<string>();
  for (const slide of deck.slides) {
    if (slideIds.has(slide.id)) {
      diagnostics.push({
        code: "deck.duplicate-slide-id",
        message: `Duplicate slide ID: ${slide.id}`,
        slideId: slide.id,
      });
    }
    slideIds.add(slide.id);
    const elementIds = new Set<string>();
    walkUnknownElements(slide.elements, (candidate) => {
      const record = asRecord(candidate);
      const id = stringValue(record.id);
      const type = stringValue(record.type ?? record.kind);
      if (!id) {
        diagnostics.push({
          code: "element.missing-id",
          message: "Every PPTX element must have a stable ID.",
          slideId: slide.id,
        });
        return;
      }
      if (elementIds.has(id)) {
        diagnostics.push({
          code: "element.duplicate-id",
          message: `Duplicate element ID: ${id}`,
          slideId: slide.id,
          elementId: id,
        });
      }
      elementIds.add(id);
      if (!SUPPORTED_TYPES.has(type)) {
        diagnostics.push({
          code: "element.unsupported",
          message: `Unsupported PPTX element type: ${type || "(missing)"}`,
          slideId: slide.id,
          elementId: id,
        });
      }
      const frame = asRecord(record.frame);
      for (const key of ["x", "y", "w", "h"] as const) {
        if (!Number.isFinite(frame[key] as number)) {
          diagnostics.push({
            code: "element.invalid-frame",
            message: `Element ${id} has a non-finite frame.${key}.`,
            slideId: slide.id,
            elementId: id,
          });
        }
      }
      if (Number(frame.w) < 0 || Number(frame.h) < 0) {
        diagnostics.push({
          code: "element.invalid-frame",
          message: `Element ${id} has a negative width or height.`,
          slideId: slide.id,
          elementId: id,
        });
      }
      if (strict && (record.editable === false || stringValue(record.fallbackReason))) {
        diagnostics.push({
          code: "strict.raster-fallback",
          message: `Element ${id} requests a non-editable raster fallback.`,
          slideId: slide.id,
          elementId: id,
        });
      }
      if ((type === "image" || type === "icon") && !resolveImageSource(record)) {
        diagnostics.push({
          code: "image.missing-source",
          message: `Image ${id} needs a local path or a data URI.`,
          slideId: slide.id,
          elementId: id,
        });
      }
      if (type === "chart") {
        const chartType = stringValue(record.chartType ?? record.chart) || "bar";
        if (!["bar", "line", "pie"].includes(chartType)) {
          diagnostics.push({
            code: "chart.unsupported-type",
            message: `Chart ${id} uses unsupported chart type: ${chartType}`,
            slideId: slide.id,
            elementId: id,
          });
        }
      }
    });
  }
  return diagnostics;
}

function walkUnknownElements(
  elements: ReadonlyArray<unknown>,
  visitor: (element: unknown) => void,
): void {
  for (const element of elements) {
    visitor(element);
    const record = asRecord(element);
    if (stringValue(record.type ?? record.kind) === "group") {
      const children = arrayValue(record.elements ?? record.children);
      walkUnknownElements(children, visitor);
    }
  }
}

function flattenElements(
  elements: ReadonlyArray<unknown>,
  parent?: {
    frame: FrameIR;
    coordinateSpace: "absolute" | "relative";
    rotation: number;
    zIndex: number;
  },
): FlattenedElement[] {
  const result: FlattenedElement[] = [];
  for (const candidate of elements) {
    const element = normalizeElement(candidate);
    let frame = element.frame;
    let rotation = element.rotation ?? 0;
    let zIndex = element.zIndex ?? 0;
    if (parent) {
      rotation += parent.rotation;
      zIndex += parent.zIndex;
      if (parent.coordinateSpace === "relative") {
        frame = {
          x: parent.frame.x + frame.x,
          y: parent.frame.y + frame.y,
          w: frame.w,
          h: frame.h,
        };
      }
    }

    if (element.type === "group") {
      const group = element as GroupElementIR;
      result.push(
        ...flattenElements(group.elements ?? group.children ?? [], {
          frame,
          coordinateSpace: group.coordinateSpace ?? "absolute",
          rotation,
          zIndex,
        }),
      );
      continue;
    }
    result.push({ element, frame, rotation, zIndex });
  }
  return result;
}

function normalizeElement(candidate: unknown): ElementIR {
  const record = asRecord(candidate);
  const type = stringValue(record.type ?? record.kind);
  return {
    ...record,
    type,
    id: stringValue(record.id),
    frame: normalizeFrame(record.frame),
  } as ElementIR;
}

function renderElement(
  slide: PptxSlide,
  flattened: FlattenedElement,
  context: RenderContext,
): void {
  const { element, frame, rotation } = flattened;
  switch (element.type) {
    case "text":
      renderText(slide, element as TextElementIR, frame, rotation, context);
      break;
    case "image":
    case "icon":
      renderImage(slide, element as ImageElementIR, frame, rotation, context);
      break;
    case "shape":
      renderShape(slide, element as ShapeElementIR, frame, rotation, context);
      break;
    case "line":
    case "connector":
      renderLine(slide, element as LineElementIR, frame, rotation, context);
      break;
    case "table":
      renderTable(slide, element as TableElementIR, frame, context);
      break;
    case "chart":
      renderChart(slide, element as ChartElementIR, frame, context);
      break;
    default:
      throw new PptxRenderError(`Unsupported element type: ${element.type}`, [
        {
          code: "element.unsupported",
          message: `Unsupported element type: ${element.type}`,
          slideId: context.slideId,
          elementId: element.id,
        },
      ]);
  }
}

function renderText(
  slide: PptxSlide,
  element: TextElementIR,
  logicalFrame: FrameIR,
  rotation: number,
  context: RenderContext,
): void {
  const frame = toInches(logicalFrame, context.canvas);
  const name = registerObjectName(element, context);
  const style = element.style ?? {};
  const text = createTextRuns(element.text, element.paragraphs, style, context);
  slide.addText(text, {
    ...frame,
    objectName: name,
    rotate: rotation,
    fontFace: style.fontFace ?? context.defaultBodyFont,
    fontSize: logicalFontSizeToPoints(style.fontSize ?? 18, context.canvas),
    color: normalizeColor(style.color ?? "000000"),
    bold: style.bold ?? isBoldWeight(style.fontWeight),
    italic: style.italic,
    strike: style.strike,
    align: style.align,
    valign: mapValign(style.valign ?? style.verticalAlign),
    margin: style.margin ?? 0,
    lineSpacing: style.lineSpacing,
    lineSpacingMultiple: style.lineSpacing === undefined ? style.lineHeight : undefined,
    charSpacing: logicalFontSizeToPoints(
      style.charSpacing ?? style.letterSpacing ?? 0,
      context.canvas,
    ),
    fit: style.fit ?? style.textFit ?? "none",
    lang: style.language,
    transparency: opacityToTransparency(element.opacity),
    fill: toShapeFill(element.fill, element.opacity),
    line: toShapeLine(element.line, element.opacity),
    isTextBox: true,
  });
}

function renderShape(
  slide: PptxSlide,
  element: ShapeElementIR,
  logicalFrame: FrameIR,
  rotation: number,
  context: RenderContext,
): void {
  const frame = toInches(logicalFrame, context.canvas);
  const name = registerObjectName(element, context);
  const shape = mapShapeName(element.shape ?? element.shapeType ?? "rect");
  const fill = toShapeFill(element.fill, element.opacity);
  const line = toShapeLine(element.line ?? element.stroke, element.opacity);
  if (element.text !== undefined || (element.paragraphs?.length ?? 0) > 0) {
    const style = element.textStyle ?? {};
    slide.addText(createTextRuns(element.text, element.paragraphs, style, context), {
      ...frame,
      objectName: name,
      shape,
      rotate: rotation,
      fill,
      line,
      fontFace: style.fontFace ?? context.defaultBodyFont,
      fontSize: logicalFontSizeToPoints(style.fontSize ?? 18, context.canvas),
      color: normalizeColor(style.color ?? "000000"),
      bold: style.bold ?? isBoldWeight(style.fontWeight),
      italic: style.italic,
      align: style.align,
      valign: mapValign(style.valign ?? style.verticalAlign),
      margin: style.margin ?? 0,
      fit: style.fit ?? style.textFit ?? "none",
      lineSpacing: style.lineSpacing,
      lineSpacingMultiple:
        style.lineSpacing === undefined ? style.lineHeight : undefined,
      lang: style.language,
    });
    return;
  }
  slide.addShape(shape, {
    ...frame,
    objectName: name,
    rotate: rotation,
    fill,
    line,
  });
}

function renderLine(
  slide: PptxSlide,
  element: LineElementIR,
  logicalFrame: FrameIR,
  rotation: number,
  context: RenderContext,
): void {
  const name = registerObjectName(element, context);
  const start = element.start;
  const end = element.end;
  const geometryFrame =
    start && end
      ? {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          w: Math.abs(end.x - start.x),
          h: Math.abs(end.y - start.y),
        }
      : logicalFrame;
  const frame = toInches(geometryFrame, context.canvas);
  const stroke = element.line ?? element.stroke;
  slide.addShape("line", {
    ...frame,
    objectName: name,
    rotate: rotation,
    flipH: start && end ? end.x < start.x : undefined,
    flipV: start && end ? end.y < start.y : undefined,
    line: toShapeLine(
      {
        ...stroke,
        beginArrow: element.beginArrow ?? stroke?.beginArrow,
        endArrow: element.endArrow ?? stroke?.endArrow,
      },
      element.opacity,
    ) ?? {
      color: "333333",
      width: 1,
    },
  });
  if (element.type === "connector") {
    context.connectorNames.push(name);
  }
}

function renderImage(
  slide: PptxSlide,
  element: ImageElementIR,
  logicalFrame: FrameIR,
  rotation: number,
  context: RenderContext,
): void {
  const frame = toInches(logicalFrame, context.canvas);
  const name = registerObjectName(element, context);
  const source = resolveImageSource(element as unknown as UnknownRecord);
  if (!source) {
    throw new PptxRenderError(`Image ${element.id} has no source.`, [
      {
        code: "image.missing-source",
        message: `Image ${element.id} has no source.`,
        slideId: context.slideId,
        elementId: element.id,
      },
    ]);
  }
  const sizing =
    element.fit && element.fit !== "stretch"
      ? {
          type: element.fit,
          w: frame.w,
          h: frame.h,
        }
      : undefined;
  slide.addImage({
    ...source,
    ...frame,
    sizing,
    objectName: name,
    altText: element.alt ?? "",
    rotate: rotation,
    flipH: element.flipH,
    flipV: element.flipV,
    transparency: opacityToTransparency(element.opacity),
  });
}

function renderTable(
  slide: PptxSlide,
  element: TableElementIR,
  logicalFrame: FrameIR,
  context: RenderContext,
): void {
  const frame = toInches(logicalFrame, context.canvas);
  const name = registerObjectName(element, context);
  const tableStyle = element.style ?? {};
  const textStyle = tableStyle.text ?? tableStyle;
  const headerRows = element.headerRows ?? 1;
  const rows = element.rows.map((row, rowIndex) => {
    const cells = Array.isArray(row) ? row : row.cells;
    return cells.map((cell) =>
      normalizeTableCell(
        cell,
        textStyle,
        rowIndex < headerRows ? tableStyle.headerFill : tableStyle.bodyFill,
        context,
      ),
    );
  });
  const colW = element.columnWidths?.map(
    (width) => (width * context.canvas.widthInch) / context.canvas.width,
  );
  const sourceRowHeights =
    element.rowHeights ??
    element.rows.map((row) => (Array.isArray(row) ? undefined : row.height));
  const rowH = sourceRowHeights.every((height) => height !== undefined)
    ? sourceRowHeights.map(
        (height) => ((height ?? 0) * context.canvas.heightInch) / context.canvas.height,
      )
    : undefined;
  slide.addTable(rows, {
    ...frame,
    objectName: name,
    autoPage: false,
    colW,
    rowH,
    fontFace: textStyle.fontFace ?? context.defaultBodyFont,
    fontSize: logicalFontSizeToPoints(textStyle.fontSize ?? 16, context.canvas),
    color: normalizeColor(textStyle.color ?? "000000"),
    bold: textStyle.bold ?? isBoldWeight(textStyle.fontWeight),
    align: textStyle.align,
    valign: mapValign(textStyle.valign ?? textStyle.verticalAlign),
    margin: textStyle.margin ?? 4,
    fill: toShapeFill(element.fill, element.opacity),
    border: toBorder(element.border ?? tableStyle.border),
  });
}

function renderChart(
  slide: PptxSlide,
  element: ChartElementIR,
  logicalFrame: FrameIR,
  context: RenderContext,
): void {
  const frame = toInches(logicalFrame, context.canvas);
  const name = registerObjectName(element, context);
  const chartType = element.chartType ?? element.chart ?? "bar";
  const chartStyle = element.style ?? {};
  const chartFontSize =
    chartStyle.fontSize === undefined
      ? undefined
      : logicalFontSizeToPoints(chartStyle.fontSize, context.canvas);
  const series = element.series?.length
    ? element.series.map((item) => ({
        name: item.name,
        labels: item.labels ?? item.values.map((_, index) => String(index + 1)),
        values: item.values,
      }))
    : [
        {
          name: element.title ?? "Series 1",
          labels: element.data?.map((item) => item.label) ?? [],
          values: element.data?.map((item) => item.value) ?? [],
        },
      ];
  slide.addChart(chartType, series, {
    ...frame,
    objectName: name,
    title: element.title,
    showTitle: chartStyle.showTitle ?? Boolean(element.title),
    showLegend: element.showLegend ?? chartStyle.showLegend ?? series.length > 1,
    showValue: element.showValue ?? chartStyle.showValue ?? false,
    chartColors: (
      element.colors ??
      chartStyle.colors ??
      element.series
        ?.map((item) => item.color)
        .filter((color): color is string => Boolean(color))
    )?.map(normalizeColor),
    showCatName: element.showCategoryName ?? chartStyle.showCategoryName ?? false,
    catAxisLabelFontFace: chartStyle.fontFace ?? context.defaultBodyFont,
    catAxisLabelFontSize: chartFontSize,
    valAxisLabelFontFace: chartStyle.fontFace ?? context.defaultBodyFont,
    valAxisLabelFontSize: chartFontSize,
    legendFontFace: chartStyle.fontFace ?? context.defaultBodyFont,
    legendFontSize: chartFontSize,
    dataLabelFontFace: chartStyle.fontFace ?? context.defaultBodyFont,
    dataLabelFontSize: chartFontSize,
    titleFontFace: chartStyle.fontFace ?? context.defaultHeadingFont,
    titleFontSize: chartFontSize,
  });
}

function createTextRuns(
  text: string | undefined,
  paragraphs: ParagraphIR[] | undefined,
  baseStyle: TextStyleIR,
  context: RenderContext,
): string | PptxTextRun[] {
  if (!paragraphs?.length) {
    return text ?? "";
  }
  const result: PptxTextRun[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphRuns = paragraph.runs?.length
      ? paragraph.runs
      : [{ text: paragraph.text ?? "" }];
    paragraphRuns.forEach((run, runIndex) => {
      const isLastRun = runIndex === paragraphRuns.length - 1;
      const style = { ...baseStyle, ...paragraph, ...run };
      result.push({
        text: run.text,
        options: {
          fontFace: style.fontFace ?? context.defaultBodyFont,
          fontSize: logicalFontSizeToPoints(style.fontSize ?? 18, context.canvas),
          color: normalizeColor(style.color ?? "000000"),
          bold: style.bold ?? isBoldWeight(style.fontWeight),
          italic: style.italic,
          underline: style.underline ? { style: "sng" } : undefined,
          strike: style.strike,
          align: style.align,
          breakLine:
            run.breakLine ?? (isLastRun && paragraphIndex < paragraphs.length - 1),
          bullet:
            runIndex === 0
              ? toBullet(paragraph.ordered ? { type: "number" } : paragraph.bullet)
              : undefined,
          indentLevel: paragraph.indentLevel ?? paragraph.level,
          paraSpaceBeforePt:
            paragraph.spaceBefore === undefined
              ? undefined
              : logicalFontSizeToPoints(paragraph.spaceBefore, context.canvas),
          paraSpaceAfterPt:
            paragraph.spaceAfter === undefined
              ? undefined
              : logicalFontSizeToPoints(paragraph.spaceAfter, context.canvas),
          lineSpacing: paragraph.lineSpacing,
          lineSpacingMultiple:
            paragraph.lineSpacing === undefined ? paragraph.lineHeight : undefined,
          charSpacing: logicalFontSizeToPoints(
            style.charSpacing ?? style.letterSpacing ?? 0,
            context.canvas,
          ),
          lang: style.language,
          hyperlink:
            run.hyperlink || run.href ? { url: run.hyperlink ?? run.href } : undefined,
        },
      });
    });
  });
  return result;
}

function normalizeTableCell(
  cell: string | TableCellIR,
  tableStyle: TextStyleIR | undefined,
  defaultFill: FillIR | undefined,
  context: RenderContext,
): PptxTableCell {
  if (typeof cell === "string") {
    return {
      text: cell,
      options: {
        fill: toShapeFill(defaultFill),
        fontFace: tableStyle?.fontFace ?? context.defaultBodyFont,
        fontSize: logicalFontSizeToPoints(tableStyle?.fontSize ?? 16, context.canvas),
        color: normalizeColor(tableStyle?.color ?? "000000"),
      },
    };
  }
  const style = { ...tableStyle, ...(cell.textStyle ?? cell.style) };
  return {
    text: cell.text ?? paragraphsToPlainText(cell.paragraphs),
    options: {
      colspan: cell.colspan ?? cell.colSpan,
      rowspan: cell.rowspan ?? cell.rowSpan,
      fill: toShapeFill(cell.fill ?? defaultFill),
      border: toBorder(cell.border),
      fontFace: style.fontFace ?? context.defaultBodyFont,
      fontSize: logicalFontSizeToPoints(style.fontSize ?? 16, context.canvas),
      color: normalizeColor(style.color ?? "000000"),
      bold: style.bold ?? isBoldWeight(style.fontWeight),
      italic: style.italic,
      align: style.align,
      valign: mapValign(style.valign ?? style.verticalAlign),
      margin: style.margin,
    },
  };
}

function registerObjectName(element: ElementIR, context: RenderContext): string {
  const name = objectName(context.slideId, element.id);
  context.objectNames.push(name);
  return name;
}

function paragraphsToPlainText(paragraphs: ParagraphIR[] | undefined): string {
  if (!paragraphs?.length) {
    return "";
  }
  return paragraphs
    .map((paragraph) => {
      if (paragraph.runs?.length) {
        return paragraph.runs.map((run) => run.text).join("");
      }
      return paragraph.text ?? "";
    })
    .join("\n");
}

function formatNotes(notes: string, sources: ReadonlyArray<SourceIR>): string {
  const normalizedNotes = notes.trim();
  if (sources.length === 0) {
    return normalizedNotes;
  }
  const sourceLines = sources.map((source) => {
    const location = source.url ? ` — ${source.url}` : "";
    const detail = source.detail ? ` (${source.detail})` : "";
    return `- ${source.label}${location}${detail}`;
  });
  return [normalizedNotes, "[Sources]", ...sourceLines].filter(Boolean).join("\n");
}

function defineMasters(
  presentation: PptxPresentation,
  deck: DeckIRInput,
  canvas: CanvasMetrics,
  bodyFont: string,
): Map<string, string> {
  const theme = asRecord(deck.theme);
  const themeBackground = readColor(theme, "background") ?? "FFFFFF";
  presentation.defineSlideMaster({
    title: DEFAULT_MASTER,
    background: { color: themeBackground },
    objects: [],
  });
  const names = new Map<string, string>();
  names.set("", DEFAULT_MASTER);
  const configuredMasters = readMasters(theme);
  for (const master of configuredMasters) {
    const id = stringValue(master.id ?? master.name);
    if (!id) {
      continue;
    }
    const masterName = `LT_MASTER_${id}`;
    const objects = arrayValue(master.elements ?? master.objects)
      .map((element) => toMasterObject(element, canvas, bodyFont))
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
    const background = asRecord(master.background);
    presentation.defineSlideMaster({
      title: masterName,
      background: {
        color: normalizeColor(stringValue(background.color) || themeBackground),
      },
      objects,
    });
    names.set(id, masterName);
  }
  for (const slide of deck.slides) {
    if (slide.masterId && !names.has(slide.masterId)) {
      const masterName = `LT_MASTER_${slide.masterId}`;
      presentation.defineSlideMaster({
        title: masterName,
        background: { color: themeBackground },
        objects: [],
      });
      names.set(slide.masterId, masterName);
    }
  }
  return names;
}

function toMasterObject(
  candidate: unknown,
  canvas: CanvasMetrics,
  bodyFont: string,
): PptxOptionRecord | undefined {
  const element = normalizeElement(candidate);
  const frame = toInches(element.frame, canvas);
  const name = `lt:master:${element.id}`;
  if (element.type === "text") {
    const textElement = element as TextElementIR;
    return {
      text: {
        text: textElement.text ?? "",
        options: {
          ...frame,
          objectName: name,
          fontFace: textElement.style?.fontFace ?? bodyFont,
          fontSize: logicalFontSizeToPoints(textElement.style?.fontSize ?? 12, canvas),
          color: normalizeColor(textElement.style?.color ?? "000000"),
          margin: textElement.style?.margin ?? 0,
        },
      },
    };
  }
  if (element.type === "image" || element.type === "icon") {
    const source = resolveImageSource(element as unknown as UnknownRecord);
    return source
      ? {
          image: {
            ...source,
            ...frame,
            objectName: name,
            altText: element.alt ?? "",
          },
        }
      : undefined;
  }
  if (element.type === "shape") {
    const shape = element as ShapeElementIR;
    return {
      rect: {
        ...frame,
        objectName: name,
        fill: toShapeFill(shape.fill, shape.opacity),
        line: toShapeLine(shape.line, shape.opacity),
      },
    };
  }
  if (element.type === "line" || element.type === "connector") {
    const line = element as LineElementIR;
    return {
      line: {
        ...frame,
        objectName: name,
        line: toShapeLine(line.line ?? line.stroke, line.opacity),
      },
    };
  }
  return undefined;
}

function applySlideBackground(slide: PptxSlide, candidate: unknown): void {
  const background = asRecord(candidate);
  const color = stringValue(background.color);
  if (color) {
    slide.background = {
      color: normalizeColor(color),
      transparency: numberValue(background.transparency),
    };
  }
}

async function convertNamedLinesToConnectors(
  data: Uint8Array,
  connectorNamesBySlide: ReadonlyArray<ReadonlyArray<string>>,
): Promise<Uint8Array> {
  if (!connectorNamesBySlide.some((names) => names.length > 0)) {
    return data;
  }
  const zip = await JSZip.loadAsync(data);
  for (let index = 0; index < connectorNamesBySlide.length; index += 1) {
    const names = connectorNamesBySlide[index];
    if (names.length === 0) {
      continue;
    }
    const path = `ppt/slides/slide${index + 1}.xml`;
    const file = zip.file(path);
    if (!file) {
      throw new PptxRenderError(`Generated PPTX is missing ${path}.`, [
        {
          code: "pptx.missing-slide-xml",
          message: `Generated PPTX is missing ${path}.`,
        },
      ]);
    }
    let xml = await file.async("string");
    for (const name of names) {
      xml = convertConnectorBlock(xml, name);
    }
    zip.file(path, xml);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function convertConnectorBlock(xml: string, name: string): string {
  const marker = `name="${escapeXmlAttribute(name)}"`;
  const markerIndex = xml.indexOf(marker);
  if (markerIndex < 0) {
    throw new PptxRenderError(`Unable to find generated connector ${name}.`, [
      {
        code: "pptx.connector-name-missing",
        message: `Unable to find generated connector ${name}.`,
      },
    ]);
  }
  const start = xml.lastIndexOf("<p:sp>", markerIndex);
  const endStart = xml.indexOf("</p:sp>", markerIndex);
  if (start < 0 || endStart < 0) {
    throw new PptxRenderError(`Generated connector ${name} is not a shape.`, [
      {
        code: "pptx.connector-shape-missing",
        message: `Generated connector ${name} is not a shape.`,
      },
    ]);
  }
  const end = endStart + "</p:sp>".length;
  const block = xml.slice(start, end);
  if (!block.includes('prst="line"')) {
    throw new PptxRenderError(
      `Generated connector ${name} does not use line geometry.`,
      [
        {
          code: "pptx.connector-invalid-geometry",
          message: `Generated connector ${name} does not use line geometry.`,
        },
      ],
    );
  }
  const converted = block
    .replace("<p:sp>", "<p:cxnSp>")
    .replace("</p:sp>", "</p:cxnSp>")
    .replace("<p:nvSpPr>", "<p:nvCxnSpPr>")
    .replace("</p:nvSpPr>", "</p:nvCxnSpPr>")
    .replace(/<p:cNvSpPr(?:\s[^>]*)?\/>/, "<p:cNvCxnSpPr/>");
  return `${xml.slice(0, start)}${converted}${xml.slice(end)}`;
}

function getCanvas(deck: DeckIRInput): CanvasMetrics {
  return {
    width: deck.canvas.width,
    height: deck.canvas.height,
    widthInch: deck.canvas.pptxWidthInch ?? DEFAULT_WIDTH_INCH,
    heightInch: deck.canvas.pptxHeightInch ?? DEFAULT_HEIGHT_INCH,
  };
}

function toInches(frame: FrameIR, canvas: CanvasMetrics): FrameIR {
  return {
    x: (frame.x * canvas.widthInch) / canvas.width,
    y: (frame.y * canvas.heightInch) / canvas.height,
    w: (frame.w * canvas.widthInch) / canvas.width,
    h: (frame.h * canvas.heightInch) / canvas.height,
  };
}

function normalizeFrame(candidate: unknown): FrameIR {
  const record = asRecord(candidate);
  return {
    x: numberValue(record.x) ?? 0,
    y: numberValue(record.y) ?? 0,
    w: numberValue(record.w) ?? 0,
    h: numberValue(record.h) ?? 0,
  };
}

function resolveImageSource(
  record: UnknownRecord,
): { path: string } | { data: string } | undefined {
  const asset = asRecord(record.asset);
  const data = stringValue(record.data ?? asset.data);
  if (data) {
    return { data };
  }
  const path = stringValue(
    record.path ??
      record.src ??
      record.absolutePath ??
      record.resolvedPath ??
      asset.absolutePath ??
      asset.path,
  );
  if (path.startsWith("data:image/")) {
    return { data: path };
  }
  return path ? { path } : undefined;
}

function toShapeFill(
  fill: FillIR | undefined,
  elementOpacity?: number,
): PptxOptionRecord | undefined {
  if (fill?.type === "none") {
    return { type: "none" };
  }
  if (!fill?.color) {
    return undefined;
  }
  return {
    color: normalizeColor(fill.color),
    transparency: combineTransparency(fill, elementOpacity),
  };
}

function toShapeLine(
  line: StrokeIR | undefined,
  elementOpacity?: number,
): PptxOptionRecord | undefined {
  if (!line) {
    return undefined;
  }
  return {
    color: normalizeColor(line.color ?? "333333"),
    transparency: combineTransparency(line, elementOpacity),
    width: line.width ?? 1,
    dashType: line.dash === "dot" ? "sysDot" : line.dash,
    beginArrowType: line.beginArrow,
    endArrowType: line.endArrow,
  };
}

function toBorder(line: StrokeIR | undefined): PptxOptionRecord | undefined {
  if (!line) {
    return undefined;
  }
  return {
    color: normalizeColor(line.color ?? "D0D0D0"),
    pt: line.width ?? 1,
    type: line.dash === "dash" ? "dash" : "solid",
  };
}

function combineTransparency(
  fill: FillIR,
  elementOpacity?: number,
): number | undefined {
  const fillTransparency =
    fill.transparency ??
    (fill.opacity === undefined ? 0 : opacityToTransparency(fill.opacity)) ??
    0;
  if (elementOpacity === undefined) {
    return fillTransparency || undefined;
  }
  const fillAlpha = 1 - fillTransparency / 100;
  const alpha = fillAlpha * clamp(elementOpacity, 0, 1);
  return Math.round((1 - alpha) * 100);
}

function opacityToTransparency(opacity: number | undefined): number | undefined {
  if (opacity === undefined) {
    return undefined;
  }
  return Math.round((1 - clamp(opacity, 0, 1)) * 100);
}

function toBullet(
  bullet: ParagraphIR["bullet"],
): boolean | PptxOptionRecord | undefined {
  if (!bullet || bullet === true) {
    return bullet;
  }
  return {
    type: bullet.type,
    characterCode: bullet.characterCode,
    indent: bullet.indent,
    numberStartAt: bullet.numberStartAt,
  };
}

function mapValign(
  valign: TextStyleIR["valign"],
): "top" | "mid" | "bottom" | undefined {
  if (valign === "middle") {
    return "mid";
  }
  return valign;
}

function mapShapeName(value: string): string {
  const aliases: Record<string, string> = {
    rectangle: "rect",
    roundedRectangle: "roundRect",
    roundedRect: "roundRect",
    circle: "ellipse",
    oval: "ellipse",
  };
  return aliases[value] ?? value;
}

function normalizeColor(value: string): string {
  const trimmed = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return trimmed
      .split("")
      .map((character) => character + character)
      .join("")
      .toUpperCase();
  }
  if (/^[0-9a-f]{8}$/i.test(trimmed)) {
    return trimmed.slice(0, 6).toUpperCase();
  }
  return /^[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function readFontFamily(
  theme: UnknownRecord,
  role: "body" | "heading",
): string | undefined {
  const fonts = asRecord(theme.fonts);
  const roleValue = fonts[role];
  if (typeof roleValue === "string") {
    return roleValue;
  }
  const roleRecord = asRecord(roleValue);
  return stringValue(roleRecord.family ?? roleRecord.fontFace);
}

function readColor(theme: UnknownRecord, role: string): string | undefined {
  const colors = asRecord(theme.colors);
  return stringValue(colors[role]);
}

function readMasters(theme: UnknownRecord): UnknownRecord[] {
  const masters = theme.masters;
  if (Array.isArray(masters)) {
    return masters.map(asRecord);
  }
  const record = asRecord(masters);
  return Object.entries(record).map(([id, value]) => ({ id, ...asRecord(value) }));
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isBoldWeight(fontWeight: number | undefined): boolean | undefined {
  return fontWeight === undefined ? undefined : fontWeight >= 600;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function toUint8Array(value: string | ArrayBuffer | Blob | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  throw new TypeError("PptxGenJS returned an unsupported output type.");
}
