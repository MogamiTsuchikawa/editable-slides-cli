import {
  type LayoutOverrides,
  LayoutOverridesSchema,
  parseDeckMdx,
} from "@editable-slides/slide-compiler";
import { parseDocument } from "yaml";

interface Point {
  line?: number;
  column?: number;
}

interface Position {
  start?: Point;
  end?: Point;
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

interface YamlNode {
  value?: unknown;
  range?: [number, number, number?];
  items?: YamlNode[];
  get?: (key: string, keepScalar?: boolean) => YamlNode | undefined;
}

interface Edit {
  start: number;
  end: number;
  value: string;
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export type RenameIdInput =
  | { kind: "slide"; from: string; to: string }
  | { kind: "element"; slideId: string; from: string; to: string };

export interface RenameIdResult {
  source: string;
  overrides: LayoutOverrides;
  renamedReferences: number;
}

function validateInput(input: RenameIdInput): void {
  if (!SAFE_ID.test(input.from) || !SAFE_ID.test(input.to)) {
    throw new Error("IDは英小文字、数字、_、-だけで指定してください。");
  }
  if (input.from === input.to) throw new Error("変更前と変更後のIDが同じです。");
  if (input.kind === "element" && !SAFE_ID.test(input.slideId)) {
    throw new Error("ページIDが正しくありません。");
  }
}

function starts(source: string): number[] {
  const result = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") result.push(index + 1);
  }
  return result;
}

function offset(point: Point | undefined, lineStarts: number[]): number {
  if (!point?.line || !point.column || lineStarts[point.line - 1] === undefined) {
    throw new Error("MDXの位置情報を確認できません。");
  }
  return (lineStarts[point.line - 1] ?? 0) + point.column - 1;
}

function attribute(node: Node, name: string): Attribute | undefined {
  return node.attributes?.find(
    (candidate) => candidate.type === "mdxJsxAttribute" && candidate.name === name,
  );
}

function stringAttribute(node: Node, name: string): string | undefined {
  const value = attribute(node, name)?.value;
  return typeof value === "string" ? value : undefined;
}

function collectElements(nodes: Node[], result: Map<string, Node>): void {
  for (const node of nodes) {
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      node.name !== "Slide"
    ) {
      const id = stringAttribute(node, "id");
      if (id) result.set(id, node);
    }
    if (node.children) collectElements(node.children, result);
  }
}

function attributeEdit(
  node: Node,
  name: string,
  value: string,
  lineStarts: number[],
): Edit {
  const target = attribute(node, name);
  if (!target?.position?.start || !target.position.end) {
    throw new Error(`${name}属性の位置を確認できません。`);
  }
  return {
    start: offset(target.position.start, lineStarts),
    end: offset(target.position.end, lineStarts),
    value: `${name}=${JSON.stringify(value)}`,
  };
}

function referenceEdits(
  nodes: Node[],
  lineStarts: number[],
  rename: (value: string) => string | undefined,
): Edit[] {
  const edits: Edit[] = [];
  for (const node of nodes) {
    for (const name of ["from", "to"] as const) {
      const current = stringAttribute(node, name);
      if (!current) continue;
      const next = rename(current);
      if (next) edits.push(attributeEdit(node, name, next, lineStarts));
    }
    if (node.children) edits.push(...referenceEdits(node.children, lineStarts, rename));
  }
  return edits;
}

function yamlSlideIdEdit(source: string, from: string, to: string): Edit {
  const match = FRONTMATTER.exec(source);
  if (!match?.[1]) throw new Error("deck.mdxの設定欄が見つかりません。");
  const yamlStart = source.indexOf(match[1], match.index);
  const document = parseDocument(match[1]);
  const slides = document.get("slides", true) as YamlNode | undefined;
  for (const item of slides?.items ?? []) {
    const id = item.get?.("id", true);
    if (id?.value !== from) continue;
    if (!id.range) throw new Error("ページIDの位置を確認できません。");
    return {
      start: yamlStart + id.range[0],
      end: yamlStart + id.range[1],
      value: JSON.stringify(to),
    };
  }
  throw new Error(`ページIDが見つかりません: ${from}`);
}

