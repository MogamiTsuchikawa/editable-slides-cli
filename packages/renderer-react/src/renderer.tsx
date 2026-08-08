import type {
  DeckIR,
  ElementIR,
  FrameIR,
  SlideIR,
} from "@editable-slides/slide-deck-ir";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type RenderMode =
  | "normal"
  | "overview"
  | "presenter"
  | "print"
  | "edit"
  | "debug";

export interface EditableFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  zIndex: number;
}

export type ElementFrameOverrides = Readonly<
  Record<string, Partial<EditableFrame> | undefined>
>;

export interface OverflowIssue {
  slideId: string;
  elementId: string;
  horizontal: boolean;
  vertical: boolean;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

export type ElementPointerHandler = (
  element: ElementIR,
  event: ReactPointerEvent<HTMLElement>,
) => void;

export interface SlideCanvasProps {
  deck?: DeckIR;
  slide: SlideIR;
  mode?: RenderMode;
  className?: string;
  frameOverrides?: ElementFrameOverrides;
  selectedIds?: ReadonlySet<string>;
  safeArea?: { x: number; y: number; w: number; h: number };
  onElementPointerDown?: ElementPointerHandler;
  onOverflowIssues?: (issues: OverflowIssue[]) => void;
}

export interface ResponsiveSlideProps extends SlideCanvasProps {
  maxScale?: number;
  minScale?: number;
  fit?: "contain" | "width";
}

declare global {
  interface Window {
    __SLIDES_READY__?: boolean;
    __SLIDE_OVERFLOW__?: OverflowIssue[];
  }
}

type FlexibleElement = ElementIR & Record<string, unknown>;
type FlexibleRecord = Record<string, unknown>;

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

function isRecord(value: unknown): value is FlexibleRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function colorValue(value: unknown, fallback = "transparent"): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return fallback;
  for (const key of ["color", "value", "hex", "rgb"]) {
    if (typeof value[key] === "string") return value[key] as string;
  }
  return fallback;
}

function colorWithOpacity(color: string, opacity: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) {
    return color;
  }
  return `rgba(${Number.parseInt(match[1] ?? "0", 16)}, ${Number.parseInt(
    match[2] ?? "0",
    16,
  )}, ${Number.parseInt(match[3] ?? "0", 16)}, ${Math.min(1, Math.max(0, opacity))})`;
}

function strokeValue(value: unknown): {
  color: string;
  width: number;
  dash?: string;
} {
  if (typeof value === "string") return { color: value, width: 2 };
  if (!isRecord(value)) return { color: "transparent", width: 0 };
  const dash = Array.isArray(value.dash)
    ? value.dash.filter((part): part is number => typeof part === "number").join(" ")
    : value.dash === "dash"
      ? "12 8"
      : value.dash === "dot"
        ? "2 7"
        : typeof value.dash === "string" && value.dash !== "solid"
          ? value.dash
          : undefined;
  return {
    color: colorValue(value, "#334155"),
    width: numberValue(value.width, 2),
    dash,
  };
}

function toCssFontWeight(value: unknown): CSSProperties["fontWeight"] {
  if (typeof value === "number" || typeof value === "string") return value;
  return undefined;
}

function quotedFontFamily(value: string): string {
  const genericFamilies = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
  ]);
  return genericFamilies.has(value.toLowerCase())
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function fontStack(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return `${quotedFontFamily(value.trim())}, ${fallback}`;
  }
  return fallback;
}

export function elementType(element: ElementIR): string {
  const flexible = element as unknown as FlexibleRecord;
  return stringValue(flexible.type ?? flexible.kind).toLowerCase();
}

export function applyFrameOverride(
  element: ElementIR,
  override?: Partial<EditableFrame>,
): EditableFrame {
  const base = element as FlexibleElement;
  const frame: FlexibleRecord = isRecord(base.frame) ? base.frame : {};
  return {
    x: numberValue(override?.x, numberValue(frame.x)),
    y: numberValue(override?.y, numberValue(frame.y)),
    w: Math.max(0, numberValue(override?.w, numberValue(frame.w))),
    h: Math.max(0, numberValue(override?.h, numberValue(frame.h))),
    rotation: numberValue(override?.rotation, numberValue(base.rotation)),
    zIndex: numberValue(override?.zIndex, numberValue(base.zIndex)),
  };
}

export function elementFrameStyle(frame: EditableFrame): CSSProperties {
  return {
    left: frame.x,
    top: frame.y,
    width: frame.w,
    height: frame.h,
    zIndex: frame.zIndex,
    transform: frame.rotation === 0 ? undefined : `rotate(${frame.rotation}deg)`,
  };
}

function themeVariables(deck?: DeckIR): CSSProperties {
  if (!deck) return {};
  const theme = deck.theme as unknown as FlexibleRecord;
  const colors = isRecord(theme.colors) ? theme.colors : {};
  const fonts = isRecord(theme.fonts) ? theme.fonts : {};
  const fontReference = (role: "body" | "heading" | "code", finalFallback: string) => {
    const reference = isRecord(fonts[role]) ? fonts[role] : {};
    const families = [
      stringValue(reference.family),
      ...(Array.isArray(reference.fallbacks)
        ? reference.fallbacks.map((family) => stringValue(family))
        : []),
    ].filter(Boolean);
    return [...new Set(families)]
      .map(quotedFontFamily)
      .concat(finalFallback)
      .join(", ");
  };
  return {
    "--lt-color-background": colorValue(
      colors.background ?? theme.background,
      "#ffffff",
    ),
    "--lt-color-text": colorValue(colors.text ?? colors.foreground, "#172033"),
    "--lt-color-primary": colorValue(colors.primary ?? colors.accent, "#2563eb"),
    "--lt-font-body": fontReference("body", "sans-serif"),
    "--lt-font-heading": fontReference("heading", "sans-serif"),
    "--lt-font-code": fontReference("code", "monospace"),
  } as CSSProperties;
}

function renderRuns(runs: unknown): ReactNode {
  if (!Array.isArray(runs)) return null;
  return runs.map((run, index) => {
    if (typeof run === "string") return <Fragment key={index}>{run}</Fragment>;
    if (!isRecord(run)) return null;
    const text = stringValue(run.text);
    const href = typeof run.href === "string" ? run.href : undefined;
    const style: CSSProperties = {
      color: colorValue(run.color, "inherit"),
      fontFamily:
        typeof run.fontFace === "string"
          ? fontStack(run.fontFace, "var(--lt-font-body, sans-serif)")
          : "inherit",
      fontSize: typeof run.fontSize === "number" ? run.fontSize : undefined,
      fontWeight: run.bold ? 700 : toCssFontWeight(run.fontWeight),
      fontStyle: run.italic ? "italic" : undefined,
      textDecoration: run.underline ? "underline" : undefined,
    };
    const content = (
      <span key={`${text}-${href ?? ""}`} style={style}>
        {text}
      </span>
    );
    return href ? (
      <a href={href} key={index} rel="noreferrer" style={{ color: "inherit" }}>
        {content}
      </a>
    ) : (
      <Fragment key={index}>{content}</Fragment>
    );
  });
}

