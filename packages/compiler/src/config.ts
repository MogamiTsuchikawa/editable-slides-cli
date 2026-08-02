import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { createDiagnostic, DeckCompileError } from "./diagnostics.js";
import {
  DATA_FILE_POLICIES,
  isSafeWebUrl,
  MAX_DATA_SOURCE_BYTES,
  readSecureDeckEntryFile,
  readSecureDeckFile,
  SecurityValidationError,
} from "./security.js";
import type {
  DeckConfig,
  DeckMdxConfig,
  LayoutOverrides,
  SlideFrontmatter,
} from "./types.js";

const idSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "IDs must start with a lowercase letter or number and contain a-z, 0-9, _ or -",
  );

const languageSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, "language must be a valid BCP 47 language tag such as ja-JP or en-US");

const webUrlSchema = z
  .string()
  .refine(isSafeWebUrl, "URL must use http or https without embedded credentials");

export const DeckConfigSchema: z.ZodType<DeckConfig> = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    title: z.string().min(1),
    author: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    theme: z.string().min(1).default("default"),
    canvas: z.literal("wide").default("wide"),
    language: languageSchema.default("ja-JP"),
    strictEditable: z.boolean().default(true),
    slides: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((config, context) => {
    const seen = new Set<string>();
    for (const [index, slidePath] of config.slides.entries()) {
      if (seen.has(slidePath)) {
        context.addIssue({
          code: "custom",
          path: ["slides", index],
          message: `Slide path is listed more than once: ${slidePath}`,
        });
      }
      seen.add(slidePath);
    }
  });

export const SlideFrontmatterSchema: z.ZodType<SlideFrontmatter> = z
  .object({
    id: idSchema,
    layout: z.string().min(1).default("title-body"),
    notes: z.string().default(""),
    sources: z
      .array(
        z
          .object({
            label: z.string().min(1),
            url: webUrlSchema.optional(),
          })
          .strict(),
      )
      .default([]),
    masterId: z.string().min(1).optional(),
    background: z
      .object({
        src: z.string().min(1),
        fit: z.enum(["stretch", "contain", "cover"]).default("cover"),
        focalPosition: z
          .object({
            x: z.number().finite().min(0).max(1),
            y: z.number().finite().min(0).max(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const DeckMdxConfigSchema: z.ZodType<DeckMdxConfig> = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    title: z.string().min(1),
    author: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    theme: z.string().min(1).default("default"),
    canvas: z.literal("wide").default("wide"),
    language: languageSchema.default("ja-JP"),
    strictEditable: z.boolean().default(true),
    slides: z.array(SlideFrontmatterSchema).min(1),
  })
  .strict()
  .superRefine((config, context) => {
    const seen = new Set<string>();
    for (const [index, slide] of config.slides.entries()) {
      if (seen.has(slide.id)) {
        context.addIssue({
          code: "custom",
          path: ["slides", index, "id"],
          message: `Slide id is listed more than once: ${slide.id}`,
        });
      }
      seen.add(slide.id);
    }
  });

const overrideValueSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    w: z.number().finite().positive().optional(),
    h: z.number().finite().positive().optional(),
    rotation: z.number().finite().optional(),
    zIndex: z.number().int().optional(),
  })
  .strict();

export const LayoutOverridesSchema: z.ZodType<LayoutOverrides> = z
  .object({
    schemaVersion: z.literal(1),
    slides: z.record(z.string(), z.record(z.string(), overrideValueSchema)),
  })
  .strict();

async function readYamlFile(filePath: string): Promise<unknown> {
  const source = (await readSecureDeckEntryFile(filePath)).data.toString("utf8");
  return parseYaml(source) as unknown;
}

function zodErrorMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

export async function readDeckConfig(configPath: string): Promise<DeckConfig> {
  try {
    return DeckConfigSchema.parse(await readYamlFile(configPath));
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      throw new DeckCompileError(
        error.issues.map((issue) =>
          createDiagnostic({
            severity: "error",
            code: issue.code,
            message: `Deck source: ${issue.message}`,
            sourceLocation: { file: configPath, line: 1, column: 1 },
          }),
        ),
      );
    }
    const message =
      error instanceof z.ZodError
        ? zodErrorMessage(error)
        : error instanceof Error
          ? error.message
          : String(error);
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "DECK_CONFIG_INVALID",
        message,
        sourceLocation: { file: configPath, line: 1, column: 1 },
      }),
    ]);
  }
}

export async function readLayoutOverrides(
  deckDirectory: string,
): Promise<LayoutOverrides> {
  const overridePath = path.join(deckDirectory, "layout.overrides.json");
  try {
    const overrideFile = await readSecureDeckFile({
      deckDirectory,
      sourcePath: path.join(deckDirectory, "deck.mdx"),
      reference: "layout.overrides.json",
      allowedExtensions: DATA_FILE_POLICIES,
      defaultMaxBytes: MAX_DATA_SOURCE_BYTES,
    });
    return LayoutOverridesSchema.parse(
      JSON.parse(overrideFile.data.toString("utf8")) as unknown,
    );
  } catch (error) {
    if (
      error instanceof SecurityValidationError &&
      error.issues.every((issue) => issue.code === "ASSET_NOT_FOUND")
    ) {
      return { schemaVersion: 1, slides: {} };
    }
    if (error instanceof SecurityValidationError) {
      throw new DeckCompileError(
        error.issues.map((issue) =>
          createDiagnostic({
            severity: "error",
            code: issue.code,
            message: `Layout overrides: ${issue.message}`,
            sourceLocation: { file: overridePath, line: 1, column: 1 },
          }),
        ),
      );
    }
    const message =
      error instanceof z.ZodError
        ? zodErrorMessage(error)
        : error instanceof Error
          ? error.message
          : String(error);
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "LAYOUT_OVERRIDES_INVALID",
        message,
        sourceLocation: { file: overridePath, line: 1, column: 1 },
      }),
    ]);
  }
}

export function resolveDeckLocalPath(
  deckDirectory: string,
  relativePath: string,
): string | undefined {
  if (
    relativePath.includes("\0") ||
    relativePath.trim() === "" ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.startsWith("//") ||
    relativePath.startsWith("\\\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(relativePath)
  ) {
    return undefined;
  }
  const resolved = path.resolve(deckDirectory, relativePath);
  const relative = path.relative(deckDirectory, resolved);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return resolved;
  }
  return undefined;
}
