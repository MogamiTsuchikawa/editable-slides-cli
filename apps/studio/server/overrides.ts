import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  emptyOverrides,
  type FrameOverride,
  OVERRIDE_SCHEMA_VERSION,
  type OverrideDocument,
} from "../src/overrides.js";

const FRAME_KEYS = ["x", "y", "w", "h", "rotation", "zIndex"] as const;

function normalizedNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Object.is(value, -0) ? 0 : Math.round(value * 1_000) / 1_000;
}

export function normalizeOverrideDocument(value: unknown): OverrideDocument {
  if (!value || typeof value !== "object") return emptyOverrides();
  const candidate = value as Record<string, unknown>;
  if (!candidate.slides || typeof candidate.slides !== "object") {
    return emptyOverrides();
  }
  const slides: OverrideDocument["slides"] = {};
  const slideEntries = Object.entries(candidate.slides as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  for (const [slideId, rawElements] of slideEntries) {
    if (!rawElements || typeof rawElements !== "object") continue;
    const normalizedElements: Record<string, FrameOverride> = {};
    const elementEntries = Object.entries(rawElements as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );

    for (const [elementId, rawFrame] of elementEntries) {
      if (!rawFrame || typeof rawFrame !== "object") continue;
      const frame = rawFrame as Record<string, unknown>;
      const values = Object.fromEntries(
        FRAME_KEYS.map((key) => [key, normalizedNumber(frame[key])]),
      ) as Record<(typeof FRAME_KEYS)[number], number | undefined>;
      if (FRAME_KEYS.some((key) => values[key] === undefined)) continue;
      normalizedElements[elementId] = {
        x: values.x as number,
        y: values.y as number,
        w: Math.max(0, values.w as number),
        h: Math.max(0, values.h as number),
        rotation: values.rotation as number,
        zIndex: values.zIndex as number,
      };
    }
    if (Object.keys(normalizedElements).length > 0) {
      slides[slideId] = normalizedElements;
    }
  }
  return { schemaVersion: OVERRIDE_SCHEMA_VERSION, slides };
}

export function serializeOverrideDocument(value: unknown): string {
  return `${JSON.stringify(normalizeOverrideDocument(value), null, 2)}\n`;
}

export async function readOverrideDocument(
  filePath: string,
): Promise<OverrideDocument> {
  try {
    return normalizeOverrideDocument(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyOverrides();
    throw error;
  }
}

export async function writeOverrideDocumentAtomic(
  filePath: string,
  value: unknown,
): Promise<OverrideDocument> {
  const document = normalizeOverrideDocument(value);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(temporaryPath, serializeOverrideDocument(document), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return document;
}
