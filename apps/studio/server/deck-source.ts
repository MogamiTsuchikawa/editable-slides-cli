import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

import {
  type ChartContractIssueCode,
  type ChartTypeIR,
  type DeckIR,
  type ElementIR,
  MAX_TABLE_CELL_SPAN,
  MAX_TABLE_GRID_COLUMNS,
  parseDeckIR,
  type SourceIR,
  scaleTableDimensions,
  tableDimensionsMatch,
  validateChartContract,
  validateTableGrid,
} from "@editable-slides/slide-deck-ir";

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
export const MAX_STUDIO_DECK_SOURCE_BYTES = 2 * 1024 * 1024;

export interface DeckSourceState {
  editable: boolean;
  sourceHash: string;
  sourceFile: string;
  slideIds: string[];
  reason?: string;
}

export interface SlideSourceMutationResult extends DeckSourceState {
  operation: "add" | "duplicate" | "delete" | "move";
  slideId: string;
  selectedSlideId: string;
}

export type SlideSourceOperation =
  | {
      type: "add";
      title: string;
      layout?: string;
      afterSlideId?: string;
    }
  | { type: "duplicate"; slideId: string }
  | { type: "delete"; slideId: string }
  | { type: "move"; slideId: string; toIndex: number };

export interface SlideMetadataUpdate {
  slideId: string;
  notes: string;
  sources: SourceIR[];
}

export interface StructuredDataUpdate {
  slideId: string;
  elementId: string;
  data: unknown;
}

interface DeckSourceContext {
  deck: DeckIR;
  sourcePath: string;
  source: string;
  sourceHash: string;
  sourceModifiedAt: number;
  irModifiedAt: number;
  lineEnding: "\n" | "\r\n";
  parsed: ParsedDeckSource;
}

interface PendingCompilation {
  sourceHash: string;
  deckContentHash: string;
}

const pendingCompilations = new Map<string, PendingCompilation>();

interface ParsedFrontmatter {
  openingEnd: number;
  closingStart: number;
  closingEnd: number;
  slidesStart: number;
  slidesEnd: number;
}

interface SlideBlock {
  id: string;
  start: number;
  end: number;
  source: string;
}

interface ParsedDeckSource {
  frontmatter: ParsedFrontmatter;
  slideBlocks: SlideBlock[];
}

interface SlideMetadata {
  id: string;
  layout: string;
  notes: string;
  sources: SourceIR[];
  masterId?: string;
}

function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function isWithin(parent: string, candidate: string): boolean {
  const normalizedParent = `${resolve(parent)}${sep}`;
  return resolve(candidate).startsWith(normalizedParent);
}

function lineEndingFor(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function lineEnd(source: string, from: number): number {
  const newline = source.indexOf("\n", from);
  return newline < 0 ? source.length : newline + 1;
}

function parseFrontmatter(source: string): ParsedFrontmatter {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r?\n)/.exec(source);
  if (!opening) {
    throw new Error("deck.mdxの先頭に設定欄が見つかりません。");
  }
  const closingPattern = /^---[ \t]*$/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(source);
  if (!closing || closing.index < opening[0].length) {
    throw new Error("deck.mdxの設定欄が閉じられていません。");
  }
  const openingEnd = opening[0].length;
  const closingStart = closing.index;
  const closingEnd = lineEnd(source, closing.index);
  const frontmatter = source.slice(openingEnd, closingStart);
  const slidesMatch = /^slides:[^\r\n]*(?:\r?\n|$)/m.exec(frontmatter);
  if (!slidesMatch || slidesMatch.index === undefined) {
    throw new Error("deck.mdxの設定欄にslidesが見つかりません。");
  }
  const slidesStart = openingEnd + slidesMatch.index;
  const afterSlidesHeader = slidesMatch.index + slidesMatch[0].length;
  const remainder = frontmatter.slice(afterSlidesHeader);
  const nextTopLevel = /^[a-zA-Z_][a-zA-Z0-9_-]*:[^\r\n]*(?:\r?\n|$)/m.exec(remainder);
  const slidesEnd = nextTopLevel
    ? openingEnd + afterSlidesHeader + (nextTopLevel.index ?? 0)
    : closingStart;
  return { openingEnd, closingStart, closingEnd, slidesStart, slidesEnd };
}