function paragraphPlainText(paragraph: FlexibleRecord): string {
  if (typeof paragraph.text === "string") return paragraph.text;
  if (!Array.isArray(paragraph.runs)) return "";
  return paragraph.runs
    .map((run) => (isRecord(run) ? stringValue(run.text) : stringValue(run)))
    .join("");
}

function renderParagraphs(paragraphs: unknown, fallbackText: string): ReactNode {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return fallbackText;
  }
  return paragraphs.map((paragraph, index) => {
    if (typeof paragraph === "string") return <p key={index}>{paragraph}</p>;
    if (!isRecord(paragraph)) return null;
    const level = Math.max(0, numberValue(paragraph.level));
    const bullet = paragraph.bullet;
    const bulletPrefix =
      paragraph.ordered || bullet === "number"
        ? `${index + 1}. `
        : bullet === true || bullet === "bullet"
          ? "• "
          : "";
    return (
      <p
        key={index}
        style={{
          marginLeft: level ? `${level * 1.1}em` : undefined,
          marginTop:
            typeof paragraph.spaceBefore === "number"
              ? paragraph.spaceBefore
              : undefined,
          marginBottom:
            typeof paragraph.spaceAfter === "number" ? paragraph.spaceAfter : undefined,
          textAlign:
            paragraph.align === "center" ||
            paragraph.align === "right" ||
            paragraph.align === "justify"
              ? paragraph.align
              : undefined,
        }}
      >
        {bulletPrefix}
        {Array.isArray(paragraph.runs)
          ? renderRuns(paragraph.runs)
          : paragraphPlainText(paragraph)}
      </p>
    );
  });
}

function TextContent({ element }: { element: FlexibleElement }) {
  const style = isRecord(element.style) ? element.style : {};
  const text = stringValue(element.text ?? element.plainText);
  const fontSize = numberValue(style.fontSize ?? element.fontSize, 36);
  const fontFace = stringValue(style.fontFace ?? element.fontFace, "");
  const role = stringValue(element.role);
  const fallbackFont =
    role === "title" || role === "heading"
      ? "var(--lt-font-heading, sans-serif)"
      : role === "code"
        ? "var(--lt-font-code, monospace)"
        : "var(--lt-font-body, sans-serif)";
  const color = colorValue(style.color ?? element.color, "inherit");
  const verticalAlign = stringValue(style.verticalAlign, "top");
  return (
    <div
      className="lt-text-element"
      data-text-role={role || undefined}
      data-vertical-align={verticalAlign}
      style={{
        width: "100%",
        height: "100%",
        color,
        fontFamily: fontStack(fontFace, fallbackFont),
        fontSize,
        fontWeight: toCssFontWeight(style.fontWeight),
        lineHeight: typeof style.lineHeight === "number" ? style.lineHeight : 1.28,
        letterSpacing:
          typeof style.letterSpacing === "number" ? style.letterSpacing : undefined,
        textAlign:
          style.align === "center" ||
          style.align === "right" ||
          style.align === "justify"
            ? style.align
            : "left",
      }}
    >
      <div className="lt-text-content">
        {renderParagraphs(element.paragraphs, text)}
      </div>
    </div>
  );
}

function ImageContent({
  element,
  mode,
}: {
  element: FlexibleElement;
  mode: RenderMode;
}) {
  const fit = stringValue(element.fit, "contain");
  const posterFrame = isRecord(element.posterFrame) ? element.posterFrame : undefined;
  const src =
    mode === "print" && posterFrame
      ? stringValue(posterFrame.src)
      : stringValue(element.src ?? element.url ?? element.dataUri);
  const crop = isRecord(element.crop) ? element.crop : undefined;
  const focalPosition = isRecord(element.focalPosition)
    ? element.focalPosition
    : undefined;
  const cropCenterX = crop
    ? (numberValue(crop.left) + 1 - numberValue(crop.right)) / 2
    : 0.5;
  const cropCenterY = crop
    ? (numberValue(crop.top) + 1 - numberValue(crop.bottom)) / 2
    : 0.5;
  const positionX = numberValue(focalPosition?.x, cropCenterX) * 100;
  const positionY = numberValue(focalPosition?.y, cropCenterY) * 100;
  const mask = isRecord(element.mask) ? element.mask : undefined;
  const border = strokeValue(element.border);
  const borderTransparency = isRecord(element.border)
    ? numberValue(element.border.transparency)
    : 0;
  const shadow = isRecord(element.shadow) ? element.shadow : undefined;
  const shadowAngle = (numberValue(shadow?.angle, 45) * Math.PI) / 180;
  const shadowDistance = numberValue(shadow?.distance, 0);
  const borderRadius =
    mask?.type === "circle"
      ? "50%"
      : mask?.type === "roundRect"
        ? numberValue(mask.radius, 24)
        : undefined;
  return (
    <div
      className="lt-image-element"
      data-image-source={mode === "print" && posterFrame ? "posterFrame" : "original"}
      style={{
        width: "100%",
        height: "100%",
        border:
          border.width > 0
            ? `${border.width}px ${
                border.dash === "12 8"
                  ? "dashed"
                  : border.dash === "2 7"
                    ? "dotted"
                    : "solid"
              } ${colorWithOpacity(border.color, 1 - borderTransparency)}`
            : undefined,
        borderRadius,
        boxShadow: shadow
          ? `${Math.cos(shadowAngle) * shadowDistance}px ${
              Math.sin(shadowAngle) * shadowDistance
            }px ${numberValue(shadow.blur)}px ${colorWithOpacity(
              colorValue(shadow.color, "#000000"),
              numberValue(shadow.opacity, 0.25),
            )}`
          : undefined,
        boxSizing: "border-box",
        overflow: mask ? "hidden" : undefined,
      }}
    >
      <img
        alt={stringValue(element.alt)}
        draggable={false}
        src={src}
        style={{
          objectFit:
            fit === "stretch"
              ? "fill"
              : fit === "cover" || fit === "crop"
                ? "cover"
                : "contain",
          objectPosition: `${positionX}% ${positionY}%`,
        }}
      />
    </div>
  );
}

function mediaFallbackLabel(element: FlexibleElement, fallback: string): string {
  const alt = stringValue(element.alt).trim();
  const transcript = stringValue(element.transcript).trim();
  return alt || transcript || fallback;
}

function VideoPoster({ element }: { element: FlexibleElement }) {
  const fit = stringValue(element.fit, "contain");
  return (
    <div
      aria-label={mediaFallbackLabel(element, "動画")}
      className="lt-video-poster"
      role="img"
    >
      <img
        alt={mediaFallbackLabel(element, "動画")}
        draggable={false}
        src={stringValue(element.posterSrc)}
        style={{ objectFit: fit === "cover" ? "cover" : "contain" }}
      />
      <span aria-hidden="true" className="lt-media-play-indicator">
        ▶
      </span>
    </div>
  );
}

