import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  DeckConfigSchema,
  DeckMdxConfigSchema,
  type SlideFrontmatter,
  SlideFrontmatterSchema,
} from "@livetoon/slide-compiler";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function readDeckLocalText(
  deckDirectory: string,
  relativePath: string,
): Promise<string> {
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    throw new Error(`資料外のファイルは移行できません: ${relativePath}`);
  }
  const root = await realpath(deckDirectory);
  const requested = path.resolve(root, relativePath);
  if (!isWithin(root, requested)) {
    throw new Error(`資料外のファイルは移行できません: ${relativePath}`);
  }
  const link = await lstat(requested);
  if (link.isSymbolicLink()) {
    throw new Error(`シンボリックリンクは移行できません: ${relativePath}`);
  }
  const canonical = await realpath(requested);
  if (!isWithin(root, canonical)) {
    throw new Error(`資料外のファイルは移行できません: ${relativePath}`);
  }
  const metadata = await stat(canonical);
  if (!metadata.isFile()) {
    throw new Error(`通常のファイルではありません: ${relativePath}`);
  }
  if (metadata.size > MAX_SOURCE_BYTES) {
    throw new Error(
      `ファイルが大きすぎます: ${relativePath} (${metadata.size} bytes、上限 ${MAX_SOURCE_BYTES} bytes)`,
    );
  }
  return readFile(canonical, "utf8");
}

function parseLegacySlide(
  source: string,
  sourcePath: string,
): {
  metadata: SlideFrontmatter;
  body: string;
} {
  const match = FRONTMATTER.exec(source);
  if (!match?.[1]) {
    throw new Error(`ページの設定欄が見つかりません: ${sourcePath}`);
  }
  const metadata = SlideFrontmatterSchema.parse(parseYaml(match[1]) as unknown);
  const body = source.slice(match[0].length).trim();
  if (!body) {
    throw new Error(`ページ本文が空です: ${sourcePath}`);
  }
  if (/<\/?(?:Slide|Assets|Asset)\b/.test(body)) {
    throw new Error(`単一ファイル専用の要素が既に含まれています: ${sourcePath}`);
  }
  return { metadata, body };
}

export interface LegacyMigrationResult {
  source: string;
  slideCount: number;
  sourceFiles: string[];
}

/**
 * Builds deck.mdx from the legacy deck.yaml + slides/*.mdx representation.
 * Existing source files are read only and intentionally remain in place.
 */
export async function migrateLegacyDeckSource(
  deckDirectory: string,
): Promise<LegacyMigrationResult> {
  const configSource = await readDeckLocalText(deckDirectory, "deck.yaml");
  const legacy = DeckConfigSchema.parse(parseYaml(configSource) as unknown);
  const slides: Array<{ metadata: SlideFrontmatter; body: string; file: string }> = [];
  for (const slidePath of legacy.slides) {
    const source = await readDeckLocalText(deckDirectory, slidePath);
    const parsed = parseLegacySlide(source, slidePath);
    slides.push({ ...parsed, file: slidePath });
  }

  const config = DeckMdxConfigSchema.parse({
    ...legacy,
    slides: slides.map((slide) => slide.metadata),
  });
  const yaml = stringifyYaml(config, { lineWidth: 0 }).trimEnd();
  const bodies = slides
    .map(
      ({ metadata, body }) =>
        `<Slide id=${JSON.stringify(metadata.id)}>\n\n${body}\n\n</Slide>`,
    )
    .join("\n\n");

  return {
    source: `---\n${yaml}\n---\n\n${bodies}\n`,
    slideCount: slides.length,
    sourceFiles: ["deck.yaml", ...slides.map((slide) => slide.file)],
  };
}
