import type { FileHandle } from "node:fs/promises";
import { access, open, readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  mutateSlideSource,
  readDeckSourceState,
  type SlideSourceOperation,
  updateSlideMetadataSource,
  updateStructuredElementSource,
} from "./deck-source.js";
import { readOverrideDocument, writeOverrideDocumentAtomic } from "./overrides.js";
import { updateTextElementSource } from "./text-source.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_SERVED_ASSET_BYTES = 100 * 1024 * 1024;
const SAFE_DECK_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

interface DeckFiles {
  deckDirectory: string;
  deckIrPath: string;
  overridePath: string;
}

function isWithin(parent: string, candidate: string): boolean {
  const normalizedParent = `${resolve(parent)}${sep}`;
  return resolve(candidate).startsWith(normalizedParent);
}

function safeDeckId(deckId: string): boolean {
  return SAFE_DECK_ID.test(deckId) && !deckId.includes("..");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDeckFiles(
  repositoryRoot: string,
  deckId: string,
): Promise<DeckFiles | undefined> {
  if (!safeDeckId(deckId)) return undefined;

  const configuredDeckDirectory = process.env.LIVETOON_DECK_DIR;
  const configuredIr = process.env.LIVETOON_DECK_IR;
  const deckDirectory = configuredDeckDirectory
    ? resolve(configuredDeckDirectory)
    : resolve(repositoryRoot, "decks", deckId);
  const deckCandidates = [
    configuredIr ? resolve(configuredIr) : undefined,
    join(deckDirectory, ".livetoon", "deck.ir.json"),
    join(deckDirectory, "deck.ir.json"),
    resolve(repositoryRoot, "dist", deckId, "deck.ir.json"),
  ].filter((path): path is string => Boolean(path));

  for (const deckIrPath of deckCandidates) {
    const allowed =
      Boolean(configuredIr && resolve(configuredIr) === deckIrPath) ||
      Boolean(configuredDeckDirectory && isWithin(deckDirectory, deckIrPath)) ||
      isWithin(repositoryRoot, deckIrPath);
    if (allowed && (await exists(deckIrPath))) {
      return {
        deckDirectory,
        deckIrPath,
        overridePath: join(deckDirectory, "layout.overrides.json"),
      };
    }
  }
  return undefined;
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".vtt": "text/vtt; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function assetUrl(deckId: string, deckDirectory: string, filePath: string): string {
  return `/api/assets/${encodeURIComponent(deckId)}?path=${encodeURIComponent(
    relative(deckDirectory, filePath),
  )}`;
}

export function rewriteAssetSources(
  value: unknown,
  deckId: string,
  deckDirectory: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteAssetSources(item, deckId, deckDirectory));
  }
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const rewritten = Object.fromEntries(
    Object.entries(source).map(([key, item]) => [
      key,
      rewriteAssetSources(item, deckId, deckDirectory),
    ]),
  );
  const type = typeof source.type === "string" ? source.type : "";
  const src = typeof source.src === "string" ? source.src : "";
  if (
    (type === "image" || type === "icon") &&
    isAbsolute(src) &&
    isWithin(deckDirectory, src)
  ) {
    rewritten.src = assetUrl(deckId, deckDirectory, src);
  } else if (
    (type === "video" || type === "audio") &&
    isAbsolute(src) &&
    isWithin(deckDirectory, src)
  ) {
    rewritten.src = assetUrl(deckId, deckDirectory, src);
  }
  for (const posterKey of ["poster", "posterSrc"] as const) {
    const poster = typeof source[posterKey] === "string" ? source[posterKey] : "";
    if (
      (type === "video" || type === "audio") &&
      isAbsolute(poster) &&
      isWithin(deckDirectory, poster)
    ) {
      rewritten[posterKey] = assetUrl(deckId, deckDirectory, poster);
    }
  }
  const captionSrc = typeof source.captionSrc === "string" ? source.captionSrc : "";
  if (
    (type === "video" || type === "audio") &&
    isAbsolute(captionSrc) &&
    isWithin(deckDirectory, captionSrc)
  ) {
    rewritten.captionSrc = assetUrl(deckId, deckDirectory, captionSrc);
  }
  const posterFrame = source.posterFrame;
  if (
    type === "image" &&
    posterFrame &&
    typeof posterFrame === "object" &&
    typeof (posterFrame as Record<string, unknown>).src === "string"
  ) {
    const posterFrameSource = (posterFrame as Record<string, unknown>).src as string;
    if (isAbsolute(posterFrameSource) && isWithin(deckDirectory, posterFrameSource)) {
      rewritten.posterFrame = {
        ...(rewritten.posterFrame as Record<string, unknown>),
        src: assetUrl(deckId, deckDirectory, posterFrameSource),
      };
    }
  }
  if (
    source.source === "file" &&
    typeof source.path === "string" &&
    isAbsolute(source.path) &&
    isWithin(deckDirectory, source.path)
  ) {
    rewritten.path = assetUrl(deckId, deckDirectory, source.path);
  }
  return rewritten;
}

