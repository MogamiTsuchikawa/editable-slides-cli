import type { Diagnostic, ElementIR, SlideIR } from "@livetoon/slide-deck-ir";

import { createDiagnostic } from "./diagnostics.js";
import type { ElementLayoutOverride, LayoutOverrides } from "./types.js";

function findElement(elements: ElementIR[], id: string): ElementIR | undefined {
  for (const element of elements) {
    if (element.id === id) {
      return element;
    }
    if (element.type === "group") {
      const child = findElement(element.children, id);
      if (child) {
        return child;
      }
    }
  }
  return undefined;
}

function applyElementOverride(
  element: ElementIR,
  override: ElementLayoutOverride,
): void {
  element.frame = {
    x: override.x ?? element.frame.x,
    y: override.y ?? element.frame.y,
    w: override.w ?? element.frame.w,
    h: override.h ?? element.frame.h,
  };
  if (override.rotation !== undefined) {
    element.rotation = override.rotation;
  }
  if (override.zIndex !== undefined) {
    element.zIndex = override.zIndex;
  }
}

export function applyLayoutOverrides(
  slides: SlideIR[],
  overrides: LayoutOverrides,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const slidesById = new Map(slides.map((slide) => [slide.id, slide]));

  for (const [slideId, elementOverrides] of Object.entries(overrides.slides)) {
    const slide = slidesById.get(slideId);
    if (!slide) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "LAYOUT_OVERRIDE_ORPHAN_SLIDE",
          message: `Override references missing slide "${slideId}"`,
          slideId,
        }),
      );
      continue;
    }
    for (const [elementId, override] of Object.entries(elementOverrides)) {
      const element = findElement(slide.elements, elementId);
      if (!element) {
        diagnostics.push(
          createDiagnostic({
            severity: "warning",
            code: "LAYOUT_OVERRIDE_ORPHAN_ELEMENT",
            message: `Override references missing element "${elementId}"`,
            sourceLocation: {
              file: slide.sourcePath,
              line: 1,
              column: 1,
            },
            slideId,
            elementId,
          }),
        );
        continue;
      }
      applyElementOverride(element, override);
    }
  }

  return diagnostics;
}
