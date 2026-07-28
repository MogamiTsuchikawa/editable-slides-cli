import type { Diagnostic, ElementIR, SlideIR } from "@livetoon/slide-deck-ir";
import { WIDE_CANVAS } from "@livetoon/slide-deck-ir";
import type { ThemeDefinition } from "@livetoon/slide-theme-default";

import { createDiagnostic } from "./diagnostics.js";

function flattenElements(elements: ElementIR[]): ElementIR[] {
  const flattened: ElementIR[] = [];
  for (const element of elements) {
    flattened.push(element);
    if (element.type === "group") {
      flattened.push(...flattenElements(element.children));
    }
  }
  return flattened;
}

function estimateTextHeight(element: Extract<ElementIR, { type: "text" }>): number {
  const averageCharacterWidth = element.style.fontSize * 0.55;
  const charactersPerLine = Math.max(
    1,
    Math.floor(element.frame.w / averageCharacterWidth),
  );
  let lines = 0;
  for (const paragraph of element.paragraphs) {
    const characters = paragraph.runs.reduce(
      (total, run) => total + run.text.length,
      0,
    );
    lines += Math.max(1, Math.ceil(characters / charactersPerLine));
  }
  return lines * element.style.fontSize * (element.style.lineHeight ?? 1.35);
}

export function validateSlides(
  slides: SlideIR[],
  theme: ThemeDefinition,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const slideIds = new Set<string>();
  const registeredFonts = new Set(theme.ir.fonts.registered.map((font) => font.family));

  for (const slide of slides) {
    if (slideIds.has(slide.id)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "SLIDE_ID_DUPLICATE",
          message: `Duplicate slide id: ${slide.id}`,
          sourceLocation: { file: slide.sourcePath, line: 1, column: 1 },
          slideId: slide.id,
        }),
      );
    }
    slideIds.add(slide.id);

    const elements = flattenElements(slide.elements);
    const elementIds = new Set<string>();
    for (const element of elements) {
      if (elementIds.has(element.id)) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "ELEMENT_ID_DUPLICATE",
            message: `Duplicate element id: ${element.id}`,
            sourceLocation: element.sourceLocation,
            slideId: slide.id,
            elementId: element.id,
          }),
        );
      }
      elementIds.add(element.id);

      const { x, y, w, h } = element.frame;
      if (x < 0 || y < 0 || x + w > WIDE_CANVAS.width || y + h > WIDE_CANVAS.height) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "ELEMENT_OUT_OF_BOUNDS",
            message: `Element frame (${x}, ${y}, ${w}, ${h}) exceeds the 1920x1080 canvas`,
            sourceLocation: element.sourceLocation,
            slideId: slide.id,
            elementId: element.id,
          }),
        );
      }

      if (element.opacity < 0 || element.opacity > 1) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "ELEMENT_OPACITY_INVALID",
            message: "opacity must be between 0 and 1",
            sourceLocation: element.sourceLocation,
            slideId: slide.id,
            elementId: element.id,
          }),
        );
      }

      if (element.type === "text") {
        const fonts = [
          element.style.fontFace,
          ...element.paragraphs.flatMap((paragraph) =>
            paragraph.runs.flatMap((run) => (run.fontFace ? [run.fontFace] : [])),
          ),
        ];
        for (const font of fonts) {
          if (!registeredFonts.has(font)) {
            diagnostics.push(
              createDiagnostic({
                severity: "error",
                code: "FONT_UNREGISTERED",
                message: `Font "${font}" is not registered by theme "${theme.ir.id}"`,
                sourceLocation: element.sourceLocation,
                slideId: slide.id,
                elementId: element.id,
              }),
            );
          }
        }
        if (
          element.style.textFit !== "shrink" &&
          estimateTextHeight(element) > element.frame.h
        ) {
          diagnostics.push(
            createDiagnostic({
              severity: "warning",
              code: "TEXT_MAY_OVERFLOW",
              message:
                'Estimated text height exceeds its frame; add space, shorten text, or explicitly set textFit="shrink"',
              sourceLocation: element.sourceLocation,
              slideId: slide.id,
              elementId: element.id,
            }),
          );
        }
      }
    }

    for (const element of elements) {
      if (element.type !== "connector") {
        continue;
      }
      for (const reference of [element.fromElementId, element.toElementId].filter(
        (value): value is string => value !== undefined,
      )) {
        if (!elementIds.has(reference)) {
          diagnostics.push(
            createDiagnostic({
              severity: "error",
              code: "CONNECTOR_TARGET_MISSING",
              message: `Connector references missing element "${reference}"`,
              sourceLocation: element.sourceLocation,
              slideId: slide.id,
              elementId: element.id,
            }),
          );
        }
      }
    }
  }

  return diagnostics;
}
