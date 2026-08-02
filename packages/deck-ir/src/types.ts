export const DECK_IR_SCHEMA_VERSION = 1 as const;

export const WIDE_CANVAS = {
  width: 1920,
  height: 1080,
  pptxWidthInch: 13.333333,
  pptxHeightInch: 7.5,
} as const;

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  sourceLocation?: SourceLocation;
  slideId?: string;
  elementId?: string;
}

export interface FrameIR {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SolidFillIR {
  type: "solid";
  color: string;
  transparency?: number;
}

export interface NoFillIR {
  type: "none";
}

export type FillIR = SolidFillIR | NoFillIR;

export interface ImageBackgroundIR {
  type: "image";
  src: string;
  contentHash?: string;
  mimeType?: string;
  fit: "stretch" | "contain" | "cover";
  focalPosition?: FocalPositionIR;
}

export type BackgroundIR = FillIR | ImageBackgroundIR;

export interface StrokeIR {
  color: string;
  width: number;
  transparency?: number;
  dash?: "solid" | "dash" | "dot";
}

export type TextAlignIR = "left" | "center" | "right" | "justify";
export type VerticalAlignIR = "top" | "middle" | "bottom";

export interface TextStyleIR {
  fontFace: string;
  fontSize: number;
  color: string;
  fontWeight: number;
  align: TextAlignIR;
  verticalAlign: VerticalAlignIR;
  lineHeight?: number;
  letterSpacing?: number;
  textFit?: "none" | "shrink";
}

export interface TextRunIR {
  text: string;
  fontFace?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
}

export interface ParagraphIR {
  runs: TextRunIR[];
  level?: number;
  bullet?: boolean;
  ordered?: boolean;
  align?: TextAlignIR;
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface ElementBase {
  id: string;
  frame: FrameIR;
  rotation: number;
  zIndex: number;
  opacity: number;
  locked?: boolean;
  editable?: boolean;
  fallbackReason?: string;
  alt?: string;
  /** Explicitly excludes a visual-only object from assistive reading order. */
  decorative?: boolean;
  sourceLocation: SourceLocation;
}

export interface TextElementIR extends ElementBase {
  type: "text";
  role?: "title" | "heading" | "body" | "caption" | "code";
  paragraphs: ParagraphIR[];
  style: TextStyleIR;
}

export interface ImageCropIR {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FocalPositionIR {
  x: number;
  y: number;
}

export type ImageMaskIR = { type: "roundRect"; radius?: number } | { type: "circle" };

export interface ImageShadowIR {
  color: string;
  opacity: number;
  blur: number;
  distance: number;
  angle: number;
}

export interface ImagePosterFrameIR {
  src: string;
  contentHash?: string;
  mimeType: "image/png";
}

export interface ImageElementIR extends ElementBase {
  type: "image";
  src: string;
  contentHash?: string;
  mimeType?: string;
  fit: "stretch" | "contain" | "cover" | "crop";
  crop?: ImageCropIR;
  focalPosition?: FocalPositionIR;
  mask?: ImageMaskIR;
  border?: StrokeIR;
  shadow?: ImageShadowIR;
  posterFrame?: ImagePosterFrameIR;
  role?: "content" | "background";
}

export interface VideoElementIR extends ElementBase {
  type: "video";
  src: string;
  contentHash?: string;
  mimeType: "video/mp4";
  byteLength?: number;
  posterSrc: string;
  posterContentHash?: string;
  posterMimeType: "image/png";
  captionSrc?: string;
  captionContentHash?: string;
  captionMimeType?: "text/vtt";
  captionLanguage?: string;
  captionLabel?: string;
  fit: "contain" | "cover";
  transcript?: string;
}

export interface AudioElementIR extends ElementBase {
  type: "audio";
  src: string;
  contentHash?: string;
  mimeType: "audio/mp4" | "audio/mpeg";
  byteLength?: number;
  posterSrc?: string;
  posterContentHash?: string;
  posterMimeType?: "image/png";
  captionSrc?: string;
  captionContentHash?: string;
  captionMimeType?: "text/vtt";
  captionLanguage?: string;
  captionLabel?: string;
  transcript?: string;
}

export interface ShapeElementIR extends ElementBase {
  type: "shape";
  shape: "rect" | "roundRect" | "ellipse" | "triangle";
  fill: FillIR;
  stroke?: StrokeIR;
}

export interface PointIR {
  x: number;
  y: number;
}

export type ArrowTypeIR = "none" | "triangle" | "stealth" | "diamond" | "oval";

export interface LineElementIR extends ElementBase {
  type: "line";
  start: PointIR;
  end: PointIR;
  stroke: StrokeIR;
  beginArrow?: ArrowTypeIR;
  endArrow?: ArrowTypeIR;
}

export interface ConnectorElementIR extends ElementBase {
  type: "connector";
  start: PointIR;
  end: PointIR;
  stroke: StrokeIR;
  beginArrow?: ArrowTypeIR;
  endArrow?: ArrowTypeIR;
  fromElementId?: string;
  toElementId?: string;
}

export interface TableCellIR {
  paragraphs: ParagraphIR[];
  /** Raw scalar value retained for structured editing and deterministic formatting. */
  value?: string | number | boolean | null;
  numberFormat?: TableNumberFormatIR;
  colSpan?: number;
  rowSpan?: number;
  fill?: FillIR;
  textStyle?: Partial<TextStyleIR>;
}

export type TableNumberFormatIR = "integer" | "decimal" | "percent" | "currency-jpy";

export interface TableRowIR {
  cells: TableCellIR[];
  height?: number;
}

export interface TableStyleIR {
  border: StrokeIR;
  headerFill: FillIR;
  bodyFill: FillIR;
  text: TextStyleIR;
}

export interface TableElementIR extends ElementBase {
  type: "table";
  rows: TableRowIR[];
  /** Number of leading rows rendered as headers. Compiler output uses 0 or 1. */
  headerRows?: 0 | 1;
  columnWidths?: number[];
  style: TableStyleIR;
}

export type ChartTypeIR =
  | "bar"
  | "line"
  | "pie"
  | "doughnut"
  | "area"
  | "scatter"
  | "radar"
  | "stacked"
  | "combo";

export type ChartSeriesTypeIR = "bar" | "line" | "area" | "scatter";

export type ChartLegendPositionIR = "top" | "bottom" | "left" | "right";

export interface ChartSeriesIR {
  name: string;
  labels: string[];
  values: number[];
  color?: string;
  chartType?: ChartSeriesTypeIR;
}

export interface ChartStyleIR {
  colors: string[];
  showLegend: boolean;
  showTitle: boolean;
  showValue: boolean;
  showCategoryName: boolean;
}

export interface ChartElementIR extends ElementBase {
  type: "chart";
  chartType: ChartTypeIR;
  series: ChartSeriesIR[];
  title?: string;
  categoryAxisTitle?: string;
  valueAxisTitle?: string;
  valueUnit?: string;
  legendPosition?: ChartLegendPositionIR;
  style: ChartStyleIR;
}

export interface IconElementIR extends ElementBase {
  type: "icon";
  src: string;
  contentHash?: string;
  color?: string;
}

export interface GroupElementIR extends ElementBase {
  type: "group";
  children: ElementIR[];
}

export type ElementIR =
  | TextElementIR
  | ImageElementIR
  | VideoElementIR
  | AudioElementIR
  | ShapeElementIR
  | LineElementIR
  | ConnectorElementIR
  | GroupElementIR
  | TableElementIR
  | ChartElementIR
  | IconElementIR;

export interface SourceIR {
  label: string;
  url?: string;
}

export interface SlideNotesIR {
  markdown: string;
  plainText: string;
  sources: SourceIR[];
}

export interface FontReferenceIR {
  family: string;
  fallbacks: string[];
}

export interface FontRegistrationIR {
  family: string;
  weight: number;
  style: "normal" | "italic";
  source: "system" | "file";
  path?: string;
  sha256?: string;
  license?: string;
}

export interface MasterIR {
  id: string;
  background: BackgroundIR;
  elements?: ElementIR[];
}

export interface ResolvedThemeIR {
  id: string;
  name: string;
  colors: Record<string, string>;
  fonts: {
    heading: FontReferenceIR;
    body: FontReferenceIR;
    code: FontReferenceIR;
    registered: FontRegistrationIR[];
  };
  typography: {
    title: TextStyleIR;
    heading: TextStyleIR;
    body: TextStyleIR;
    caption: TextStyleIR;
    code: TextStyleIR;
  };
  safeArea: FrameIR;
  layoutIds: string[];
  masters: MasterIR[];
}

export interface SlideIR {
  id: string;
  sourcePath: string;
  layoutId: string;
  masterId?: string;
  background?: BackgroundIR;
  elements: ElementIR[];
  notes: SlideNotesIR;
}

export interface DeckIR {
  schemaVersion: typeof DECK_IR_SCHEMA_VERSION;
  metadata: {
    id: string;
    title: string;
    author?: string;
    company?: string;
    language: string;
  };
  canvas: typeof WIDE_CANVAS;
  theme: ResolvedThemeIR;
  slides: SlideIR[];
  diagnostics: Diagnostic[];
  contentHash: string;
}
