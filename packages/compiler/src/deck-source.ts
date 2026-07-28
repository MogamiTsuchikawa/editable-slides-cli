import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { readDeckConfig } from "./config.js";
import { parseDeckMdx } from "./deck-mdx.js";
import { createDiagnostic, DeckCompileError } from "./diagnostics.js";
import type { DeckConfig, DeckMdxConfig } from "./types.js";

export async function resolveDeckEntry(deckDirectory: string): Promise<string> {
  const absoluteDirectory = path.resolve(deckDirectory);
  const deckMdxPath = path.join(absoluteDirectory, "deck.mdx");
  try {
    await access(deckMdxPath);
    return deckMdxPath;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  return path.join(absoluteDirectory, "deck.yaml");
}

export async function readDeckSourceConfig(
  entryPath: string,
): Promise<DeckConfig | DeckMdxConfig> {
  const absoluteEntryPath = path.resolve(entryPath);
  const extension = path.extname(absoluteEntryPath).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    return readDeckConfig(absoluteEntryPath);
  }
  if (extension !== ".mdx") {
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "DECK_SOURCE_EXTENSION_INVALID",
        message: "Deck source must be deck.mdx, deck.yaml or deck.yml",
        sourceLocation: { file: absoluteEntryPath, line: 1, column: 1 },
      }),
    ]);
  }

  try {
    const source = await readFile(absoluteEntryPath, "utf8");
    return parseDeckMdx(source, absoluteEntryPath).config;
  } catch (error) {
    if (error instanceof DeckCompileError) {
      throw error;
    }
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "DECK_MDX_READ_FAILED",
        message: error instanceof Error ? error.message : String(error),
        sourceLocation: { file: absoluteEntryPath, line: 1, column: 1 },
      }),
    ]);
  }
}
