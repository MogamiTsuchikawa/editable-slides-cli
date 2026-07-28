import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { createDiagnostic, DeckCompileError } from "./diagnostics.js";
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

export const DeckConfigSchema: z.ZodType<DeckConfig> = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    title: z.string().min(1),
    author: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    theme: z.string().min(1).default("default"),
    canvas: z.literal("wide").default("wide"),
    language: z.string().min(1).default("ja-JP"),
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
            url: z.string().url().optional(),
          })
          .strict(),
      )
      .default([]),
    masterId: z.string().min(1).optional(),
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
    language: z.string().min(1).default("ja-JP"),
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
  const source = await readFile(filePath, "utf8");
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
    const source = await readFile(overridePath, "utf8");
    return LayoutOverridesSchema.parse(JSON.parse(source) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { schemaVersion: 1, slides: {} };
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
  if (relativePath.includes("\0")) {
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