function collectReferencedAssetPaths(value: unknown, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedAssetPaths(item, paths);
    return;
  }
  if (!value || typeof value !== "object") return;

  const source = value as Record<string, unknown>;
  const type = typeof source.type === "string" ? source.type : "";
  if (
    ["image", "icon", "video", "audio"].includes(type) &&
    typeof source.src === "string"
  ) {
    paths.add(source.src);
  }
  if (type === "video" || type === "audio") {
    for (const posterKey of ["poster", "posterSrc"] as const) {
      if (typeof source[posterKey] === "string") paths.add(source[posterKey]);
    }
    if (typeof source.captionSrc === "string") paths.add(source.captionSrc);
  }
  if (
    type === "image" &&
    source.posterFrame &&
    typeof source.posterFrame === "object"
  ) {
    const posterFrameSource = (source.posterFrame as Record<string, unknown>).src;
    if (typeof posterFrameSource === "string") paths.add(posterFrameSource);
  }
  if (source.source === "file" && typeof source.path === "string") {
    paths.add(source.path);
  }
  for (const item of Object.values(source)) collectReferencedAssetPaths(item, paths);
}

async function referencedAssetAllowlist(files: DeckFiles): Promise<Set<string>> {
  const deckIr = JSON.parse(await readFile(files.deckIrPath, "utf8")) as unknown;
  const referencedPaths = new Set<string>();
  collectReferencedAssetPaths(deckIr, referencedPaths);
  const canonicalDeckDirectory = await realpath(files.deckDirectory);
  const allowed = new Set<string>();
  await Promise.all(
    [...referencedPaths].map(async (referencedPath) => {
      if (
        !isAbsolute(referencedPath) ||
        !isWithin(files.deckDirectory, referencedPath)
      ) {
        return;
      }
      const canonicalReference = await realpath(referencedPath).catch(() => undefined);
      if (canonicalReference && isWithin(canonicalDeckDirectory, canonicalReference)) {
        allowed.add(canonicalReference);
      }
    }),
  );
  return allowed;
}

interface ByteRange {
  start: number;
  end: number;
}

