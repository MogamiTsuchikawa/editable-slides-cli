import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  compileDeckDirectory,
  readDeckSourceConfig,
  resolveDeckEntry,
  serializeDeck,
} from "@livetoon/slide-compiler";
import type { DeckIR, Diagnostic, ElementIR } from "@livetoon/slide-deck-ir";
import { companyTheme } from "@livetoon/slide-theme-company";
import { defaultTheme, type ThemeDefinition } from "@livetoon/slide-theme-default";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export interface CompiledArtifact {
  deckDirectory: string;
  outputDirectory: string;
  deckIrPath: string;
  diagnosticsPath: string;
  deck: DeckIR;
  diagnostics: Diagnostic[];
}

export interface RunningStudio {
  child: ChildProcess;
  baseUrl: string;
  stop(): Promise<void>;
}

export interface BuildManifest {
  cliVersion: string;
  deckIrSchemaVersion: number;
  nodeVersion: string;
  lockfileSha256?: string;
  theme: {
    id: string;
    name: string;
  };
  fonts: Array<{
    family: string;
    weight: number;
    style: string;
    sha256?: string;
  }>;
  assets: Array<{
    slideId: string;
    elementId: string;
    source: string;
    sha256?: string;
  }>;
  sourceContentHash: string;
  buildTimestamp: string;
  diagnostics: {
    errors: number;
    warnings: number;
    info: number;
  };
  outputs?: Record<string, unknown>;
}

export async function atomicWriteText(
  filePath: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function compileArtifact(
  deckInput: string,
  options: { failOnWarnings?: boolean } = {},
): Promise<CompiledArtifact> {
  const deckDirectory = path.resolve(deckInput);
  const entryPath = await resolveDeckEntry(deckDirectory);
  await access(entryPath);
  const config = await readDeckSourceConfig(entryPath);
  const theme = await loadTheme(config.theme, deckDirectory);
  const result = await compileDeckDirectory(deckDirectory, {
    failOnWarnings: options.failOnWarnings ?? false,
    theme,
  });
  const outputDirectory = path.resolve(repositoryRoot, "dist", result.deck.metadata.id);
  const deckIrPath = path.join(outputDirectory, "deck.ir.json");
  const diagnosticsPath = path.join(outputDirectory, "diagnostics.json");
  await Promise.all([
    atomicWriteText(deckIrPath, serializeDeck(result.deck)),
    atomicWriteText(
      diagnosticsPath,
      `${JSON.stringify(result.diagnostics, null, 2)}\n`,
    ),
  ]);
  return {
    deckDirectory,
    outputDirectory,
    deckIrPath,
    diagnosticsPath,
    deck: result.deck,
    diagnostics: result.diagnostics,
  };
}

function isThemeDefinition(value: unknown): value is ThemeDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    ir?: { id?: unknown };
    layouts?: unknown;
    defaults?: unknown;
  };
  return (
    typeof candidate.ir?.id === "string" &&
    Boolean(candidate.layouts && typeof candidate.layouts === "object") &&
    Boolean(candidate.defaults && typeof candidate.defaults === "object")
  );
}

