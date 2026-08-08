import path from "node:path";

import {
  type DeckIR,
  DeckIRSchema,
  type Diagnostic,
  WIDE_CANVAS,
} from "@editable-slides/slide-deck-ir";
import {
  defaultTheme,
  type ThemeDefinition,
} from "@editable-slides/slide-theme-default";

import { readDeckConfig, readLayoutOverrides, resolveDeckLocalPath } from "./config.js";
import { parseDeckMdx } from "./deck-mdx.js";
import { resolveDeckEntry } from "./deck-source.js";
import { createDiagnostic, DeckCompileError } from "./diagnostics.js";
import { applyLayoutOverrides } from "./overrides.js";
import {
  MAX_SLIDE_SOURCE_BYTES,
  readSecureDeckEntryFile,
  readSecureDeckFile,
  SecurityValidationError,
  SLIDE_FILE_POLICIES,
} from "./security.js";
import { calculateDeckContentHash } from "./serialize.js";
import { compileSlide, compileSlideDocument } from "./slide.js";
import type {
  CompileDeckOptions,
  CompileDeckResult,
  DeckConfig,
  DeckMdxConfig,
} from "./types.js";
import { validateSlides } from "./validate.js";

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function validateThemeSelection(
  configuredTheme: string,
  suppliedTheme: ThemeDefinition | undefined,
  configPath: string,
): Diagnostic[] {
  if (suppliedTheme) {
    const declarativeTheme =
      configuredTheme === "./theme.json" || configuredTheme === "theme.json";
    if (
      configuredTheme !== suppliedTheme.ir.id &&
      configuredTheme !== "default" &&
      !declarativeTheme
    ) {
      return [
        createDiagnostic({
          severity: "error",
          code: "THEME_ID_MISMATCH",
          message: `Deck source requests theme "${configuredTheme}" but supplied theme is "${suppliedTheme.ir.id}"`,
          sourceLocation: { file: configPath, line: 1, column: 1 },
        }),
      ];
    }
    return [];
  }
  if (configuredTheme !== "default") {
    return [
      createDiagnostic({
        severity: "error",
        code: "THEME_EXTERNAL_UNSUPPORTED",
        message:
          `Theme "${configuredTheme}" requires passing a ThemeDefinition to compileDeck; ` +
          'only "default" is loaded automatically',
        sourceLocation: { file: configPath, line: 1, column: 1 },
      }),
    ];
  }
  return [];
}