function parseScalar(value: string): string {
  const trimmed = value.trim().replace(/\s+#.*$/, "");
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function slideIdFromOpeningTag(tag: string): string | undefined {
  const match = /\bid\s*=\s*(["'])([^"']+)\1/.exec(tag);
  return match?.[2];
}

function parseSlideBlocks(source: string, bodyStart: number): SlideBlock[] {
  const blocks: SlideBlock[] = [];
  const openingPattern = /<Slide\b[^>]*>/g;
  openingPattern.lastIndex = bodyStart;
  for (
    let opening = openingPattern.exec(source);
    opening;
    opening = openingPattern.exec(source)
  ) {
    const id = slideIdFromOpeningTag(opening[0]);
    if (!id) {
      throw new Error("idのないSlideブロックはStudioで編集できません。");
    }
    const closingStart = source.indexOf("</Slide>", opening.index + opening[0].length);
    if (closingStart < 0) {
      throw new Error(`スライド「${id}」の終了タグが見つかりません。`);
    }
    const end = closingStart + "</Slide>".length;
    blocks.push({
      id,
      start: opening.index,
      end,
      source: source.slice(opening.index, end),
    });
    openingPattern.lastIndex = end;
  }
  if (blocks.length === 0) {
    throw new Error("deck.mdxにSlideブロックが見つかりません。");
  }
  return blocks;
}

function parseDeckSource(source: string): ParsedDeckSource {
  const frontmatter = parseFrontmatter(source);
  return {
    frontmatter,
    slideBlocks: parseSlideBlocks(source, frontmatter.closingEnd),
  };
}

function explicitMasterIds(
  source: string,
  parsed: ParsedDeckSource,
): Map<string, string> {
  const result = new Map<string, string>();
  const block = source.slice(
    parsed.frontmatter.slidesStart,
    parsed.frontmatter.slidesEnd,
  );
  const entryPattern = /^ {2}- id:\s*(.+?)\s*$/gm;
  const entries = [...block.matchAll(entryPattern)];
  for (const [index, entry] of entries.entries()) {
    const id = parseScalar(entry[1] ?? "");
    if (!SAFE_ID.test(id)) continue;
    const start = entry.index ?? 0;
    const end = entries[index + 1]?.index ?? block.length;
    const entrySource = block.slice(start, end);
    const master = /^ {4}masterId:\s*(.+?)\s*$/m.exec(entrySource);
    if (master?.[1]) result.set(id, parseScalar(master[1]));
  }
  return result;
}

function metadataFromDeck(context: DeckSourceContext): SlideMetadata[] {
  const masters = explicitMasterIds(context.source, context.parsed);
  return context.deck.slides.map((slide) => ({
    id: slide.id,
    layout: slide.layoutId,
    notes: slide.notes.markdown,
    sources: slide.notes.sources.map((source) => ({ ...source })),
    ...(masters.get(slide.id) ? { masterId: masters.get(slide.id) } : {}),
  }));
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function formatSlides(metadata: readonly SlideMetadata[], eol: string): string {
  const lines = ["slides:"];
  for (const slide of metadata) {
    lines.push(`  - id: ${slide.id}`, `    layout: ${yamlString(slide.layout)}`);
    if (slide.notes.trim()) {
      lines.push("    notes: |");
      lines.push(
        ...slide.notes
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => `      ${line}`),
      );
    } else {
      lines.push('    notes: ""');
    }
    if (slide.sources.length === 0) {
      lines.push("    sources: []");
    } else {
      lines.push("    sources:");
      for (const source of slide.sources) {
        lines.push(`      - label: ${yamlString(source.label)}`);
        if (source.url) lines.push(`        url: ${yamlString(source.url)}`);
      }
    }
    if (slide.masterId) lines.push(`    masterId: ${yamlString(slide.masterId)}`);
  }
  return `${lines.join(eol)}${eol}`;
}

function replaceSlidesMetadata(
  source: string,
  parsed: ParsedDeckSource,
  metadata: readonly SlideMetadata[],
  eol: string,
): string {
  return `${source.slice(0, parsed.frontmatter.slidesStart)}${formatSlides(
    metadata,
    eol,
  )}${source.slice(parsed.frontmatter.slidesEnd)}`;
}

function replaceSlideBlocks(
  source: string,
  parsed: ParsedDeckSource,
  blocks: readonly SlideBlock[],
  eol: string,
): string {
  const first = parsed.slideBlocks[0];
  const last = parsed.slideBlocks.at(-1);
  if (!first || !last) throw new Error("Slideブロックが見つかりません。");
  return `${source.slice(0, first.start)}${blocks
    .map((block) => block.source.trim())
    .join(`${eol}${eol}`)}${source.slice(last.end)}`;
}

function replaceSlideOpeningId(block: SlideBlock, nextId: string): string {
  const openingEnd = block.source.indexOf(">");
  if (openingEnd < 0) throw new Error(`スライド「${block.id}」の開始タグが不正です。`);
  const opening = block.source.slice(0, openingEnd + 1);
  const replaced = opening.replace(/\bid\s*=\s*(["'])[^"']+\1/, `id="${nextId}"`);
  if (opening === replaced)
    throw new Error(`スライド「${block.id}」のidを変更できません。`);
  return `${replaced}${block.source.slice(openingEnd + 1)}`;
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function uniqueSlideId(preferred: string, existing: ReadonlySet<string>): string {
  const base = SAFE_ID.test(preferred) ? preferred : slug(preferred) || "slide";
  if (!existing.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("新しいスライドIDを作成できませんでした。");
}

function assertDeckAndSourceAgree(context: DeckSourceContext): void {
  const sourceIds = context.parsed.slideBlocks.map((slide) => slide.id);
  const deckIds = context.deck.slides.map((slide) => slide.id);
  if (JSON.stringify(sourceIds) !== JSON.stringify(deckIds)) {
    throw new Error("直前の変更を反映中です。少し待ってから再読み込みしてください。");
  }
}

async function readContext(
  deckDirectory: string,
  deckIrPath: string,
): Promise<DeckSourceContext> {
  const [deckSource, irStats] = await Promise.all([
    readFile(deckIrPath, "utf8"),
    stat(deckIrPath),
  ]);
  const deck = parseDeckIR(JSON.parse(deckSource) as unknown);
  const sourcePaths = new Set(deck.slides.map((slide) => slide.sourcePath));
  if (sourcePaths.size !== 1) {
    throw new Error("ページ操作は単一のdeck.mdxで作られた資料だけに対応しています。");
  }
  const configuredPath = [...sourcePaths][0];
  if (!configuredPath) throw new Error("deck.mdxの場所を確認できません。");
  const sourcePath = isAbsolute(configuredPath)
    ? resolve(configuredPath)
    : resolve(deckDirectory, configuredPath);
  if (!isWithin(deckDirectory, sourcePath) || basename(sourcePath) !== "deck.mdx") {
    throw new Error("ページ操作は資料フォルダ内のdeck.mdxだけに対応しています。");
  }
  const [canonicalDeckDirectory, canonicalSourcePath] = await Promise.all([
    realpath(deckDirectory),
    realpath(sourcePath),
  ]);
  if (!isWithin(canonicalDeckDirectory, canonicalSourcePath)) {
    throw new Error(
      "deck.mdxの実体が資料フォルダの外にあるため、Studioでは編集できません。",
    );
  }
  const sourceStats = await stat(canonicalSourcePath);
  if (!sourceStats.isFile()) {
    throw new Error("deck.mdxが通常のファイルではないため、Studioでは編集できません。");
  }
  if (sourceStats.size > MAX_STUDIO_DECK_SOURCE_BYTES) {
    throw new Error(
      `deck.mdxが編集上限の${MAX_STUDIO_DECK_SOURCE_BYTES}バイトを超えています。`,
    );
  }
  const source = await readFile(canonicalSourcePath, "utf8");
  return {
    deck,
    sourcePath: canonicalSourcePath,
    source,
    sourceHash: hashSource(source),
    sourceModifiedAt: sourceStats.mtimeMs,
    irModifiedAt: irStats.mtimeMs,
    lineEnding: lineEndingFor(source),
    parsed: parseDeckSource(source),
  };
}

function awaitingCompilation(context: DeckSourceContext): boolean {
  const pending = pendingCompilations.get(context.sourcePath);
  if (pending) {
    if (
      pending.sourceHash === context.sourceHash &&
      pending.deckContentHash === context.deck.contentHash
    ) {
      return true;
    }
    pendingCompilations.delete(context.sourcePath);
  }
  return context.sourceModifiedAt > context.irModifiedAt;
}

function assertCompilationReady(context: DeckSourceContext): void {
  if (awaitingCompilation(context)) {
    throw new Error("直前の変更を反映中です。少し待ってから再読み込みしてください。");
  }
}

function markCompilationPending(context: DeckSourceContext, sourceHash: string): void {
  pendingCompilations.set(context.sourcePath, {
    sourceHash,
    deckContentHash: context.deck.contentHash,
  });
}

function assertExpectedHash(context: DeckSourceContext, expectedHash: string): void {
  if (!expectedHash || context.sourceHash !== expectedHash) {
    throw new Error(
      "別の場所で資料が更新されています。再読み込みしてから、もう一度操作してください。",
    );
  }
}

async function atomicReplace(
  filePath: string,
  expectedSource: string,
  nextSource: string,
): Promise<string> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, nextSource, { encoding: "utf8", flag: "wx" });
    const latest = await readFile(filePath, "utf8");
    if (hashSource(latest) !== hashSource(expectedSource)) {
      throw new Error(
        "保存の直前に資料が更新されました。再読み込みしてから、もう一度操作してください。",
      );
    }
    await rename(temporaryPath, filePath);
    return hashSource(nextSource);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function sourceState(context: DeckSourceContext): DeckSourceState {
  const slideIds = context.parsed.slideBlocks.map((slide) => slide.id);
  const ready =
    !awaitingCompilation(context) &&
    JSON.stringify(slideIds) ===
      JSON.stringify(context.deck.slides.map((slide) => slide.id));
  return {
    editable: ready,
    sourceHash: context.sourceHash,
    sourceFile: basename(context.sourcePath),
    slideIds,
    ...(ready
      ? {}
      : { reason: "直前の変更を反映中です。少し待ってから再読み込みしてください。" }),
  };
}

export async function readDeckSourceState(
  deckDirectory: string,
  deckIrPath: string,
): Promise<DeckSourceState> {
  try {
    return sourceState(await readContext(deckDirectory, deckIrPath));
  } catch (error) {
    return {
      editable: false,
      sourceHash: "",
      sourceFile: "deck.mdx",
      slideIds: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function mutateSlideSource(
  deckDirectory: string,
  deckIrPath: string,
  expectedHash: string,
  operation: SlideSourceOperation,
): Promise<SlideSourceMutationResult> {
  const context = await readContext(deckDirectory, deckIrPath);
  assertExpectedHash(context, expectedHash);
  assertCompilationReady(context);
  assertDeckAndSourceAgree(context);
  const metadata = metadataFromDeck(context);
  const blocks = context.parsed.slideBlocks.map((block) => ({ ...block }));
  const existing = new Set(blocks.map((block) => block.id));
  let selectedSlideId = operation.type === "add" ? "" : operation.slideId;
  let affectedSlideId = selectedSlideId;

  if (operation.type === "add") {
    const title = operation.title.trim() || "新しいスライド";
    const newId = uniqueSlideId(slug(title) || "slide", existing);
    const afterIndex = operation.afterSlideId
      ? blocks.findIndex((block) => block.id === operation.afterSlideId)
      : blocks.length - 1;
    const insertIndex = afterIndex < 0 ? blocks.length : afterIndex + 1;
    metadata.splice(insertIndex, 0, {
      id: newId,
      layout: operation.layout?.trim() || "title-body",
      notes: "",
      sources: [],
    });
    blocks.splice(insertIndex, 0, {
      id: newId,
      start: 0,
      end: 0,
      source: `<Slide id="${newId}">${context.lineEnding}${context.lineEnding}# ${title}${context.lineEnding}${context.lineEnding}</Slide>`,
    });
    selectedSlideId = newId;
    affectedSlideId = newId;
  } else {
    const index = blocks.findIndex((block) => block.id === operation.slideId);
    if (index < 0)
      throw new Error(`スライド「${operation.slideId}」が見つかりません。`);
    if (operation.type === "duplicate") {
      const sourceBlock = blocks[index];
      const sourceMetadata = metadata[index];
      if (!sourceBlock || !sourceMetadata) throw new Error("複製元を確認できません。");
      const newId = uniqueSlideId(`${operation.slideId}-copy`, existing);
      blocks.splice(index + 1, 0, {
        id: newId,
        start: 0,
        end: 0,
        source: replaceSlideOpeningId(sourceBlock, newId),
      });
      metadata.splice(index + 1, 0, {
        ...structuredClone(sourceMetadata),
        id: newId,
      });
      selectedSlideId = newId;
      affectedSlideId = newId;
    } else if (operation.type === "delete") {
      if (blocks.length === 1) throw new Error("最後の1ページは削除できません。");
      blocks.splice(index, 1);
      metadata.splice(index, 1);
      selectedSlideId =
        blocks[Math.min(index, blocks.length - 1)]?.id ?? blocks[0]?.id ?? "";
    } else {
      const toIndex = Math.max(0, Math.min(blocks.length - 1, operation.toIndex));
      const [block] = blocks.splice(index, 1);
      const [entry] = metadata.splice(index, 1);
      if (!block || !entry) throw new Error("移動するページを確認できません。");
      blocks.splice(toIndex, 0, block);
      metadata.splice(toIndex, 0, entry);
    }
  }

  const withMetadata = replaceSlidesMetadata(
    context.source,
    context.parsed,
    metadata,
    context.lineEnding,
  );
  const reparsed = parseDeckSource(withMetadata);
  const nextSource = replaceSlideBlocks(
    withMetadata,
    reparsed,
    blocks,
    context.lineEnding,
  );
  const nextHash = await atomicReplace(context.sourcePath, context.source, nextSource);
  markCompilationPending(context, nextHash);
  return {
    editable: false,
    sourceHash: nextHash,
    sourceFile: basename(context.sourcePath),
    slideIds: blocks.map((block) => block.id),
    reason: "変更を反映しています。",
    operation: operation.type,
    slideId: affectedSlideId,
    selectedSlideId,
  };
}

function validateSources(sources: SourceIR[]): SourceIR[] {
  if (sources.length > 100) throw new Error("出典は1ページにつき100件までです。");
  return sources.map((source) => {
    const label = source.label.trim();
    if (!label) throw new Error("出典名を入力してください。");
    if (source.url) {
      try {
        const url = new URL(source.url);
        if (
          (url.protocol !== "https:" && url.protocol !== "http:") ||
          url.username ||
          url.password
        ) {
          throw new Error();
        }
      } catch {
        throw new Error(`出典「${label}」のURLを確認してください。`);
      }
    }
    return { label, ...(source.url?.trim() ? { url: source.url.trim() } : {}) };
  });
}

export async function updateSlideMetadataSource(
  deckDirectory: string,
  deckIrPath: string,
  expectedHash: string,
  update: SlideMetadataUpdate,
): Promise<DeckSourceState> {
  const context = await readContext(deckDirectory, deckIrPath);
  assertExpectedHash(context, expectedHash);
  assertCompilationReady(context);
  assertDeckAndSourceAgree(context);
  const metadata = metadataFromDeck(context);
  const target = metadata.find((slide) => slide.id === update.slideId);
  if (!target) throw new Error(`スライド「${update.slideId}」が見つかりません。`);
  target.notes = update.notes.replace(/\r\n?/g, "\n").trim();
  target.sources = validateSources(update.sources);
  const nextSource = replaceSlidesMetadata(
    context.source,
    context.parsed,
    metadata,
    context.lineEnding,
  );
  const nextHash = await atomicReplace(context.sourcePath, context.source, nextSource);
  markCompilationPending(context, nextHash);
  return {
    editable: false,
    sourceHash: nextHash,
    sourceFile: basename(context.sourcePath),
    slideIds: context.parsed.slideBlocks.map((slide) => slide.id),
    reason: "変更を反映しています。",
  };
}

function findElement(
  elements: readonly ElementIR[],
  id: string,
): ElementIR | undefined {
  for (const element of elements) {
    if (element.id === id) return element;
    if (element.type === "group") {
      const nested = findElement(element.children, id);
      if (nested) return nested;
    }
  }
  return undefined;
}

function findTagEnd(source: string, start: number): number {
  let braceDepth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth -= 1;
    else if (character === ">" && braceDepth === 0) return index + 1;
  }
  return -1;
}

interface AttributeSpan {
  name: string;
  start: number;
  end: number;
}

function attributeSpans(tag: string, component: string): AttributeSpan[] {
  const result: AttributeSpan[] = [];
  let index = `<${component}`.length;
  while (index < tag.length) {
    const whitespaceStart = index;
    while (/\s/.test(tag[index] ?? "")) index += 1;
    if (tag.startsWith("/>", index) || tag[index] === ">") break;
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(tag.slice(index));
    if (!nameMatch) throw new Error(`${component}の属性を安全に読み取れません。`);
    const name = nameMatch[0];
    index += name.length;
    while (/\s/.test(tag[index] ?? "")) index += 1;
    if (tag[index] === "=") {
      index += 1;
      while (/\s/.test(tag[index] ?? "")) index += 1;
      const opening = tag[index];
      if (opening === '"' || opening === "'") {
        index += 1;
        let escaped = false;
        while (index < tag.length) {
          const character = tag[index];
          index += 1;
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === opening) break;
        }
      } else if (opening === "{") {
        let depth = 0;
        let quote: '"' | "'" | "`" | undefined;
        let escaped = false;
        while (index < tag.length) {
          const character = tag[index];
          index += 1;
          if (quote) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = undefined;
          } else if (character === '"' || character === "'" || character === "`") {
            quote = character;
          } else if (character === "{") depth += 1;
          else if (character === "}" && --depth === 0) break;
        }
      } else {
        while (index < tag.length && !/\s|>/.test(tag[index] ?? "")) index += 1;
      }
    }
    result.push({ name, start: whitespaceStart, end: index });
  }
  return result;
}

function findComponentTag(
  source: string,
  slide: SlideBlock,
  component: "Table" | "Chart",
  elementId: string,
): { start: number; end: number; tag: string } {
  const pattern = new RegExp(`<${component}\\b`, "g");
  pattern.lastIndex = slide.start;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index >= slide.end) break;
    const end = findTagEnd(source, match.index);
    if (end < 0 || end > slide.end)
      throw new Error(`${component}の開始タグが不正です。`);
    const tag = source.slice(match.index, end);
    if (slideIdFromOpeningTag(tag) === elementId) {
      return { start: match.index, end, tag };
    }
    pattern.lastIndex = end;
  }
  throw new Error(`要素「${elementId}」の${component}がdeck.mdxに見つかりません。`);
}

function replaceDataProps(
  tag: string,
  component: "Table" | "Chart",
  dataProps: ReadonlyArray<{ name: string; data: unknown }>,
  resetDetailedSettings: boolean,
): string {
  const remove = new Set(
    component === "Table"
      ? ["headers", "rows", "dataSrc"]
      : ["data", "dataSrc", "series", "seriesName"],
  );
  if (resetDetailedSettings) {
    const detailNames =
      component === "Table"
        ? ["columnWidths", "rowHeights"]
        : [
            "categoryAxisTitle",
            "valueAxisTitle",
            "valueUnit",
            "showLegend",
            "legendPosition",
            "showValue",
            "showCategoryName",
          ];
    for (const name of detailNames) remove.add(name);
  }
  let result = tag;
  for (const span of attributeSpans(tag, component).reverse()) {
    if (remove.has(span.name)) {
      result = `${result.slice(0, span.start)}${result.slice(span.end)}`;
    }
  }
  const close = result.endsWith("/>") ? "/>" : ">";
  const closeIndex = result.lastIndexOf(close);
  const base = result.slice(0, closeIndex).trimEnd();
  const formatted = dataProps
    .map(({ name, data }) => {
      const value = JSON.stringify(data, null, 2).replaceAll("\n", "\n  ");
      return `  ${name}={${value}}`;
    })
    .join("\n");
  return `${base}\n${formatted}\n${close}`;
}

const STATIC_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function attributeValueSource(
  tag: string,
  component: "Table" | "Chart",
  name: string,
): string | undefined {
  const span = attributeSpans(tag, component).find(
    (candidate) => candidate.name === name,
  );
  if (!span) return undefined;
  const attribute = tag.slice(span.start, span.end).trim();
  const equals = attribute.indexOf("=");
  if (equals < 0) throw new Error(`${component}の${name}を安全に読み取れません。`);
  return attribute.slice(equals + 1).trim();
}

function staticPositiveNumberAttribute(tag: string, name: "w" | "h") {
  const source = attributeValueSource(tag, "Table", name);
  if (source === undefined) return undefined;
  const expression = /^\{([\s\S]*)\}$/.exec(source)?.[1]?.trim();
  if (!expression || !STATIC_NUMBER.test(expression)) {
    throw new Error(`表の${name}は静的な数値で指定してください。`);
  }
  const value = Number(expression);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`表の${name}は0より大きい数値で指定してください。`);
  }
  return value;
}

function staticPositiveNumberArrayAttribute(
  tag: string,
  name: "columnWidths" | "rowHeights",
): number[] | undefined {
  const source = attributeValueSource(tag, "Table", name);
  if (source === undefined) return undefined;
  const body = /^\{\s*\[([\s\S]*)\]\s*\}$/.exec(source)?.[1];
  if (body === undefined) {
    throw new Error(`表の${name}は静的な数値配列で指定してください。`);
  }
  const parts = body.split(",").map((part) => part.trim());
  if (parts.at(-1) === "") parts.pop();
  if (parts.length === 0 || parts.some((part) => !STATIC_NUMBER.test(part))) {
    throw new Error(`表の${name}は静的な数値配列で指定してください。`);
  }
  const values = parts.map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`表の${name}は0より大きい数値配列で指定してください。`);
  }
  return values;
}

function sourceSizedTableData(
  data: EditableTableData,
  tag: string,
  renderedFrame: { w: number; h: number },
  hasSizeOverride: { w: boolean; h: boolean },
): EditableTableData {
  const sourceWidths = data.columnWidths
    ? staticPositiveNumberArrayAttribute(tag, "columnWidths")
    : undefined;
  const sourceHeights = data.rowHeights
    ? staticPositiveNumberArrayAttribute(tag, "rowHeights")
    : undefined;
  const sourceWidth =
    sourceWidths?.reduce((total, value) => total + value, 0) ??
    staticPositiveNumberAttribute(tag, "w") ??
    (hasSizeOverride.w ? undefined : renderedFrame.w);
  const sourceHeight =
    sourceHeights?.reduce((total, value) => total + value, 0) ??
    staticPositiveNumberAttribute(tag, "h") ??
    (hasSizeOverride.h ? undefined : renderedFrame.h);
  if (data.columnWidths && sourceWidth === undefined) {
    throw new Error(
      "元の表幅を確認できないため列幅を保存できません。先に位置調整を焼き込んでください。",
    );
  }
  if (data.rowHeights && sourceHeight === undefined) {
    throw new Error(
      "元の表高さを確認できないため行高を保存できません。先に位置調整を焼き込んでください。",
    );
  }
  return {
    rows: data.rows,
    ...(data.columnWidths && sourceWidth !== undefined
      ? {
          columnWidths: scaleTableDimensions(
            data.columnWidths,
            renderedFrame.w,
            sourceWidth,
          ),
        }
      : {}),
    ...(data.rowHeights && sourceHeight !== undefined
      ? {
          rowHeights: scaleTableDimensions(
            data.rowHeights,
            renderedFrame.h,
            sourceHeight,
          ),
        }
      : {}),
  };
}

async function elementSizeOverride(
  deckDirectory: string,
  slideId: string,
  elementId: string,
): Promise<{ w: boolean; h: boolean }> {
  try {
    const parsed = JSON.parse(
      await readFile(join(deckDirectory, "layout.overrides.json"), "utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object") return { w: false, h: false };
    const slides = (parsed as Record<string, unknown>).slides;
    if (!slides || typeof slides !== "object") return { w: false, h: false };
    const elements = (slides as Record<string, unknown>)[slideId];
    if (!elements || typeof elements !== "object") return { w: false, h: false };
    const frame = (elements as Record<string, unknown>)[elementId];
    if (!frame || typeof frame !== "object") return { w: false, h: false };
    return { w: true, h: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { w: false, h: false };
    }
    throw new Error("位置調整データを安全に読み取れません。", { cause: error });
  }
}

type EditableScalar = string | number | boolean | null;

type EditableTableCell =
  | EditableScalar
  | {
      value: EditableScalar;
      fill?: string;
      align?: "left" | "center" | "right";
      verticalAlign?: "top" | "middle" | "bottom";
      colSpan?: number;
      rowSpan?: number;
      numberFormat?: "integer" | "decimal" | "percent" | "currency-jpy";
    };

interface EditableTableData {
  rows: EditableTableCell[][];
  columnWidths?: number[];
  rowHeights?: number[];
}

function positiveNumberList(value: unknown, label: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0,
    )
  ) {
    throw new Error(`${label}は0より大きい数値の一覧で入力してください。`);
  }
  return value as number[];
}

function validateTableCell(cell: unknown): EditableTableCell {
  if (
    cell === null ||
    typeof cell === "string" ||
    typeof cell === "boolean" ||
    (typeof cell === "number" && Number.isFinite(cell))
  ) {
    return cell;
  }
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
    throw new Error("表のセルには文字、数値、真偽値またはセル設定を入力できます。");
  }
  const input = cell as Record<string, unknown>;
  const allowed = new Set([
    "value",
    "fill",
    "backgroundColor",
    "align",
    "verticalAlign",
    "colSpan",
    "rowSpan",
    "numberFormat",
  ]);
  const unknownKey = Object.keys(input).find((key) => !allowed.has(key));
  if (unknownKey)
    throw new Error(`表のセル設定「${unknownKey}」には対応していません。`);
  const rawValue = input.value ?? null;
  if (
    rawValue !== null &&
    typeof rawValue !== "string" &&
    typeof rawValue !== "boolean" &&
    (typeof rawValue !== "number" || !Number.isFinite(rawValue))
  ) {
    throw new Error("表のセル値を確認してください。");
  }
  const fill = input.fill ?? input.backgroundColor;
  if (
    fill !== undefined &&
    (typeof fill !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(fill))
  ) {
    throw new Error("セル背景色は#RRGGBB形式で入力してください。");
  }
  if (
    input.align !== undefined &&
    input.align !== "left" &&
    input.align !== "center" &&
    input.align !== "right"
  ) {
    throw new Error("セルの横位置を確認してください。");
  }
  if (
    input.verticalAlign !== undefined &&
    input.verticalAlign !== "top" &&
    input.verticalAlign !== "middle" &&
    input.verticalAlign !== "bottom"
  ) {
    throw new Error("セルの縦位置を確認してください。");
  }
  for (const name of ["colSpan", "rowSpan"] as const) {
    const span = input[name];
    if (
      span !== undefined &&
      (typeof span !== "number" ||
        !Number.isInteger(span) ||
        span <= 0 ||
        span > MAX_TABLE_CELL_SPAN)
    ) {
      throw new Error(`${name}は1〜${MAX_TABLE_CELL_SPAN}の整数で入力してください。`);
    }
  }
  const format = input.numberFormat;
  if (
    format !== undefined &&
    format !== "integer" &&
    format !== "decimal" &&
    format !== "percent" &&
    format !== "currency-jpy"
  ) {
    throw new Error("セルの数値形式を確認してください。");
  }
  if (format !== undefined && typeof rawValue !== "number") {
    throw new Error("数値形式を使うセルには数値を入力してください。");
  }
  return {
    value: rawValue as EditableScalar,
    ...(typeof fill === "string" ? { fill } : {}),
    ...(input.align ? { align: input.align as "left" | "center" | "right" } : {}),
    ...(input.verticalAlign
      ? { verticalAlign: input.verticalAlign as "top" | "middle" | "bottom" }
      : {}),
    ...(typeof input.colSpan === "number" ? { colSpan: input.colSpan } : {}),
    ...(typeof input.rowSpan === "number" ? { rowSpan: input.rowSpan } : {}),
    ...(format
      ? {
          numberFormat: format as "integer" | "decimal" | "percent" | "currency-jpy",
        }
      : {}),
  };
}

