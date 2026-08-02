import {
  type FillIR,
  type FrameIR,
  type GroupElementIR,
  type ShapeElementIR,
  type SourceLocation,
  type TextElementIR,
  type TextRunIR,
  WIDE_CANVAS,
} from "@livetoon/slide-deck-ir";
import type { ThemeDefinition } from "@livetoon/slide-theme-default";
import { contrastRatio } from "./accessibility.js";

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_CODE_CHARACTERS = 50_000;
const MAX_CODE_LINES = 300;

export type CodeTokenKind = "plain" | "keyword" | "string" | "number" | "comment";

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "json"
  | "python"
  | "bash"
  | "html"
  | "css";

interface SyntaxDefinition {
  keywords: ReadonlySet<string>;
  lineComments: readonly string[];
  blocks: ReadonlyArray<{
    start: string;
    end: string;
    kind: "comment" | "string";
  }>;
  quotes: readonly string[];
  caseInsensitive?: boolean;
  allowHyphenInIdentifier?: boolean;
}

interface LexerState {
  block?: {
    end: string;
    kind: "comment" | "string";
  };
}

const JS_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const TS_KEYWORDS = new Set([
  ...JS_KEYWORDS,
  "abstract",
  "any",
  "asserts",
  "bigint",
  "boolean",
  "constructor",
  "declare",
  "enum",
  "implements",
  "infer",
  "interface",
  "is",
  "keyof",
  "module",
  "namespace",
  "never",
  "number",
  "object",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "satisfies",
  "string",
  "symbol",
  "type",
  "unknown",
]);

const PYTHON_KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const BASH_KEYWORDS = new Set([
  "case",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "time",
  "until",
  "while",
]);

const HTML_KEYWORDS = new Set([
  "a",
  "article",
  "aside",
  "body",
  "button",
  "class",
  "data",
  "div",
  "doctype",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "head",
  "header",
  "href",
  "html",
  "id",
  "img",
  "input",
  "label",
  "li",
  "link",
  "main",
  "meta",
  "nav",
  "ol",
  "p",
  "script",
  "section",
  "source",
  "span",
  "src",
  "style",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "title",
  "tr",
  "type",
  "ul",
  "video",
]);

const CSS_KEYWORDS = new Set([
  "align-items",
  "animation",
  "background",
  "border",
  "bottom",
  "box-shadow",
  "color",
  "content",
  "display",
  "flex",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "grid",
  "height",
  "justify-content",
  "keyframes",
  "left",
  "line-height",
  "margin",
  "media",
  "opacity",
  "padding",
  "position",
  "right",
  "supports",
  "text-align",
  "top",
  "transform",
  "transition",
  "width",
  "z-index",
]);

const SYNTAX: Record<SupportedLanguage, SyntaxDefinition> = {
  javascript: {
    keywords: JS_KEYWORDS,
    lineComments: ["//"],
    blocks: [{ start: "/*", end: "*/", kind: "comment" }],
    quotes: ["'", '"', "`"],
  },
  typescript: {
    keywords: TS_KEYWORDS,
    lineComments: ["//"],
    blocks: [{ start: "/*", end: "*/", kind: "comment" }],
    quotes: ["'", '"', "`"],
  },
  json: {
    keywords: new Set(["false", "null", "true"]),
    lineComments: ["//"],
    blocks: [{ start: "/*", end: "*/", kind: "comment" }],
    quotes: ['"'],
  },
  python: {
    keywords: PYTHON_KEYWORDS,
    lineComments: ["#"],
    blocks: [
      { start: "'''", end: "'''", kind: "string" },
      { start: '"""', end: '"""', kind: "string" },
    ],
    quotes: ["'", '"'],
  },
  bash: {
    keywords: BASH_KEYWORDS,
    lineComments: ["#"],
    blocks: [],
    quotes: ["'", '"', "`"],
  },
  html: {
    keywords: HTML_KEYWORDS,
    lineComments: [],
    blocks: [{ start: "<!--", end: "-->", kind: "comment" }],
    quotes: ["'", '"'],
    caseInsensitive: true,
    allowHyphenInIdentifier: true,
  },
  css: {
    keywords: CSS_KEYWORDS,
    lineComments: [],
    blocks: [{ start: "/*", end: "*/", kind: "comment" }],
    quotes: ["'", '"'],
    caseInsensitive: true,
    allowHyphenInIdentifier: true,
  },
};