function requestedRange(
  value: string | undefined,
  size: number,
): ByteRange | undefined {
  if (!value) return undefined;
  if (value.includes(",")) throw new Error("複数範囲の取得には対応していません。");
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) {
    throw new Error("素材の取得範囲が正しくありません。");
  }
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new Error("素材の取得範囲が正しくありません。");
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      throw new Error("素材の取得範囲が正しくありません。");
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseSlideOperation(value: unknown): SlideSourceOperation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const operation = value as Record<string, unknown>;
  switch (operation.type) {
    case "add":
      if (
        typeof operation.title !== "string" ||
        (operation.layout !== undefined && typeof operation.layout !== "string") ||
        (operation.afterSlideId !== undefined &&
          typeof operation.afterSlideId !== "string")
      ) {
        return undefined;
      }
      return {
        type: "add",
        title: operation.title,
        ...(typeof operation.layout === "string" ? { layout: operation.layout } : {}),
        ...(typeof operation.afterSlideId === "string"
          ? { afterSlideId: operation.afterSlideId }
          : {}),
      };
    case "duplicate":
    case "delete":
      return typeof operation.slideId === "string"
        ? { type: operation.type, slideId: operation.slideId }
        : undefined;
    case "move":
      return typeof operation.slideId === "string" &&
        typeof operation.toIndex === "number" &&
        Number.isSafeInteger(operation.toIndex)
        ? {
            type: "move",
            slideId: operation.slideId,
            toIndex: operation.toIndex,
          }
        : undefined;
    default:
      return undefined;
  }
}

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  repositoryRoot: string,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const deckMatch = /^\/api\/decks\/([^/]+)$/.exec(url.pathname);
  const overridesMatch = /^\/api\/layout-overrides\/([^/]+)$/.exec(url.pathname);
  const assetsMatch = /^\/api\/assets\/([^/]+)$/.exec(url.pathname);
  const sourceStateMatch = /^\/api\/deck-source\/([^/]+)$/.exec(url.pathname);
  const slideOperationMatch = /^\/api\/slide-operations\/([^/]+)$/.exec(url.pathname);
  const slideMetadataMatch = /^\/api\/slide-metadata\/([^/]+)\/([^/]+)$/.exec(
    url.pathname,
  );
  const structuredDataMatch =
    /^\/api\/structured-data\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  const textMatch = /^\/api\/text-elements\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
    url.pathname,
  );
  if (
    !deckMatch &&
    !overridesMatch &&
    !assetsMatch &&
    !sourceStateMatch &&
    !slideOperationMatch &&
    !slideMetadataMatch &&
    !structuredDataMatch &&
    !textMatch
  ) {
    return false;
  }

  const encodedDeckId =
    deckMatch?.[1] ??
    overridesMatch?.[1] ??
    assetsMatch?.[1] ??
    sourceStateMatch?.[1] ??
    slideOperationMatch?.[1] ??
    slideMetadataMatch?.[1] ??
    structuredDataMatch?.[1] ??
    textMatch?.[1];
  const deckId = encodedDeckId ? decodeURIComponent(encodedDeckId) : "";
  if (!safeDeckId(deckId)) {
    json(response, 400, { error: "Invalid deck ID." });
    return true;
  }
  const files = await resolveDeckFiles(repositoryRoot, deckId);
  if (!files) {
    json(response, 404, {
      error: `Deck "${deckId}" was not found.`,
      hint: "Set LIVETOON_DECK_DIR / LIVETOON_DECK_IR or compile to dist/<deckId>/deck.ir.json.",
    });
    return true;
  }

  if (assetsMatch && (request.method === "GET" || request.method === "HEAD")) {
    const assetPath = url.searchParams.get("path");
    if (!assetPath) {
      json(response, 400, { error: "Missing asset path." });
      return true;
    }
    const resolvedAsset = resolve(files.deckDirectory, assetPath);
    if (!isWithin(files.deckDirectory, resolvedAsset)) {
      json(response, 403, { error: "Asset path is outside the deck." });
      return true;
    }
    let canonicalAsset: string;
    try {
      const [canonicalDeckDirectory, resolvedCanonicalAsset] = await Promise.all([
        realpath(files.deckDirectory),
        realpath(resolvedAsset),
      ]);
      if (!isWithin(canonicalDeckDirectory, resolvedCanonicalAsset)) {
        json(response, 403, { error: "Asset path is outside the deck." });
        return true;
      }
      canonicalAsset = resolvedCanonicalAsset;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        json(response, 404, { error: "Asset was not found." });
        return true;
      }
      throw error;
    }
    const allowedAssets = await referencedAssetAllowlist(files);
    if (!allowedAssets.has(canonicalAsset)) {
      json(response, 403, {
        error: "Asset is not referenced by the compiled deck.",
      });
      return true;
    }
    let asset: FileHandle | undefined;
    try {
      asset = await open(canonicalAsset, "r");
      const stats = await asset.stat();
      if (!stats.isFile()) {
        json(response, 404, { error: "Asset was not found." });
        return true;
      }
      if (stats.size > MAX_SERVED_ASSET_BYTES) {
        json(response, 413, {
          error: `Asset exceeds the ${MAX_SERVED_ASSET_BYTES}-byte serving limit.`,
        });
        return true;
      }
      let range: ByteRange | undefined;
      try {
        range = requestedRange(request.headers.range, stats.size);
      } catch {
        response.statusCode = 416;
        response.setHeader("accept-ranges", "bytes");
        response.setHeader("content-range", `bytes */${stats.size}`);
        response.setHeader("cache-control", "no-cache");
        response.end();
        return true;
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stats.size - 1);
      const length = stats.size === 0 ? 0 : end - start + 1;
      response.statusCode = range ? 206 : 200;
      response.setHeader(
        "content-type",
        ASSET_CONTENT_TYPES[extname(canonicalAsset).toLowerCase()] ??
          "application/octet-stream",
      );
      response.setHeader("accept-ranges", "bytes");
      response.setHeader("content-length", String(length));
      if (range)
        response.setHeader("content-range", `bytes ${start}-${end}/${stats.size}`);
      response.setHeader("cache-control", "no-cache");
      if (request.method === "HEAD" || length === 0) {
        response.end();
      } else {
        await pipeline(
          asset.createReadStream({ start, end, autoClose: false }),
          response,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        json(response, 404, { error: "Asset was not found." });
        return true;
      }
      throw error;
    } finally {
      await asset?.close();
    }
    return true;
  }

  if (deckMatch && request.method === "GET") {
    const source = await readFile(files.deckIrPath, "utf8");
    json(
      response,
      200,
      rewriteAssetSources(JSON.parse(source) as unknown, deckId, files.deckDirectory),
    );
    return true;
  }

  if (sourceStateMatch && request.method === "GET") {
    json(
      response,
      200,
      await readDeckSourceState(files.deckDirectory, files.deckIrPath),
    );
    return true;
  }

  if (slideOperationMatch && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") {
      json(response, 400, { error: "操作内容を確認できません。" });
      return true;
    }
    const { expectedHash, operation: rawOperation } = body as {
      expectedHash?: unknown;
      operation?: unknown;
    };
    const operation = parseSlideOperation(rawOperation);
    if (typeof expectedHash !== "string" || !operation) {
      json(response, 400, { error: "ページ操作の内容が正しくありません。" });
      return true;
    }
    const saved = await mutateSlideSource(
      files.deckDirectory,
      files.deckIrPath,
      expectedHash,
      operation,
    );

    const overrides = await readOverrideDocument(files.overridePath);
    if (saved.operation === "duplicate" && operation.type === "duplicate") {
      const sourceOverrides = overrides.slides[operation.slideId];
      if (sourceOverrides) {
        overrides.slides[saved.slideId] = structuredClone(sourceOverrides);
        await writeOverrideDocumentAtomic(files.overridePath, overrides);
      }
    } else if (saved.operation === "delete") {
      if (overrides.slides[saved.slideId]) {
        delete overrides.slides[saved.slideId];
        await writeOverrideDocumentAtomic(files.overridePath, overrides);
      }
    }
    json(response, 200, saved);
    return true;
  }

  if (slideMetadataMatch && request.method === "PUT") {
    const slideId = decodeURIComponent(slideMetadataMatch[2] ?? "");
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") {
      json(response, 400, { error: "発表者原稿と出典を確認できません。" });
      return true;
    }
    const { expectedHash, notes, sources } = body as Record<string, unknown>;
    if (
      typeof expectedHash !== "string" ||
      typeof notes !== "string" ||
      !Array.isArray(sources)
    ) {
      json(response, 400, { error: "発表者原稿と出典の内容が正しくありません。" });
      return true;
    }
    json(
      response,
      200,
      await updateSlideMetadataSource(
        files.deckDirectory,
        files.deckIrPath,
        expectedHash,
        { slideId, notes, sources: sources as Array<{ label: string; url?: string }> },
      ),
    );
    return true;
  }

  if (structuredDataMatch && request.method === "PUT") {
    const slideId = decodeURIComponent(structuredDataMatch[2] ?? "");
    const elementId = decodeURIComponent(structuredDataMatch[3] ?? "");
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") {
      json(response, 400, { error: "表またはグラフのデータを確認できません。" });
      return true;
    }
    const { expectedHash, data } = body as Record<string, unknown>;
    if (typeof expectedHash !== "string" || !("data" in body)) {
      json(response, 400, { error: "表またはグラフのデータが正しくありません。" });
      return true;
    }
    json(
      response,
      200,
      await updateStructuredElementSource(
        files.deckDirectory,
        files.deckIrPath,
        expectedHash,
        { slideId, elementId, data },
      ),
    );
    return true;
  }

  if (overridesMatch && request.method === "GET") {
    json(response, 200, await readOverrideDocument(files.overridePath));
    return true;
  }

  if (overridesMatch && request.method === "PUT") {
    const saved = await writeOverrideDocumentAtomic(
      files.overridePath,
      await readJsonBody(request),
    );
    json(response, 200, saved);
    return true;
  }

  if (textMatch && request.method === "PUT") {
    const slideId = decodeURIComponent(textMatch[2] ?? "");
    const elementId = decodeURIComponent(textMatch[3] ?? "");
    const body = await readJsonBody(request);
    const text =
      body && typeof body === "object" && "text" in body
        ? (body as { text?: unknown }).text
        : undefined;
    if (typeof text !== "string") {
      json(response, 400, { error: 'Request body must contain a string "text".' });
      return true;
    }
    const saved = await updateTextElementSource(files.deckDirectory, files.deckIrPath, {
      slideId,
      elementId,
      text,
    });
    json(response, 200, {
      slideId: saved.slideId,
      elementId: saved.elementId,
      text: saved.text,
    });
    return true;
  }

  response.setHeader(
    "allow",
    deckMatch || sourceStateMatch
      ? "GET"
      : assetsMatch
        ? "GET, HEAD"
        : slideOperationMatch
          ? "POST"
          : textMatch || slideMetadataMatch || structuredDataMatch
            ? "PUT"
            : "GET, PUT",
  );
  json(response, 405, { error: "Method not allowed." });
  return true;
}
