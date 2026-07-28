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

export interface ImageElementIR extends ElementBase {
  type: "image";
  src: string;
  contentHash?: string;
  mimeType?: string;
  fit: "contain" | "cover" | "crop";
  crop?: ImageCropIR;
  role?: "content" | "background";
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
  colSpan?: number;
  rowSpan?: number;
  fill?: FillIR;
  textStyle?: Partial<TextStyleIR>;
}

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
  columnWidths?: number[];
  style: TableStyleIR;
}

export interface ChartSeriesIR {
  name: string;
  labels: string[];
  values: number[];
  color?: string;
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
  chartType: "bar" | "line" | "pie";
  series: ChartSeriesIR[];
  title?: string;
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
  background: FillIR;
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
  background?: FillIR;
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