function VideoContent({
  element,
  mode,
}: {
  element: FlexibleElement;
  mode: RenderMode;
}) {
  if (mode !== "normal" && mode !== "presenter") {
    return <VideoPoster element={element} />;
  }
  const fit = stringValue(element.fit, "contain");
  const captionSrc = stringValue(element.captionSrc);
  return (
    <div className="lt-video-content">
      {/* biome-ignore lint/a11y/useMediaCaption: Captions are optional; a track is emitted whenever captionSrc is present. */}
      <video
        aria-label={mediaFallbackLabel(element, "動画")}
        controls
        playsInline
        poster={stringValue(element.posterSrc)}
        preload="metadata"
        src={stringValue(element.src)}
        style={{ objectFit: fit === "cover" ? "cover" : "contain" }}
      >
        {captionSrc ? (
          <track
            default
            kind="captions"
            label={stringValue(element.captionLabel, "字幕")}
            src={captionSrc}
            srcLang={stringValue(element.captionLanguage, "ja")}
          />
        ) : null}
      </video>
    </div>
  );
}

function AudioPoster({ element }: { element: FlexibleElement }) {
  const posterSrc = stringValue(element.posterSrc);
  return (
    <div className="lt-audio-poster">
      {posterSrc ? (
        <img alt="" aria-hidden="true" draggable={false} src={posterSrc} />
      ) : null}
      <span aria-hidden="true" className="lt-audio-icon">
        ♪
      </span>
      <span>{mediaFallbackLabel(element, "音声を再生")}</span>
    </div>
  );
}

function AudioContent({
  element,
  mode,
}: {
  element: FlexibleElement;
  mode: RenderMode;
}) {
  if (mode !== "normal" && mode !== "presenter") {
    return <AudioPoster element={element} />;
  }
  const captionSrc = stringValue(element.captionSrc);
  return (
    <div className="lt-audio-content">
      {/* biome-ignore lint/a11y/useMediaCaption: Captions are optional; a track is emitted whenever captionSrc is present. */}
      <audio
        aria-label={mediaFallbackLabel(element, "音声を再生")}
        controls
        preload="metadata"
        src={stringValue(element.src)}
      >
        {captionSrc ? (
          <track
            default
            kind="captions"
            label={stringValue(element.captionLabel, "字幕")}
            src={captionSrc}
            srcLang={stringValue(element.captionLanguage, "ja")}
          />
        ) : null}
      </audio>
    </div>
  );
}

function ShapeContent({ element }: { element: FlexibleElement }) {
  const shape = stringValue(element.shape ?? element.shapeType, "rect");
  const stroke = strokeValue(element.stroke);
  let clipPath: string | undefined;
  let borderRadius: CSSProperties["borderRadius"];
  if (shape === "ellipse") borderRadius = "50%";
  if (shape === "roundRect") borderRadius = numberValue(element.radius, 24);
  if (shape === "triangle") clipPath = "polygon(50% 0, 100% 100%, 0 100%)";
  return (
    <div
      className="lt-shape-element"
      style={{
        width: "100%",
        height: "100%",
        border: stroke.width ? `${stroke.width}px solid ${stroke.color}` : undefined,
        borderRadius,
        background: colorValue(element.fill, "transparent"),
        clipPath,
      }}
    />
  );
}

function arrowMarker(
  id: string,
  color: string,
  enabled: boolean,
  reverse = false,
): ReactNode {
  if (!enabled) return null;
  return (
    <marker
      id={id}
      markerHeight="8"
      markerUnits="strokeWidth"
      markerWidth="8"
      orient={reverse ? "auto-start-reverse" : "auto"}
      refX="7"
      refY="4"
      viewBox="0 0 8 8"
    >
      <path d="M0,0 L8,4 L0,8 Z" fill={color} />
    </marker>
  );
}

