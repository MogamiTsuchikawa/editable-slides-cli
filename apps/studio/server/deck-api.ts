import { access, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { readOverrideDocument, writeOverrideDocumentAtomic } from "./overrides.js";
import { updateTextElementSource } from "./text-source.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
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
};

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
    rewritten.src = `/api/assets/${encodeURIComponent(
      deckId,
    )}?path=${encodeURIComponent(relative(deckDirectory, src))}`;
  }
  return rewritten;
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

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  repositoryRoot: string,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const deckMatch = /^\/api\/decks\/([^/]+)$/.exec(url.pathname);
  const overridesMatch = /^\/api\/layout-overrides\/([^/]+)$/.exec(url.pathname);
  const assetsMatch = /^\/api\/assets\/([^/]+)$/.exec(url.pathname);
  const textMatch = /^\/api\/text-elements\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
    url.pathname,
  );
  if (!deckMatch && !overridesMatch && !assetsMatch && !textMatch) return false;

  const encodedDeckId =
    deckMatch?.[1] ?? overridesMatch?.[1] ?? assetsMatch?.[1] ?? textMatch?.[1];
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

  if (assetsMatch && request.method === "GET") {
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
    try {
      const contents = await readFile(resolvedAsset);
      response.statusCode = 200;
      response.setHeader(
        "content-type",
        ASSET_CONTENT_TYPES[extname(resolvedAsset).toLowerCase()] ??
          "application/octet-stream",
      );
      response.setHeader("cache-control", "no-cache");
      response.end(contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        json(response, 404, { error: "Asset was not found." });
        return true;
      }
      throw error;
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
    deckMatch || assetsMatch ? "GET" : textMatch ? "PUT" : "GET, PUT",
  );
  json(response, 405, { error: "Method not allowed." });
  return true;
}

function shouldNotify(filePath: string): "deck" | "overrides" | undefined {
  if (basename(filePath) === "layout.overrides.json") return "overrides";
  if (
    filePath.endsWith(".mdx") ||
    filePath.endsWith(".yaml") ||
    filePath.endsWith(".yml") ||
    basename(filePath) === "deck.ir.json"
  ) {
    return "deck";
  }
  return undefined;
}

function configureWatcher(server: ViteDevServer, repositoryRoot: string): void {
  const configuredDeckDirectory = process.env.LIVETOON_DECK_DIR;
  const configuredIr = process.env.LIVETOON_DECK_IR;
  server.watcher.add([
    resolve(repositoryRoot, "decks"),
    resolve(repositoryRoot, "dist"),
    ...(configuredDeckDirectory ? [resolve(configuredDeckDirectory)] : []),
    ...(configuredIr ? [resolve(configuredIr)] : []),
  ]);
  server.watcher.on("all", (_event, filePath) => {
    const kind = shouldNotify(filePath);
    if (!kind) return;
    server.ws.send({
      type: "custom",
      event: "studio:deck-changed",
      data: { kind, filePath },
    });
  });
}

export function deckApiPlugin(repositoryRoot: string): Plugin {
  return {
    name: "livetoon-slide-deck-api",
    configureServer(server) {
      configureWatcher(server, repositoryRoot);
      server.middlewares.use((request, response, next) => {
        void handleApiRequest(request, response, repositoryRoot)
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            json(response, 500, {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
    },
  };
}
