import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

import {
  type ElementIR,
  parseDeckIR,
  type SourceLocation,
  type TextElementIR,
} from "@editable-slides/slide-deck-ir";

export interface TextSourceUpdate {
  slideId: string;
  elementId: string;
  text: string;
}

export interface SavedTextSource extends TextSourceUpdate {
  sourcePath: string;
}

function isWithin(parent: string, candidate: string): boolean {
  const normalizedParent = `${resolve(parent)}${sep}`;
  return resolve(candidate).startsWith(normalizedParent);
}

function findElement(
  elements: readonly ElementIR[],
  elementId: string,
): ElementIR | undefined {
  for (const element of elements) {
    if (element.id === elementId) return element;
    if (element.type === "group") {
      const nested = findElement(element.children, elementId);
      if (nested) return nested;
    }
  }
  return undefined;
}

function lineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function offsetAt(
  source: string,
  offsets: readonly number[],
  line: number,
  column: number,
): number {
  const lineOffset = offsets[line - 1];
  if (lineOffset === undefined) {
    throw new Error(`Source location line ${line} is outside the MDX document.`);
  }
  const offset = lineOffset + column - 1;
  if (offset < lineOffset || offset > source.length) {
    throw new Error(`Source location column ${column} is outside line ${line}.`);
  }
  return offset;
}

function sourceRange(
  source: string,
  location: SourceLocation,
): { start: number; end: number } {
  if (!location.endLine || !location.endColumn) {
    throw new Error(
      "This text element does not have a complete source range. Recompile the deck before editing it.",
    );
  }
  const offsets = lineOffsets(source);
  const start = offsetAt(source, offsets, location.line, location.column);
  const end = offsetAt(source, offsets, location.endLine, location.endColumn);
  if (end <= start) {
    throw new Error("The text element source range is empty or reversed.");
  }
  return { start, end };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimmedRange(
  source: string,
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  const value = source.slice(start, end);
  const leading = value.match(/^\s*/)?.[0].length ?? 0;
  const trailing = value.match(/\s*$/)?.[0].length ?? 0;
  const trimmedStart = start + leading;
  const trimmedEnd = end - trailing;
  return trimmedEnd > trimmedStart
    ? { start: trimmedStart, end: trimmedEnd }
    : undefined;
}

function slideContentRange(
  source: string,
  slideId: string,
): { start: number; end: number } {
  const opening = new RegExp(
    `<Slide\\b(?=[^>]*\\bid\\s*=\\s*["']${escapeRegex(slideId)}["'])[^>]*>`,
    "g",
  ).exec(source);
  if (!opening || opening.index === undefined) {
    return { start: 0, end: source.length };
  }
  const start = opening.index + opening[0].length;
  const closing = source.indexOf("</Slide>", start);
  if (closing < 0) {
    throw new Error(`Slide "${slideId}" no longer has a closing </Slide> tag.`);
  }
  return { start, end: closing };
}

function titleRange(
  source: string,
  slideRange: { start: number; end: number },
): { start: number; end: number } | undefined {
  const content = source.slice(slideRange.start, slideRange.end);
  const heading = /^#(?!#)[ \t]+.*$/m.exec(content);
  if (!heading || heading.index === undefined) return undefined;
  return {
    start: slideRange.start + heading.index,
    end: slideRange.start + heading.index + heading[0].length,
  };
}

function componentRange(
  source: string,
  slideRange: { start: number; end: number },
  component: "Slot" | "Text",
  prop: "name" | "id",
  value: string,
): { start: number; end: number } | undefined {
  const content = source.slice(slideRange.start, slideRange.end);
  const openingPattern = new RegExp(
    `<${component}\\b(?=[^>]*\\b${prop}\\s*=\\s*["']${escapeRegex(value)}["'])[^>]*>`,
    "g",
  );
  const matches = [...content.matchAll(openingPattern)];
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new Error(
      `${component} ${prop}="${value}" is declared more than once and cannot be edited safely.`,
    );
  }
  const opening = matches[0];
  if (!opening || opening.index === undefined) return undefined;
  const start = slideRange.start + opening.index;
  const closingTag = `</${component}>`;
  const closingStart = source.indexOf(closingTag, start + opening[0].length);
  if (closingStart < 0 || closingStart > slideRange.end) {
    throw new Error(
      `${component} ${prop}="${value}" no longer has a closing ${closingTag} tag.`,
    );
  }
  return component === "Text"
    ? { start, end: closingStart + closingTag.length }
    : trimmedRange(source, start + opening[0].length, closingStart);
}

