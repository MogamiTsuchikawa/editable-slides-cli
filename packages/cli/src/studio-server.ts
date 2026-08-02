import { execFile } from "node:child_process";
import { access, readFile, realpath, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleApiRequest } from "../../../apps/studio/server/deck-api.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface StudioArtifact {
  deckDirectory: string;
  deckIrPath: string;
  deck: { metadata: { id: string } };
}

export interface RunningStudio {
  baseUrl: string;
  closed: Promise<void>;
  notify(kind?: "deck" | "overrides"): void;
  stop(): Promise<void>;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function studioRoot(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, "../studio"),
    path.resolve(moduleDirectory, "../dist/studio"),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "index.html"));
      return await realpath(candidate);
    } catch {
      // Try the source-tree or packaged location next.
    }
  }
  throw new Error("Studio assets are missing. Rebuild the CLI package.");
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'",
  );
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

function allowedStudioHosts(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

export function isAllowedStudioHost(host: string | undefined, port: number): boolean {
  return typeof host === "string" && allowedStudioHosts(port).has(host.toLowerCase());
}

export function isAllowedStudioOrigin(
  origin: string | undefined,
  port: number,
): boolean {
  if (typeof origin !== "string") return false;
  const normalizedOrigin = origin.toLowerCase();
  return (
    normalizedOrigin === `http://127.0.0.1:${port}` ||
    normalizedOrigin === `http://localhost:${port}`
  );
}

function isUnsafeMethod(method: string | undefined): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method ?? "GET");
}

export function studioRequestRejection(
  request: { method?: string; host?: string; origin?: string },
  port: number,
): { statusCode: 421 | 403; error: string } | undefined {
  if (!isAllowedStudioHost(request.host, port)) {
    return { statusCode: 421, error: "Invalid Studio host." };
  }
  if (isUnsafeMethod(request.method) && !isAllowedStudioOrigin(request.origin, port)) {
    return { statusCode: 403, error: "Invalid Studio origin." };
  }
  return undefined;
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: "Invalid URL." });
    return;
  }
  const requested = path.resolve(root, `.${pathname}`);
  if (!isWithin(root, requested)) {
    sendJson(response, 403, { error: "Path is outside Studio." });
    return;
  }
  let filePath = requested;
  const metadata = await stat(filePath).catch(() => undefined);
  if (metadata?.isDirectory()) filePath = path.join(filePath, "index.html");
  if (!metadata || metadata.isDirectory()) {
    const extension = path.extname(pathname);
    if (!extension) filePath = path.join(root, "index.html");
  }
  const resolved = await realpath(filePath).catch(() => undefined);
  if (!resolved || !isWithin(root, resolved)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  const contents = await readFile(resolved);
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream",
  );
  response.setHeader(
    "cache-control",
    path.basename(resolved) === "index.html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  );
  response.setHeader("content-length", contents.byteLength);
  response.end(request.method === "HEAD" ? undefined : contents);
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };
  const child = execFile(command.file, command.args, () => undefined);
  child.unref();
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startPackagedStudio(
  artifact: StudioArtifact,
  repositoryRoot: string,
  options: { port: number; open?: boolean },
): Promise<RunningStudio> {
  const root = await studioRoot();
  const eventStreams = new Set<ServerResponse>();
  const previousDeckDirectory = process.env.LIVETOON_DECK_DIR;
  const previousDeckIr = process.env.LIVETOON_DECK_IR;
  const restoreEnvironment = () => {
    if (previousDeckDirectory === undefined) delete process.env.LIVETOON_DECK_DIR;
    else process.env.LIVETOON_DECK_DIR = previousDeckDirectory;
    if (previousDeckIr === undefined) delete process.env.LIVETOON_DECK_IR;
    else process.env.LIVETOON_DECK_IR = previousDeckIr;
  };
  process.env.LIVETOON_DECK_DIR = artifact.deckDirectory;
  process.env.LIVETOON_DECK_IR = artifact.deckIrPath;

  const server = createServer((request, response) => {
    applySecurityHeaders(response);
    const rejection = studioRequestRejection(
      {
        method: request.method,
        host: request.headers.host,
        origin: request.headers.origin,
      },
      options.port,
    );
    if (rejection) {
      sendJson(response, rejection.statusCode, { error: rejection.error });
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/api/events" && request.method === "GET") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");
      response.write("retry: 500\n\n");
      eventStreams.add(response);
      request.once("close", () => eventStreams.delete(response));
      return;
    }
    void handleApiRequest(request, response, repositoryRoot)
      .then((handled) => (handled ? undefined : serveStatic(request, response, root)))
      .catch((error: unknown) => {
        if (!response.headersSent) {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          response.end();
        }
      });
  });
  try {
    await listen(server, options.port);
  } catch (error) {
    restoreEnvironment();
    throw error;
  }
  const baseUrl = `http://127.0.0.1:${options.port}`;
  if (options.open) {
    openBrowser(`${baseUrl}/edit/${encodeURIComponent(artifact.deck.metadata.id)}`);
  }

  let resolveClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  server.once("close", () => resolveClosed?.());
  let stopped = false;
  return {
    baseUrl,
    closed,
    notify(kind = "deck") {
      const message = `event: ${kind}\ndata: ${JSON.stringify({ kind })}\n\n`;
      for (const stream of eventStreams) stream.write(message);
    },
    async stop() {
      if (stopped) return closed;
      stopped = true;
      for (const stream of eventStreams) stream.end();
      eventStreams.clear();
      try {
        if (server.listening) {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          server.closeAllConnections();
        }
      } finally {
        restoreEnvironment();
      }
    },
  };
}