function validateTableData(
  value: unknown,
  frame: { w: number; h: number },
): EditableTableData {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { rows: value };
  const rowsValue = input.rows;
  if (
    !Array.isArray(rowsValue) ||
    rowsValue.length === 0 ||
    !rowsValue.every(Array.isArray)
  ) {
    throw new Error("表データは1行以上の配列で入力してください。");
  }
  if (
    rowsValue.length > 500 ||
    rowsValue.some((row) => row.length > MAX_TABLE_GRID_COLUMNS)
  ) {
    throw new Error(`表は500行・${MAX_TABLE_GRID_COLUMNS}列以内で入力してください。`);
  }
  const rows = rowsValue.map((row) => row.map(validateTableCell));
  const columnWidths = positiveNumberList(input.columnWidths, "列幅");
  const rowHeights = positiveNumberList(input.rowHeights, "行の高さ");
  const grid = validateTableGrid(
    rows.map((row) => ({
      cells: row.map((cell) =>
        cell && typeof cell === "object" && !Array.isArray(cell) ? cell : {},
      ),
    })),
  );
  if (!grid.success) {
    if (grid.issue.code === "empty-row") {
      throw new Error("表の各行には1つ以上のセルが必要です。");
    }
    if (grid.issue.code === "row-span-out-of-bounds") {
      throw new Error("縦結合が表の最終行を越えています。");
    }
    if (grid.issue.code === "cell-does-not-fit") {
      throw new Error("結合セルが重なるか、セルが表の列グリッドからはみ出しています。");
    }
    throw new Error(grid.issue.message);
  }
  if (columnWidths && columnWidths.length !== grid.columnCount) {
    throw new Error(`列幅は${grid.columnCount}件入力してください。`);
  }
  if (columnWidths && !tableDimensionsMatch(columnWidths, frame.w)) {
    throw new Error(`列幅の合計を表の幅${frame.w}に合わせてください。`);
  }
  if (rowHeights && rowHeights.length !== rows.length) {
    throw new Error(`行の高さは${rows.length}件入力してください。`);
  }
  if (rowHeights && !tableDimensionsMatch(rowHeights, frame.h)) {
    throw new Error(`行の高さの合計を表の高さ${frame.h}に合わせてください。`);
  }
  return {
    rows,
    ...(columnWidths ? { columnWidths } : {}),
    ...(rowHeights ? { rowHeights } : {}),
  };
}

