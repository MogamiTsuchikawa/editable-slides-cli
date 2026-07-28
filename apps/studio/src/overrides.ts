import type { ElementIR, SlideIR } from "@livetoon/slide-deck-ir";

export const OVERRIDE_SCHEMA_VERSION = 1 as const;

export interface FrameOverride {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  zIndex: number;
}

export interface OverrideDocument {
  schemaVersion: typeof OVERRIDE_SCHEMA_VERSION;
  slides: Record<string, Record<string, FrameOverride>>;
}

export function emptyOverrides(): OverrideDocument {
  return {
    schemaVersion: OVERRIDE_SCHEMA_VERSION,
    slides: {},
  };
}

export function isFrameOverride(value: unknown): value is FrameOverride {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["x", "y", "w", "h", "rotation", "zIndex"].every(
    (key) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]),
  );
}

export function parseOverrideDocument(value: unknown): OverrideDocument {
  if (!value || typeof value !== "object") return emptyOverrides();
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== OVERRIDE_SCHEMA_VERSION) return emptyOverrides();
  if (!candidate.slides || typeof candidate.slides !== "object") {
    return emptyOverrides();
  }

  const slides: OverrideDocument["slides"] = {};
  for (const [slideId, rawElements] of Object.entries(
    candidate.slides as Record<string, unknown>,
  )) {
    if (!rawElements || typeof rawElements !== "object") continue;
    const elements: Record<string, FrameOverride> = {};
    for (const [elementId, rawFrame] of Object.entries(
      rawElements as Record<string, unknown>,
    )) {
      if (isFrameOverride(rawFrame)) elements[elementId] = { ...rawFrame };
    }
    if (Object.keys(elements).length > 0) slides[slideId] = elements;
  }
  return { schemaVersion: OVERRIDE_SCHEMA_VERSION, slides };
}

export function frameForElement(
  element: ElementIR,
  override?: FrameOverride,
): FrameOverride {
  return {
    x: override?.x ?? element.frame.x,
    y: override?.y ?? element.frame.y,
    w: override?.w ?? element.frame.w,
    h: override?.h ?? element.frame.h,
    rotation: override?.rotation ?? element.rotation,
    zIndex: override?.zIndex ?? element.zIndex,
  };
}

export function setFrameOverride(
  document: OverrideDocument,
  slideId: string,
  elementId: string,
  frame: FrameOverride,
): OverrideDocument {
  return {
    schemaVersion: OVERRIDE_SCHEMA_VERSION,
    slides: {
      ...document.slides,
      [slideId]: {
        ...document.slides[slideId],
        [elementId]: { ...frame },
      },
    },
  };
}

export function setFrameOverrides(
  document: OverrideDocument,
  slideId: string,
  frames: Readonly<Record<string, FrameOverride>>,
): OverrideDocument {
  return {
    schemaVersion: OVERRIDE_SCHEMA_VERSION,
    slides: {
      ...document.slides,
      [slideId]: {
        ...document.slides[slideId],
        ...frames,
      },
    },
  };
}

export function flattenElements(elements: readonly ElementIR[]): ElementIR[] {
  const flattened: ElementIR[] = [];
  const visit = (element: ElementIR) => {
    flattened.push(element);
    if (element.type === "group") element.children.forEach(visit);
  };
  elements.forEach(visit);
  return flattened;
}

export function findOrphanOverrides(
  document: OverrideDocument,
  slides: readonly SlideIR[],
): string[] {
  const elementsBySlide = new Map(
    slides.map((slide) => [
      slide.id,
      new Set(flattenElements(slide.elements).map((element) => element.id)),
    ]),
  );
  const orphans: string[] = [];
  for (const [slideId, elements] of Object.entries(document.slides)) {
    const known = elementsBySlide.get(slideId);
    for (const elementId of Object.keys(elements)) {
      if (!known?.has(elementId)) orphans.push(`${slideId}/${elementId}`);
    }
  }
  return orphans.sort();
}