const LANGUAGE_ALIASES: Readonly<Record<string, SupportedLanguage>> = {
  bash: "bash",
  css: "css",
  htm: "html",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  xml: "html",
  zsh: "bash",
};

export interface CodeBlockInput {
  id: string;
  frame: FrameIR;
  sourceLocation: SourceLocation;
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  padding?: number;
  zIndex?: number;
  alt?: string;
}

export interface CodeBlockValidationIssue {
  path: Array<string | number>;
  message: string;
}

export class CodeBlockValidationError extends Error {
  readonly issues: CodeBlockValidationIssue[];

  constructor(issues: CodeBlockValidationIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path.join(".") || "codeBlock"}: ${issue.message}`)
        .join("; "),
    );
    this.name = "CodeBlockValidationError";
    this.issues = issues;
  }
}

function round(value: number): number {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function frame(x: number, y: number, w: number, h: number): FrameIR {
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

function location(value: SourceLocation): SourceLocation {
  return { ...value };
}

function themeColor(theme: ThemeDefinition, name: string, fallback: string): string {
  return theme.ir.colors[name] ?? fallback;
}

function appendToken(tokens: CodeToken[], kind: CodeTokenKind, text: string): void {
  if (!text) return;
  const previous = tokens.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
    return;
  }
  tokens.push({ kind, text });
}

function supportedLanguage(
  language: string | undefined,
): SupportedLanguage | undefined {
  if (!language) return undefined;
  return LANGUAGE_ALIASES[language.toLowerCase()];
}

const NUMBER =
  /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?n?)/;

function tokenizeKnownLine(
  line: string,
  definition: SyntaxDefinition,
  state: LexerState,
): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < line.length) {
    if (state.block) {
      const endIndex = line.indexOf(state.block.end, index);
      if (endIndex === -1) {
        appendToken(tokens, state.block.kind, line.slice(index));
        index = line.length;
        continue;
      }
      appendToken(
        tokens,
        state.block.kind,
        line.slice(index, endIndex + state.block.end.length),
      );
      index = endIndex + state.block.end.length;
      state.block = undefined;
      continue;
    }

    const block = definition.blocks.find((candidate) =>
      line.startsWith(candidate.start, index),
    );
    if (block) {
      const endIndex = line.indexOf(block.end, index + block.start.length);
      if (endIndex === -1) {
        appendToken(tokens, block.kind, line.slice(index));
        state.block = { end: block.end, kind: block.kind };
        index = line.length;
        continue;
      }
      appendToken(tokens, block.kind, line.slice(index, endIndex + block.end.length));
      index = endIndex + block.end.length;
      continue;
    }

    const lineComment = definition.lineComments.find((marker) =>
      line.startsWith(marker, index),
    );
    if (lineComment) {
      appendToken(tokens, "comment", line.slice(index));
      index = line.length;
      continue;
    }

    const quote = definition.quotes.find((candidate) =>
      line.startsWith(candidate, index),
    );
    if (quote) {
      let endIndex = index + quote.length;
      let escaped = false;
      while (endIndex < line.length) {
        const character = line[endIndex];
        if (!escaped && character === quote) {
          endIndex += quote.length;
          break;
        }
        if (!escaped && character === "\\") {
          escaped = true;
        } else {
          escaped = false;
        }
        endIndex += 1;
      }
      appendToken(tokens, "string", line.slice(index, endIndex));
      index = endIndex;
      continue;
    }

    const character = line[index] ?? "";
    if (
      /\d/.test(character) ||
      (character === "." && /\d/.test(line[index + 1] ?? ""))
    ) {
      const match = line.slice(index).match(NUMBER)?.[0];
      if (match) {
        appendToken(tokens, "number", match);
        index += match.length;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(character)) {
      let endIndex = index + 1;
      const identifierPart = definition.allowHyphenInIdentifier
        ? /[A-Za-z0-9_$-]/
        : /[A-Za-z0-9_$]/;
      while (identifierPart.test(line[endIndex] ?? "")) endIndex += 1;
      const identifier = line.slice(index, endIndex);
      const lookup = definition.caseInsensitive ? identifier.toLowerCase() : identifier;
      appendToken(
        tokens,
        definition.keywords.has(lookup) ? "keyword" : "plain",
        identifier,
      );
      index = endIndex;
      continue;
    }

    appendToken(tokens, "plain", character);
    index += 1;
  }

  return tokens.length > 0 ? tokens : [{ kind: "plain", text: "" }];
}

/**
 * Deterministically tokenizes supported code without external parser dependencies.
 * Unknown languages intentionally stay as one plain run per line.
 */
export function tokenizeCode(code: string, language?: string): CodeToken[][] {
  const lines = code.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const normalizedLanguage = supportedLanguage(language);
  if (!normalizedLanguage) {
    return lines.map((line) => [{ kind: "plain", text: line }]);
  }
  const definition = SYNTAX[normalizedLanguage];
  const state: LexerState = {};
  return lines.map((line) => tokenizeKnownLine(line, definition, state));
}

function accessibleCodeColor(
  preferred: string,
  fallback: string,
  background: string,
): string {
  const candidates = [preferred, fallback, "#172033", "#FFFFFF"];
  const passing = candidates.find((color) => contrastRatio(color, background) >= 4.5);
  if (passing) return passing;
  return candidates.reduce((best, color) =>
    contrastRatio(color, background) > contrastRatio(best, background) ? color : best,
  );
}

function tokenRuns(
  tokens: readonly CodeToken[],
  theme: ThemeDefinition,
  background: string,
): TextRunIR[] {
  const keyword = accessibleCodeColor(
    themeColor(theme, "brand", "#2857D9"),
    "#174EA6",
    background,
  );
  const string = accessibleCodeColor(
    themeColor(theme, "accent", themeColor(theme, "gold", "#00866F")),
    "#006B5F",
    background,
  );
  const number = accessibleCodeColor(
    themeColor(theme, "lavender", themeColor(theme, "danger", "#B42318")),
    "#8A2C64",
    background,
  );
  const comment = accessibleCodeColor(
    themeColor(theme, "muted", "#5F6B7A"),
    "#475569",
    background,
  );
  return tokens.map((token) => {
    switch (token.kind) {
      case "keyword":
        return { text: token.text, color: keyword, bold: true };
      case "string":
        return { text: token.text, color: string };
      case "number":
        return { text: token.text, color: number };
      case "comment":
        return { text: token.text, color: comment, italic: true };
      default:
        return { text: token.text };
    }
  });
}

function validateFrame(
  value: FrameIR | undefined,
  issues: CodeBlockValidationIssue[],
): void {
  if (!value || ![value.x, value.y, value.w, value.h].every(Number.isFinite)) {
    issues.push({ path: ["frame"], message: "must contain finite numbers" });
    return;
  }
  if (value.w < 240 || value.h < 120) {
    issues.push({ path: ["frame"], message: "must be at least 240 wide and 120 high" });
  }
  if (
    value.x < 0 ||
    value.y < 0 ||
    value.x + value.w > WIDE_CANVAS.width ||
    value.y + value.h > WIDE_CANVAS.height
  ) {
    issues.push({ path: ["frame"], message: "must stay inside the 1920x1080 canvas" });
  }
}

export function validateCodeBlockInput(
  input: CodeBlockInput,
): CodeBlockValidationIssue[] {
  const issues: CodeBlockValidationIssue[] = [];
  if (!input || typeof input !== "object") {
    return [{ path: [], message: "must be an object" }];
  }
  if (!SAFE_ID.test(input.id ?? "")) {
    issues.push({ path: ["id"], message: "must be a safe, lowercase ID" });
  }
  validateFrame(input.frame, issues);
  if (
    !input.sourceLocation ||
    typeof input.sourceLocation.file !== "string" ||
    !input.sourceLocation.file ||
    !Number.isInteger(input.sourceLocation.line) ||
    input.sourceLocation.line < 1 ||
    !Number.isInteger(input.sourceLocation.column) ||
    input.sourceLocation.column < 1
  ) {
    issues.push({
      path: ["sourceLocation"],
      message: "requires file and positive line/column numbers",
    });
  }
  if (typeof input.code !== "string") {
    issues.push({ path: ["code"], message: "must be text" });
  } else {
    if (input.code.length > MAX_CODE_CHARACTERS) {
      issues.push({
        path: ["code"],
        message: `must be ${MAX_CODE_CHARACTERS} characters or less`,
      });
    }
    if (input.code.split("\n").length > MAX_CODE_LINES) {
      issues.push({
        path: ["code"],
        message: `must be ${MAX_CODE_LINES} lines or less`,
      });
    }
  }
  if (
    input.language !== undefined &&
    (typeof input.language !== "string" ||
      !/^[a-z0-9][a-z0-9_+.#-]{0,31}$/i.test(input.language))
  ) {
    issues.push({ path: ["language"], message: "contains unsupported characters" });
  }
  if (
    input.title !== undefined &&
    (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200)
  ) {
    issues.push({ path: ["title"], message: "must be 1 to 200 characters" });
  }
  if (
    input.padding !== undefined &&
    (!Number.isFinite(input.padding) || input.padding < 12 || input.padding > 80)
  ) {
    issues.push({ path: ["padding"], message: "must be between 12 and 80" });
  }
  if (
    input.zIndex !== undefined &&
    (!Number.isSafeInteger(input.zIndex) || input.zIndex < 0)
  ) {
    issues.push({ path: ["zIndex"], message: "must be a non-negative integer" });
  }
  if (input.alt !== undefined && (typeof input.alt !== "string" || !input.alt.trim())) {
    issues.push({ path: ["alt"], message: "must be non-empty text" });
  }
  const lineCount = typeof input.code === "string" ? input.code.split("\n").length : 0;
  const seenHighlights = new Set<number>();
  if (input.highlightLines !== undefined && !Array.isArray(input.highlightLines)) {
    issues.push({ path: ["highlightLines"], message: "must be an array" });
  } else {
    for (const [index, line] of (input.highlightLines ?? []).entries()) {
      if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) {
        issues.push({
          path: ["highlightLines", index],
          message: `must reference a line between 1 and ${lineCount}`,
        });
      } else if (seenHighlights.has(line)) {
        issues.push({
          path: ["highlightLines", index],
          message: "must not contain duplicates",
        });
      }
      seenHighlights.add(line);
    }
  }
  return issues;
}

function backgroundShape(
  input: CodeBlockInput,
  id: string,
  shapeFrame: FrameIR,
  fill: FillIR,
  theme: ThemeDefinition,
  zIndex: number,
): ShapeElementIR {
  return {
    id,
    type: "shape",
    frame: { ...shapeFrame },
    rotation: 0,
    zIndex,
    opacity: 1,
    editable: true,
    sourceLocation: location(input.sourceLocation),
    shape: "roundRect",
    fill: structuredClone(fill),
    stroke: structuredClone(theme.defaults.shape.stroke),
  };
}

function textElement(
  input: CodeBlockInput,
  id: string,
  textFrame: FrameIR,
  paragraphs: TextElementIR["paragraphs"],
  theme: ThemeDefinition,
  values: Partial<TextElementIR["style"]>,
  zIndex: number,
): TextElementIR {
  return {
    id,
    type: "text",
    role: "code",
    frame: { ...textFrame },
    rotation: 0,
    zIndex,
    opacity: 1,
    editable: true,
    sourceLocation: location(input.sourceLocation),
    paragraphs,
    style: {
      ...structuredClone(theme.ir.typography.code),
      ...values,
      textFit: "shrink",
    },
  };
}

/**
 * Expands CodeBlock input into editable native Shape/Text IR.
 * Every child uses absolute canvas coordinates and stable IDs derived from input.id.
 */
export function expandCodeBlock(
  input: CodeBlockInput,
  theme: ThemeDefinition,
): GroupElementIR {
  const issues = validateCodeBlockInput(input);
  if (issues.length > 0) throw new CodeBlockValidationError(issues);

  const padding = input.padding ?? 28;
  const tokenizedLines = tokenizeCode(input.code, input.language);
  const lines = tokenizedLines.map((tokens) =>
    tokens.map((token) => token.text).join(""),
  );
  const hasHeader = Boolean(input.title || input.language);
  const headerHeight = hasHeader ? Math.min(54, input.frame.h * 0.18) : 0;
  const contentY = input.frame.y + padding + headerHeight;
  const contentHeight = Math.max(1, input.frame.h - padding * 2 - headerHeight);
  const baseFontSize = theme.ir.typography.code.fontSize;
  const baseLineHeight = theme.ir.typography.code.lineHeight ?? 1.4;
  const paragraphGap = 0.22;
  const lineUnits =
    lines.length * baseLineHeight + Math.max(0, lines.length - 1) * paragraphGap;
  const fittedFontSize = Math.min(baseFontSize, contentHeight / Math.max(1, lineUnits));
  const fontSize = Math.max(0.001, round(fittedFontSize));
  const lineHeight = Math.max(0.001, round(fontSize * baseLineHeight));
  const lineStep = Math.max(
    lineHeight,
    round(fontSize * (baseLineHeight + paragraphGap)),
  );
  const numberDigits = String(lines.length).length;
  const numberGutter = input.showLineNumbers
    ? Math.max(38, numberDigits * fontSize * 0.7 + 22)
    : 0;
  const contentX = input.frame.x + padding;
  const contentWidth = Math.max(1, input.frame.w - padding * 2);
  const codeX = contentX + numberGutter;
  const codeWidth = Math.max(1, contentWidth - numberGutter);
  const surface = themeColor(theme, "surface", "#F5F7FA");
  const highlight = themeColor(theme, "brandSoft", "#EAF0FF");
  const muted = themeColor(theme, "muted", "#5F6B7A");
  const children: Array<ShapeElementIR | TextElementIR> = [
    backgroundShape(
      input,
      `${input.id}--background`,
      frame(input.frame.x, input.frame.y, input.frame.w, input.frame.h),
      { type: "solid", color: surface },
      theme,
      1,
    ),
  ];

  if (hasHeader) {
    const title = [input.title, input.language?.toUpperCase()]
      .filter(Boolean)
      .join(" · ");
    children.push(
      textElement(
        input,
        `${input.id}--header`,
        frame(contentX, input.frame.y + padding * 0.45, contentWidth, headerHeight),
        [{ runs: [{ text: title, bold: true }] }],
        theme,
        {
          color: muted,
          fontFace: theme.ir.fonts.body.family,
          fontSize: Math.min(20, theme.ir.typography.caption.fontSize),
          fontWeight: 700,
          verticalAlign: "middle",
        },
        3,
      ),
    );
  }

  for (const line of [...new Set(input.highlightLines ?? [])].sort((a, b) => a - b)) {
    const y = contentY + (line - 1) * lineStep;
    children.push(
      backgroundShape(
        input,
        `${input.id}--highlight-${line}`,
        frame(contentX - 7, y, contentWidth + 14, Math.max(1, lineHeight)),
        { type: "solid", color: highlight },
        theme,
        2,
      ),
    );
  }

  if (input.showLineNumbers) {
    children.push(
      textElement(
        input,
        `${input.id}--line-numbers`,
        frame(contentX, contentY, Math.max(1, numberGutter - 14), contentHeight),
        lines.map((_, index) => ({ runs: [{ text: String(index + 1) }] })),
        theme,
        {
          align: "right",
          verticalAlign: "top",
          color: muted,
          fontSize,
          lineHeight: baseLineHeight,
        },
        3,
      ),
    );
  }

  children.push(
    textElement(
      input,
      `${input.id}--code`,
      frame(codeX, contentY, codeWidth, contentHeight),
      tokenizedLines.map((tokens) => ({ runs: tokenRuns(tokens, theme, surface) })),
      theme,
      {
        align: "left",
        verticalAlign: "top",
        fontSize,
        lineHeight: baseLineHeight,
      },
      3,
    ),
  );

  return {
    id: input.id,
    type: "group",
    frame: frame(input.frame.x, input.frame.y, input.frame.w, input.frame.h),
    rotation: 0,
    zIndex: input.zIndex ?? 20,
    opacity: 1,
    editable: true,
    ...(input.alt ? { alt: input.alt } : {}),
    sourceLocation: location(input.sourceLocation),
    children,
  };
}