function bodyRange(
  source: string,
  slideRange: { start: number; end: number },
): { start: number; end: number } | undefined {
  const title = titleRange(source, slideRange);
  const start = title?.end ?? slideRange.start;
  const content = source.slice(start, slideRange.end);
  const nextComponent = /^\s*<[A-Z][A-Za-z0-9]*(?:\s|>)/m.exec(content);
  return trimmedRange(
    source,
    start,
    nextComponent?.index === undefined ? slideRange.end : start + nextComponent.index,
  );
}

function structuralSourceRange(
  source: string,
  slideId: string,
  element: TextElementIR,
): { start: number; end: number } | undefined {
  const slideRange = slideContentRange(source, slideId);
  if (element.id === `${slideId}--title`) {
    return titleRange(source, slideRange);
  }
  if (element.id === `${slideId}--body`) {
    return bodyRange(source, slideRange);
  }
  const generatedPrefix = `${slideId}--`;
  if (element.id.startsWith(generatedPrefix)) {
    const slotName = element.id.slice(generatedPrefix.length);
    const slot = componentRange(source, slideRange, "Slot", "name", slotName);
    if (slot) return slot;
  }
  return componentRange(source, slideRange, "Text", "id", element.id);
}

function normalizeMarkdown(text: string): string {
  if (text.includes("\0")) {
    throw new Error("Text may not contain a null byte.");
  }
  return text.replace(/\r\n?/g, "\n").trim();
}

function titleReplacement(original: string, text: string): string {
  const match = /^(\s{0,3}#{1,6}[ \t]+)([\s\S]*?)([ \t]*)$/.exec(original);
  if (!match) {
    throw new Error("The title source is no longer a Markdown heading.");
  }
  const title = text.replace(/\s*\n+\s*/g, " ").trim();
  if (!title) throw new Error("A slide title may not be empty.");
  return `${match[1]}${title}${match[3]}`;
}

function textComponentReplacement(original: string, text: string): string {
  const openingEnd = original.indexOf(">");
  const closingStart = original.lastIndexOf("</Text>");
  if (openingEnd < 0 || closingStart <= openingEnd) {
    throw new Error("The Text component source is no longer structurally editable.");
  }
  const opening = original.slice(0, openingEnd + 1);
  const closing = original.slice(closingStart);
  const normalized = normalizeMarkdown(text);
  return `${opening}\n\n${normalized}\n\n${closing}`;
}

function replacementFor(
  element: TextElementIR,
  original: string,
  text: string,
): string {
  if (element.role === "title" && /^\s{0,3}#/.test(original)) {
    return titleReplacement(original, text);
  }
  if (/^\s*<Text(?:\s|>)/.test(original)) {
    return textComponentReplacement(original, text);
  }
  if (/<\/?[A-Z][A-Za-z0-9]*(?:\s|>)/.test(original)) {
    throw new Error(
      "This source range also contains an MDX component and cannot be edited safely in the visual editor.",
    );
  }
  const normalized = normalizeMarkdown(text);
  if (!normalized) throw new Error("Text may not be empty.");
  return normalized;
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function updateTextElementSource(
  deckDirectory: string,
  deckIrPath: string,
  update: TextSourceUpdate,
): Promise<SavedTextSource> {
  const deck = parseDeckIR(JSON.parse(await readFile(deckIrPath, "utf8")) as unknown);
  const slide = deck.slides.find((candidate) => candidate.id === update.slideId);
  if (!slide) throw new Error(`Slide "${update.slideId}" was not found.`);

  const element = findElement(slide.elements, update.elementId);
  if (!element) {
    throw new Error(
      `Element "${update.elementId}" was not found on slide "${update.slideId}".`,
    );
  }
  if (element.type !== "text") {
    throw new Error(`Element "${update.elementId}" is not a text element.`);
  }
  if (element.editable === false || element.locked) {
    throw new Error(`Element "${update.elementId}" is not editable.`);
  }

  const sourcePath = isAbsolute(element.sourceLocation.file)
    ? resolve(element.sourceLocation.file)
    : resolve(deckDirectory, element.sourceLocation.file);
  if (!isWithin(deckDirectory, sourcePath)) {
    throw new Error("The text source is outside the configured deck directory.");
  }
  if (!sourcePath.endsWith(".mdx")) {
    throw new Error("Only MDX text sources can be edited.");
  }

  const source = await readFile(sourcePath, "utf8");
  const range =
    structuralSourceRange(source, update.slideId, element) ??
    sourceRange(source, element.sourceLocation);
  const original = source.slice(range.start, range.end);
  const replacement = replacementFor(element, original, update.text);
  await atomicWrite(
    sourcePath,
    `${source.slice(0, range.start)}${replacement}${source.slice(range.end)}`,
  );
  return { ...update, sourcePath };
}
