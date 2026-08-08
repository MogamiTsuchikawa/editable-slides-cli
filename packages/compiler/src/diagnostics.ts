import type {
  Diagnostic,
  DiagnosticSeverity,
  SourceLocation,
} from "@editable-slides/slide-deck-ir";

export interface DiagnosticInput {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  sourceLocation?: SourceLocation;
  slideId?: string;
  elementId?: string;
}

export function createDiagnostic(input: DiagnosticInput): Diagnostic {
  const diagnostic: Diagnostic = {
    severity: input.severity,
    code: input.code,
    message: input.message,
  };
  if (input.sourceLocation) {
    diagnostic.sourceLocation = input.sourceLocation;
  }
  if (input.slideId) {
    diagnostic.slideId = input.slideId;
  }
  if (input.elementId) {
    diagnostic.elementId = input.elementId;
  }
  return diagnostic;
}

export class DeckCompileError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    super(
      errors.length === 1
        ? errors[0]?.message
        : `Deck compilation failed with ${errors.length} errors`,
    );
    this.name = "DeckCompileError";
    this.diagnostics = diagnostics;
  }
}
