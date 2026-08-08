import type {
  ElementIR,
  FillIR,
  FrameIR,
  SlideIR,
  TextElementIR,
} from "@livetoon/slide-deck-ir";
import type { ThemeDefinition } from "@livetoon/slide-theme-default";

export interface AccessibilityIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  elementId?: string;
}

export interface VisualAlternativeInput {
  component: "Image" | "Icon" | "Video" | "Audio";
  alt?: string;
  transcript?: string;
  decorative?: boolean;
  background?: boolean;
}

export function validateVisualAlternative(
  input: VisualAlternativeInput,
): AccessibilityIssue[] {
  const alt = input.alt?.trim() ?? "";
  const transcript = input.transcript?.trim() ?? "";
  const explicitlyDecorative = input.decorative === true || input.background === true;
  if (explicitlyDecorative && alt !== "") {
    return [
      {
        severity: "error",
        code: "ACCESSIBILITY_DECORATIVE_ALT_CONFLICT",
        message: `${input.component} marked decorative must not include alt text`,
      },
    ];
  }
  if (!explicitlyDecorative && alt === "" && transcript === "") {
    return [
      {
        severity: "error",
        code: "ACCESSIBILITY_ALT_REQUIRED",
        message:
          input.component === "Video" || input.component === "Audio"
            ? `${input.component} requires non-empty alt text or transcript`
            : `${input.component} requires non-empty alt text or decorative={true}`,
      },
    ];
  }
  return [];
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function parseColor(value: string | undefined): RgbColor | undefined {
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value ?? "");
  if (!match?.[1]) return undefined;
  return {
    red: Number.parseInt(match[1].slice(0, 2), 16),
    green: Number.parseInt(match[1].slice(2, 4), 16),
    blue: Number.parseInt(match[1].slice(4, 6), 16),
    alpha: match[2] ? Number.parseInt(match[2], 16) / 255 : 1,
  };
}

function composite(foreground: RgbColor, background: RgbColor): RgbColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha <= 0) {
    return { red: 255, green: 255, blue: 255, alpha: 1 };
  }
  return {
    red:
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
      alpha,
    green:
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
      alpha,
    blue:
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
      alpha,
    alpha,
  };
}

function linearChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: RgbColor): number {
  return (
    0.2126 * linearChannel(color.red) +
    0.7152 * linearChannel(color.green) +
    0.0722 * linearChannel(color.blue)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  if (!foregroundColor || !backgroundColor) return 1;
  const opaqueBackground = composite(backgroundColor, {
    red: 255,
    green: 255,
    blue: 255,
    alpha: 1,
  });
  const opaqueForeground = composite(foregroundColor, opaqueBackground);
  const light = Math.max(luminance(opaqueForeground), luminance(opaqueBackground));
  const dark = Math.min(luminance(opaqueForeground), luminance(opaqueBackground));
  return (light + 0.05) / (dark + 0.05);
}

function withOpacity(color: RgbColor, opacity: number): RgbColor {
  return {
    ...color,
    alpha: color.alpha * Math.max(0, Math.min(1, opacity)),
  };
}

function fillColor(
  fill: FillIR | undefined,
  background: RgbColor,
): RgbColor | undefined {
  if (fill?.type !== "solid") return undefined;
  const color = parseColor(fill.color);
  if (!color) return undefined;
  const transparency = Math.max(0, Math.min(100, fill.transparency ?? 0));
  return composite(withOpacity(color, 1 - transparency / 100), background);
}

function contains(outer: FrameIR, inner: FrameIR): boolean {
  return (
    outer.x <= inner.x + 1 &&
    outer.y <= inner.y + 1 &&
    outer.x + outer.w >= inner.x + inner.w - 1 &&
    outer.y + outer.h >= inner.y + inner.h - 1
  );
}

function intersects(left: FrameIR, right: FrameIR): boolean {
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}

function flatten(elements: readonly ElementIR[]): ElementIR[] {
  const flattened: ElementIR[] = [];
  for (const element of elements) {
    flattened.push(element);
    if (element.type === "group") {
      flattened.push(...flatten(element.children));
    }
  }
  return flattened;
}

function baseBackground(slide: SlideIR, theme: ThemeDefinition): RgbColor {
  const white = { red: 255, green: 255, blue: 255, alpha: 1 };
  const master = theme.ir.masters.find((candidate) => candidate.id === slide.masterId);
  const candidates = [
    slide.background,
    master?.background,
    theme.ir.colors.background
      ? ({ type: "solid", color: theme.ir.colors.background } as const)
      : undefined,
  ];
  for (const fill of candidates) {
    if (fill?.type === "image") {
      continue;
    }
    const color = fillColor(fill, white);
    if (color) return color;
  }
  return white;
}

function backgroundForText(
  text: TextElementIR,
  slideElements: readonly ElementIR[],
  masterElements: readonly ElementIR[],
  slideBackground: RgbColor,
): RgbColor {
  const masterShapes = masterElements
    .filter(
      (
        element,
      ): element is Extract<ElementIR, { type: "shape" }> & {
        fill: Extract<FillIR, { type: "solid" }>;
      } =>
        element.type === "shape" &&
        contains(element.frame, text.frame) &&
        element.fill.type === "solid",
    )
    .sort((left, right) => left.zIndex - right.zIndex);
  const slideShapes = slideElements
    .filter(
      (
        element,
      ): element is Extract<ElementIR, { type: "shape" }> & {
        fill: Extract<FillIR, { type: "solid" }>;
      } =>
        element.type === "shape" &&
        element.zIndex < text.zIndex &&
        contains(element.frame, text.frame) &&
        element.fill.type === "solid",
    )
    .sort((left, right) => left.zIndex - right.zIndex);

  let background = slideBackground;
  for (const shape of [...masterShapes, ...slideShapes]) {
    const color = parseColor(shape.fill.color);
    if (!color) continue;
    const transparency = shape.fill.transparency ?? 0;
    background = composite(
      withOpacity(color, shape.opacity * (1 - transparency / 100)),
      background,
    );
  }
  return background;
}

function contrastIssues(
  slide: SlideIR,
  theme: ThemeDefinition,
  textElements: readonly ElementIR[],
  masterElements: readonly ElementIR[],
): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = [];
  const slideBackground = baseBackground(slide, theme);
  for (const element of textElements) {
    if (element.type !== "text") continue;
    const background = backgroundForText(
      element,
      textElements,
      masterElements,
      slideBackground,
    );
    const backgroundHex = `#${[background.red, background.green, background.blue]
      .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
      .join("")}`;
    let lowestRatio = Number.POSITIVE_INFINITY;
    let requiredRatio = 4.5;
    let lowestNormalizedRatio = Number.POSITIVE_INFINITY;
    for (const paragraph of element.paragraphs) {
      for (const run of paragraph.runs) {
        if (run.text.trim() === "") continue;
        const rawColor = run.color ?? element.style.color;
        const parsed = parseColor(rawColor);
        if (!parsed) continue;
        const effective = composite(withOpacity(parsed, element.opacity), background);
        const effectiveHex = `#${[effective.red, effective.green, effective.blue]
          .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
          .join("")}`;
        const ratio = contrastRatio(effectiveHex, backgroundHex);
        const fontSizePoints = (run.fontSize ?? element.style.fontSize) * 0.5;
        const bold = run.bold === true || element.style.fontWeight >= 700;
        const large = fontSizePoints >= 18 || (bold && fontSizePoints >= 14);
        const required = large ? 3 : 4.5;
        if (ratio / required < lowestNormalizedRatio) {
          lowestRatio = ratio;
          requiredRatio = required;
          lowestNormalizedRatio = ratio / required;
        }
      }
    }
    if (lowestNormalizedRatio + 0.002 < 1) {
      issues.push({
        severity: "warning",
        code: "ACCESSIBILITY_TEXT_CONTRAST_LOW",
        message: `Text contrast is ${lowestRatio.toFixed(2)}:1; at least ${requiredRatio.toFixed(1)}:1 is recommended`,
        elementId: element.id,
      });
    }
  }
  return issues;
}

