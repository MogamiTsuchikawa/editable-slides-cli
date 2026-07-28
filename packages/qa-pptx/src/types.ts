export type PptxInput = string | Uint8Array | ArrayBuffer;

export interface PptxDeckInput {
  schemaVersion: number;
  metadata?: {
    id?: string;
    title?: string;
    language?: string;
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
    elements: ReadonlyArray<unknown>;
    notes?: {
      markdown?: string;
      plainText?: string;
      sources?: ReadonlyArray<{
        label: string;
        url?: string;
        detail?: string;
      }>;
    };
  }>;
}

export interface InspectPptxOptions {
  strictEditable?: boolean;
  frameTolerance?: number;
  fullSlideImageThreshold?: number;
  compareText?: boolean;
  compareTextStyles?: boolean;
}

export type InspectionSeverity = "error" | "warning";

export interface InspectionIssue {
  severity: InspectionSeverity;
  code: string;
  message: string;
  slideId?: string;
  slideNumber?: number;
  elementId?: string;
  objectName?: string;
  expected?: unknown;
  actual?: unknown;
}

export type NativeObjectKind =
  | "text"
  | "shape"
  | "line"
  | "connector"
  | "image"
  | "table"
  | "chart"
  | "unknown";

export interface InspectedTextRun {
  text: string;
  fontFace?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface LogicalFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InspectedObject {
  name: string;
  nativeKind: NativeObjectKind;
  ooxmlElement: "p:sp" | "p:cxnSp" | "p:pic" | "p:graphicFrame";
  logicalFrame?: LogicalFrame;
  rotation?: number;
  text?: string;
  textRuns?: InspectedTextRun[];
  relationshipId?: string;
}

export interface InspectedSlide {
  slideNumber: number;
  slideId?: string;
  fileName: string;
  objects: InspectedObject[];
  notesFile?: string;
  notesText?: string;
}

export interface PptxInspectionReport {
  valid: boolean;
  slideCount: number;
  notesSlideCount: number;
  expectedEditableObjects: number;
  verifiedNativeObjects: number;
  nativeEditabilityRate: number;
  semanticHash: string;
  issues: InspectionIssue[];
  slides: InspectedSlide[];
}

export interface LibreOfficeSmokeOptions {
  binary?: string;
  timeoutMs?: number;
  required?: boolean;
}

export interface LibreOfficeSmokeResult {
  available: boolean;
  success: boolean;
  binary?: string;
  output: string;
  error?: string;
  generatedPdfBytes?: number;
}
