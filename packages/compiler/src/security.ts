import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_SVG_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_EMBEDDED_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_SLIDE_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_DECK_SOURCE_BYTES = 2 * 1024 * 1024;

export interface SecurityIssue {
  code: string;
  message: string;
}

export class SecurityValidationError extends Error {
  readonly issues: SecurityIssue[];

  constructor(issues: SecurityIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "SecurityValidationError";
    this.issues = issues;
  }
}

export interface DeckFileTypePolicy {
  mimeType?: string;
  maxBytes?: number;
}

export interface ReadSecureDeckFileOptions {
  deckDirectory: string;
  sourcePath: string;
  reference: string;
  allowedExtensions: Readonly<Record<string, DeckFileTypePolicy>>;
  defaultMaxBytes?: number;
}

export interface SecureDeckFile {
  path: string;
  data: Buffer;
  contentHash: string;
  extension: string;
  mimeType?: string;
}

export const IMAGE_FILE_POLICIES: Readonly<Record<string, DeckFileTypePolicy>> = {
  ".png": { mimeType: "image/png" },
  ".jpg": { mimeType: "image/jpeg" },
  ".jpeg": { mimeType: "image/jpeg" },
  ".gif": { mimeType: "image/gif" },
  ".webp": { mimeType: "image/webp" },
  ".svg": { mimeType: "image/svg+xml", maxBytes: MAX_SVG_ASSET_BYTES },
};

export const DATA_FILE_POLICIES: Readonly<Record<string, DeckFileTypePolicy>> = {
  ".json": {},
  ".csv": {},
};

export const SLIDE_FILE_POLICIES: Readonly<Record<string, DeckFileTypePolicy>> = {
  ".mdx": {},
};

export const DECK_SOURCE_FILE_POLICIES: Readonly<Record<string, DeckFileTypePolicy>> = {
  ".mdx": {},
  ".yaml": {},
  ".yml": {},
};

function issue(code: string, message: string): SecurityIssue {
  return { code, message };
}

