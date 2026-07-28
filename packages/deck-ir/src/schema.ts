import { z } from "zod";

import type {
  ChartElementIR,
  ConnectorElementIR,
  DeckIR,
  Diagnostic,
  ElementIR,
  FillIR,
  FrameIR,
  GroupElementIR,
  IconElementIR,
  ImageElementIR,
  LineElementIR,
  ParagraphIR,
  ResolvedThemeIR,
  ShapeElementIR,
  SlideIR,
  SourceLocation,
  StrokeIR,
  TableElementIR,
  TextElementIR,
  TextRunIR,
} from "./types.js";
import { DECK_IR_SCHEMA_VERSION, WIDE_CANVAS } from "./types.js";

const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const unitInterval = finiteNumber.min(0).max(1);
const color = z
  .string()
  .regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i, "Expected #RRGGBB or #RRGGBBAA");

export const SourceLocationSchema: z.ZodType<SourceLocation> = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    endColumn: z.number().int().positive().optional(),
  })
  .strict();

export const DiagnosticSchema: z.ZodType<Diagnostic> = z
  .object({
    severity: z.enum(["error", "warning", "info"]),
    code: z.string().min(1),
    message: z.string().min(1),
    sourceLocation: SourceLocationSchema.optional(),
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
  })
  .strict();

export const FrameIRSchema: z.ZodType<FrameIR> = z
  .object({
    x: finiteNumber,
    y: finiteNumber,
    w: finiteNumber.positive(),
    h: finiteNumber.positive(),
  })
  .strict();

export const FillIRSchema: z.ZodType<FillIR> = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("solid"),
      color,
      transparency: unitInterval.optional(),
    })
    .strict(),
  z.object({ type: z.literal("none") }).strict(),
]);

export const StrokeIRSchema: z.ZodType<StrokeIR> = z
  .object({
    color,
    width: nonNegativeNumber,
    transparency: unitInterval.optional(),
    dash: z.enum(["solid", "dash", "dot"]).optional(),
  })
  .strict();

export const TextStyleIRSchema = z
  .object({
    fontFace: z.string().min(1),
    fontSize: finiteNumber.positive(),
    color,
    fontWeight: finiteNumber.min(100).max(1000),
    align: z.enum(["left", "center", "right", "justify"]),
    verticalAlign: z.enum(["top", "middle", "bottom"]),
    lineHeight: finiteNumber.positive().optional(),
    letterSpacing: finiteNumber.optional(),
    textFit: z.enum(["none", "shrink"]).optional(),
  })
  .strict();

export const TextRunIRSchema: z.ZodType<TextRunIR> = z
  .object({
    text: z.string(),
    fontFace: z.string().min(1).optional(),
    fontSize: finiteNumber.positive().optional(),
    color: color.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    href: z.string().url().optional(),
  })
  .strict();

export const ParagraphIRSchema: z.ZodType<ParagraphIR> = z
  .object({
    runs: z.array(TextRunIRSchema),
    level: z.number().int().nonnegative().optional(),
    bullet: z.boolean().optional(),
    ordered: z.boolean().optional(),
    align: z.enum(["left", "center", "right", "justify"]).optional(),
    spaceBefore: nonNegativeNumber.optional(),
    spaceAfter: nonNegativeNumber.optional(),
  })
  .strict();

const elementBaseShape = {
  id: z.string().min(1),
  frame: FrameIRSchema,
  rotation: finiteNumber,
  zIndex: z.number().int(),
  opacity: unitInterval,
  locked: z.boolean().optional(),
  editable: z.boolean().optional(),
  fallbackReason: z.string().min(1).optional(),
  alt: z.string().min(1).optional(),
  sourceLocation: SourceLocationSchema,
};

export const TextElementIRSchema: z.ZodType<TextElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("text"),
    role: z.enum(["title", "heading", "body", "caption", "code"]).optional(),
    paragraphs: z.array(ParagraphIRSchema),
    style: TextStyleIRSchema,
  })
  .strict();

