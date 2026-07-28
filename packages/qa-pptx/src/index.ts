export { PptxInspectionError } from "./error.js";
export { assertPptx, inspectPptx } from "./inspector.js";
export {
  findLibreOfficeBinary,
  smokeTestPptxWithLibreOffice,
} from "./libreoffice.js";
export type {
  InspectedObject,
  InspectedSlide,
  InspectedTextRun,
  InspectionIssue,
  InspectionSeverity,
  InspectPptxOptions,
  LibreOfficeSmokeOptions,
  LibreOfficeSmokeResult,
  LogicalFrame,
  NativeObjectKind,
  PptxDeckInput,
  PptxInput,
  PptxInspectionReport,
} from "./types.js";