function LineContent({
  element,
  frame,
}: {
  element: FlexibleElement;
  frame: EditableFrame;
}) {
  const stroke = strokeValue(element.stroke);
  const local = (value: unknown, origin: number, fallback: number) => {
    const resolved = numberValue(value, fallback);
    return resolved >= origin ? resolved - origin : resolved;
  };
  const start = isRecord(element.start) ? element.start : {};
  const end = isRecord(element.end) ? element.end : {};
  const x1 = local(start.x ?? element.x1, frame.x, 0);
  const y1 = local(start.y ?? element.y1, frame.y, 0);
  const x2 = local(end.x ?? element.x2, frame.x, frame.w);
  const y2 = local(end.y ?? element.y2, frame.y, frame.h);
  const markerBase = `lt-arrow-${stringValue(element.id).replace(/[^a-z0-9_-]/gi, "-")}`;
  const beginArrow = stringValue(element.beginArrow, "none");
  const endArrow = stringValue(element.endArrow, "none");
  const begin = beginArrow !== "none";
  const hasEnd = endArrow !== "none";
  return (
    <div className="lt-line-element" style={{ width: "100%", height: "100%" }}>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${Math.max(frame.w, 1)} ${Math.max(frame.h, 1)}`}
      >
        <defs>
          {arrowMarker(`${markerBase}-begin`, stroke.color, begin, true)}
          {arrowMarker(`${markerBase}-end`, stroke.color, hasEnd)}
        </defs>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={stroke.color}
          strokeDasharray={stroke.dash}
          strokeLinecap="round"
          strokeWidth={stroke.width}
          markerStart={begin ? `url(#${markerBase}-begin)` : undefined}
          markerEnd={hasEnd ? `url(#${markerBase}-end)` : undefined}
        />
      </svg>
    </div>
  );
}

function renderCellParagraphs(value: unknown): ReactNode {
  if (isRecord(value) && Array.isArray(value.paragraphs)) {
    return renderParagraphs(value.paragraphs, "");
  }
  return stringValue(value);
}

function TableContent({ element }: { element: FlexibleElement }) {
  const rows = Array.isArray(element.rows) ? element.rows : [];
  const headerRows = Math.max(0, Math.floor(numberValue(element.headerRows, 1)));
  const columnWidths = Array.isArray(element.columnWidths)
    ? element.columnWidths.filter(
        (part): part is number => typeof part === "number" && part > 0,
      )
    : [];
  const totalColumnWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const style = isRecord(element.style) ? element.style : {};
  const textStyle = isRecord(style.text) ? style.text : {};
  const border = strokeValue(style.border);
  return (
    <div
      className="lt-table-element"
      style={
        {
          width: "100%",
          height: "100%",
          color: colorValue(textStyle.color, "inherit"),
          fontFamily: fontStack(textStyle.fontFace, "var(--lt-font-body, sans-serif)"),
          fontSize: numberValue(textStyle.fontSize, 26),
          "--lt-table-border": border.color || "#cbd5e1",
          "--lt-table-border-width": `${border.width || 1}px`,
        } as CSSProperties
      }
    >
      <table>
        {columnWidths.length > 0 ? (
          <colgroup>
            {columnWidths.map((width, index) => (
              <col
                key={index}
                style={{
                  width:
                    totalColumnWidth > 0
                      ? `${(width / totalColumnWidth) * 100}%`
                      : undefined,
                }}
              />
            ))}
          </colgroup>
        ) : null}
        <tbody>
          {rows.map((row, rowIndex) => {
            const rowRecord = isRecord(row) ? row : {};
            const cells = Array.isArray(rowRecord.cells) ? rowRecord.cells : [];
            return (
              <tr
                key={rowIndex}
                style={{
                  height:
                    typeof rowRecord.height === "number" && rowRecord.height > 0
                      ? rowRecord.height
                      : undefined,
                }}
              >
                {cells.map((cell, cellIndex) => {
                  const cellRecord = isRecord(cell) ? cell : {};
                  const cellTextStyle = isRecord(cellRecord.textStyle)
                    ? cellRecord.textStyle
                    : {};
                  const resolvedTextStyle = { ...textStyle, ...cellTextStyle };
                  const isHeader = rowIndex < headerRows;
                  const Tag = isHeader ? "th" : "td";
                  return (
                    <Tag
                      key={cellIndex}
                      colSpan={numberValue(cellRecord.colSpan, 1)}
                      rowSpan={numberValue(cellRecord.rowSpan, 1)}
                      style={{
                        background: colorValue(
                          cellRecord.fill ??
                            (isHeader ? style.headerFill : style.bodyFill),
                          "transparent",
                        ),
                        color: colorValue(resolvedTextStyle.color, "inherit"),
                        fontFamily:
                          typeof resolvedTextStyle.fontFace === "string"
                            ? fontStack(
                                resolvedTextStyle.fontFace,
                                "var(--lt-font-body, sans-serif)",
                              )
                            : undefined,
                        fontSize:
                          typeof resolvedTextStyle.fontSize === "number"
                            ? resolvedTextStyle.fontSize
                            : undefined,
                        fontWeight: toCssFontWeight(resolvedTextStyle.fontWeight),
                        fontStyle:
                          resolvedTextStyle.italic === true ? "italic" : undefined,
                        lineHeight:
                          typeof resolvedTextStyle.lineHeight === "number"
                            ? resolvedTextStyle.lineHeight
                            : undefined,
                        textAlign:
                          resolvedTextStyle.align === "left" ||
                          resolvedTextStyle.align === "center" ||
                          resolvedTextStyle.align === "right" ||
                          resolvedTextStyle.align === "justify"
                            ? resolvedTextStyle.align
                            : undefined,
                        verticalAlign:
                          resolvedTextStyle.verticalAlign === "top" ||
                          resolvedTextStyle.verticalAlign === "bottom" ||
                          resolvedTextStyle.verticalAlign === "middle"
                            ? resolvedTextStyle.verticalAlign
                            : undefined,
                      }}
                    >
                      {renderCellParagraphs(cellRecord)}
                    </Tag>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ChartSeries {
  name: string;
  labels: string[];
  values: number[];
  color?: string;
  chartType?: "bar" | "line" | "area" | "scatter";
  paletteIndex: number;
}

function chartSeries(value: unknown): ChartSeries[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((series, paletteIndex) => {
    if (!isRecord(series)) return [];
    const labels = Array.isArray(series.labels)
      ? series.labels.map((label) => stringValue(label))
      : [];
    const values = Array.isArray(series.values)
      ? series.values.map((part) => numberValue(part))
      : [];
    const rawChartType = stringValue(series.chartType ?? series.type);
    const chartType = ["bar", "line", "area", "scatter"].includes(rawChartType)
      ? (rawChartType as ChartSeries["chartType"])
      : undefined;
    const color = stringValue(series.color) || undefined;
    return [
      {
        name: stringValue(series.name),
        labels,
        values,
        color,
        chartType,
        paletteIndex,
      },
    ];
  });
}

const CHART_COLORS = ["#2563eb", "#14b8a6", "#f97316", "#8b5cf6", "#e11d48"];

function chartDataLabel(
  label: string | undefined,
  value: number,
  showValue: boolean,
  showCategoryName: boolean,
): string {
  return [showCategoryName ? label : undefined, showValue ? String(value) : undefined]
    .filter(Boolean)
    .join(" · ");
}

function categoryX(index: number, count: number): number {
  const groupWidth = 860 / Math.max(1, count);
  return 100 + index * groupWidth + groupWidth * 0.35;
}

function CategoryAxis({ count, labels }: { count?: number; labels: string[] }) {
  const resolvedCount = count ?? labels.length;
  return (
    <>
      <line x1="90" y1="820" x2="960" y2="820" stroke="#94a3b8" strokeWidth="3" />
      {labels.map((label, index) => (
        <text
          className="lt-chart-category-label"
          key={`${label}-${index}`}
          x={categoryX(index, resolvedCount)}
          y="885"
          fill="currentColor"
          fontSize="34"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
    </>
  );
}

function PieChart({
  colors,
  doughnut = false,
  series,
  showCategoryName,
  showValue,
}: {
  colors: string[];
  doughnut?: boolean;
  series: ChartSeries[];
  showCategoryName: boolean;
  showValue: boolean;
}) {
  const values = series[0]?.values ?? [];
  const labels = series[0]?.labels ?? [];
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  let cursor = -Math.PI / 2;
  const paths = values.map((value, index) => {
    const angle = (Math.max(0, value) / total) * Math.PI * 2;
    const start = cursor;
    const end = cursor + angle;
    cursor = end;
    const point = (at: number) => [500 + Math.cos(at) * 350, 500 + Math.sin(at) * 350];
    const [x1, y1] = point(start);
    const [x2, y2] = point(end);
    const large = angle > Math.PI ? 1 : 0;
    const middle = start + angle / 2;
    const labelText = chartDataLabel(labels[index], value, showValue, showCategoryName);
    return (
      <Fragment key={index}>
        <path
          d={`M500 500 L${x1} ${y1} A350 350 0 ${large} 1 ${x2} ${y2} Z`}
          fill={series[0]?.color ?? colors[index % colors.length]}
        />
        {labelText ? (
          <text
            className="lt-chart-data-label"
            x={500 + Math.cos(middle) * 270}
            y={500 + Math.sin(middle) * 270}
            fill="currentColor"
            fontSize="32"
            textAnchor="middle"
          >
            {labelText}
          </text>
        ) : null}
      </Fragment>
    );
  });
  return (
    <>
      {paths}
      {doughnut ? (
        <circle cx="500" cy="500" r="190" fill="var(--lt-slide-bg, white)" />
      ) : null}
    </>
  );
}

function BarChart({
  categoryCount,
  colorByPoint = true,
  colors,
  maxValue,
  series,
  showCategoryAxis = true,
  showCategoryName,
  showValue,
  stacked = false,
}: {
  categoryCount?: number;
  colorByPoint?: boolean;
  colors: string[];
  maxValue?: number;
  series: ChartSeries[];
  showCategoryAxis?: boolean;
  showCategoryName: boolean;
  showValue: boolean;
  stacked?: boolean;
}) {
  const count =
    categoryCount ?? Math.max(1, ...series.map((item) => item.values.length));
  const max =
    maxValue ??
    (stacked
      ? Math.max(
          1,
          ...Array.from({ length: count }, (_, index) =>
            series.reduce((sum, item) => sum + Math.max(0, item.values[index] ?? 0), 0),
          ),
        )
      : Math.max(1, ...series.flatMap((item) => item.values.map(Math.abs))));
  const groupWidth = 860 / count;
  const barWidth = stacked
    ? Math.max(8, groupWidth * 0.7)
    : Math.max(8, (groupWidth * 0.7) / Math.max(1, series.length));
  const baseline = 820;
  const labels = series[0]?.labels ?? [];
  const precedingValue = (seriesIndex: number, valueIndex: number) =>
    series
      .slice(0, seriesIndex)
      .reduce((sum, item) => sum + Math.max(0, item.values[valueIndex] ?? 0), 0);
  return (
    <>
      {showCategoryAxis ? <CategoryAxis labels={labels} /> : null}
      {series.flatMap((item, seriesIndex) =>
        item.values.map((value, index) => {
          const height = (Math.abs(value) / max) * 650;
          const x = 100 + index * groupWidth + (stacked ? 0 : seriesIndex * barWidth);
          const y =
            baseline -
            height -
            (stacked ? (precedingValue(seriesIndex, index) / max) * 650 : 0);
          return (
            <Fragment key={`${seriesIndex}-${index}`}>
              <rect
                x={x}
                y={y}
                width={barWidth - 4}
                height={height}
                rx="4"
                fill={
                  item.color ??
                  colors[
                    (colorByPoint && series.length === 1 ? index : item.paletteIndex) %
                      colors.length
                  ]
                }
              />
              {showValue || showCategoryName ? (
                <text
                  className="lt-chart-data-label"
                  x={x + (barWidth - 4) / 2}
                  y={y - 18}
                  fill="currentColor"
                  fontSize="34"
                  textAnchor="middle"
                >
                  {chartDataLabel(
                    item.labels[index],
                    value,
                    showValue,
                    showCategoryName,
                  )}
                </text>
              ) : null}
            </Fragment>
          );
        }),
      )}
    </>
  );
}

function LineChart({
  categoryCount,
  colors,
  maxValue,
  series,
  showCategoryAxis = true,
  showCategoryName,
  showValue,
  area = false,
  useCategoryBands = false,
}: {
  categoryCount?: number;
  colors: string[];
  maxValue?: number;
  series: ChartSeries[];
  showCategoryAxis?: boolean;
  showCategoryName: boolean;
  showValue: boolean;
  area?: boolean;
  useCategoryBands?: boolean;
}) {
  const count =
    categoryCount ?? Math.max(2, ...series.map((item) => item.values.length));
  const max =
    maxValue ?? Math.max(1, ...series.flatMap((item) => item.values.map(Math.abs)));
  const labels = series[0]?.labels ?? [];
  const pointX = (index: number) =>
    useCategoryBands
      ? categoryX(index, count)
      : 100 + (index / Math.max(1, count - 1)) * 850;
  const pointY = (value: number) => 820 - (value / max) * 650;
  return (
    <>
      {showCategoryAxis ? <CategoryAxis labels={labels} /> : null}
      {series.map((item, seriesIndex) => {
        const points = item.values
          .map((value, index) => {
            const x = pointX(index);
            const y = pointY(value);
            return `${x},${y}`;
          })
          .join(" ");
        return (
          <g key={seriesIndex}>
            {area && item.values.length > 0 ? (
              <polygon
                points={`${pointX(0)},820 ${points} ${pointX(
                  item.values.length - 1,
                )},820`}
                fill={item.color ?? colors[item.paletteIndex % colors.length]}
                fillOpacity="0.28"
              />
            ) : null}
            <polyline
              points={points}
              fill="none"
              stroke={item.color ?? colors[item.paletteIndex % colors.length]}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="12"
            />
            {showValue || showCategoryName
              ? item.values.map((value, index) => (
                  <text
                    className="lt-chart-data-label"
                    key={index}
                    x={pointX(index)}
                    y={pointY(value) - 25}
                    fill="currentColor"
                    fontSize="32"
                    textAnchor="middle"
                  >
                    {chartDataLabel(
                      item.labels[index],
                      value,
                      showValue,
                      showCategoryName,
                    )}
                  </text>
                ))
              : null}
          </g>
        );
      })}
    </>
  );
}

function ScatterChart({
  categoryCount,
  colors,
  maxValue,
  series,
  showAxes = true,
  showCategoryName,
  showValue,
  useCategoryBands = false,
}: {
  categoryCount?: number;
  colors: string[];
  maxValue?: number;
  series: ChartSeries[];
  showAxes?: boolean;
  showCategoryName: boolean;
  showValue: boolean;
  useCategoryBands?: boolean;
}) {
  const points = series.flatMap((item) => item.values);
  const maxY = maxValue ?? Math.max(1, ...points.map(Math.abs));
  const resolvedCategoryCount =
    categoryCount ?? Math.max(1, ...series.map((item) => item.values.length));
  const xValues = series.flatMap((item) =>
    item.labels.map((label, index) => {
      const numeric = Number(label);
      return Number.isFinite(numeric) ? numeric : index;
    }),
  );
  const minX = Math.min(0, ...xValues);
  const maxX = Math.max(minX + 1, ...xValues);
  return (
    <>
      {showAxes ? (
        <>
          <line x1="90" y1="820" x2="960" y2="820" stroke="#94a3b8" strokeWidth="3" />
          <line x1="90" y1="80" x2="90" y2="820" stroke="#94a3b8" strokeWidth="3" />
        </>
      ) : null}
      {series.flatMap((item, seriesIndex) =>
        item.values.map((value, index) => {
          const label = item.labels[index];
          const numeric = Number(label);
          const xValue = Number.isFinite(numeric) ? numeric : index;
          const x = useCategoryBands
            ? categoryX(index, resolvedCategoryCount)
            : 100 + ((xValue - minX) / (maxX - minX)) * 850;
          const y = 820 - (value / maxY) * 650;
          const labelText = chartDataLabel(label, value, showValue, showCategoryName);
          return (
            <Fragment key={`${seriesIndex}-${index}`}>
              <circle
                cx={x}
                cy={y}
                r="14"
                fill={item.color ?? colors[item.paletteIndex % colors.length]}
              />
              {labelText ? (
                <text
                  className="lt-chart-data-label"
                  x={x + 20}
                  y={y - 18}
                  fill="currentColor"
                  fontSize="30"
                >
                  {labelText}
                </text>
              ) : null}
            </Fragment>
          );
        }),
      )}
    </>
  );
}

function RadarChart({
  colors,
  series,
  showCategoryName,
  showValue,
}: {
  colors: string[];
  series: ChartSeries[];
  showCategoryName: boolean;
  showValue: boolean;
}) {
  const count = Math.max(3, ...series.map((item) => item.values.length));
  const max = Math.max(1, ...series.flatMap((item) => item.values.map(Math.abs)));
  const point = (index: number, radius: number) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    return `${500 + Math.cos(angle) * radius},${500 + Math.sin(angle) * radius}`;
  };
  return (
    <>
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon
          key={scale}
          points={Array.from({ length: count }, (_, index) =>
            point(index, 350 * scale),
          ).join(" ")}
          fill="none"
          stroke="#cbd5e1"
          strokeWidth="3"
        />
      ))}
      {Array.from({ length: count }, (_, index) => (
        <line
          key={index}
          x1="500"
          y1="500"
          x2={point(index, 350).split(",")[0]}
          y2={point(index, 350).split(",")[1]}
          stroke="#cbd5e1"
          strokeWidth="3"
        />
      ))}
      {series.map((item, seriesIndex) => (
        <g key={seriesIndex}>
          <polygon
            points={item.values
              .map((value, index) => point(index, (Math.max(0, value) / max) * 350))
              .join(" ")}
            fill={item.color ?? colors[item.paletteIndex % colors.length]}
            fillOpacity="0.24"
            stroke={item.color ?? colors[item.paletteIndex % colors.length]}
            strokeWidth="10"
          />
          {showValue || showCategoryName
            ? item.values.map((value, index) => {
                const [x, y] = point(
                  index,
                  Math.max(42, (Math.max(0, value) / max) * 350),
                )
                  .split(",")
                  .map(Number);
                return (
                  <text
                    className="lt-chart-data-label"
                    key={index}
                    x={x}
                    y={(y ?? 0) - 16}
                    fill="currentColor"
                    fontSize="28"
                    textAnchor="middle"
                  >
                    {chartDataLabel(
                      item.labels[index],
                      value,
                      showValue,
                      showCategoryName,
                    )}
                  </text>
                );
              })
            : null}
        </g>
      ))}
    </>
  );
}

function ComboChart({
  colors,
  series,
  showCategoryName,
  showValue,
}: {
  colors: string[];
  series: ChartSeries[];
  showCategoryName: boolean;
  showValue: boolean;
}) {
  const bars = series.filter(
    (item, index) => (item.chartType ?? (index === 0 ? "bar" : "line")) === "bar",
  );
  const areas = series.filter((item) => item.chartType === "area");
  const lines = series.filter((item, index) => {
    const type = item.chartType ?? (index === 0 ? "bar" : "line");
    return type === "line";
  });
  const scatters = series.filter((item) => item.chartType === "scatter");
  const categoryCount = Math.max(1, ...series.map((item) => item.values.length));
  const labels =
    series.reduce<ChartSeries | undefined>(
      (longest, item) =>
        !longest || item.labels.length > longest.labels.length ? item : longest,
      undefined,
    )?.labels ?? [];
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values.map(Math.abs)));
  return (
    <>
      <CategoryAxis count={categoryCount} labels={labels} />
      {bars.length > 0 ? (
        <BarChart
          categoryCount={categoryCount}
          colorByPoint={false}
          colors={colors}
          maxValue={maxValue}
          series={bars}
          showCategoryAxis={false}
          showCategoryName={showCategoryName}
          showValue={showValue}
        />
      ) : null}
      {areas.length > 0 ? (
        <LineChart
          area
          categoryCount={categoryCount}
          colors={colors}
          maxValue={maxValue}
          series={areas}
          showCategoryAxis={false}
          showCategoryName={showCategoryName}
          showValue={showValue}
          useCategoryBands
        />
      ) : null}
      {lines.length > 0 ? (
        <LineChart
          categoryCount={categoryCount}
          colors={colors}
          maxValue={maxValue}
          series={lines}
          showCategoryAxis={false}
          showCategoryName={showCategoryName}
          showValue={showValue}
          useCategoryBands
        />
      ) : null}
      {scatters.length > 0 ? (
        <ScatterChart
          categoryCount={categoryCount}
          colors={colors}
          maxValue={maxValue}
          series={scatters}
          showAxes={false}
          showCategoryName={showCategoryName}
          showValue={showValue}
          useCategoryBands
        />
      ) : null}
    </>
  );
}

function ChartLegend({
  categoryMode = false,
  colors,
  series,
}: {
  categoryMode?: boolean;
  colors: string[];
  series: ChartSeries[];
}) {
  const firstSeries = series[0];
  const items = categoryMode
    ? (firstSeries?.labels ?? []).map((label, index) => ({
        color: firstSeries?.color ?? colors[index % colors.length],
        key: `category-${index}`,
        label: label || `Category ${index + 1}`,
      }))
    : series.map((item, index) => ({
        color: item.color ?? colors[index % colors.length],
        key: `${item.name}-${index}`,
        label: item.name || `Series ${index + 1}`,
      }));
  return (
    <div className="lt-chart-legend" data-chart-legend="true">
      {items.map((item) => (
        <span className="lt-chart-legend-item" key={item.key}>
          <span
            aria-hidden="true"
            className="lt-chart-legend-swatch"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ChartContent({ element }: { element: FlexibleElement }) {
  const series = chartSeries(element.series);
  const chartType = stringValue(element.chartType ?? element.type, "bar");
  const style = isRecord(element.style) ? element.style : {};
  const styleColors = (Array.isArray(style.colors) ? style.colors : [])
    .map((color) => stringValue(color))
    .filter(Boolean);
  const elementColors = (Array.isArray(element.colors) ? element.colors : [])
    .map((color) => stringValue(color))
    .filter(Boolean);
  const colors = styleColors.length > 0 ? styleColors : elementColors;
  const palette = colors.length > 0 ? colors : CHART_COLORS;
  const showValue = style.showValue === true;
  const showCategoryName = style.showCategoryName === true;
  const showLegend = style.showLegend === true;
  const legendPosition = ["top", "bottom", "left", "right"].includes(
    stringValue(element.legendPosition),
  )
    ? stringValue(element.legendPosition)
    : "bottom";
  const valueAxisTitle = stringValue(element.valueAxisTitle);
  const valueUnit = stringValue(element.valueUnit);
  const displayedValueAxisTitle = valueAxisTitle
    ? `${valueAxisTitle}${valueUnit ? `（${valueUnit}）` : ""}`
    : valueUnit
      ? `単位：${valueUnit}`
      : "";
  const legend = showLegend ? (
    <ChartLegend
      categoryMode={chartType === "pie" || chartType === "doughnut"}
      colors={palette}
      series={series}
    />
  ) : null;
  const plot = (
    <div className="lt-chart-plot">
      {displayedValueAxisTitle ? (
        <div className="lt-chart-axis-title lt-chart-value-axis-title">
          {displayedValueAxisTitle}
        </div>
      ) : null}
      <svg
        aria-label={stringValue(element.alt, "Chart")}
        data-chart-kind={chartType}
        role="img"
        style={{ fontFamily: "var(--lt-font-body, sans-serif)" }}
        viewBox="0 0 1000 1000"
      >
        {chartType === "pie" ? (
          <PieChart
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        ) : chartType === "doughnut" ? (
          <PieChart
            colors={palette}
            doughnut
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        ) : chartType === "line" ? (
          <LineChart
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        ) : chartType === "area" ? (
          <LineChart
            area
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        ) : chartType === "scatter" ? (
          <ScatterChart
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        ) : chartType === "radar" ? (
          <RadarChart
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        ) : chartType === "stacked" ? (
          <BarChart
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
            stacked
          />
        ) : chartType === "combo" ? (
          <ComboChart
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        ) : (
          <BarChart
            colors={palette}
            series={series}
            showCategoryName={showCategoryName}
            showValue={showValue}
          />
        )}
      </svg>
      {stringValue(element.categoryAxisTitle) ? (
        <div className="lt-chart-axis-title lt-chart-category-axis-title">
          {stringValue(element.categoryAxisTitle)}
        </div>
      ) : null}
    </div>
  );
  return (
    <div
      className="lt-chart-element"
      data-legend-position={legendPosition}
      style={{ width: "100%", height: "100%" }}
    >
      {style.showTitle === true && stringValue(element.title) ? (
        <div className="lt-chart-title">{stringValue(element.title)}</div>
      ) : null}
      <div className="lt-chart-body" data-legend-position={legendPosition}>
        {legendPosition === "top" || legendPosition === "left" ? legend : null}
        {plot}
        {legendPosition === "bottom" || legendPosition === "right" ? legend : null}
      </div>
    </div>
  );
}

function IconContent({ element }: { element: FlexibleElement }) {
  const src = stringValue(element.src);
  if (src) {
    return (
      <div className="lt-icon-element" style={{ width: "100%", height: "100%" }}>
        <img
          alt={stringValue(element.alt)}
          draggable={false}
          src={src}
          style={{ objectFit: "contain" }}
        />
      </div>
    );
  }
  return (
    <div
      className="lt-icon-element"
      style={{
        display: "grid",
        width: "100%",
        height: "100%",
        color: colorValue(element.color, "currentColor"),
        fontSize: "min(100cqw, 100cqh)",
        placeItems: "center",
      }}
    >
      {stringValue(element.glyph ?? element.name)}
    </div>
  );
}

function elementContent(
  element: FlexibleElement,
  frame: EditableFrame,
  mode: RenderMode,
): ReactNode {
  switch (elementType(element)) {
    case "text":
      return <TextContent element={element} />;
    case "image":
      return <ImageContent element={element} mode={mode} />;
    case "video":
      return <VideoContent element={element} mode={mode} />;
    case "audio":
      return <AudioContent element={element} mode={mode} />;
    case "shape":
      return <ShapeContent element={element} />;
    case "line":
    case "connector":
      return <LineContent element={element} frame={frame} />;
    case "table":
      return <TableContent element={element} />;
    case "chart":
      return <ChartContent element={element} />;
    case "icon":
      return <IconContent element={element} />;
    default:
      return null;
  }
}

function ElementView({
  element,
  mode,
  frameOverrides,
  selectedIds,
  isMaster = false,
  parentOffset = { x: 0, y: 0 },
  onElementPointerDown,
}: {
  element: ElementIR;
  mode: RenderMode;
  frameOverrides?: ElementFrameOverrides;
  selectedIds?: ReadonlySet<string>;
  isMaster?: boolean;
  parentOffset?: { x: number; y: number };
  onElementPointerDown?: ElementPointerHandler;
}) {
  const flexible = element as FlexibleElement;
  const type = elementType(element);
  const frame = applyFrameOverride(element, frameOverrides?.[element.id]);
  const renderedFrame = {
    ...frame,
    x: frame.x - parentOffset.x,
    y: frame.y - parentOffset.y,
  };
  const opacity = numberValue(flexible.opacity, 1);
  const locked = isMaster || Boolean(flexible.locked) || flexible.editable === false;
  const selected = !isMaster && (selectedIds?.has(element.id) ?? false);
  if (type === "group" && Array.isArray(flexible.children)) {
    const children = flexible.children.filter(isRecord) as unknown as ElementIR[];
    return (
      <div
        className="lt-slide-element lt-group-element"
        data-element-id={element.id}
        data-slide-element-id={element.id}
        data-element-type={type}
        data-master-element={isMaster || undefined}
        data-selected={selected}
        data-locked={locked}
        style={{
          ...elementFrameStyle(renderedFrame),
          opacity,
          overflow: "visible",
        }}
        onPointerDown={
          isMaster ? undefined : (event) => onElementPointerDown?.(element, event)
        }
      >
        {children.map((child) => (
          <ElementView
            key={child.id}
            element={child}
            mode={mode}
            frameOverrides={frameOverrides}
            isMaster={isMaster}
            selectedIds={selectedIds}
            parentOffset={{ x: frame.x, y: frame.y }}
            onElementPointerDown={onElementPointerDown}
          />
        ))}
        {mode === "debug" ? (
          <>
            <div className="lt-debug-frame" />
            <div className="lt-debug-label">{element.id} · group</div>
          </>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className={`lt-slide-element lt-${type || "unknown"}-element`}
      data-element-id={element.id}
      data-slide-element-id={element.id}
      data-element-type={type}
      data-master-element={isMaster || undefined}
      data-selected={selected}
      data-locked={locked}
      style={{
        ...elementFrameStyle(renderedFrame),
        opacity,
        cursor: mode === "edit" ? (locked ? "not-allowed" : "move") : undefined,
      }}
      onPointerDown={
        isMaster ? undefined : (event) => onElementPointerDown?.(element, event)
      }
    >
      {elementContent(flexible, frame, mode)}
      {mode === "debug" ? (
        <>
          <div className="lt-debug-frame" />
          <div className="lt-debug-label">
            {element.id} · {type || "unknown"}
          </div>
        </>
      ) : null}
    </div>
  );
}

function backgroundStyle(slide: SlideIR, deck?: DeckIR): CSSProperties {
  const flexible = slide as SlideIR & FlexibleRecord;
  const master = deck?.theme.masters?.find(
    (candidate) => candidate.id === slide.masterId,
  );
  const background = flexible.background ?? master?.background;
  if (typeof background === "string") return { background };
  if (!isRecord(background)) return {};
  const image = stringValue(background.src ?? background.image);
  const focalPosition = isRecord(background.focalPosition)
    ? background.focalPosition
    : undefined;
  const fit = stringValue(background.fit, "cover");
  return {
    backgroundColor: colorValue(background.fill ?? background.color, "transparent"),
    backgroundImage: image ? `url("${image.replaceAll('"', '\\"')}")` : undefined,
    backgroundPosition: focalPosition
      ? `${numberValue(focalPosition.x, 0.5) * 100}% ${
          numberValue(focalPosition.y, 0.5) * 100
        }%`
      : stringValue(background.position, "center"),
    backgroundRepeat: "no-repeat",
    backgroundSize: fit === "stretch" ? "100% 100%" : fit,
  };
}

function fontFaceRules(deck?: DeckIR): string {
  if (!deck) return "";
  return (deck.theme.fonts?.registered ?? [])
    .filter((font) => font.source === "file" && font.path)
    .map((font) => {
      const family = font.family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const path = (font.path as string)
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"');
      return `@font-face{font-family:"${family}";src:url("${path}");font-style:${font.style};font-weight:${font.weight};font-display:block;}`;
    })
    .join("\n");
}

export function collectOverflowIssues(
  root: ParentNode,
  slideId: string,
): OverflowIssue[] {
  const issues: OverflowIssue[] = [];
  root.querySelectorAll<HTMLElement>("[data-slide-element-id]").forEach((element) => {
    const horizontal = element.scrollWidth > element.clientWidth + 1;
    const vertical = element.scrollHeight > element.clientHeight + 1;
    element.classList.toggle("lt-slide-overflow", horizontal || vertical);
    if (horizontal || vertical) {
      issues.push({
        slideId,
        elementId: element.dataset.slideElementId ?? "",
        horizontal,
        vertical,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      });
    }
  });
  return issues;
}

export function useOverflowInspection(
  rootRef: RefObject<HTMLElement | null>,
  slideId: string,
  enabled: boolean,
  onIssues?: (issues: OverflowIssue[]) => void,
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    let frame = 0;
    const inspect = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const issues = collectOverflowIssues(root, slideId);
        window.__SLIDE_OVERFLOW__ = issues;
        onIssues?.(issues);
      });
    };
    inspect();
    const observer = new ResizeObserver(inspect);
    observer.observe(root);
    root.querySelectorAll<HTMLElement>("[data-slide-element-id]").forEach((element) => {
      observer.observe(element);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled, onIssues, rootRef, slideId]);
}

export function SlideCanvas({
  deck,
  slide,
  mode = "normal",
  className,
  frameOverrides,
  selectedIds,
  safeArea,
  onElementPointerDown,
  onOverflowIssues,
}: SlideCanvasProps) {
  const rootRef = useRef<HTMLElement>(null);
  useOverflowInspection(
    rootRef,
    slide.id,
    mode === "debug" || Boolean(onOverflowIssues),
    onOverflowIssues,
  );
  const elements = [...slide.elements].sort((left, right) => {
    const leftFrame = applyFrameOverride(left, frameOverrides?.[left.id]);
    const rightFrame = applyFrameOverride(right, frameOverrides?.[right.id]);
    return leftFrame.zIndex - rightFrame.zIndex;
  });
  const masterElements = [
    ...(deck?.theme.masters?.find((master) => master.id === slide.masterId)?.elements ??
      []),
  ].sort((left, right) => left.zIndex - right.zIndex);
  return (
    <section
      ref={rootRef}
      aria-label={`Slide ${slide.id}`}
      className={`lt-slide-canvas${className ? ` ${className}` : ""}`}
      data-mode={mode}
      data-slide-id={slide.id}
      style={{
        ...themeVariables(deck),
        ...backgroundStyle(slide, deck),
        fontFamily: "var(--lt-font-body, sans-serif)",
      }}
    >
      {deck ? <style data-editable-slides-fonts>{fontFaceRules(deck)}</style> : null}
      <div className="lt-master-elements" data-master-id={slide.masterId}>
        {masterElements.map((element) => (
          <ElementView key={element.id} element={element} isMaster mode={mode} />
        ))}
      </div>
      <div className="lt-slide-elements">
        {elements.map((element) => (
          <ElementView
            key={element.id}
            element={element}
            mode={mode}
            frameOverrides={frameOverrides}
            selectedIds={selectedIds}
            onElementPointerDown={onElementPointerDown}
          />
        ))}
      </div>
      {safeArea && (mode === "debug" || mode === "edit") ? (
        <div
          className="lt-safe-area"
          style={{
            left: safeArea.x,
            top: safeArea.y,
            width: safeArea.w,
            height: safeArea.h,
          }}
        />
      ) : null}
    </section>
  );
}

function useContainerScale(
  containerRef: RefObject<HTMLElement | null>,
  fit: "contain" | "width",
  minScale: number,
  maxScale: number,
) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const bounds = container.getBoundingClientRect();
      const widthScale = bounds.width / CANVAS_WIDTH;
      const heightScale = bounds.height / CANVAS_HEIGHT;
      const next = fit === "width" ? widthScale : Math.min(widthScale, heightScale);
      setScale(Math.min(maxScale, Math.max(minScale, next || 1)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, fit, maxScale, minScale]);
  return scale;
}

export function ResponsiveSlide({
  fit = "contain",
  minScale = 0.01,
  maxScale = 4,
  ...slideProps
}: ResponsiveSlideProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scale = useContainerScale(viewportRef, fit, minScale, maxScale);
  return (
    <div ref={viewportRef} className="lt-slide-viewport">
      <div
        className="lt-slide-stage"
        style={{
          width: CANVAS_WIDTH * scale,
          height: CANVAS_HEIGHT * scale,
        }}
      >
        <div
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <SlideCanvas {...slideProps} />
        </div>
      </div>
    </div>
  );
}

async function waitForImages(root: ParentNode): Promise<void> {
  const images = [...root.querySelectorAll("img")];
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) {
        try {
          await image.decode();
        } catch {
          // A failed image is still a settled image. Diagnostics owns the error.
        }
        return;
      }
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  );
}

export function useDeckReadiness(
  deck: DeckIR | undefined,
  root: ParentNode = document,
) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!deck) {
      window.__SLIDES_READY__ = false;
      setReady(false);
      return;
    }
    let active = true;
    window.__SLIDES_READY__ = false;
    setReady(false);
    const settle = async () => {
      await document.fonts.ready;
      await waitForImages(root);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (!active) return;
      window.__SLIDES_READY__ = true;
      setReady(true);
    };
    void settle();
    return () => {
      active = false;
    };
  }, [deck, root]);
  return ready;
}

export function DeckReadiness({
  deck,
  children,
}: {
  deck?: DeckIR;
  children?: (ready: boolean) => ReactNode;
}) {
  const ready = useDeckReadiness(deck);
  return children?.(ready) ?? null;
}

export function PrintDeck({
  deck,
  frameOverridesBySlide,
}: {
  deck: DeckIR;
  frameOverridesBySlide?: Readonly<Record<string, ElementFrameOverrides | undefined>>;
}) {
  const slides = useMemo(() => deck.slides, [deck]);
  return (
    <main className="lt-print-deck" data-deck-id={deck.metadata.id}>
      {slides.map((slide) => (
        <section className="lt-print-page" key={slide.id}>
          <div className="lt-print-scaler">
            <SlideCanvas
              deck={deck}
              frameOverrides={frameOverridesBySlide?.[slide.id]}
              mode="print"
              slide={slide}
            />
          </div>
        </section>
      ))}
    </main>
  );
}

export type { DeckIR, ElementIR, FrameIR, SlideIR };