function themeFromModule(module: Record<string, unknown>): ThemeDefinition | undefined {
  for (const candidate of [module.default, module.theme, module.companyTheme]) {
    if (isThemeDefinition(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function importThemeFile(filePath: string): Promise<ThemeDefinition | undefined> {
  try {
    await access(filePath);
  } catch {
    return undefined;
  }
  const module = (await import(pathToFileURL(filePath).href)) as Record<
    string,
    unknown
  >;
  return themeFromModule(module);
}

export async function loadTheme(
  reference: string,
  deckDirectory: string,
): Promise<ThemeDefinition> {
  if (reference === "default") {
    return structuredClone(defaultTheme);
  }
  if (reference === "company") {
    return structuredClone(companyTheme);
  }

  const pathLike =
    path.isAbsolute(reference) ||
    reference.startsWith(".") ||
    reference.includes("/") ||
    reference.includes("\\");
  if (pathLike) {
    const resolved = path.resolve(deckDirectory, reference);
    const candidates = [
      resolved,
      path.join(resolved, "dist", "index.js"),
      path.join(resolved, "index.js"),
    ];
    for (const candidate of candidates) {
      const theme = await importThemeFile(candidate);
      if (theme) {
        return theme;
      }
    }
  } else {
    const localTheme = await importThemeFile(
      path.join(repositoryRoot, "themes", reference, "dist", "index.js"),
    );
    if (localTheme) {
      return localTheme;
    }
    try {
      const module = (await import(reference)) as Record<string, unknown>;
      const theme = themeFromModule(module);
      if (theme) {
        return theme;
      }
    } catch {
      // A more useful error is emitted below.
    }
  }

  throw new Error(
    `Theme "${reference}" could not be loaded. Build a theme module that exports a ThemeDefinition, or use "company"/"default".`,
  );
}

function walkElements(
  slideId: string,
  elements: readonly ElementIR[],
  assets: BuildManifest["assets"],
): void {
  for (const element of elements) {
    if (element.type === "image" || element.type === "icon") {
      assets.push({
        slideId,
        elementId: element.id,
        source: element.src,
        ...(element.contentHash ? { sha256: element.contentHash } : {}),
      });
    }
    if (element.type === "group") {
      walkElements(slideId, element.children, assets);
    }
  }
}

async function lockfileHash(): Promise<string | undefined> {
  try {
    const contents = await readFile(path.join(repositoryRoot, "package-lock.json"));
    return createHash("sha256").update(contents).digest("hex");
  } catch {
    return undefined;
  }
}

export async function createBuildManifest(
  artifact: CompiledArtifact,
  outputs?: Record<string, unknown>,
): Promise<BuildManifest> {
  const assets: BuildManifest["assets"] = [];
  for (const slide of artifact.deck.slides) {
    walkElements(slide.id, slide.elements, assets);
  }
  const count = (severity: Diagnostic["severity"]) =>
    artifact.diagnostics.filter((diagnostic) => diagnostic.severity === severity)
      .length;
  return {
    cliVersion: "0.1.0",
    deckIrSchemaVersion: artifact.deck.schemaVersion,
    nodeVersion: process.version,
    ...(await lockfileHash().then((sha256) =>
      sha256 ? { lockfileSha256: sha256 } : {},
    )),
    theme: {
      id: artifact.deck.theme.id,
      name: artifact.deck.theme.name,
    },
    fonts: artifact.deck.theme.fonts.registered.map((font) => ({
      family: font.family,
      weight: font.weight,
      style: font.style,
      ...(font.sha256 ? { sha256: font.sha256 } : {}),
    })),
    assets,
    sourceContentHash: artifact.deck.contentHash,
    buildTimestamp: new Date().toISOString(),
    diagnostics: {
      errors: count("error"),
      warnings: count("warning"),
      info: count("info"),
    },
    ...(outputs ? { outputs } : {}),
  };
}

export async function writeBuildManifest(
  artifact: CompiledArtifact,
  outputs?: Record<string, unknown>,
): Promise<string> {
  const manifestPath = path.join(artifact.outputDirectory, "build-manifest.json");
  await atomicWriteText(
    manifestPath,
    `${JSON.stringify(await createBuildManifest(artifact, outputs), null, 2)}\n`,
  );
  return manifestPath;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a local preview port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHttp(
  url: string,
  child: ChildProcess,
  timeoutMs = 30_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Studio exited before it became ready (exit ${child.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The Vite server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Studio: ${url}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, 3_000);
  });
  await Promise.race([exited, timeout]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

export async function startStudio(
  artifact: CompiledArtifact,
  options: {
    port?: number;
    open?: boolean;
    inheritOutput?: boolean;
  } = {},
): Promise<RunningStudio> {
  const port = options.port ?? (await freePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const args = [
    "run",
    "dev",
    "--workspace=@livetoon/slide-studio",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ];
  if (options.open) {
    args.push("--open", `/edit/${artifact.deck.metadata.id}`);
  }
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(executable, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      LIVETOON_DECK_DIR: artifact.deckDirectory,
      LIVETOON_DECK_IR: artifact.deckIrPath,
    },
    stdio: options.inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  let capturedError = "";
  if (!options.inheritOutput) {
    child.stderr?.on("data", (chunk: Buffer) => {
      capturedError = `${capturedError}${chunk.toString("utf8")}`.slice(-8_000);
    });
  }
  try {
    await waitForHttp(
      `${baseUrl}/api/decks/${encodeURIComponent(artifact.deck.metadata.id)}`,
      child,
    );
  } catch (error) {
    await stopChild(child);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${
        capturedError ? `\n${capturedError.trim()}` : ""
      }`,
    );
  }
  return {
    child,
    baseUrl,
    stop: () => stopChild(child),
  };
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.sourceLocation
    ? `${diagnostic.sourceLocation.file}:${diagnostic.sourceLocation.line}:${diagnostic.sourceLocation.column}`
    : diagnostic.slideId
      ? `slide:${diagnostic.slideId}`
      : "deck";
  const element = diagnostic.elementId ? ` [${diagnostic.elementId}]` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location}${element} ${diagnostic.message}`;
}
