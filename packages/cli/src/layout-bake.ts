import {
  type ElementLayoutOverride,
  evaluateStaticExpression,
  type LayoutOverrides,
  LayoutOverridesSchema,
  parseDeckMdx,
} from "@livetoon/slide-compiler";
import { scaleTableDimensions } from "@livetoon/slide-deck-ir";

interface PositionPoint {
  line?: number;
  column?: number;
}

interface Position {
  start?: PositionPoint;
  end?: PositionPoint;
}

interface Attribute {
  type: string;
  name?: string;
  value?: string | null | { type?: string; value?: string };
  position?: Position;
}

interface Node {
  type: string;
  name?: string | null;
  children?: Node[];
  attributes?: Attribute[];
  position?: Position;
}

interface Edit {
  start: number;
  end: number;
  value: string;
}

const FRAME_PROPS = ["x", "y", "w", "h", "rotation", "zIndex"] as const;

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function offsetFor(point: PositionPoint | undefined, starts: number[]): number {
  const line = point?.line;
  const column = point?.column;
  if (!line || !column || (!starts[line - 1] && line !== 1)) {
    throw new Error("MDXの位置情報を確認できません。");
  }
  return (starts[line - 1] ?? 0) + column - 1;
}

function staticId(node: Node): string | undefined {
  const attribute = node.attributes?.find(
    (candidate) => candidate.type === "mdxJsxAttribute" && candidate.name === "id",
  );
  return typeof attribute?.value === "string" ? attribute.value : undefined;
}

function collectElements(nodes: Node[], result: Map<string, Node>): void {
  for (const node of nodes) {
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      node.name !== "Slide"
    ) {
      const id = staticId(node);
      if (id) result.set(id, node);
    }
    if (node.children) collectElements(node.children, result);
  }
}

function numberText(value: number): string {
  const rounded = Math.round(value * 1_000) / 1_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function openingTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let braces = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces = Math.max(0, braces - 1);
    } else if (character === ">" && braces === 0) {
      return index;
    }
  }
  throw new Error("要素の開始タグが閉じられていません。");
}

function attributeFor(node: Node, name: string): Attribute | undefined {
  return node.attributes?.find(
    (candidate) => candidate.type === "mdxJsxAttribute" && candidate.name === name,
  );
}

function staticAttributeValue(attribute: Attribute, name: string): unknown {
  if (
    !attribute.value ||
    typeof attribute.value !== "object" ||
    typeof attribute.value.value !== "string"
  ) {
    throw new Error(`Tableの${name}は静的な数値で指定してください。`);
  }
  return evaluateStaticExpression(attribute.value.value);
}