export const ImageElementIRSchema: z.ZodType<ImageElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("image"),
    src: z.string().min(1),
    contentHash: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    fit: z.enum(["contain", "cover", "crop"]),
    crop: z
      .object({
        left: unitInterval,
        top: unitInterval,
        right: unitInterval,
        bottom: unitInterval,
      })
      .strict()
      .optional(),
    role: z.enum(["content", "background"]).optional(),
  })
  .strict();

export const ShapeElementIRSchema: z.ZodType<ShapeElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("shape"),
    shape: z.enum(["rect", "roundRect", "ellipse", "triangle"]),
    fill: FillIRSchema,
    stroke: StrokeIRSchema.optional(),
  })
  .strict();

const pointSchema = z.object({ x: finiteNumber, y: finiteNumber }).strict();
const arrowSchema = z.enum(["none", "triangle", "stealth", "diamond", "oval"]);

export const LineElementIRSchema: z.ZodType<LineElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("line"),
    start: pointSchema,
    end: pointSchema,
    stroke: StrokeIRSchema,
    beginArrow: arrowSchema.optional(),
    endArrow: arrowSchema.optional(),
  })
  .strict();

export const ConnectorElementIRSchema: z.ZodType<ConnectorElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("connector"),
    start: pointSchema,
    end: pointSchema,
    stroke: StrokeIRSchema,
    beginArrow: arrowSchema.optional(),
    endArrow: arrowSchema.optional(),
    fromElementId: z.string().min(1).optional(),
    toElementId: z.string().min(1).optional(),
  })
  .strict();

const tableCellSchema = z
  .object({
    paragraphs: z.array(ParagraphIRSchema),
    colSpan: z.number().int().positive().optional(),
    rowSpan: z.number().int().positive().optional(),
    fill: FillIRSchema.optional(),
    textStyle: TextStyleIRSchema.partial().optional(),
  })
  .strict();

export const TableElementIRSchema: z.ZodType<TableElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("table"),
    rows: z.array(
      z
        .object({
          cells: z.array(tableCellSchema),
          height: finiteNumber.positive().optional(),
        })
        .strict(),
    ),
    columnWidths: z.array(finiteNumber.positive()).optional(),
    style: z
      .object({
        border: StrokeIRSchema,
        headerFill: FillIRSchema,
        bodyFill: FillIRSchema,
        text: TextStyleIRSchema,
      })
      .strict(),
  })
  .strict();

export const ChartElementIRSchema: z.ZodType<ChartElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("chart"),
    chartType: z.enum(["bar", "line", "pie"]),
    series: z.array(
      z
        .object({
          name: z.string(),
          labels: z.array(z.string()),
          values: z.array(finiteNumber),
          color: color.optional(),
        })
        .strict()
        .refine((series) => series.labels.length === series.values.length, {
          message: "labels and values must have the same length",
        }),
    ),
    title: z.string().optional(),
    style: z
      .object({
        colors: z.array(color),
        showLegend: z.boolean(),
        showTitle: z.boolean(),
        showValue: z.boolean(),
        showCategoryName: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const IconElementIRSchema: z.ZodType<IconElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("icon"),
    src: z.string().min(1),
    contentHash: z.string().min(1).optional(),
    color: color.optional(),
  })
  .strict();

export const GroupElementIRSchema: z.ZodType<GroupElementIR> = z
  .object({
    ...elementBaseShape,
    type: z.literal("group"),
    children: z.array(z.lazy(() => ElementIRSchema)),
  })
  .strict();

export const ElementIRSchema: z.ZodType<ElementIR> = z.lazy(() =>
  z.union([
    TextElementIRSchema,
    ImageElementIRSchema,
    ShapeElementIRSchema,
    LineElementIRSchema,
    ConnectorElementIRSchema,
    GroupElementIRSchema,
    TableElementIRSchema,
    ChartElementIRSchema,
    IconElementIRSchema,
  ]),
);