interface EditableChartSeries {
  name: string;
  labels: string[];
  values: number[];
  color?: string;
  chartType?: "bar" | "line" | "area" | "scatter";
}

function validateChartData(value: unknown): EditableChartSeries[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("グラフには1系列以上のデータが必要です。");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("グラフ系列の形式を確認してください。");
    }
    const series = candidate as Record<string, unknown>;
    if (
      typeof series.name !== "string" ||
      !Array.isArray(series.labels) ||
      !series.labels.every((label) => typeof label === "string") ||
      !Array.isArray(series.values) ||
      !series.values.every(
        (number) => typeof number === "number" && Number.isFinite(number),
      ) ||
      series.labels.length === 0 ||
      series.labels.length !== series.values.length
    ) {
      throw new Error("系列名と、1件以上で同じ件数のラベル・数値を入力してください。");
    }
    const name = series.name.trim();
    if (!name) throw new Error("系列名を入力してください。");
    const color = series.color;
    if (
      color !== undefined &&
      (typeof color !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color))
    ) {
      throw new Error("系列色は#RRGGBB形式で入力してください。");
    }
    const chartType = series.chartType ?? series.type;
    if (
      chartType !== undefined &&
      chartType !== "bar" &&
      chartType !== "line" &&
      chartType !== "area" &&
      chartType !== "scatter"
    ) {
      throw new Error("系列のグラフ種類を確認してください。");
    }
    return {
      name,
      labels: series.labels as string[],
      values: series.values as number[],
      ...(typeof color === "string" ? { color } : {}),
      ...(chartType ? { chartType } : {}),
    };
  });
}

