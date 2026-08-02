export interface FrameIR {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceIR {
  label: string;
  url?: string;
  detail?: string;
}

export interface FillIR {
  type?: "solid" | "none";
  color?: string;
  opacity?: number;
  transparency?: number;
}

export interface StrokeIR extends FillIR {
  width?: number;
  dash?:
    | "solid"
    | "dash"
    | "dot"
    | "dashDot"
    | "lgDash"
    | "lgDashDot"
    | "lgDashDotDot"
    | "sysDash"
    | "sysDot";
  beginArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
  endArrow?: "none" | "arrow" | "diamond" | "oval" | "stealth" | "triangle";
}

export interface TextStyleIR {
  fontFace?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "left" | "center" | "right" | "justify";
  valign?: "top" | "middle" | "bottom";
  verticalAlign?: "top" | "middle" | "bottom";
  margin?: number | [number, number, number, number];
  lineSpacing?: number;
  lineHeight?: number;
  charSpacing?: number;
  letterSpacing?: number;
  fit?: "none" | "shrink" | "resize";
  textFit?: "none" | "shrink";
  language?: string;
}

export interface TextRunIR extends TextStyleIR {
  text: string;
  breakLine?: boolean;
  hyperlink?: string;
  href?: string;
}

export interface ParagraphIR extends TextStyleIR {
  text?: string;
  runs?: TextRunIR[];
  bullet?:
    | boolean
    | {
        type?: "bullet" | "number";
        characterCode?: string;
        indent?: number;
        numberStartAt?: number;
      };
  indentLevel?: number;
  level?: number;
  ordered?: boolean;
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface ElementBaseIR {
  id: string;
  type: string;
  frame: FrameIR;
  rotation?: number;
  zIndex?: number;
  opacity?: number;
  locked?: boolean;
  alt?: string;
  decorative?: boolean;
  editable?: boolean;
  fallbackReason?: string;
}

export interface TextElementIR extends ElementBaseIR {
  type: "text";
  role?: "title" | "heading" | "body" | "caption" | "code";
  text?: string;
  paragraphs?: ParagraphIR[];
  style?: TextStyleIR;
  fill?: FillIR;
  line?: StrokeIR;
}

export interface ImageElementIR extends ElementBaseIR {
  type: "image" | "icon";
  path?: string;
  data?: string;
  src?: string;
  asset?: {
    absolutePath?: string;
    path?: string;
    data?: string;
  };
  fit?: "stretch" | "contain" | "cover" | "crop";
  crop?: { left: number; top: number; right: number; bottom: number };
  focalPosition?: { x: number; y: number };
  mask?: { type: "roundRect"; radius?: number } | { type: "circle" };
  border?: StrokeIR;
  shadow?: {
    color: string;
    opacity: number;
    blur: number;
    distance: number;
    angle: number;
  };
  posterFrame?: {
    src: string;
    contentHash?: string;
    mimeType: "image/png";
  };
  role?: "content" | "background";
  flipH?: boolean;
  flipV?: boolean;
}

export interface VideoElementIR extends ElementBaseIR {
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
  fit?: "contain" | "cover";
  transcript?: string;
}

export interface AudioElementIR extends ElementBaseIR {
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

export interface ShapeElementIR extends ElementBaseIR {
  type: "shape";
  shape?: string;
  shapeType?: string;
  fill?: FillIR;
  line?: StrokeIR;
  stroke?: StrokeIR;
  text?: string;
  paragraphs?: ParagraphIR[];
  textStyle?: TextStyleIR;
}

export interface LineElementIR extends ElementBaseIR {
  type: "line" | "connector";
  line?: StrokeIR;
  stroke?: StrokeIR;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  beginArrow?: StrokeIR["beginArrow"];
  endArrow?: StrokeIR["endArrow"];
}

export interface TableCellIR {
  text?: string;
  value?: string | number | boolean | null;
  numberFormat?: "integer" | "decimal" | "percent" | "currency-jpy";
  colspan?: number;
  colSpan?: number;
  rowspan?: number;
  rowSpan?: number;
  fill?: FillIR;
  border?: StrokeIR;
  style?: TextStyleIR;
  textStyle?: TextStyleIR;
  paragraphs?: ParagraphIR[];
}

export interface TableStyleIR extends TextStyleIR {
  border?: StrokeIR;
  headerFill?: FillIR;
  bodyFill?: FillIR;
  text?: TextStyleIR;
}

export interface TableElementIR extends ElementBaseIR {
  type: "table";
  rows: Array<
    | Array<string | TableCellIR>
    | {
        cells: Array<string | TableCellIR>;
        height?: number;
      }
  >;
  columnWidths?: number[];
  rowHeights?: number[];
  style?: TableStyleIR;
  border?: StrokeIR;
  fill?: FillIR;
  headerRows?: number;
}

export interface ChartSeriesIR {
  name: string;
  labels?: string[];
  values: number[];
  color?: string;
  chartType?: "bar" | "line" | "area" | "scatter";
}

export interface ChartElementIR extends ElementBaseIR {
  type: "chart";
  chartType?:
    | "bar"
    | "line"
    | "pie"
    | "doughnut"
    | "area"
    | "scatter"
    | "radar"
    | "stacked"
    | "combo";
  chart?: ChartElementIR["chartType"];
  series?: ChartSeriesIR[];
  data?: Array<{ label: string; value: number }>;
  title?: string;
  categoryAxisTitle?: string;
  valueAxisTitle?: string;
  valueUnit?: string;
  legendPosition?: "top" | "bottom" | "left" | "right";
  showLegend?: boolean;
  showValue?: boolean;
  showCategoryName?: boolean;
  colors?: string[];
  style?: TextStyleIR & {
    colors?: string[];
    showLegend?: boolean;
    showTitle?: boolean;
    showValue?: boolean;
    showCategoryName?: boolean;
  };
}

export interface GroupElementIR extends ElementBaseIR {
  type: "group";
  elements?: ElementIR[];
  children?: ElementIR[];
  coordinateSpace?: "absolute" | "relative";
}

export type ElementIR =
  | TextElementIR
  | ImageElementIR
  | VideoElementIR
  | AudioElementIR
  | ShapeElementIR
  | LineElementIR
  | TableElementIR
  | ChartElementIR
  | GroupElementIR;

/**
 * The renderer accepts this deliberately permissive structural type so that the
 * DeckIR package can evolve independently. Runtime normalization validates each
 * element before PptxGenJS is called.
 */
export interface DeckIRInput {
  schemaVersion: number;
  metadata: {
    id: string;
    title: string;
    author?: string;
    company?: string;
    language?: string;
    subject?: string;
  };
  canvas: {
    width: number;
    height: number;
    pptxWidthInch?: number;
    pptxHeightInch?: number;
  };
  theme?: unknown;
  slides: ReadonlyArray<{
    id: string;
    sourcePath?: string;
    layoutId?: string;
    masterId?: string;
    background?: unknown;
    elements: ReadonlyArray<unknown>;
    notes?: {
      markdown?: string;
      plainText?: string;
      sources?: ReadonlyArray<SourceIR>;
    };
  }>;
  diagnostics?: ReadonlyArray<unknown>;
  contentHash?: string;
}

export interface RenderPptxOptions {
  strictEditable?: boolean;
  compression?: boolean;
  revision?: string;
  subject?: string;
}

export interface RenderedPptx {
  data: Uint8Array;
  slideCount: number;
  objectNames: string[];
}

export interface RendererDiagnostic {
  code: string;
  message: string;
  slideId?: string;
  elementId?: string;
}