function throwIssue(code: string, message: string): never {
  throw new SecurityValidationError([issue(code, message)]);
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function validateLocalReference(reference: string): void {
  if (reference.trim() === "") {
    throwIssue("ASSET_REFERENCE_INVALID", "Asset reference must not be empty");
  }
  if (reference.includes("\0")) {
    throwIssue(
      "ASSET_REFERENCE_INVALID",
      "Asset reference must not contain a null byte",
    );
  }
  if (
    path.isAbsolute(reference) ||
    path.win32.isAbsolute(reference) ||
    reference.startsWith("//") ||
    reference.startsWith("\\\\")
  ) {
    throwIssue(
      "ASSET_REFERENCE_ABSOLUTE_FORBIDDEN",
      "Asset references must use a relative path inside the deck",
    );
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(reference)?.[1]?.toLowerCase();
  if (scheme) {
    const remote = scheme === "http" || scheme === "https";
    throwIssue(
      remote ? "ASSET_REMOTE_REFERENCE_FORBIDDEN" : "ASSET_SCHEME_FORBIDDEN",
      remote
        ? "Remote asset URLs are forbidden; store the asset inside the deck"
        : `Asset URL scheme "${scheme}:" is forbidden`,
    );
  }
}

function filesystemMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readSecureDeckFile(
  options: ReadSecureDeckFileOptions,
): Promise<SecureDeckFile> {
  validateLocalReference(options.reference);
  const deckDirectory = path.resolve(options.deckDirectory);
  const candidate = path.resolve(path.dirname(options.sourcePath), options.reference);
  if (!isWithin(deckDirectory, candidate)) {
    throwIssue(
      "ASSET_PATH_OUTSIDE_DECK",
      "Asset path must stay inside the deck directory",
    );
  }

  let realDeckDirectory: string;
  let realCandidate: string;
  try {
    [realDeckDirectory, realCandidate] = await Promise.all([
      realpath(deckDirectory),
      realpath(candidate),
    ]);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
    throwIssue(
      code === "ENOENT" ? "ASSET_NOT_FOUND" : "ASSET_READ_FAILED",
      `Cannot resolve asset "${options.reference}": ${filesystemMessage(error)}`,
    );
  }
  if (!isWithin(realDeckDirectory, realCandidate)) {
    throwIssue(
      "ASSET_SYMLINK_OUTSIDE_DECK",
      "Asset resolves through a symbolic link outside the deck directory",
    );
  }

  const extension = path.extname(candidate).toLowerCase();
  const policy = options.allowedExtensions[extension];
  if (!policy) {
    const allowed = Object.keys(options.allowedExtensions).sort().join(", ");
    throwIssue(
      "ASSET_TYPE_UNSUPPORTED",
      `Asset extension "${extension || "(none)"}" is unsupported; allowed: ${allowed}`,
    );
  }

  let metadata: Stats;
  try {
    metadata = await stat(realCandidate);
  } catch (error) {
    throwIssue(
      "ASSET_READ_FAILED",
      `Cannot inspect asset "${options.reference}": ${filesystemMessage(error)}`,
    );
  }
  if (!metadata.isFile()) {
    throwIssue("ASSET_NOT_FILE", "Asset reference must resolve to a regular file");
  }
  const maxBytes = policy.maxBytes ?? options.defaultMaxBytes ?? MAX_IMAGE_ASSET_BYTES;
  if (metadata.size > maxBytes) {
    throwIssue(
      "ASSET_SIZE_LIMIT_EXCEEDED",
      `Asset is ${metadata.size} bytes; the limit is ${maxBytes} bytes`,
    );
  }

  let data: Buffer;
  try {
    data = await readFile(realCandidate);
  } catch (error) {
    throwIssue(
      "ASSET_READ_FAILED",
      `Cannot read asset "${options.reference}": ${filesystemMessage(error)}`,
    );
  }
  if (!matchesFileSignature(extension, data)) {
    throwIssue(
      "ASSET_SIGNATURE_MISMATCH",
      `Asset contents do not match the "${extension}" file type`,
    );
  }
  if (policy.mimeType === "image/svg+xml") {
    const svgIssues = validateSvgSafety(data.toString("utf8"));
    if (svgIssues.length > 0) {
      throw new SecurityValidationError(svgIssues);
    }
  }

  const result: SecureDeckFile = {
    path: realCandidate,
    data,
    contentHash: createHash("sha256").update(data).digest("hex"),
    extension,
  };
  if (policy.mimeType) {
    result.mimeType = policy.mimeType;
  }
  return result;
}

export async function readSecureDeckEntryFile(
  entryPath: string,
): Promise<SecureDeckFile> {
  const absoluteEntryPath = path.resolve(entryPath);
  const deckDirectory = path.dirname(absoluteEntryPath);
  return readSecureDeckFile({
    deckDirectory,
    sourcePath: path.join(deckDirectory, ".livetoon-entry"),
    reference: path.basename(absoluteEntryPath),
    allowedExtensions: DECK_SOURCE_FILE_POLICIES,
    defaultMaxBytes: MAX_DECK_SOURCE_BYTES,
  });
}

function matchesFileSignature(extension: string, data: Buffer): boolean {
  switch (extension) {
    case ".png":
      return data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case ".jpg":
    case ".jpeg":
      return (
        data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      );
    case ".gif":
      return (
        data.subarray(0, 6).toString("ascii") === "GIF87a" ||
        data.subarray(0, 6).toString("ascii") === "GIF89a"
      );
    case ".webp":
      return (
        data.subarray(0, 4).toString("ascii") === "RIFF" &&
        data.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case ".mp4":
    case ".m4a":
      return data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp";
    case ".mp3":
      return (
        data.subarray(0, 3).toString("ascii") === "ID3" ||
        (data.length >= 2 && data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0)
      );
    default:
      return true;
  }
}

function attributeReferences(svg: string): string[] {
  const references: string[] = [];
  const pattern = /\b(?:href|xlink:href|src)\s*=\s*(["'])(.*?)\1/gis;
  for (const match of svg.matchAll(pattern)) {
    references.push(match[2] ?? "");
  }
  return references;
}

function cssReferences(svg: string): string[] {
  const references: string[] = [];
  const pattern = /url\(\s*(["']?)(.*?)\1\s*\)/gis;
  for (const match of svg.matchAll(pattern)) {
    references.push(match[2] ?? "");
  }
  return references;
}

export function validateSvgSafety(svg: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  if (!/<svg\b/i.test(svg)) {
    issues.push(issue("SVG_DOCUMENT_INVALID", "SVG asset has no svg root element"));
  }
  if (
    /<(?:[a-z0-9_-]+:)?script\b/i.test(svg) ||
    /\son[a-z][a-z0-9_-]*\s*=/i.test(svg)
  ) {
    issues.push(
      issue(
        "SVG_SCRIPT_FORBIDDEN",
        "SVG assets must not contain scripts or event-handler attributes",
      ),
    );
  }
  if (/<!DOCTYPE\b/i.test(svg) || /<!ENTITY\b/i.test(svg)) {
    issues.push(
      issue(
        "SVG_ENTITY_FORBIDDEN",
        "SVG assets must not contain document type or entity declarations",
      ),
    );
  }
  if (/<(?:[a-z0-9_-]+:)?foreignObject\b/i.test(svg)) {
    issues.push(
      issue(
        "SVG_FOREIGN_OBJECT_FORBIDDEN",
        "SVG assets must not contain foreignObject content",
      ),
    );
  }
  const references = [...attributeReferences(svg), ...cssReferences(svg)];
  if (
    references.some((reference) => {
      const normalized = reference.trim();
      return normalized !== "" && !normalized.startsWith("#");
    }) ||
    /@import\b/i.test(svg)
  ) {
    issues.push(
      issue(
        "SVG_EXTERNAL_REFERENCE_FORBIDDEN",
        "SVG assets must not load external or embedded resources",
      ),
    );
  }
  return issues.filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.code === candidate.code) === index,
  );
}

export function validateEmbeddedAsset(
  data: Buffer,
  mimeType: string,
  maxBytes = MAX_EMBEDDED_ASSET_BYTES,
): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  if (data.byteLength > maxBytes) {
    issues.push(
      issue(
        "ASSET_SIZE_LIMIT_EXCEEDED",
        `Embedded asset is ${data.byteLength} bytes; the limit is ${maxBytes} bytes`,
      ),
    );
  }
  if (mimeType === "image/svg+xml") {
    issues.push(...validateSvgSafety(data.toString("utf8")));
  }
  return issues;
}

export function isSafeWebUrl(value: string): boolean {
  return isSafeUrlWithProtocols(value, new Set(["http:", "https:"]));
}

export function isSafeHyperlink(value: string): boolean {
  return isSafeUrlWithProtocols(value, new Set(["http:", "https:", "mailto:"]));
}

function isSafeUrlWithProtocols(
  value: string,
  allowedProtocols: ReadonlySet<string>,
): boolean {
  if (value.trim() !== value || hasControlCharacters(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      allowedProtocols.has(parsed.protocol) &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.protocol === "mailto:" || parsed.hostname !== "")
    );
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