interface EditableChartData {
  series: EditableChartSeries[];
  categoryAxisTitle?: string;
  valueAxisTitle?: string;
  valueUnit?: string;
  showLegend?: boolean;
  legendPosition?: "top" | "bottom" | "left" | "right";
  showValue?: boolean;
  showCategoryName?: boolean;
}

function optionalChartText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > 120) {
    throw new Error(`${label}は120文字以内で入力してください。`);
  }
  return value.trim() || undefined;
}

function chartContractMessage(code: ChartContractIssueCode): string {
  switch (code) {
    case "single-series-required":
      return "円グラフとドーナツグラフは1系列で入力してください。";
    case "combo-scatter-unsupported":
      return "複合グラフでは散布図系列を使用できません。散布図は単独のグラフにしてください。";
    case "category-labels-mismatch":
      return "カテゴリ型グラフの全系列でラベルを同じ順序・内容にしてください。";
    case "pie-negative-value":
      return "円グラフとドーナツグラフの値は0以上で入力してください。";
    case "pie-all-zero":
      return "円グラフとドーナツグラフには0より大きい値を1件以上入力してください。";
    case "scatter-label-not-numeric":
      return "散布図のラベルには有限の数値を入力してください。";
  }
}

function validateChartPayload(
  value: unknown,
  chartType: ChartTypeIR,
): EditableChartData {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { series: value };
  const result: EditableChartData = { series: validateChartData(input.series) };
  const contract = validateChartContract(chartType, result.series);
  if (!contract.success) {
    throw new Error(chartContractMessage(contract.issue.code));
  }
  const categoryAxisTitle = optionalChartText(input.categoryAxisTitle, "横軸タイトル");
  const valueAxisTitle = optionalChartText(input.valueAxisTitle, "縦軸タイトル");
  const valueUnit = optionalChartText(input.valueUnit, "単位");
  if (categoryAxisTitle) result.categoryAxisTitle = categoryAxisTitle;
  if (valueAxisTitle) result.valueAxisTitle = valueAxisTitle;
  if (valueUnit) result.valueUnit = valueUnit;
  for (const name of ["showLegend", "showValue", "showCategoryName"] as const) {
    if (input[name] !== undefined && typeof input[name] !== "boolean") {
      throw new Error(`${name}はオン・オフで指定してください。`);
    }
    if (typeof input[name] === "boolean") result[name] = input[name];
  }
  const legendPosition = input.legendPosition;
  if (
    legendPosition !== undefined &&
    legendPosition !== "top" &&
    legendPosition !== "bottom" &&
    legendPosition !== "left" &&
    legendPosition !== "right"
  ) {
    throw new Error("凡例の位置を確認してください。");
  }
  if (legendPosition) result.legendPosition = legendPosition;
  return result;
}