function staticNumber(node: Node, name: string): number | undefined {
  const attribute = attributeFor(node, name);
  if (!attribute) return undefined;
  const value = staticAttributeValue(attribute, name);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Tableの${name}は0より大きい数値で指定してください。`);
  }
  return value;
}

function staticNumberArray(
  node: Node,
  name: "columnWidths" | "rowHeights",
): { attribute: Attribute; values: number[] } | undefined {
  const attribute = attributeFor(node, name);
  if (!attribute) return undefined;
  const value = staticAttributeValue(attribute, name);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0,
    )
  ) {
    throw new Error(`Tableの${name}は0より大きい数値の配列で指定してください。`);
  }
  return { attribute, values: value as number[] };
}

function dimensionArrayText(values: readonly number[], target: number): string {
  const rounded = values.map((value) => Number(numberText(value)));
  const lastIndex = rounded.length - 1;
  if (lastIndex >= 0) {
    const prefixTotal = rounded
      .slice(0, lastIndex)
      .reduce((total, value) => total + value, 0);
    rounded[lastIndex] = Number(numberText(target - prefixTotal));
  }
  return `[${rounded.map(numberText).join(", ")}]`;
}

function tableDimensionEdits(
  node: Node,
  override: ElementLayoutOverride,
  starts: number[],
): Edit[] {
  if (node.name !== "Table") return [];
  const edits: Edit[] = [];
  for (const dimension of [
    { frame: "w", detail: "columnWidths" },
    { frame: "h", detail: "rowHeights" },
  ] as const) {
    const target = override[dimension.frame];
    if (target === undefined) continue;
    const detail = staticNumberArray(node, dimension.detail);
    if (!detail) continue;
    const sourceTotal =
      staticNumber(node, dimension.frame) ??
      detail.values.reduce((total, value) => total + value, 0);
    const scaled = scaleTableDimensions(detail.values, sourceTotal, target);
    if (!detail.attribute.position?.start || !detail.attribute.position.end) {
      throw new Error(`Tableの${dimension.detail}の位置を確認できません。`);
    }
    edits.push({
      start: offsetFor(detail.attribute.position.start, starts),
      end: offsetFor(detail.attribute.position.end, starts),
      value: `${dimension.detail}={${dimensionArrayText(scaled, target)}}`,
    });
  }
  return edits;
}

function editsForNode(
  source: string,
  node: Node,
  override: ElementLayoutOverride,
  starts: number[],
): Edit[] {
  const edits: Edit[] = [];
  const missing: string[] = [];
  for (const name of FRAME_PROPS) {
    const value = override[name];
    if (value === undefined) continue;
    const attribute = node.attributes?.find(
      (candidate) => candidate.type === "mdxJsxAttribute" && candidate.name === name,
    );
    if (attribute?.position?.start && attribute.position.end) {
      edits.push({
        start: offsetFor(attribute.position.start, starts),
        end: offsetFor(attribute.position.end, starts),
        value: `${name}={${numberText(value)}}`,
      });
    } else {
      missing.push(`${name}={${numberText(value)}}`);
    }
  }
  if (missing.length > 0) {
    const start = offsetFor(node.position?.start, starts);
    const tagEnd = openingTagEnd(source, start);
    const slash = source.slice(start, tagEnd).match(/\/\s*$/);
    const insertion = slash ? tagEnd - (slash[0]?.length ?? 0) : tagEnd;
    const opening = source.slice(start, tagEnd);
    const value = opening.includes("\n")
      ? `\n  ${missing.join("\n  ")}`
      : ` ${missing.join(" ")}`;
    edits.push({ start: insertion, end: insertion, value });
  }
  return edits;
}

function applyEdits(source: string, edits: Edit[]): string {
  let result = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, edit.start)}${edit.value}${result.slice(edit.end)}`;
  }
  return result;
}

export interface LayoutBakeResult {
  source: string;
  overrides: LayoutOverrides;
  baked: Array<{ slideId: string; elementId: string }>;
  skipped: Array<{ slideId: string; elementId: string }>;
}

/** Bakes source-backed element frames and leaves generated Markdown elements untouched. */
export function bakeLayoutOverrides(
  source: string,
  rawOverrides: unknown,
  sourcePath: string,
): LayoutBakeResult {
  const overrides = LayoutOverridesSchema.parse(rawOverrides);
  const parsed = parseDeckMdx(source, sourcePath);
  const starts = lineStarts(source);
  const edits: Edit[] = [];
  const baked: LayoutBakeResult["baked"] = [];
  const skipped: LayoutBakeResult["skipped"] = [];
  const remaining: LayoutOverrides = { schemaVersion: 1, slides: {} };

  for (const [slideId, slideOverrides] of Object.entries(overrides.slides)) {
    const slide = parsed.slides.find(
      (candidate) => candidate.frontmatter.id === slideId,
    );
    const elements = new Map<string, Node>();
    if (slide) collectElements(slide.children as Node[], elements);
    for (const [elementId, override] of Object.entries(slideOverrides)) {
      const node = elements.get(elementId);
      if (!node) {
        remaining.slides[slideId] ??= {};
        remaining.slides[slideId][elementId] = override;
        skipped.push({ slideId, elementId });
        continue;
      }
      edits.push(...tableDimensionEdits(node, override, starts));
      edits.push(...editsForNode(source, node, override, starts));
      baked.push({ slideId, elementId });
    }
  }

  return {
    source: applyEdits(source, edits),
    overrides: remaining,
    baked,
    skipped,
  };
}