function apply(source: string, edits: Edit[]): string {
  let result = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, edit.start)}${edit.value}${result.slice(edit.end)}`;
  }
  return result;
}

function renameOverrideKeys(
  values: Record<string, LayoutOverrides["slides"][string][string]>,
  from: string,
  to: string,
): Record<string, LayoutOverrides["slides"][string][string]> {
  const renamed: Record<string, LayoutOverrides["slides"][string][string]> = {};
  for (const [key, value] of Object.entries(values)) {
    const next =
      key === from
        ? to
        : key.startsWith(`${from}--`)
          ? `${to}${key.slice(from.length)}`
          : key;
    if (renamed[next]) throw new Error(`位置調整のIDが衝突します: ${next}`);
    renamed[next] = value;
  }
  return renamed;
}

export function renameStableId(
  source: string,
  rawOverrides: unknown,
  sourcePath: string,
  input: RenameIdInput,
): RenameIdResult {
  validateInput(input);
  const parsed = parseDeckMdx(source, sourcePath);
  const lineStarts = starts(source);
  const overrides = structuredClone(LayoutOverridesSchema.parse(rawOverrides));
  const edits: Edit[] = [];
  let renamedReferences = 0;

  if (input.kind === "slide") {
    const slide = parsed.slides.find(
      (candidate) => candidate.frontmatter.id === input.from,
    );
    if (!slide) throw new Error(`ページIDが見つかりません: ${input.from}`);
    if (parsed.slides.some((candidate) => candidate.frontmatter.id === input.to)) {
      throw new Error(`変更後のページIDは既に使われています: ${input.to}`);
    }
    edits.push(yamlSlideIdEdit(source, input.from, input.to));
    edits.push(attributeEdit(slide.sourceNode as Node, "id", input.to, lineStarts));
    const references = referenceEdits(slide.children as Node[], lineStarts, (value) =>
      value.startsWith(`${input.from}--`)
        ? `${input.to}${value.slice(input.from.length)}`
        : undefined,
    );
    edits.push(...references);
    renamedReferences = references.length;
    const slideOverrides = overrides.slides[input.from];
    if (slideOverrides) {
      if (overrides.slides[input.to]) {
        throw new Error(`変更後のページIDに位置調整が既にあります: ${input.to}`);
      }
      delete overrides.slides[input.from];
      overrides.slides[input.to] = renameOverrideKeys(
        slideOverrides,
        input.from,
        input.to,
      );
    }
  } else {
    const slide = parsed.slides.find(
      (candidate) => candidate.frontmatter.id === input.slideId,
    );
    if (!slide) throw new Error(`ページIDが見つかりません: ${input.slideId}`);
    const elements = new Map<string, Node>();
    collectElements(slide.children as Node[], elements);
    const element = elements.get(input.from);
    if (!element) throw new Error(`要素IDが見つかりません: ${input.from}`);
    if (elements.has(input.to)) {
      throw new Error(`変更後の要素IDは既に使われています: ${input.to}`);
    }
    edits.push(attributeEdit(element, "id", input.to, lineStarts));
    const references = referenceEdits(slide.children as Node[], lineStarts, (value) =>
      value === input.from
        ? input.to
        : value.startsWith(`${input.from}--`)
          ? `${input.to}${value.slice(input.from.length)}`
          : undefined,
    );
    edits.push(...references);
    renamedReferences = references.length;
    const slideOverrides = overrides.slides[input.slideId];
    if (slideOverrides) {
      overrides.slides[input.slideId] = renameOverrideKeys(
        slideOverrides,
        input.from,
        input.to,
      );
    }
  }

  return {
    source: apply(source, edits),
    overrides,
    renamedReferences,
  };
}