export async function updateStructuredElementSource(
  deckDirectory: string,
  deckIrPath: string,
  expectedHash: string,
  update: StructuredDataUpdate,
): Promise<DeckSourceState> {
  const context = await readContext(deckDirectory, deckIrPath);
  assertExpectedHash(context, expectedHash);
  assertCompilationReady(context);
  assertDeckAndSourceAgree(context);
  const slide = context.deck.slides.find(
    (candidate) => candidate.id === update.slideId,
  );
  if (!slide) throw new Error(`スライド「${update.slideId}」が見つかりません。`);
  const element = findElement(slide.elements, update.elementId);
  if (!element || (element.type !== "table" && element.type !== "chart")) {
    throw new Error(`要素「${update.elementId}」は表またはグラフではありません。`);
  }
  if (element.editable === false || element.locked) {
    throw new Error(`要素「${update.elementId}」は編集できません。`);
  }
  const sourceBlock = context.parsed.slideBlocks.find(
    (block) => block.id === update.slideId,
  );
  if (!sourceBlock) throw new Error(`スライド「${update.slideId}」が見つかりません。`);
  const component = element.type === "table" ? "Table" : "Chart";
  const tag = findComponentTag(
    context.source,
    sourceBlock,
    component,
    update.elementId,
  );
  const dataProps: Array<{ name: string; data: unknown }> = [];
  if (element.type === "table") {
    const validated = validateTableData(update.data, element.frame);
    const tableData = Array.isArray(update.data)
      ? validated
      : sourceSizedTableData(
          validated,
          tag.tag,
          element.frame,
          await elementSizeOverride(deckDirectory, update.slideId, update.elementId),
        );
    const rows = tableData.rows;
    const hasHeaders = (element.headerRows ?? 1) === 1;
    if (hasHeaders) {
      dataProps.push({ name: "headers", data: rows[0] ?? [] });
      dataProps.push({ name: "rows", data: rows.slice(1) });
    } else {
      dataProps.push({ name: "rows", data: rows });
    }
    if (tableData.columnWidths) {
      dataProps.push({ name: "columnWidths", data: tableData.columnWidths });
    }
    if (tableData.rowHeights) {
      dataProps.push({ name: "rowHeights", data: tableData.rowHeights });
    }
  } else {
    const chartData = validateChartPayload(update.data, element.chartType);
    dataProps.push({ name: "series", data: chartData.series });
    for (const name of [
      "categoryAxisTitle",
      "valueAxisTitle",
      "valueUnit",
      "showLegend",
      "legendPosition",
      "showValue",
      "showCategoryName",
    ] as const) {
      const data = chartData[name];
      if (data !== undefined) dataProps.push({ name, data });
    }
  }
  const resetDetailedSettings =
    component === "Table" ||
    Boolean(
      update.data && typeof update.data === "object" && !Array.isArray(update.data),
    );
  const nextTag = replaceDataProps(
    tag.tag,
    component,
    dataProps,
    resetDetailedSettings,
  );
  const nextSource = `${context.source.slice(0, tag.start)}${nextTag}${context.source.slice(tag.end)}`;
  const nextHash = await atomicReplace(context.sourcePath, context.source, nextSource);
  markCompilationPending(context, nextHash);
  return {
    editable: false,
    sourceHash: nextHash,
    sourceFile: basename(context.sourcePath),
    slideIds: context.parsed.slideBlocks.map((candidate) => candidate.id),
    reason: "変更を反映しています。",
  };
}
