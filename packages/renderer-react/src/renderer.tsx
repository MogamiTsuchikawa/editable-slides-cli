import type { DeckIR, ElementIR, FrameIR, SlideIR } from "@livetoon/slide-deck-ir";
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

function ImageContent({ element }: { element: FlexibleElement }) {
  const fit = stringValue(element.fit, "contain");
  const src = stringValue(element.src ?? element.url ?? element.dataUri);
  const crop = isRecord(element.crop) ? element.crop : undefined;
  const objectPosition = crop
    ? `${numberValue(crop.x, 50)}% ${numberValue(crop.y, 50)}%`
    : "50% 50%";
  return (
    <div className="lt-image-element" style={{ width: "100%", height: "100%" }}>
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
          objectPosition,
        }}
      />
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
  const columnWidths = Array.isArray(element.columnWidths)
    ? element.columnWidths.filter((part): part is number => typeof part === "number")
    : [];
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
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
        ) : null}
        <tbody>
          {rows.map((row, rowIndex) => {
            const rowRecord = isRecord(row) ? row : {};
            const cells = Array.isArray(rowRecord.cells) ? rowRecord.cells : [];
            return (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => {
                  const cellRecord = isRecord(cell) ? cell : {};
                  const cellTextStyle = isRecord(cellRecord.textStyle)
                    ? cellRecord.textStyle
                    : {};
                  const Tag = rowIndex === 0 ? "th" : "td";
                  return (
                    <Tag
                      key={cellIndex}
                      colSpan={numberValue(cellRecord.colSpan, 1)}
                      rowSpan={numberValue(cellRecord.rowSpan, 1)}
                      style={{
                        background: colorValue(
                          cellRecord.fill ??
                            (rowIndex === 0 ? style.headerFill : style.bodyFill),
                          "transparent",
                        ),
                        color: colorValue(cellTextStyle.color, "inherit"),
                        fontFamily:
                          typeof cellTextStyle.fontFace === "string"
                            ? fontStack(
                                cellTextStyle.fontFace,
                                "var(--lt-font-body, sans-serif)",
                              )
                            : undefined,
                        fontSize:
                          typeof cellTextStyle.fontSize === "number"
                            ? cellTextStyle.fontSize
                            : undefined,
                        fontWeight: toCssFontWeight(cellTextStyle.fontWeight),
                        fontStyle: cellTextStyle.italic === true ? "italic" : undefined,
                        lineHeight:
                          typeof cellTextStyle.lineHeight === "number"
                            ? cellTextStyle.lineHeight
                            : undefined,
                        textAlign:
                          cellTextStyle.align === "center" ||
                          cellTextStyle.align === "right" ||
                          cellTextStyle.align === "justify"
                            ? cellTextStyle.align
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
}

function chartSeries(value: unknown): ChartSeries[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((series) => {
    if (!isRecord(series)) return [];
    const labels = Array.isArray(series.labels)
      ? series.labels.map((label) => stringValue(label))
      : [];
    const values = Array.isArray(series.values)
      ? series.values.map((part) => numberValue(part))
      : [];
    return [{ name: stringValue(series.name), labels, values }];
  });
}

const CHART_COLORS = ["#2563eb", "#14b8a6", "#f97316", "#8b5cf6", "#e11d48"];

function PieChart({ colors, series }: { colors: string[]; series: ChartSeries[] }) {
  const values = series[0]?.values ?? [];
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
    return (
      <path
        key={index}
        d={`M500 500 L${x1} ${y1} A350 350 0 ${large} 1 ${x2} ${y2} Z`}
        fill={colors[index % colors.length]}
      />
    );
  });
  return <>{paths}</>;
}

function BarChart({
  colors,
  series,
  showValue,
}: {
  colors: string[];
  series: ChartSeries[];
  showValue: boolean;
}) {
  const count = Math.max(1, ...series.map((item) => item.values.length));
  const max = Math.max(1, ...series.flatMap((item) => item.values.map(Math.abs)));
  const groupWidth = 860 / count;
  const barWidth = Math.max(8, (groupWidth * 0.7) / Math.max(1, series.length));
  const baseline = 820;
  const labels = series[0]?.labels ?? [];
  return (
    <>
      <line
        x1="90"
        y1={baseline}
        x2="960"
        y2={baseline}
        stroke="#94a3b8"
        strokeWidth="3"
      />
      {series.flatMap((item, seriesIndex) =>
        item.values.map((value, index) => {
          const height = (Math.abs(value) / max) * 650;
          const x = 100 + index * groupWidth + seriesIndex * barWidth;
          return (
            <Fragment key={`${seriesIndex}-${index}`}>
              <rect
                x={x}
                y={baseline - height}
                width={barWidth - 4}
                height={height}
                rx="4"
                fill={
                  colors[(series.length === 1 ? index : seriesIndex) % colors.length]
                }
              />
              {showValue ? (
                <text
                  x={x + (barWidth - 4) / 2}
                  y={baseline - height - 18}
                  fill="currentColor"
                  fontSize="34"
                  textAnchor="middle"
                >
                  {value}
                </text>
              ) : null}
            </Fragment>
          );
        }),
      )}
      {labels.map((label, index) => (
        <text
          key={label}
          x={100 + index * groupWidth + groupWidth * 0.35}
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

function LineChart({
  colors,
  series,
  showValue,
}: {
  colors: string[];
  series: ChartSeries[];
  showValue: boolean;
}) {
  const count = Math.max(2, ...series.map((item) => item.values.length));
  const max = Math.max(1, ...series.flatMap((item) => item.values.map(Math.abs)));
  const labels = series[0]?.labels ?? [];
  return (
    <>
      <line x1="90" y1="820" x2="960" y2="820" stroke="#94a3b8" strokeWidth="3" />
      {series.map((item, seriesIndex) => {
        const points = item.values
          .map((value, index) => {
            const x = 100 + (index / Math.max(1, count - 1)) * 850;
            const y = 800 - (value / max) * 650;
            return `${x},${y}`;
          })
          .join(" ");
        return (
          <g key={seriesIndex}>
            <polyline
              points={points}
              fill="none"
              stroke={colors[seriesIndex % colors.length]}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="12"
            />
            {showValue
              ? item.values.map((value, index) => (
                  <text
                    key={index}
                    x={100 + (index / Math.max(1, count - 1)) * 850}
                    y={775 - (value / max) * 650}
                    fill="currentColor"
                    fontSize="32"
                    textAnchor="middle"
                  >
                    {value}
                  </text>
                ))
              : null}
          </g>
        );
      })}
      {labels.map((label, index) => (
        <text
          key={label}
          x={100 + (index / Math.max(1, count - 1)) * 850}
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
  return (
    <div className="lt-chart-element" style={{ width: "100%", height: "100%" }}>
      <svg
        aria-label={stringValue(element.alt, "Chart")}
        role="img"
        style={{ fontFamily: "var(--lt-font-body, sans-serif)" }}
        viewBox="0 0 1000 1000"
      >
        {chartType === "pie" ? (
          <PieChart colors={palette} series={series} />
        ) : chartType === "line" ? (
          <LineChart colors={palette} series={series} showValue={showValue} />
        ) : (
          <BarChart colors={palette} series={series} showValue={showValue} />
        )}
      </svg>
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

function elementContent(element: FlexibleElement, frame: EditableFrame): ReactNode {
  switch (elementType(element)) {
    case "text":
      return <TextContent element={element} />;
    case "image":
      return <ImageContent element={element} />;
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
      {elementContent(flexible, frame)}
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
  return {
    backgroundColor: colorValue(background.fill ?? background.color, "transparent"),
    backgroundImage: image ? `url("${image.replaceAll('"', '\\"')}")` : undefined,
    backgroundPosition: stringValue(background.position, "center"),
    backgroundRepeat: "no-repeat",
    backgroundSize: stringValue(background.fit, "cover"),
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
      {deck ? <style data-livetoon-fonts>{fontFaceRules(deck)}</style> : null}
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
