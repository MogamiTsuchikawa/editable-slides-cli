import type { RendererDiagnostic } from "./types.js";

export class PptxRenderError extends Error {
  readonly diagnostics: RendererDiagnostic[];

  constructor(message: string, diagnostics: RendererDiagnostic[]) {
    super(message);
    this.name = "PptxRenderError";
    this.diagnostics = diagnostics;
  }
}

export class StrictEditableError extends PptxRenderError {
  constructor(diagnostics: RendererDiagnostic[]) {
    super(
      `PPTX strict-editable validation failed with ${diagnostics.length} error(s).`,
      diagnostics,
    );
    this.name = "StrictEditableError";
  }
}
