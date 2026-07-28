export { compileDeck, compileDeckDirectory } from "./compiler.js";
export {
  DeckConfigSchema,
  DeckMdxConfigSchema,
  LayoutOverridesSchema,
  readDeckConfig,
  readLayoutOverrides,
  resolveDeckLocalPath,
  SlideFrontmatterSchema,
} from "./config.js";
export {
  type DeckMdxSlide,
  type ParsedDeckMdx,
  parseDeckMdx,
} from "./deck-mdx.js";
export {
  readDeckSourceConfig,
  resolveDeckEntry,
} from "./deck-source.js";
export { createDiagnostic, DeckCompileError } from "./diagnostics.js";
export {
  calculateDeckContentHash,
  serializeDeck,
  stableStringify,
} from "./serialize.js";
export {
  evaluateStaticExpression,
  type StaticValue,
} from "./static-expression.js";
export type {
  CompileDeckOptions,
  CompileDeckResult,
  DeckConfig,
  DeckMdxConfig,
  ElementLayoutOverride,
  EmbeddedAsset,
  LayoutOverrides,
  SlideFrontmatter,
} from "./types.js";
