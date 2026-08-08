import { createHash } from "node:crypto";
import path from "node:path";

import type { DeckIR } from "@editable-slides/slide-deck-ir";

function normalizeForHash(value: unknown, deckDirectory: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item, deckDirectory));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "diagnostics" || key === "contentHash") {
        continue;
      }
      if (
        (key === "sourcePath" || key === "src" || key === "file") &&
        typeof child === "string" &&
        path.isAbsolute(child)
      ) {
        result[key] = path.relative(deckDirectory, child);
      } else {
        result[key] = normalizeForHash(child, deckDirectory);
      }
    }
    return result;
  }
  return value;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown, indentation = 2): string {
  return JSON.stringify(sortKeys(value), null, indentation);
}

export function calculateDeckContentHash(
  deck: Omit<DeckIR, "contentHash"> & { contentHash?: string },
  deckDirectory: string,
): string {
  return createHash("sha256")
    .update(stableStringify(normalizeForHash(deck, deckDirectory), 0))
    .digest("hex");
}

export function serializeDeck(deck: DeckIR): string {
  return `${stableStringify(deck)}\n`;
}