export async function compileDeck(
  configPath: string,
  options: CompileDeckOptions = {},
): Promise<CompileDeckResult> {
  const absoluteConfigPath = path.resolve(configPath);
  const deckDirectory = path.dirname(absoluteConfigPath);
  const extension = path.extname(absoluteConfigPath).toLowerCase();
  let config: DeckConfig | DeckMdxConfig;
  let parsedDeckMdx: ReturnType<typeof parseDeckMdx> | undefined;
  if (extension === ".mdx") {
    try {
      const source = (await readSecureDeckEntryFile(absoluteConfigPath)).data.toString(
        "utf8",
      );
      parsedDeckMdx = parseDeckMdx(source, absoluteConfigPath);
      config = parsedDeckMdx.config;
    } catch (error) {
      if (error instanceof DeckCompileError) {
        throw error;
      }
      if (error instanceof SecurityValidationError) {
        throw new DeckCompileError(
          error.issues.map((issue) =>
            createDiagnostic({
              severity: "error",
              code: issue.code,
              message: `Deck source: ${issue.message}`,
              sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
            }),
          ),
        );
      }
      throw new DeckCompileError([
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_READ_FAILED",
          message: error instanceof Error ? error.message : String(error),
          sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
        }),
      ]);
    }
  } else if (extension === ".yaml" || extension === ".yml") {
    config = await readDeckConfig(absoluteConfigPath);
  } else {
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "DECK_SOURCE_EXTENSION_INVALID",
        message: "Deck source must be deck.mdx, deck.yaml or deck.yml",
        sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
      }),
    ]);
  }
  const theme = options.theme ?? defaultTheme;
  const diagnostics = validateThemeSelection(
    config.theme,
    options.theme,
    absoluteConfigPath,
  );
  const slides = [];

  if (parsedDeckMdx) {
    diagnostics.push(...parsedDeckMdx.diagnostics);
    for (const slideDocument of parsedDeckMdx.slides) {
      try {
        const parsed = await compileSlideDocument(
          {
            frontmatter: slideDocument.frontmatter,
            children: slideDocument.children,
          },
          absoluteConfigPath,
          deckDirectory,
          theme,
          parsedDeckMdx.assets,
        );
        slides.push(parsed.slide);
        diagnostics.push(...parsed.diagnostics);
      } catch (error) {
        if (error instanceof DeckCompileError) {
          diagnostics.push(...error.diagnostics);
        } else {
          diagnostics.push(
            createDiagnostic({
              severity: "error",
              code: "SLIDE_COMPILE_FAILED",
              message: error instanceof Error ? error.message : String(error),
              sourceLocation: {
                file: absoluteConfigPath,
                line: slideDocument.sourceNode.position?.start?.line ?? 1,
                column: slideDocument.sourceNode.position?.start?.column ?? 1,
              },
              slideId: slideDocument.frontmatter.id,
            }),
          );
        }
      }
    }
  } else {
    for (const slideReference of config.slides) {
      if (typeof slideReference !== "string") {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "SLIDE_PATH_INVALID",
            message: "deck.yaml slide entries must be .mdx paths",
            sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
          }),
        );
        continue;
      }
      const slidePath = resolveDeckLocalPath(deckDirectory, slideReference);
      if (!slidePath || path.extname(slidePath).toLowerCase() !== ".mdx") {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "SLIDE_PATH_INVALID",
            message: `Slide path must point to an .mdx file inside the deck: ${slideReference}`,
            sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
          }),
        );
        continue;
      }
      try {
        const slideFile = await readSecureDeckFile({
          deckDirectory,
          sourcePath: absoluteConfigPath,
          reference: slideReference,
          allowedExtensions: SLIDE_FILE_POLICIES,
          defaultMaxBytes: MAX_SLIDE_SOURCE_BYTES,
        });
        const parsed = await compileSlide(
          slideFile.data.toString("utf8"),
          slideFile.path,
          deckDirectory,
          theme,
        );
        slides.push(parsed.slide);
        diagnostics.push(...parsed.diagnostics);
      } catch (error) {
        if (error instanceof DeckCompileError) {
          diagnostics.push(...error.diagnostics);
        } else if (error instanceof SecurityValidationError) {
          diagnostics.push(
            ...error.issues.map((issue) =>
              createDiagnostic({
                severity: "error",
                code: issue.code,
                message: `Slide "${slideReference}": ${issue.message}`,
                sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
              }),
            ),
          );
        } else {
          diagnostics.push(
            createDiagnostic({
              severity: "error",
              code: "SLIDE_READ_FAILED",
              message: error instanceof Error ? error.message : String(error),
              sourceLocation: { file: slidePath, line: 1, column: 1 },
            }),
          );
        }
      }
    }
  }

  try {
    const overrides = await readLayoutOverrides(deckDirectory);
    diagnostics.push(...applyLayoutOverrides(slides, overrides));
  } catch (error) {
    if (error instanceof DeckCompileError) {
      diagnostics.push(...error.diagnostics);
    } else {
      throw error;
    }
  }
  diagnostics.push(...validateSlides(slides, theme));

  if (hasErrors(diagnostics)) {
    throw new DeckCompileError(diagnostics);
  }

  const partialDeck: Omit<DeckIR, "contentHash"> = {
    schemaVersion: 1,
    metadata: {
      id: config.id,
      title: config.title,
      language: config.language,
      ...(config.author ? { author: config.author } : {}),
      ...(config.company ? { company: config.company } : {}),
    },
    canvas: WIDE_CANVAS,
    theme: structuredClone(theme.ir),
    slides,
    diagnostics,
  };
  const deck: DeckIR = {
    ...partialDeck,
    contentHash: calculateDeckContentHash(partialDeck, deckDirectory),
  };
  const parsedDeck = DeckIRSchema.safeParse(deck);
  if (!parsedDeck.success) {
    const schemaDiagnostics = parsedDeck.error.issues.map((issue) =>
      createDiagnostic({
        severity: "error",
        code: "DECK_IR_INVALID",
        message: `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
      }),
    );
    throw new DeckCompileError([...diagnostics, ...schemaDiagnostics]);
  }
  if (
    options.failOnWarnings &&
    diagnostics.some((diagnostic) => diagnostic.severity === "warning")
  ) {
    throw new DeckCompileError([
      ...diagnostics,
      createDiagnostic({
        severity: "error",
        code: "WARNINGS_AS_ERRORS",
        message: "Compilation produced warnings and failOnWarnings is enabled",
        sourceLocation: { file: absoluteConfigPath, line: 1, column: 1 },
      }),
    ]);
  }

  return { deck: parsedDeck.data, diagnostics };
}

export async function compileDeckDirectory(
  deckDirectory: string,
  options?: CompileDeckOptions,
): Promise<CompileDeckResult> {
  return compileDeck(await resolveDeckEntry(deckDirectory), options);
}