function isSemantic(element: ElementIR): boolean {
  if (element.type === "text" || element.type === "table" || element.type === "chart") {
    return true;
  }
  return (
    (element.type === "image" || element.type === "icon") &&
    typeof element.alt === "string" &&
    element.alt.trim() !== ""
  );
}

function horizontalOverlapRatio(left: FrameIR, right: FrameIR): number {
  const overlap = Math.max(
    0,
    Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x),
  );
  return overlap / Math.max(1, Math.min(left.w, right.w));
}

function readingOrderIssues(elements: readonly ElementIR[]): AccessibilityIssue[] {
  const semantic = elements.filter(isSemantic);
  const issues: AccessibilityIssue[] = [];
  for (let laterIndex = 1; laterIndex < semantic.length; laterIndex += 1) {
    const later = semantic[laterIndex];
    if (!later) continue;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = semantic[earlierIndex];
      if (!earlier) continue;
      const verticalInversion = earlier.frame.y - later.frame.y;
      if (
        verticalInversion >= 64 &&
        horizontalOverlapRatio(earlier.frame, later.frame) >= 0.5
      ) {
        issues.push({
          severity: "warning",
          code: "ACCESSIBILITY_READING_ORDER_SUSPECT",
          message: `Element appears above earlier source element "${earlier.id}"; check reading order`,
          elementId: later.id,
        });
        break;
      }
    }
  }
  return issues;
}

function safeAreaIssues(
  elements: readonly ElementIR[],
  safeArea: FrameIR,
): AccessibilityIssue[] {
  return elements.flatMap((element): AccessibilityIssue[] => {
    if (!isSemantic(element) || intersects(element.frame, safeArea)) return [];
    return [
      {
        severity: "warning",
        code: "ACCESSIBILITY_ELEMENT_OUTSIDE_SAFE_AREA",
        message: "Semantic content is entirely outside the theme safe area",
        elementId: element.id,
      },
    ];
  });
}

export function validateSlideAccessibility(
  slide: SlideIR,
  theme: ThemeDefinition,
): AccessibilityIssue[] {
  const elements = flatten(slide.elements);
  const master = theme.ir.masters.find((candidate) => candidate.id === slide.masterId);
  const masterElements = flatten(master?.elements ?? []);
  return [
    ...contrastIssues(slide, theme, elements, masterElements),
    ...readingOrderIssues(elements),
    ...safeAreaIssues(elements, theme.ir.safeArea),
  ];
}