export const ResolvedThemeIRSchema: z.ZodType<ResolvedThemeIR> = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    colors: z.record(z.string(), color),
    fonts: z
      .object({
        heading: z
          .object({
            family: z.string().min(1),
            fallbacks: z.array(z.string().min(1)),
          })
          .strict(),
        body: z
          .object({
            family: z.string().min(1),
            fallbacks: z.array(z.string().min(1)),
          })
          .strict(),
        code: z
          .object({
            family: z.string().min(1),
            fallbacks: z.array(z.string().min(1)),
          })
          .strict(),
        registered: z.array(
          z
            .object({
              family: z.string().min(1),
              weight: finiteNumber.min(100).max(1000),
              style: z.enum(["normal", "italic"]),
              source: z.enum(["system", "file"]),
              path: z.string().min(1).optional(),
              sha256: z.string().min(1).optional(),
              license: z.string().min(1).optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    typography: z
      .object({
        title: TextStyleIRSchema,
        heading: TextStyleIRSchema,
        body: TextStyleIRSchema,
        caption: TextStyleIRSchema,
        code: TextStyleIRSchema,
      })
      .strict(),
    safeArea: FrameIRSchema,
    layoutIds: z.array(z.string().min(1)),
    masters: z.array(
      z
        .object({
          id: z.string().min(1),
          background: FillIRSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const SlideIRSchema: z.ZodType<SlideIR> = z
  .object({
    id: z.string().min(1),
    sourcePath: z.string().min(1),
    layoutId: z.string().min(1),
    masterId: z.string().min(1).optional(),
    background: FillIRSchema.optional(),
    elements: z.array(ElementIRSchema),
    notes: z
      .object({
        markdown: z.string(),
        plainText: z.string(),
        sources: z.array(
          z
            .object({
              label: z.string().min(1),
              url: z.string().url().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

function visitElements(
  elements: ElementIR[],
  visitor: (element: ElementIR) => void,
): void {
  for (const element of elements) {
    visitor(element);
    if (element.type === "group") {
      visitElements(element.children, visitor);
    }
  }
}

export const DeckIRSchema: z.ZodType<DeckIR> = z
  .object({
    schemaVersion: z.literal(DECK_IR_SCHEMA_VERSION),
    metadata: z
      .object({
        id: z.string().min(1),
        title: z.string().min(1),
        author: z.string().min(1).optional(),
        company: z.string().min(1).optional(),
        language: z.string().min(1),
      })
      .strict(),
    canvas: z
      .object({
        width: z.literal(WIDE_CANVAS.width),
        height: z.literal(WIDE_CANVAS.height),
        pptxWidthInch: z.literal(WIDE_CANVAS.pptxWidthInch),
        pptxHeightInch: z.literal(WIDE_CANVAS.pptxHeightInch),
      })
      .strict(),
    theme: ResolvedThemeIRSchema,
    slides: z.array(SlideIRSchema).min(1),
    diagnostics: z.array(DiagnosticSchema),
    contentHash: z.string().min(1),
  })
  .strict()
  .superRefine((deck, context) => {
    const slideIds = new Set<string>();
    for (const [slideIndex, slide] of deck.slides.entries()) {
      if (slideIds.has(slide.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate slide id: ${slide.id}`,
          path: ["slides", slideIndex, "id"],
        });
      }
      slideIds.add(slide.id);

      const elementIds = new Set<string>();
      visitElements(slide.elements, (element) => {
        if (elementIds.has(element.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate element id in slide ${slide.id}: ${element.id}`,
            path: ["slides", slideIndex, "elements"],
          });
        }
        elementIds.add(element.id);
        if (element.editable === false && !element.fallbackReason) {
          context.addIssue({
            code: "custom",
            message: `Non-editable element ${element.id} requires fallbackReason`,
            path: ["slides", slideIndex, "elements"],
          });
        }
      });
    }
  });

export function parseDeckIR(value: unknown): DeckIR {
  return DeckIRSchema.parse(value);
}

export function safeParseDeckIR(value: unknown): z.ZodSafeParseResult<DeckIR> {
  return DeckIRSchema.safeParse(value);
}
