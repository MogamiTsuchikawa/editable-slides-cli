import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import PptxGenJSModule from "pptxgenjs";
import { PptxRenderError, StrictEditableError } from "./errors.js";
import type {
  AudioElementIR,
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
  VideoElementIR,
} from "./types.js";

const LAYOUT_NAME = "EDITABLE_SLIDES_WIDE";
const DEFAULT_MASTER = "LT_DEFAULT_MASTER";
const DEFAULT_WIDTH_INCH = 13.333333;
const DEFAULT_HEIGHT_INCH = 7.5;
const SUPPORTED_TYPES = new Set([
  "text",
  "image",
  "icon",
  "video",
  "audio",
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

interface PptxChartSeries {
  name: string;
  labels: string[];
  values: number[];
}

interface PptxScatterSeries {
  name: string;
  values: Array<number | undefined>;
}

interface PptxSlide {
  background: PptxOptionRecord;
  addText(text: string | PptxTextRun[], options?: PptxOptionRecord): unknown;
  addImage(options: PptxOptionRecord): unknown;
  addMedia(options: PptxOptionRecord): unknown;
  addShape(shapeName: string, options?: PptxOptionRecord): unknown;
  addTable(rows: PptxTableCell[][], options?: PptxOptionRecord): unknown;
  addChart(type: unknown, data: unknown, options?: PptxOptionRecord): unknown;
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
  slideTitleElementId?: string;
  defaultCaptionLanguage: string;
  canvas: CanvasMetrics;
  defaultBodyFont: string;
  defaultHeadingFont: string;
  objectNames: string[];
  connectorNames: string[];
  imageAdjustments: ImageAdjustment[];
  audioMediaAdjustments: AudioMediaAdjustment[];
  mediaCaptionAdjustments: MediaCaptionAdjustment[];
  accessibilityAdjustments: AccessibilityAdjustment[];
  chartAdjustments: ChartAdjustment[];
}

interface MediaCaptionAdjustment {
  name: string;
  data: Uint8Array;
  contentHash: string;
  language: string;
  label: string;
}

interface AudioMediaAdjustment {
  name: string;
}

interface AccessibilityAdjustment {
  name: string;
  altText?: string;
  decorative?: boolean;
  slideTitle?: boolean;
  tableHeader?: boolean;
}

interface ChartAdjustment {
  showCategoryName: boolean;
  scatterSeries: ScatterSeriesAdjustment[];
}

interface ScatterSeriesAdjustment {
  xColumn: number;
  yColumn: number;
  pointCount: number;
  xValues: number[];
  yValues: number[];
}

interface ImageAdjustment {
  name: string;
  altText?: string;
  fit?: ImageElementIR["fit"];
  crop?: ImageElementIR["crop"];
  sourceRectangle?: SourceRectangle;
  focalPosition?: ImageElementIR["focalPosition"];
  mask?: ImageElementIR["mask"];
}

interface SourceRectangle {
  left: number;
  right: number;
  top: number;
  bottom: number;
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
  const imageAdjustmentsBySlide: ImageAdjustment[][] = [];
  const audioMediaAdjustmentsBySlide: AudioMediaAdjustment[][] = [];
  const mediaCaptionAdjustmentsBySlide: MediaCaptionAdjustment[][] = [];
  const accessibilityAdjustmentsBySlide: AccessibilityAdjustment[][] = [];
  const chartAdjustments: ChartAdjustment[] = [];

  for (const slideIR of deck.slides) {
    const masterName = masters.get(slideIR.masterId ?? "") ?? DEFAULT_MASTER;
    const slide = presentation.addSlide({ masterName });
    const elements = flattenElements(slideIR.elements);
    const slideTitleElementId = selectSlideTitleElementId(elements);

    const context: RenderContext = {
      slideId: slideIR.id,
      slideTitleElementId,
      defaultCaptionLanguage: deck.metadata.language?.trim() ?? "",
      canvas,
      defaultBodyFont: bodyFont,
      defaultHeadingFont: headingFont,
      objectNames: allObjectNames,
      connectorNames: [],
      imageAdjustments: [],
      audioMediaAdjustments: [],
      mediaCaptionAdjustments: [],
      accessibilityAdjustments: [],
      chartAdjustments,
    };
    await renderSlideBackground(slide, slideIR.background, context);
    sortElementsForReadingOrder(elements, slideTitleElementId);

    for (const flattened of elements) {
      await renderElement(slide, flattened, context);
    }

    const noteText = formatNotes(
      slideIR.notes?.plainText ?? slideIR.notes?.markdown ?? "",
      slideIR.notes?.sources ?? [],
    );
    if (noteText.length > 0) {
      slide.addNotes(noteText);
    }
    connectorsBySlide.push(context.connectorNames);
    imageAdjustmentsBySlide.push(context.imageAdjustments);
    audioMediaAdjustmentsBySlide.push(context.audioMediaAdjustments);
    mediaCaptionAdjustmentsBySlide.push(context.mediaCaptionAdjustments);
    accessibilityAdjustmentsBySlide.push(context.accessibilityAdjustments);
  }

  const generated = await presentation.write({
    outputType: "uint8array",
    compression: options.compression ?? true,
  });
  const bytes = toUint8Array(generated);
  const connectorsConverted = await convertNamedLinesToConnectors(
    bytes,
    connectorsBySlide,
  );
  const imagesAdjusted = await adjustNamedImages(
    connectorsConverted,
    imageAdjustmentsBySlide,
  );
  const audioNormalized = await normalizeNativeAudioMedia(
    imagesAdjusted,
    audioMediaAdjustmentsBySlide,
  );
  const postprocessed = await convertNamedMasterShapeGeometry(
    audioNormalized,
    readMasterShapePresets(theme),
  );
  const chartsAdjusted = await adjustChartDataLabels(postprocessed, chartAdjustments);
  const captionsEmbedded = await embedMediaCaptions(
    chartsAdjusted,
    mediaCaptionAdjustmentsBySlide,
  );
  const accessibilityAdjusted = await adjustAccessibilityMetadata(
    captionsEmbedded,
    accessibilityAdjustmentsBySlide,
  );
  return {
    data: accessibilityAdjusted,
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
      if (type === "video" || type === "audio") {
        const source = stringValue(record.src);
        const mimeType = stringValue(record.mimeType);
        const captionSource = stringValue(record.captionSrc);
        const captionMimeType = stringValue(record.captionMimeType);
        const hasCaptionMetadata =
          record.captionSrc !== undefined ||
          record.captionContentHash !== undefined ||
          record.captionMimeType !== undefined ||
          record.captionLanguage !== undefined ||
          record.captionLabel !== undefined;
        if (!source || !isLocalMediaSource(source)) {
          diagnostics.push({
            code: "media.invalid-source",
            message: `Media ${id} needs a local file path; remote URLs and data URIs are not supported.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        const supportedMimeTypes =
          type === "video" ? ["video/mp4"] : ["audio/mp4", "audio/mpeg"];
        if (
          stringValue(record.alt).trim() === "" &&
          stringValue(record.transcript).trim() === ""
        ) {
          diagnostics.push({
            code: "media.missing-alternative",
            message: `Media ${id} requires non-empty alt text or transcript.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (!supportedMimeTypes.includes(mimeType)) {
          diagnostics.push({
            code: "media.unsupported-mime-type",
            message: `Media ${id} uses unsupported MIME type: ${mimeType || "(missing)"}`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (
          source &&
          isLocalMediaSource(source) &&
          supportedMimeTypes.includes(mimeType) &&
          !hasSupportedMediaExtension(source, type, mimeType)
        ) {
          diagnostics.push({
            code: "media.extension-mismatch",
            message: `Media ${id} file extension does not match ${mimeType}.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (captionSource) {
          if (
            !isLocalMediaSource(captionSource) ||
            !captionSource.toLowerCase().endsWith(".vtt")
          ) {
            diagnostics.push({
              code: "media.caption-invalid-source",
              message: `Media ${id} captions need a local .vtt file path; remote URLs and data URIs are not supported.`,
              slideId: slide.id,
              elementId: id,
            });
          }
          if (captionMimeType !== "text/vtt") {
            diagnostics.push({
              code: "media.caption-unsupported-mime-type",
              message: `Media ${id} captions must use text/vtt.`,
              slideId: slide.id,
              elementId: id,
            });
          }
        } else if (hasCaptionMetadata) {
          diagnostics.push({
            code: "media.caption-missing-source",
            message: `Media ${id} needs captionSrc when caption metadata is provided.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (
          record.captionLanguage !== undefined &&
          stringValue(record.captionLanguage).trim() === ""
        ) {
          diagnostics.push({
            code: "media.caption-invalid-language",
            message: `Media ${id} captionLanguage must be a non-empty string.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (
          record.captionLabel !== undefined &&
          stringValue(record.captionLabel).trim() === ""
        ) {
          diagnostics.push({
            code: "media.caption-invalid-label",
            message: `Media ${id} captionLabel must be a non-empty string.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        const poster = stringValue(record.posterSrc);
        if (type === "video" && !poster) {
          diagnostics.push({
            code: "media.missing-poster",
            message: `Video ${id} requires a PNG poster.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (poster && !isPngPosterSource(poster)) {
          diagnostics.push({
            code: "media.invalid-poster",
            message: `Media ${id} poster must be a local PNG path or PNG data URI.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (numberValue(record.rotation) !== undefined && record.rotation !== 0) {
          diagnostics.push({
            code: "media.unsupported-rotation",
            message: `Media ${id} cannot be rotated in the PPTX renderer.`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (numberValue(record.opacity) !== undefined && record.opacity !== 1) {
          diagnostics.push({
            code: "media.unsupported-opacity",
            message: `Media ${id} must use full opacity in the PPTX renderer.`,
            slideId: slide.id,
            elementId: id,
          });
        }
      }
      if (type === "chart") {
        const chartType = stringValue(record.chartType ?? record.chart) || "bar";
        if (
          ![
            "bar",
            "line",
            "pie",
            "doughnut",
            "area",
            "scatter",
            "radar",
            "stacked",
            "combo",
          ].includes(chartType)
        ) {
          diagnostics.push({
            code: "chart.unsupported-type",
            message: `Chart ${id} uses unsupported chart type: ${chartType}`,
            slideId: slide.id,
            elementId: id,
          });
        }
        if (
          chartType === "combo" &&
          Array.isArray(record.series) &&
          record.series.some(
            (series) => stringValue(asRecord(series).chartType) === "scatter",
          )
        ) {
          diagnostics.push({
            code: "chart.unsupported-combo-scatter",
            message: `Chart ${id} cannot combine scatter series with category-based chart series in PowerPoint.`,
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

function selectSlideTitleElementId(
  elements: ReadonlyArray<FlattenedElement>,
): string | undefined {
  const textElements = elements.filter((candidate) => {
    if (candidate.element.type !== "text") return false;
    const text = candidate.element as TextElementIR;
    return (text.text ?? paragraphsToPlainText(text.paragraphs)).trim().length > 0;
  });
  const explicitTitles = textElements.filter(
    (candidate) => (candidate.element as TextElementIR).role === "title",
  );
  const candidates = explicitTitles.length > 0 ? explicitTitles : textElements;
  return [...candidates]
    .sort(
      (left, right) =>
        left.frame.y - right.frame.y ||
        left.frame.x - right.frame.x ||
        left.zIndex - right.zIndex,
    )
    .at(0)?.element.id;
}

function sortElementsForReadingOrder(
  elements: FlattenedElement[],
  slideTitleElementId: string | undefined,
): void {
  const sourceOrder = new Map(
    elements.map((element, index) => [element, index] as const),
  );
  const groups = new Map<
    string,
    {
      connectorRank: number;
      zIndex: number;
      firstSourceIndex: number;
      elements: FlattenedElement[];
    }
  >();
  for (const element of elements) {
    const connectorRank = element.element.type === "connector" ? 0 : 1;
    const key = `${connectorRank}:${element.zIndex}`;
    const existing = groups.get(key);
    if (existing) {
      existing.elements.push(element);
      continue;
    }
    groups.set(key, {
      connectorRank,
      zIndex: element.zIndex,
      firstSourceIndex: sourceOrder.get(element) ?? 0,
      elements: [element],
    });
  }

  const ordered = [...groups.values()]
    .sort(
      (left, right) =>
        left.connectorRank - right.connectorRank ||
        left.zIndex - right.zIndex ||
        left.firstSourceIndex - right.firstSourceIndex,
    )
    .flatMap((group) =>
      sortNonOverlappingElements(group.elements, sourceOrder, slideTitleElementId),
    );
  elements.splice(0, elements.length, ...ordered);
}

function sortNonOverlappingElements(
  elements: ReadonlyArray<FlattenedElement>,
  sourceOrder: ReadonlyMap<FlattenedElement, number>,
  slideTitleElementId: string | undefined,
): FlattenedElement[] {
  if (elements.length < 2) return [...elements];

  const parent = elements.map((_element, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root] ?? root;
    }
    while (parent[index] !== index) {
      const next = parent[index] ?? root;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let left = 0; left < elements.length; left += 1) {
    for (let right = left + 1; right < elements.length; right += 1) {
      const leftElement = elements[left];
      const rightElement = elements[right];
      if (
        leftElement &&
        rightElement &&
        framesOverlap(
          rotatedFrameBounds(leftElement.frame, leftElement.rotation),
          rotatedFrameBounds(rightElement.frame, rightElement.rotation),
        )
      ) {
        union(left, right);
      }
    }
  }

  const componentMembers = new Map<number, FlattenedElement[]>();
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element) continue;
    const root = find(index);
    const members = componentMembers.get(root) ?? [];
    members.push(element);
    componentMembers.set(root, members);
  }

  const components = [...componentMembers.values()].map((members) => {
    members.sort(
      (left, right) => (sourceOrder.get(left) ?? 0) - (sourceOrder.get(right) ?? 0),
    );
    return {
      members,
      bounds: containingFrame(
        members.map((member) => rotatedFrameBounds(member.frame, member.rotation)),
      ),
      containsTitle: members.some(
        (member) => member.element.id === slideTitleElementId,
      ),
      firstSourceIndex: sourceOrder.get(members[0] as FlattenedElement) ?? 0,
    };
  });

  const titleComponents = components.filter((component) => component.containsTitle);
  const contentComponents = components.filter((component) => !component.containsTitle);
  return [
    ...orderReadingRows(titleComponents),
    ...orderReadingRows(contentComponents),
  ].flatMap((component) => component.members);
}

function orderReadingRows<
  T extends {
    bounds: FrameIR;
    firstSourceIndex: number;
  },
>(components: ReadonlyArray<T>): T[] {
  const rows: Array<{
    anchorY: number;
    minimumHeight: number;
    components: T[];
  }> = [];
  const topToBottom = [...components].sort(
    (left, right) =>
      left.bounds.y - right.bounds.y ||
      left.bounds.x - right.bounds.x ||
      left.firstSourceIndex - right.firstSourceIndex,
  );
  for (const component of topToBottom) {
    const currentRow = rows.at(-1);
    const tolerance = currentRow
      ? Math.max(1, Math.min(currentRow.minimumHeight, component.bounds.h) * 0.1)
      : 0;
    if (currentRow && Math.abs(component.bounds.y - currentRow.anchorY) <= tolerance) {
      currentRow.components.push(component);
      currentRow.minimumHeight = Math.min(currentRow.minimumHeight, component.bounds.h);
      continue;
    }
    rows.push({
      anchorY: component.bounds.y,
      minimumHeight: component.bounds.h,
      components: [component],
    });
  }
  return rows.flatMap((row) =>
    row.components.sort(
      (left, right) =>
        left.bounds.x - right.bounds.x ||
        left.bounds.y - right.bounds.y ||
        left.firstSourceIndex - right.firstSourceIndex,
    ),
  );
}

function rotatedFrameBounds(frame: FrameIR, rotation: number): FrameIR {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const width = frame.w * cosine + frame.h * sine;
  const height = frame.w * sine + frame.h * cosine;
  return {
    x: frame.x + frame.w / 2 - width / 2,
    y: frame.y + frame.h / 2 - height / 2,
    w: width,
    h: height,
  };
}

function framesOverlap(left: FrameIR, right: FrameIR): boolean {
  return (
    left.x < right.x + right.w &&
    right.x < left.x + left.w &&
    left.y < right.y + right.h &&
    right.y < left.y + left.h
  );
}

function containingFrame(frames: ReadonlyArray<FrameIR>): FrameIR {
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.w));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
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

async function renderElement(
  slide: PptxSlide,
  flattened: FlattenedElement,
  context: RenderContext,
): Promise<void> {
  const { element, frame, rotation } = flattened;
  switch (element.type) {
    case "text":
      renderText(slide, element as TextElementIR, frame, rotation, context);
      break;
    case "image":
    case "icon":
      await renderImage(slide, element as ImageElementIR, frame, rotation, context);
      break;
    case "video":
      await renderMedia(slide, element as VideoElementIR, frame, context);
      break;
    case "audio":
      await renderMedia(slide, element as AudioElementIR, frame, context);
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

async function renderMedia(
  slide: PptxSlide,
  element: VideoElementIR | AudioElementIR,
  logicalFrame: FrameIR,
  context: RenderContext,
): Promise<void> {
  const frame = toInches(logicalFrame, context.canvas);
  const name = registerObjectName(element, context);
  const cover = await resolveMediaCover(element.posterSrc);
  const caption = element.captionSrc
    ? await readMediaCaption(element, context)
    : undefined;
  const sourceRectangle =
    element.type === "video" && element.posterSrc
      ? automaticSourceRectangle(
          element.fit === "cover" ? "cover" : "contain",
          await readImageDimensions({ src: element.posterSrc }),
          logicalFrame,
        )
      : undefined;
  slide.addMedia({
    ...frame,
    type: element.type,
    path: element.src,
    objectName: name,
    ...(cover ? { cover } : {}),
  });
  context.imageAdjustments.push({
    name,
    altText: element.alt ?? element.transcript ?? "",
    ...(sourceRectangle ? { sourceRectangle } : {}),
  });
  if (element.type === "audio") {
    context.audioMediaAdjustments.push({ name });
  }
  if (caption) {
    context.mediaCaptionAdjustments.push({
      name,
      data: caption.data,
      contentHash: caption.contentHash,
      language: element.captionLanguage?.trim() || context.defaultCaptionLanguage,
      label: element.captionLabel?.trim() || "字幕",
    });
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
  if (element.id === context.slideTitleElementId) {
    context.accessibilityAdjustments.push({ name, slideTitle: true });
  }
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
    recordObjectAccessibility(element, name, context, false);
    return;
  }
  slide.addShape(shape, {
    ...frame,
    objectName: name,
    rotate: rotation,
    fill,
    line,
  });
  recordObjectAccessibility(element, name, context, true);
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
  recordObjectAccessibility(element, name, context, true);
}

async function renderImage(
  slide: PptxSlide,
  element: ImageElementIR,
  logicalFrame: FrameIR,
  rotation: number,
  context: RenderContext,
): Promise<void> {
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
          type: element.fit === "crop" ? "cover" : element.fit,
          w: frame.w,
          h: frame.h,
        }
      : undefined;
  const sourceRectangle =
    element.fit && element.fit !== "stretch" && !element.crop
      ? automaticSourceRectangle(
          element.fit === "crop" ? "cover" : element.fit,
          await readImageDimensions(element),
          logicalFrame,
        )
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
    rounding: element.mask?.type === "circle",
    shadow: element.shadow
      ? {
          type: "outer",
          color: normalizeColor(element.shadow.color),
          opacity: element.shadow.opacity,
          blur: element.shadow.blur,
          offset: element.shadow.distance,
          angle: element.shadow.angle,
        }
      : undefined,
    transparency: opacityToTransparency(element.opacity),
  });
  if (element.decorative === true || element.role === "background") {
    context.accessibilityAdjustments.push({ name, decorative: true });
  }
  if (
    element.crop ||
    sourceRectangle ||
    element.focalPosition ||
    element.mask?.type === "roundRect"
  ) {
    context.imageAdjustments.push({
      name,
      fit: element.fit,
      ...(element.crop ? { crop: element.crop } : {}),
      ...(sourceRectangle ? { sourceRectangle } : {}),
      ...(element.focalPosition ? { focalPosition: element.focalPosition } : {}),
      ...(element.mask ? { mask: element.mask } : {}),
    });
  }
  if (element.border && (element.border.width ?? 0) > 0) {
    slide.addShape(
      element.mask?.type === "circle"
        ? "ellipse"
        : element.mask?.type === "roundRect"
          ? "roundRect"
          : "rect",
      {
        ...frame,
        objectName: `aux:${name}:border`,
        fill: { color: "FFFFFF", transparency: 100 },
        line: {
          color: normalizeColor(element.border.color ?? "000000"),
          transparency:
            element.border.transparency === undefined
              ? undefined
              : Math.round(element.border.transparency * 100),
          width: element.border.width ?? 1,
          dashType: element.border.dash === "dot" ? "sysDot" : element.border.dash,
        },
      },
    );
    context.accessibilityAdjustments.push({
      name: `aux:${name}:border`,
      decorative: true,
    });
  }
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
  const defaultRowHeight = logicalFrame.h / Math.max(1, element.rows.length);
  const rowH = sourceRowHeights.some((height) => height !== undefined)
    ? sourceRowHeights.map(
        (height) =>
          ((height ?? defaultRowHeight) * context.canvas.heightInch) /
          context.canvas.height,
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
  context.accessibilityAdjustments.push({
    name,
    ...(element.alt?.trim() ? { altText: element.alt.trim() } : {}),
    ...(headerRows > 0 ? { tableHeader: true } : {}),
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
  const series: PptxChartSeries[] = element.series?.length
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
  const nativeChartType = chartType === "stacked" ? "bar" : chartType;
  const fallbackColors = element.colors ?? chartStyle.colors ?? [];
  const hasSeriesColors = element.series?.some((item) => Boolean(item.color)) ?? false;
  const configuredColors = hasSeriesColors
    ? (element.series ?? []).map(
        (item, index) =>
          item.color ??
          fallbackColors[index % Math.max(1, fallbackColors.length)] ??
          "#2563EB",
      )
    : fallbackColors;
  const comboTypes =
    chartType === "combo"
      ? series.map((item, index) => ({
          type: element.series?.[index]?.chartType ?? (index === 0 ? "bar" : "line"),
          data: [item],
          options: {
            ...(configuredColors[index]
              ? { chartColors: [normalizeColor(configuredColors[index])] }
              : {}),
          },
        }))
      : undefined;
  const scatterData =
    chartType === "scatter"
      ? toPptxScatterData(series, element.categoryAxisTitle)
      : undefined;
  const pptxChartColors =
    chartType === "scatter"
      ? scatterChartColors(configuredColors, series.length)
      : configuredColors;
  const legendPosition =
    element.legendPosition === "top"
      ? "t"
      : element.legendPosition === "left"
        ? "l"
        : element.legendPosition === "right"
          ? "r"
          : "b";
  const valueAxisTitle = element.valueAxisTitle
    ? `${element.valueAxisTitle}${element.valueUnit ? `（${element.valueUnit}）` : ""}`
    : element.valueUnit
      ? `単位：${element.valueUnit}`
      : undefined;
  const chartOptions: PptxOptionRecord = {
    ...frame,
    objectName: name,
    altText: chartAlternativeText(element, series),
    title: element.title,
    showTitle: chartStyle.showTitle ?? Boolean(element.title),
    showLegend: element.showLegend ?? chartStyle.showLegend ?? series.length > 1,
    legendPos: legendPosition,
    showValue: element.showValue ?? chartStyle.showValue ?? false,
    chartColors:
      pptxChartColors.length > 0 ? pptxChartColors.map(normalizeColor) : undefined,
    showLabel: element.showCategoryName ?? chartStyle.showCategoryName ?? false,
    catAxisTitle: element.categoryAxisTitle,
    valAxisTitle: valueAxisTitle,
    showCatAxisTitle: Boolean(element.categoryAxisTitle),
    showValAxisTitle: Boolean(valueAxisTitle),
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
    ...(chartType === "doughnut" ? { holeSize: 55 } : {}),
    ...(chartType === "radar" ? { radarStyle: "marker" } : {}),
    ...(chartType === "stacked" ? { barGrouping: "stacked", barOverlapPct: 100 } : {}),
  };
  context.chartAdjustments.push({
    showCategoryName: element.showCategoryName ?? chartStyle.showCategoryName ?? false,
    scatterSeries: scatterSeriesAdjustments(chartType, series),
  });
  if (comboTypes) {
    slide.addChart(comboTypes, chartOptions);
  } else {
    slide.addChart(nativeChartType, scatterData ?? series, chartOptions);
  }
}

/**
 * PptxGenJS models scatter data differently from category charts: the first
 * item is an X-value vector and every following item is a visible Y series.
 * For independent X coordinates, helper X series are interleaved and removed
 * from the generated chart XML after PptxGenJS has built the editable workbook.
 */
function toPptxScatterData(
  series: ReadonlyArray<PptxChartSeries>,
  xAxisName?: string,
): PptxScatterSeries[] {
  if (series.length === 0) return [];
  const maxPointCount = Math.max(...series.map((item) => item.values.length));
  const padded = (values: ReadonlyArray<number>): Array<number | undefined> =>
    Array.from({ length: maxPointCount }, (_, index) => values[index]);
  return series.flatMap((item, index) => {
    const xValues = scatterXValues(item);
    return [
      {
        name: index === 0 ? (xAxisName ?? "X") : `${xAxisName ?? "X"} ${index + 1}`,
        values: padded(xValues),
      },
      { name: item.name, values: padded(item.values) },
    ];
  });
}

function scatterSeriesAdjustments(
  chartType: ChartElementIR["chartType"],
  series: ReadonlyArray<PptxChartSeries>,
): ScatterSeriesAdjustment[] {
  if (chartType !== "scatter") return [];
  return series.map((item, index) => ({
    xColumn: 1 + index * 2,
    yColumn: 2 + index * 2,
    pointCount: item.values.length,
    xValues: scatterXValues(item),
    yValues: item.values,
  }));
}

function scatterXValues(series: PptxChartSeries): number[] {
  return series.values.map((_, index) => {
    const label = series.labels[index]?.trim();
    if (label) {
      const numericLabel = Number(label);
      if (Number.isFinite(numericLabel)) return numericLabel;
    }
    return index + 1;
  });
}

function scatterChartColors(
  colors: ReadonlyArray<string>,
  seriesCount: number,
): string[] {
  if (colors.length === 0) return [];
  const expanded: string[] = [];
  for (let index = 0; index < seriesCount; index += 1) {
    if (index > 0) expanded.push("#000000");
    expanded.push(colors[index % colors.length] ?? colors[0] ?? "#2563EB");
  }
  return expanded;
}

function chartAlternativeText(
  element: ChartElementIR,
  series: ReadonlyArray<PptxChartSeries>,
): string {
  const authored = element.alt?.trim();
  if (authored) return authored;

  const title = element.title?.trim() ?? "";
  const unit = element.valueUnit?.trim() ?? "";
  const summaries = series.map((item) => {
    const values = item.values
      .map((value, index) => {
        const label = item.labels[index]?.trim() || String(index + 1);
        return `${label} ${value}${unit}`;
      })
      .join(", ");
    return item.name.trim() && item.name.trim() !== title
      ? `${item.name.trim()}: ${values}`
      : values;
  });
  return (
    [title, ...summaries].filter(Boolean).join(" — ").slice(0, 2_048) || element.id
  );
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

function recordObjectAccessibility(
  element: ElementIR,
  name: string,
  context: RenderContext,
  decorativeWhenUnlabelled: boolean,
): void {
  const altText = element.alt?.trim();
  const decorative =
    element.decorative === true || (decorativeWhenUnlabelled && !altText);
  if (!altText && !decorative) return;
  context.accessibilityAdjustments.push({
    name,
    ...(altText ? { altText } : {}),
    ...(decorative ? { decorative: true } : {}),
  });
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
    const background = asRecord(master.background);
    const backgroundImage = toMasterBackgroundObject(background, canvas, id);
    const objects = arrayValue(master.elements ?? master.objects)
      .map((element) => toMasterObject(element, canvas, bodyFont))
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
    presentation.defineSlideMaster({
      title: masterName,
      background: {
        color: normalizeColor(stringValue(background.color) || themeBackground),
      },
      objects: backgroundImage ? [backgroundImage, ...objects] : objects,
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

function toMasterBackgroundObject(
  background: UnknownRecord,
  canvas: CanvasMetrics,
  masterId: string,
): PptxOptionRecord | undefined {
  if (stringValue(background.type) !== "image") {
    return undefined;
  }
  const source = resolveImageSource(background);
  if (!source) {
    return undefined;
  }
  const fit = stringValue(background.fit) || "cover";
  return {
    image: {
      ...source,
      x: 0,
      y: 0,
      w: canvas.widthInch,
      h: canvas.heightInch,
      objectName: `background:master:${masterId}`,
      sizing:
        fit === "stretch"
          ? undefined
          : {
              type: fit,
              w: canvas.widthInch,
              h: canvas.heightInch,
            },
    },
  };
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
    const style = textElement.style ?? {};
    return {
      text: {
        text: textElement.text ?? paragraphsToPlainText(textElement.paragraphs),
        options: {
          ...frame,
          objectName: name,
          rotate: textElement.rotation,
          transparency: opacityToTransparency(textElement.opacity),
          fontFace: style.fontFace ?? bodyFont,
          fontSize: logicalFontSizeToPoints(style.fontSize ?? 12, canvas),
          color: normalizeColor(style.color ?? "000000"),
          bold: style.bold ?? isBoldWeight(style.fontWeight),
          italic: style.italic,
          align: style.align,
          valign: mapValign(style.valign ?? style.verticalAlign),
          margin: style.margin ?? 0,
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
            transparency: opacityToTransparency(element.opacity),
            rotate: element.rotation,
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
        line: toShapeLine(shape.line ?? shape.stroke, shape.opacity),
        rotate: shape.rotation,
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
        rotate: line.rotation,
      },
    };
  }
  return undefined;
}

interface MasterShapePreset {
  name: string;
  preset: string;
}

function readMasterShapePresets(theme: UnknownRecord): MasterShapePreset[] {
  const presets: MasterShapePreset[] = [];
  for (const master of readMasters(theme)) {
    for (const candidate of arrayValue(master.elements ?? master.objects)) {
      const element = normalizeElement(candidate);
      if (element.type !== "shape") {
        continue;
      }
      const shape = element as ShapeElementIR;
      const preset = mapShapeName(shape.shape ?? shape.shapeType ?? "rect");
      if (preset !== "rect") {
        presets.push({ name: `lt:master:${shape.id}`, preset });
      }
    }
  }
  return presets;
}

async function renderSlideBackground(
  slide: PptxSlide,
  candidate: unknown,
  context: RenderContext,
): Promise<void> {
  const background = asRecord(candidate);
  if (stringValue(background.type) === "image") {
    const source = resolveImageSource(background);
    if (!source) {
      throw new PptxRenderError("Slide image background has no source.", [
        {
          code: "background.missing-source",
          message: "Slide image background has no source.",
          slideId: context.slideId,
        },
      ]);
    }
    const fit = stringValue(background.fit) || "cover";
    const name = `background:${context.slideId}`;
    const sourceRectangle =
      fit === "stretch"
        ? undefined
        : automaticSourceRectangle(
            fit === "contain" ? "contain" : "cover",
            await readImageDimensions(background),
            {
              x: 0,
              y: 0,
              w: context.canvas.width,
              h: context.canvas.height,
            },
          );
    slide.addImage({
      ...source,
      x: 0,
      y: 0,
      w: context.canvas.widthInch,
      h: context.canvas.heightInch,
      objectName: name,
      altText: "",
      sizing:
        fit === "stretch"
          ? undefined
          : {
              type: fit,
              w: context.canvas.widthInch,
              h: context.canvas.heightInch,
            },
    });
    context.accessibilityAdjustments.push({ name, decorative: true });
    const focalPosition = asRecord(background.focalPosition);
    if (Object.keys(focalPosition).length > 0 || sourceRectangle) {
      context.imageAdjustments.push({
        name,
        fit: fit === "contain" || fit === "stretch" ? fit : "cover",
        ...(sourceRectangle ? { sourceRectangle } : {}),
        ...(Object.keys(focalPosition).length > 0
          ? {
              focalPosition: {
                x: numberValue(focalPosition.x) ?? 0.5,
                y: numberValue(focalPosition.y) ?? 0.5,
              },
            }
          : {}),
      });
    }
    return;
  }
  const color = stringValue(background.color);
  if (color) {
    slide.background = {
      color: normalizeColor(color),
      transparency: numberValue(background.transparency),
    };
  }
}

async function adjustNamedImages(
  data: Uint8Array,
  adjustmentsBySlide: ReadonlyArray<ReadonlyArray<ImageAdjustment>>,
): Promise<Uint8Array> {
  if (!adjustmentsBySlide.some((adjustments) => adjustments.length > 0)) {
    return data;
  }
  const zip = await JSZip.loadAsync(data);
  for (let index = 0; index < adjustmentsBySlide.length; index += 1) {
    const adjustments = adjustmentsBySlide[index];
    if (!adjustments || adjustments.length === 0) {
      continue;
    }
    const slidePath = `ppt/slides/slide${index + 1}.xml`;
    const slideFile = zip.file(slidePath);
    if (!slideFile) {
      throw new PptxRenderError(`Unable to adjust images in missing ${slidePath}.`, [
        {
          code: "pptx.image-slide-missing",
          message: `Unable to adjust images in missing ${slidePath}.`,
        },
      ]);
    }
    let xml = await slideFile.async("string");
    for (const adjustment of adjustments) {
      xml = adjustNamedImageBlock(xml, adjustment);
    }
    zip.file(slidePath, xml);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

async function normalizeNativeAudioMedia(
  data: Uint8Array,
  adjustmentsBySlide: ReadonlyArray<ReadonlyArray<AudioMediaAdjustment>>,
): Promise<Uint8Array> {
  if (!adjustmentsBySlide.some((adjustments) => adjustments.length > 0)) {
    return data;
  }

  const zip = await JSZip.loadAsync(data);
  for (let index = 0; index < adjustmentsBySlide.length; index += 1) {
    const adjustments = adjustmentsBySlide[index];
    if (!adjustments || adjustments.length === 0) continue;
    const slidePath = `ppt/slides/slide${index + 1}.xml`;
    const slideFile = zip.file(slidePath);
    if (!slideFile) {
      throw new PptxRenderError(`Unable to normalize audio in missing ${slidePath}.`, [
        {
          code: "pptx.audio-slide-missing",
          message: `Unable to normalize audio in missing ${slidePath}.`,
        },
      ]);
    }
    let xml = await slideFile.async("string");
    for (const adjustment of adjustments) {
      xml = normalizeNamedAudioBlock(xml, adjustment.name);
    }
    zip.file(slidePath, xml);
  }

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    throw new PptxRenderError(
      "Unable to normalize audio without [Content_Types].xml.",
      [
        {
          code: "pptx.audio-content-types-missing",
          message: "Unable to normalize audio without [Content_Types].xml.",
        },
      ],
    );
  }
  const contentTypes = await contentTypesFile.async("string");
  zip.file(
    "[Content_Types].xml",
    contentTypes.replace(/<Default\b[^>]*\/>/g, (entry) =>
      /\bExtension="m4a"/i.test(entry)
        ? entry.replace(/\bContentType="[^"]*"/, 'ContentType="audio/mp4"')
        : entry,
    ),
  );

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function normalizeNamedAudioBlock(xml: string, name: string): string {
  const marker = `name="${escapeXmlAttribute(name)}"`;
  const markerIndex = xml.indexOf(marker);
  const start = xml.lastIndexOf("<p:pic>", markerIndex);
  const endStart = xml.indexOf("</p:pic>", markerIndex);
  if (markerIndex < 0 || start < 0 || endStart < 0) {
    throw new PptxRenderError(
      `Unable to find generated audio object ${name} for normalization.`,
      [
        {
          code: "pptx.audio-name-missing",
          message: `Unable to find generated audio object ${name} for normalization.`,
        },
      ],
    );
  }

  const end = endStart + "</p:pic>".length;
  const block = xml.slice(start, end);
  if (block.includes("<a:audioFile")) return xml;
  if (!block.includes("<a:videoFile")) {
    throw new PptxRenderError(
      `Generated audio object ${name} has no native audio relationship marker.`,
      [
        {
          code: "pptx.audio-native-marker-missing",
          message: `Generated audio object ${name} has no native audio relationship marker.`,
        },
      ],
    );
  }
  const normalized = block
    .replace("<a:videoFile", "<a:audioFile")
    .replace("</a:videoFile>", "</a:audioFile>");
  return `${xml.slice(0, start)}${normalized}${xml.slice(end)}`;
}

const MEDIA_TRACK_RELATIONSHIP_TYPE =
  "http://schemas.microsoft.com/office/2017/04/relationships/track";
const MEDIA_TRACK_EXTENSION_URI = "{3AFAAA56-56D3-431D-BCD4-E75A35582382}";
const MEDIA_TRACK_NAMESPACE =
  "http://schemas.microsoft.com/office/powerpoint/2017/3/main";

async function embedMediaCaptions(
  data: Uint8Array,
  adjustmentsBySlide: ReadonlyArray<ReadonlyArray<MediaCaptionAdjustment>>,
): Promise<Uint8Array> {
  if (!adjustmentsBySlide.some((adjustments) => adjustments.length > 0)) {
    return data;
  }

  const zip = await JSZip.loadAsync(data);
  let trackNumber = 1;
  const trackFilesByContentHash = new Map<string, string>();
  for (let index = 0; index < adjustmentsBySlide.length; index += 1) {
    const adjustments = adjustmentsBySlide[index];
    if (!adjustments || adjustments.length === 0) continue;

    const slidePath = `ppt/slides/slide${index + 1}.xml`;
    const relationshipsPath = `ppt/slides/_rels/slide${index + 1}.xml.rels`;
    const slideFile = zip.file(slidePath);
    const relationshipsFile = zip.file(relationshipsPath);
    if (!slideFile || !relationshipsFile) {
      throw new PptxRenderError(
        `Unable to embed media captions in missing ${!slideFile ? slidePath : relationshipsPath}.`,
        [
          {
            code: "pptx.media-caption-part-missing",
            message: `Unable to embed media captions in missing ${!slideFile ? slidePath : relationshipsPath}.`,
          },
        ],
      );
    }

    let slideXml = await slideFile.async("string");
    let relationshipsXml = await relationshipsFile.async("string");
    for (const adjustment of adjustments) {
      let fileName = trackFilesByContentHash.get(adjustment.contentHash);
      if (!fileName) {
        while (zip.file(`ppt/media/track${trackNumber}.vtt`)) {
          trackNumber += 1;
        }
        fileName = `track${trackNumber}.vtt`;
        trackFilesByContentHash.set(adjustment.contentHash, fileName);
        zip.file(`ppt/media/${fileName}`, adjustment.data);
        trackNumber += 1;
      }
      const relationshipId = nextRelationshipId(relationshipsXml);
      const trackId = deterministicTrackGuid(adjustment);
      slideXml = adjustNamedMediaCaptionBlock(
        slideXml,
        adjustment,
        relationshipId,
        trackId,
      );
      relationshipsXml = addMediaTrackRelationship(
        relationshipsXml,
        relationshipId,
        fileName,
      );
    }
    zip.file(slidePath, slideXml);
    zip.file(relationshipsPath, relationshipsXml);
  }

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    throw new PptxRenderError(
      "Unable to embed media captions without [Content_Types].xml.",
      [
        {
          code: "pptx.media-caption-content-types-missing",
          message: "Unable to embed media captions without [Content_Types].xml.",
        },
      ],
    );
  }
  zip.file(
    "[Content_Types].xml",
    ensureVttContentType(await contentTypesFile.async("string")),
  );
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function adjustNamedMediaCaptionBlock(
  xml: string,
  adjustment: MediaCaptionAdjustment,
  relationshipId: string,
  trackId: string,
): string {
  const marker = `name="${escapeXmlAttribute(adjustment.name)}"`;
  const markerIndex = xml.indexOf(marker);
  const start = xml.lastIndexOf("<p:pic>", markerIndex);
  const endStart = xml.indexOf("</p:pic>", markerIndex);
  if (markerIndex < 0 || start < 0 || endStart < 0) {
    throw new PptxRenderError(
      `Unable to find generated media object ${adjustment.name} for captions.`,
      [
        {
          code: "pptx.media-caption-name-missing",
          message: `Unable to find generated media object ${adjustment.name} for captions.`,
        },
      ],
    );
  }

  const end = endStart + "</p:pic>".length;
  const block = xml.slice(start, end);
  if (block.includes("<p173:track ")) {
    throw new PptxRenderError(
      `Generated media object ${adjustment.name} already contains captions.`,
      [
        {
          code: "pptx.media-caption-duplicate",
          message: `Generated media object ${adjustment.name} already contains captions.`,
        },
      ],
    );
  }
  const trackXml =
    `<p14:extLst><p:ext uri="${MEDIA_TRACK_EXTENSION_URI}">` +
    `<p173:tracksInfo xmlns:p173="${MEDIA_TRACK_NAMESPACE}" displayLoc="media">` +
    `<p173:trackLst><p173:track id="${trackId}" label="${escapeXmlAttribute(
      adjustment.label,
    )}" lang="${escapeXmlAttribute(adjustment.language)}" r:embed="${relationshipId}"/>` +
    "</p173:trackLst></p173:tracksInfo></p:ext></p14:extLst>";
  let adjustedBlock: string;
  if (/<p14:media\b[^>]*\/>/.test(block)) {
    adjustedBlock = block.replace(
      /<p14:media\b([^>]*)\/>/,
      (_match, attributes: string) => `<p14:media${attributes}>${trackXml}</p14:media>`,
    );
  } else if (/<p14:media\b[^>]*>/.test(block) && block.includes("</p14:media>")) {
    adjustedBlock = block.replace("</p14:media>", `${trackXml}</p14:media>`);
  } else {
    throw new PptxRenderError(
      `Generated media object ${adjustment.name} has no native p14:media metadata.`,
      [
        {
          code: "pptx.media-caption-native-media-missing",
          message: `Generated media object ${adjustment.name} has no native p14:media metadata.`,
        },
      ],
    );
  }
  return `${xml.slice(0, start)}${adjustedBlock}${xml.slice(end)}`;
}

function nextRelationshipId(relationshipsXml: string): string {
  const used = new Set(
    [...relationshipsXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1])),
  );
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return `rId${candidate}`;
}

function addMediaTrackRelationship(
  relationshipsXml: string,
  relationshipId: string,
  fileName: string,
): string {
  if (!relationshipsXml.includes("</Relationships>")) {
    throw new PptxRenderError("Generated slide relationships are incomplete.", [
      {
        code: "pptx.media-caption-relationships-incomplete",
        message: "Generated slide relationships are incomplete.",
      },
    ]);
  }
  const relationship = `<Relationship Id="${relationshipId}" Type="${MEDIA_TRACK_RELATIONSHIP_TYPE}" Target="../media/${escapeXmlAttribute(fileName)}"/>`;
  return relationshipsXml.replace(
    "</Relationships>",
    `${relationship}</Relationships>`,
  );
}

function deterministicTrackGuid(adjustment: MediaCaptionAdjustment): string {
  const digest = createHash("sha256")
    .update("editable-slides-cli-media-caption\0")
    .update(adjustment.name)
    .update("\0")
    .update(adjustment.contentHash)
    .digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex").toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
}

function ensureVttContentType(xml: string): string {
  let found = false;
  const adjusted = xml.replace(/<Default\b[^>]*\/>/g, (tag) => {
    const extension = /\bExtension="([^"]*)"/.exec(tag)?.[1];
    if (extension?.toLowerCase() !== "vtt") return tag;
    if (found) return "";
    found = true;
    if (/\bContentType="[^"]*"/.test(tag)) {
      return tag.replace(/\bContentType="[^"]*"/, 'ContentType="text/vtt"');
    }
    return tag.replace(/\/>$/, ' ContentType="text/vtt"/>');
  });
  if (found) return adjusted;
  if (!adjusted.includes("</Types>")) {
    throw new PptxRenderError("Generated [Content_Types].xml is incomplete.", [
      {
        code: "pptx.media-caption-content-types-incomplete",
        message: "Generated [Content_Types].xml is incomplete.",
      },
    ]);
  }
  return adjusted.replace(
    "</Types>",
    '<Default Extension="vtt" ContentType="text/vtt"/></Types>',
  );
}

const DECORATIVE_EXTENSION_URI = "{C183D7F6-B498-43B3-948B-1728B52AA6E4}";
const DECORATIVE_EXTENSION_XML = `<a:ext uri="${DECORATIVE_EXTENSION_URI}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext>`;

async function adjustAccessibilityMetadata(
  data: Uint8Array,
  adjustmentsBySlide: ReadonlyArray<ReadonlyArray<AccessibilityAdjustment>>,
): Promise<Uint8Array> {
  if (!adjustmentsBySlide.some((adjustments) => adjustments.length > 0)) {
    return data;
  }
  const zip = await JSZip.loadAsync(data);
  for (let index = 0; index < adjustmentsBySlide.length; index += 1) {
    const adjustments = adjustmentsBySlide[index];
    if (!adjustments || adjustments.length === 0) continue;
    const slidePath = `ppt/slides/slide${index + 1}.xml`;
    const slideFile = zip.file(slidePath);
    if (!slideFile) {
      throw new PptxRenderError(
        `Unable to add accessibility metadata to missing ${slidePath}.`,
        [
          {
            code: "pptx.accessibility-slide-missing",
            message: `Unable to add accessibility metadata to missing ${slidePath}.`,
          },
        ],
      );
    }
    let xml = await slideFile.async("string");
    for (const adjustment of adjustments) {
      xml = adjustNamedAccessibilityBlock(xml, adjustment);
    }
    zip.file(slidePath, xml);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function adjustNamedAccessibilityBlock(
  xml: string,
  adjustment: AccessibilityAdjustment,
): string {
  const marker = `name="${escapeXmlAttribute(adjustment.name)}"`;
  const markerIndex = xml.indexOf(marker);
  const candidateTags = ["p:sp", "p:pic", "p:cxnSp", "p:graphicFrame"];
  let tag = "";
  let start = -1;
  for (const candidate of candidateTags) {
    const candidateStart = xml.lastIndexOf(`<${candidate}>`, markerIndex);
    if (candidateStart > start) {
      start = candidateStart;
      tag = candidate;
    }
  }
  const endStart = tag ? xml.indexOf(`</${tag}>`, markerIndex) : -1;
  if (markerIndex < 0 || start < 0 || endStart < 0) {
    throw new PptxRenderError(
      `Unable to find generated object ${adjustment.name} for accessibility metadata.`,
      [
        {
          code: "pptx.accessibility-name-missing",
          message: `Unable to find generated object ${adjustment.name} for accessibility metadata.`,
        },
      ],
    );
  }
  const end = endStart + `</${tag}>`.length;
  let block = xml.slice(start, end);
  if (adjustment.altText || adjustment.decorative) {
    block = adjustNonVisualProperties(block, adjustment);
  }
  if (adjustment.slideTitle) {
    block = markSlideTitlePlaceholder(block, adjustment.name);
  }
  if (adjustment.tableHeader) {
    block = markTableHeaderRow(block, adjustment.name);
  }
  return `${xml.slice(0, start)}${block}${xml.slice(end)}`;
}

function adjustNonVisualProperties(
  block: string,
  adjustment: AccessibilityAdjustment,
): string {
  const marker = `name="${escapeXmlAttribute(adjustment.name)}"`;
  const markerIndex = block.indexOf(marker);
  const start = block.lastIndexOf("<p:cNvPr", markerIndex);
  const openingEnd = block.indexOf(">", markerIndex);
  if (start < 0 || openingEnd < 0) {
    throw new PptxRenderError(
      `Generated object ${adjustment.name} has no non-visual properties.`,
      [
        {
          code: "pptx.accessibility-properties-missing",
          message: `Generated object ${adjustment.name} has no non-visual properties.`,
        },
      ],
    );
  }
  const selfClosing = block.slice(start, openingEnd + 1).endsWith("/>");
  let opening = block.slice(start, openingEnd + 1).replace(/\sdescr="[^"]*"/g, "");
  if (adjustment.altText && !adjustment.decorative) {
    const closing = selfClosing ? "/>" : ">";
    opening = `${opening.slice(0, -closing.length)} descr="${escapeXmlAttribute(
      adjustment.altText,
    )}"${closing}`;
  }
  if (!adjustment.decorative) {
    return `${block.slice(0, start)}${opening}${block.slice(openingEnd + 1)}`;
  }

  if (selfClosing) {
    const expanded = `${opening.slice(0, -2)}><a:extLst>${DECORATIVE_EXTENSION_XML}</a:extLst></p:cNvPr>`;
    return `${block.slice(0, start)}${expanded}${block.slice(openingEnd + 1)}`;
  }
  const closingStart = block.indexOf("</p:cNvPr>", openingEnd + 1);
  if (closingStart < 0) {
    throw new PptxRenderError(
      `Generated object ${adjustment.name} has incomplete non-visual properties.`,
      [
        {
          code: "pptx.accessibility-properties-incomplete",
          message: `Generated object ${adjustment.name} has incomplete non-visual properties.`,
        },
      ],
    );
  }
  let contents = block.slice(openingEnd + 1, closingStart);
  if (!contents.includes(DECORATIVE_EXTENSION_URI)) {
    contents = contents.includes("</a:extLst>")
      ? contents.replace("</a:extLst>", `${DECORATIVE_EXTENSION_XML}</a:extLst>`)
      : `${contents}<a:extLst>${DECORATIVE_EXTENSION_XML}</a:extLst>`;
  }
  return `${block.slice(0, start)}${opening}${contents}${block.slice(closingStart)}`;
}

function markSlideTitlePlaceholder(block: string, name: string): string {
  const adjusted = block;
  if (/<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(adjusted)) {
    return adjusted;
  }
  if (/<p:nvPr\s*\/>/.test(adjusted)) {
    return adjusted.replace(/<p:nvPr\s*\/>/, '<p:nvPr><p:ph type="title"/></p:nvPr>');
  }
  if (/<p:nvPr>/.test(adjusted)) {
    return adjusted.replace(/<p:nvPr>/, '<p:nvPr><p:ph type="title"/>');
  }
  throw new PptxRenderError(`Generated title ${name} has no placeholder metadata.`, [
    {
      code: "pptx.accessibility-title-placeholder-missing",
      message: `Generated title ${name} has no placeholder metadata.`,
    },
  ]);
}

function markTableHeaderRow(block: string, name: string): string {
  let matched = false;
  const adjusted = block.replace(/<a:tblPr\b([^>]*)>/, (_match, attributes: string) => {
    matched = true;
    const selfClosing = attributes.trimEnd().endsWith("/");
    const cleaned = attributes
      .replace(/\sfirstRow="[^"]*"/g, "")
      .replace(/\/\s*$/, "")
      .trimEnd();
    return `<a:tblPr${cleaned} firstRow="1"${selfClosing ? "/" : ""}>`;
  });
  if (!matched) {
    throw new PptxRenderError(`Generated table ${name} has no table properties.`, [
      {
        code: "pptx.accessibility-table-properties-missing",
        message: `Generated table ${name} has no table properties.`,
      },
    ]);
  }
  return adjusted;
}

async function adjustChartDataLabels(
  data: Uint8Array,
  adjustments: ReadonlyArray<ChartAdjustment>,
): Promise<Uint8Array> {
  if (
    !adjustments.some(
      (adjustment) =>
        adjustment.showCategoryName || adjustment.scatterSeries.length > 0,
    )
  ) {
    return data;
  }
  const zip = await JSZip.loadAsync(data);
  const chartPaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path))
    .sort((left, right) => {
      const leftNumber = Number(/chart(\d+)\.xml$/.exec(left)?.[1] ?? 0);
      const rightNumber = Number(/chart(\d+)\.xml$/.exec(right)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });
  if (chartPaths.length !== adjustments.length) {
    throw new PptxRenderError(
      "Unable to match generated charts to data-label settings.",
      [
        {
          code: "pptx.chart-count-mismatch",
          message: "Unable to match generated charts to data-label settings.",
        },
      ],
    );
  }
  for (const [index, adjustment] of adjustments.entries()) {
    const path = chartPaths[index];
    const file = path ? zip.file(path) : undefined;
    if (!path || !file) continue;
    let xml = await file.async("string");
    if (adjustment.showCategoryName) {
      xml = xml.replaceAll('<c:showCatName val="0"/>', '<c:showCatName val="1"/>');
    }
    if (adjustment.scatterSeries.length > 0) {
      xml = adjustScatterChartReferences(xml, adjustment.scatterSeries);
    }
    zip.file(path, xml);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function adjustScatterChartReferences(
  xml: string,
  adjustments: ReadonlyArray<ScatterSeriesAdjustment>,
): string {
  let chartIndex = 0;
  return xml.replace(/<c:scatterChart>[\s\S]*?<\/c:scatterChart>/g, (chart) => {
    if (chartIndex > 0) return chart;
    chartIndex += 1;
    let generatedSeriesIndex = 0;
    let visibleSeriesIndex = 0;
    return chart.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (seriesXml) => {
      const isHelperXSeries = generatedSeriesIndex % 2 === 1;
      generatedSeriesIndex += 1;
      if (isHelperXSeries) return "";
      const adjustment = adjustments[visibleSeriesIndex];
      if (!adjustment) return seriesXml;
      const order = visibleSeriesIndex;
      visibleSeriesIndex += 1;
      const xColumn = excelColumnName(adjustment.xColumn);
      const yColumn = excelColumnName(adjustment.yColumn);
      const lastRow = adjustment.pointCount + 1;
      let adjusted = seriesXml
        .replace(/<c:idx val="\d+"\/>/, `<c:idx val="${order}"/>`)
        .replace(/<c:order val="\d+"\/>/, `<c:order val="${order}"/>`);
      adjusted = replaceChartFormula(adjusted, "tx", `Sheet1!$${yColumn}$1`);
      adjusted = replaceChartFormula(
        adjusted,
        "xVal",
        `Sheet1!$${xColumn}$2:$${xColumn}$${lastRow}`,
      );
      adjusted = replaceChartFormula(
        adjusted,
        "yVal",
        `Sheet1!$${yColumn}$2:$${yColumn}$${lastRow}`,
      );
      adjusted = replaceChartNumericCache(adjusted, "xVal", adjustment.xValues);
      return replaceChartNumericCache(adjusted, "yVal", adjustment.yValues);
    });
  });
}

function replaceChartFormula(xml: string, tag: string, formula: string): string {
  return xml.replace(
    new RegExp(`(<c:${tag}>[\\s\\S]*?<c:f>)[^<]*(</c:f>)`),
    (_match, prefix: string, suffix: string) => `${prefix}${formula}${suffix}`,
  );
}

function replaceChartNumericCache(
  xml: string,
  tag: "xVal" | "yVal",
  values: ReadonlyArray<number>,
): string {
  const cache = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`)
    .join("")}</c:numCache>`;
  return xml.replace(
    new RegExp(
      `(<c:${tag}>[\\s\\S]*?<c:numRef>[\\s\\S]*?)<c:numCache>[\\s\\S]*?</c:numCache>`,
    ),
    (_match, prefix: string) => `${prefix}${cache}`,
  );
}

function excelColumnName(index: number): string {
  let remaining = index;
  let name = "";
  while (remaining > 0) {
    remaining -= 1;
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26);
  }
  return name;
}

function adjustNamedImageBlock(xml: string, adjustment: ImageAdjustment): string {
  const marker = `name="${escapeXmlAttribute(adjustment.name)}"`;
  const markerIndex = xml.indexOf(marker);
  const start = xml.lastIndexOf("<p:pic>", markerIndex);
  const endStart = xml.indexOf("</p:pic>", markerIndex);
  if (markerIndex < 0 || start < 0 || endStart < 0) {
    throw new PptxRenderError(`Unable to find generated image ${adjustment.name}.`, [
      {
        code: "pptx.image-name-missing",
        message: `Unable to find generated image ${adjustment.name}.`,
      },
    ]);
  }
  const end = endStart + "</p:pic>".length;
  let block = xml.slice(start, end);

  if (adjustment.altText) {
    block = block.replace(
      marker,
      `${marker} descr="${escapeXmlAttribute(adjustment.altText)}"`,
    );
  }

  if (adjustment.mask?.type === "roundRect") {
    block = block.replace(
      /<a:prstGeom prst="(?:rect|ellipse)">/,
      '<a:prstGeom prst="roundRect">',
    );
  }

  if (adjustment.crop) {
    const sourceRectangle = sourceRectangleXml({
      left: adjustment.crop.left,
      right: adjustment.crop.right,
      top: adjustment.crop.top,
      bottom: adjustment.crop.bottom,
    });
    if (!/<a:srcRect\b[^>]*\/>/.test(block)) {
      throw new PptxRenderError(
        `Generated image ${adjustment.name} has no crop rectangle.`,
        [
          {
            code: "pptx.image-crop-missing",
            message: `Generated image ${adjustment.name} has no crop rectangle.`,
          },
        ],
      );
    }
    block = block.replace(/<a:srcRect\b[^>]*\/>/, sourceRectangle);
  } else if (adjustment.sourceRectangle) {
    const rectangle = { ...adjustment.sourceRectangle };
    if (
      adjustment.focalPosition &&
      (adjustment.fit === "cover" || adjustment.fit === "crop")
    ) {
      const horizontalCrop = Math.max(0, rectangle.left + rectangle.right);
      const verticalCrop = Math.max(0, rectangle.top + rectangle.bottom);
      rectangle.left = horizontalCrop * adjustment.focalPosition.x;
      rectangle.right = horizontalCrop * (1 - adjustment.focalPosition.x);
      rectangle.top = verticalCrop * adjustment.focalPosition.y;
      rectangle.bottom = verticalCrop * (1 - adjustment.focalPosition.y);
    }
    const sourceRectangle = sourceRectangleXml(rectangle);
    if (/<a:srcRect\b[^>]*\/>/.test(block)) {
      block = block.replace(/<a:srcRect\b[^>]*\/>/, sourceRectangle);
    } else if (/<a:stretch>/.test(block)) {
      block = block.replace(/<a:stretch>/, `${sourceRectangle}<a:stretch>`);
    } else {
      throw new PptxRenderError(
        `Generated image ${adjustment.name} has no source rectangle anchor.`,
        [
          {
            code: "pptx.image-source-rectangle-missing",
            message: `Generated image ${adjustment.name} has no source rectangle anchor.`,
          },
        ],
      );
    }
  }

  return `${xml.slice(0, start)}${block}${xml.slice(end)}`;
}

function sourceRectangleXml(crop: SourceRectangle): string {
  return `<a:srcRect l="${Math.round(crop.left * 100_000)}" r="${Math.round(
    crop.right * 100_000,
  )}" t="${Math.round(crop.top * 100_000)}" b="${Math.round(crop.bottom * 100_000)}"/>`;
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

async function convertNamedMasterShapeGeometry(
  data: Uint8Array,
  presets: ReadonlyArray<MasterShapePreset>,
): Promise<Uint8Array> {
  if (presets.length === 0) {
    return data;
  }
  const zip = await JSZip.loadAsync(data);
  const layoutPaths = Object.keys(zip.files).filter((path) =>
    /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path),
  );
  const matched = new Set<string>();
  for (const path of layoutPaths) {
    const file = zip.file(path);
    if (!file) {
      continue;
    }
    let xml = await file.async("string");
    let changed = false;
    for (const preset of presets) {
      if (!xml.includes(`name="${escapeXmlAttribute(preset.name)}"`)) {
        continue;
      }
      xml = convertMasterShapeBlock(xml, preset);
      matched.add(preset.name);
      changed = true;
    }
    if (changed) {
      zip.file(path, xml);
    }
  }
  const missing = presets.find((preset) => !matched.has(preset.name));
  if (missing) {
    throw new PptxRenderError(
      `Unable to find generated master shape ${missing.name}.`,
      [
        {
          code: "pptx.master-shape-name-missing",
          message: `Unable to find generated master shape ${missing.name}.`,
        },
      ],
    );
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function convertMasterShapeBlock(xml: string, preset: MasterShapePreset): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(preset.preset)) {
    throw new PptxRenderError(
      `Master shape ${preset.name} uses an invalid preset ${preset.preset}.`,
      [
        {
          code: "pptx.master-shape-invalid-preset",
          message: `Master shape ${preset.name} uses an invalid preset ${preset.preset}.`,
        },
      ],
    );
  }
  const marker = `name="${escapeXmlAttribute(preset.name)}"`;
  const markerIndex = xml.indexOf(marker);
  const start = xml.lastIndexOf("<p:sp>", markerIndex);
  const endStart = xml.indexOf("</p:sp>", markerIndex);
  if (markerIndex < 0 || start < 0 || endStart < 0) {
    throw new PptxRenderError(`Generated master shape ${preset.name} is not a shape.`, [
      {
        code: "pptx.master-shape-block-missing",
        message: `Generated master shape ${preset.name} is not a shape.`,
      },
    ]);
  }
  const end = endStart + "</p:sp>".length;
  const block = xml.slice(start, end);
  if (!block.includes('prst="rect"')) {
    throw new PptxRenderError(
      `Generated master shape ${preset.name} does not use rectangle geometry.`,
      [
        {
          code: "pptx.master-shape-invalid-geometry",
          message: `Generated master shape ${preset.name} does not use rectangle geometry.`,
        },
      ],
    );
  }
  const converted = block.replace('prst="rect"', `prst="${preset.preset}"`);
  return `${xml.slice(0, start)}${converted}${xml.slice(end)}`;
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

async function readImageDimensions(
  candidate: unknown,
): Promise<{ width: number; height: number } | undefined> {
  const record = asRecord(candidate);
  const source = resolveImageSource(record);
  if (!source) {
    return undefined;
  }
  let data: Buffer;
  if ("data" in source) {
    const comma = source.data.indexOf(",");
    if (comma < 0 || !source.data.slice(0, comma).includes("base64")) {
      return undefined;
    }
    data = Buffer.from(source.data.slice(comma + 1), "base64");
  } else {
    data = await readFile(source.path);
  }
  return imageDimensionsFromBuffer(data);
}

function imageDimensionsFromBuffer(
  data: Buffer,
): { width: number; height: number } | undefined {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  const gifHeader = data.subarray(0, 6).toString("ascii");
  if (data.length >= 10 && (gifHeader === "GIF87a" || gifHeader === "GIF89a")) {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    const jpeg = jpegDimensions(data);
    if (jpeg) {
      return jpeg;
    }
  }
  if (
    data.length >= 30 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const webp = webpDimensions(data);
    if (webp) {
      return webp;
    }
  }
  const source = data.toString("utf8");
  if (/<svg\b/i.test(source)) {
    const viewBox =
      /\bviewBox\s*=\s*["']\s*[-+\d.e]+\s+[-+\d.e]+\s+([-+\d.e]+)\s+([-+\d.e]+)\s*["']/i.exec(
        source,
      );
    if (viewBox) {
      const width = Number(viewBox[1]);
      const height = Number(viewBox[2]);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    const width = Number(/\bwidth\s*=\s*["']\s*([-+\d.e]+)/i.exec(source)?.[1]);
    const height = Number(/\bheight\s*=\s*["']\s*([-+\d.e]+)/i.exec(source)?.[1]);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  return undefined;
}

function jpegDimensions(data: Buffer): { width: number; height: number } | undefined {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break;
    }
    const length = data.readUInt16BE(offset + 2);
    if (startOfFrameMarkers.has(marker)) {
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }
    if (length < 2) {
      break;
    }
    offset += length + 2;
  }
  return undefined;
}

function webpDimensions(data: Buffer): { width: number; height: number } | undefined {
  const chunk = data.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + data.readUIntLE(24, 3),
      height: 1 + data.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L" && data[20] === 0x2f) {
    const first = data[21] ?? 0;
    const second = data[22] ?? 0;
    const third = data[23] ?? 0;
    const fourth = data[24] ?? 0;
    return {
      width: 1 + (((second & 0x3f) << 8) | first),
      height: 1 + ((fourth & 0x0f) << 10) + (third << 2) + (second >> 6),
    };
  }
  if (chunk === "VP8 " && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
    };
  }
  return undefined;
}

function automaticSourceRectangle(
  fit: "contain" | "cover",
  dimensions: { width: number; height: number } | undefined,
  frame: FrameIR,
): SourceRectangle | undefined {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return undefined;
  }
  const imageRatio = dimensions.height / dimensions.width;
  const boxRatio = frame.h / frame.w;
  const rectangle: SourceRectangle = { left: 0, right: 0, top: 0, bottom: 0 };
  if (fit === "cover") {
    if (boxRatio > imageRatio) {
      const crop = 1 - imageRatio / boxRatio;
      rectangle.left = crop / 2;
      rectangle.right = crop / 2;
    } else {
      const crop = 1 - boxRatio / imageRatio;
      rectangle.top = crop / 2;
      rectangle.bottom = crop / 2;
    }
  } else if (boxRatio > imageRatio) {
    const padding = 1 - boxRatio / imageRatio;
    rectangle.top = padding / 2;
    rectangle.bottom = padding / 2;
  } else {
    const padding = 1 - imageRatio / boxRatio;
    rectangle.left = padding / 2;
    rectangle.right = padding / 2;
  }
  return rectangle;
}

function isLocalMediaSource(source: string): boolean {
  if (/^[a-z]:[\\/]/i.test(source)) {
    return true;
  }
  return (
    source.length > 0 &&
    !source.startsWith("//") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(source) &&
    !/^data:/i.test(source) &&
    !/^file:/i.test(source)
  );
}

function hasSupportedMediaExtension(
  source: string,
  type: "video" | "audio",
  mimeType: string,
): boolean {
  const normalized = source.toLowerCase();
  if (type === "video") {
    return mimeType === "video/mp4" && normalized.endsWith(".mp4");
  }
  return (
    (mimeType === "audio/mp4" && normalized.endsWith(".m4a")) ||
    (mimeType === "audio/mpeg" && normalized.endsWith(".mp3"))
  );
}

function isPngPosterSource(source: string): boolean {
  return (
    source.startsWith("data:image/png;base64,") ||
    (isLocalMediaSource(source) && source.toLowerCase().endsWith(".png"))
  );
}

async function readMediaCaption(
  element: VideoElementIR | AudioElementIR,
  context: RenderContext,
): Promise<{ data: Uint8Array; contentHash: string }> {
  const source = element.captionSrc;
  if (!source) {
    throw new PptxRenderError(`Media ${element.id} has no caption source.`, [
      {
        code: "media.caption-missing-source",
        message: `Media ${element.id} has no caption source.`,
        slideId: context.slideId,
        elementId: element.id,
      },
    ]);
  }

  let fileData: Buffer;
  try {
    fileData = await readFile(source);
  } catch {
    throw new PptxRenderError(
      `Unable to read WebVTT captions for media ${element.id}: ${source}`,
      [
        {
          code: "media.caption-read-failed",
          message: `Unable to read WebVTT captions for media ${element.id}: ${source}`,
          slideId: context.slideId,
          elementId: element.id,
        },
      ],
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(fileData);
  } catch {
    throw new PptxRenderError(
      `WebVTT captions for media ${element.id} are not valid UTF-8.`,
      [
        {
          code: "media.caption-invalid-utf8",
          message: `WebVTT captions for media ${element.id} are not valid UTF-8.`,
          slideId: context.slideId,
          elementId: element.id,
        },
      ],
    );
  }
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (!/^WEBVTT(?:[ \t].*)?(?:\r\n|\n|\r|$)/.test(withoutBom)) {
    throw new PptxRenderError(
      `WebVTT captions for media ${element.id} have an invalid WEBVTT header.`,
      [
        {
          code: "media.caption-invalid-webvtt",
          message: `WebVTT captions for media ${element.id} have an invalid WEBVTT header.`,
          slideId: context.slideId,
          elementId: element.id,
        },
      ],
    );
  }

  const contentHash = createHash("sha256").update(fileData).digest("hex");
  if (
    element.captionContentHash &&
    element.captionContentHash.toLowerCase() !== contentHash
  ) {
    throw new PptxRenderError(
      `WebVTT captions for media ${element.id} do not match captionContentHash.`,
      [
        {
          code: "media.caption-content-hash-mismatch",
          message: `WebVTT captions for media ${element.id} do not match captionContentHash.`,
          slideId: context.slideId,
          elementId: element.id,
        },
      ],
    );
  }
  return { data: Uint8Array.from(fileData), contentHash };
}

async function resolveMediaCover(
  source: string | undefined,
): Promise<string | undefined> {
  if (!source) {
    return undefined;
  }
  if (source.startsWith("data:image/png;base64,")) {
    return source;
  }
  const data = await readFile(source);
  const signature = data.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new PptxRenderError(`Media poster is not a PNG file: ${source}`, [
      {
        code: "media.invalid-poster-signature",
        message: `Media poster is not a PNG file: ${source}`,
      },
    ]);
  }
  return `data:image/png;base64,${data.toString("base64")}`;
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
