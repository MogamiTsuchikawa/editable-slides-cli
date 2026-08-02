import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  compileDeckDirectory,
  readDeckSourceConfig,
  resolveDeckEntry,
  serializeDeck,
} from "@livetoon/slide-compiler";
import type { DeckIR, Diagnostic, ElementIR } from "@livetoon/slide-deck-ir";
import { companyTheme } from "@livetoon/slide-theme-company";
import { defaultTheme, type ThemeDefinition } from "@livetoon/slide-theme-default";
import { type RunningStudio, startPackagedStudio } from "./studio-server.js";
import { cliVersion } from "./version.js";

export type { RunningStudio } from "./studio-server.js";

export function resolveRepositoryRoot(
  options: {
    explicitRoot?: string;
    initialDirectory?: string;
    currentDirectory?: string;
  } = {},
): string {
  return path.resolve(
    options.explicitRoot ??
      options.currentDirectory ??
      options.initialDirectory ??
      process.cwd(),
  );
}

export const repositoryRoot = resolveRepositoryRoot({
  explicitRoot: process.env.LIVETOON_WORKSPACE_ROOT,
  initialDirectory: process.env.INIT_CWD,
  currentDirectory: process.cwd(),
});

export interface CompiledArtifact {
  deckDirectory: string;
  outputDirectory: string;
  finalOutputDirectory: string;
  deckIrPath: string;
  publicDeckIrPath: string;
  diagnosticsPath: string;
  deck: DeckIR;
  diagnostics: Diagnostic[];
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
    kind: "image" | "icon" | "video" | "audio";
    slideId: string;
    elementId: string;
    source: string;
    sha256?: string;
    mimeType?: string;
    byteLength?: number;
    poster?: {
      source: string;
      sha256?: string;
      mimeType?: string;
    };
    caption?: {
      source: string;
      sha256?: string;
      mimeType: "text/vtt";
      language?: string;
      label?: string;
    };
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
  options: { failOnWarnings?: boolean; staging?: boolean } = {},
): Promise<CompiledArtifact> {
  const requestedDirectory = path.resolve(deckInput);
  let deckDirectory: string;
  try {
    deckDirectory = await realpath(requestedDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    deckDirectory = requestedDirectory;
  }
  const entryPath = await resolveDeckEntry(deckDirectory);
  await access(entryPath);
  const config = await readDeckSourceConfig(entryPath);
  const theme = await loadTheme(config.theme, deckDirectory);
  const result = await compileDeckDirectory(deckDirectory, {
    failOnWarnings: options.failOnWarnings ?? false,
    theme,
  });
  const finalOutputDirectory = path.resolve(
    repositoryRoot,
    "dist",
    result.deck.metadata.id,
  );
  const outputDirectory = options.staging
    ? path.join(
        path.dirname(finalOutputDirectory),
        `.${path.basename(finalOutputDirectory)}.release-${randomUUID()}`,
      )
    : finalOutputDirectory;
  const deckIrPath = path.join(deckDirectory, ".livetoon", "deck.ir.json");
  const publicDeckIrPath = path.join(outputDirectory, "deck.ir.json");
  const diagnosticsPath = path.join(outputDirectory, "diagnostics.json");
  const publicDeck = sanitizeArtifactPaths(result.deck, {
    deckDirectory,
    outputDirectory,
    workspaceDirectory: repositoryRoot,
  });
  const publicDiagnostics = sanitizeArtifactPaths(result.diagnostics, {
    deckDirectory,
    outputDirectory,
    workspaceDirectory: repositoryRoot,
  });
  try {
    await Promise.all([
      atomicWriteText(deckIrPath, serializeDeck(result.deck)),
      atomicWriteText(publicDeckIrPath, serializeDeck(publicDeck as DeckIR)),
      atomicWriteText(
        diagnosticsPath,
        `${JSON.stringify(publicDiagnostics, null, 2)}\n`,
      ),
    ]);
  } catch (error) {
    if (options.staging) {
      await rm(outputDirectory, { recursive: true, force: true });
    }
    throw error;
  }
  return {
    deckDirectory,
    outputDirectory,
    finalOutputDirectory,
    deckIrPath,
    publicDeckIrPath,
    diagnosticsPath,
    deck: result.deck,
    diagnostics: result.diagnostics,
  };
}

export async function publishStagedOutput(
  stagingDirectory: string,
  finalDirectory: string,
): Promise<void> {
  const staging = path.resolve(stagingDirectory);
  const destination = path.resolve(finalDirectory);
  if (
    path.dirname(staging) !== path.dirname(destination) ||
    !path.basename(staging).startsWith(`.${path.basename(destination)}.release-`)
  ) {
    throw new Error("Refusing to publish an unexpected staging directory.");
  }
  const stagingStats = await stat(staging);
  if (!stagingStats.isDirectory()) {
    throw new Error("Release staging output is not a directory.");
  }
  const backup = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.backup-${randomUUID()}`,
  );
  let movedExisting = false;
  try {
    await rename(destination, backup);
    movedExisting = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (movedExisting) await rename(backup, destination).catch(() => undefined);
    throw error;
  }
  if (movedExisting) await rm(backup, { recursive: true, force: true });
}

const ARTIFACT_PATH_KEYS = new Set([
  "captionSrc",
  "file",
  "path",
  "posterSrc",
  "source",
  "sourcePath",
  "src",
]);

function portable(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function containedRelative(parent: string, candidate: string): string | undefined {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
    ? relative
    : undefined;
}

function sanitizePath(
  value: string,
  roots: {
    deckDirectory: string;
    outputDirectory: string;
    workspaceDirectory: string;
  },
): string {
  if (!path.isAbsolute(value)) return value;
  const deckPath = containedRelative(roots.deckDirectory, value);
  if (deckPath !== undefined) return `./${portable(deckPath)}`;
  const outputPath = containedRelative(roots.outputDirectory, value);
  if (outputPath !== undefined) return `./${portable(outputPath)}`;
  const workspacePath = containedRelative(roots.workspaceDirectory, value);
  if (workspacePath !== undefined) return `workspace/${portable(workspacePath)}`;
  return `external/${path.basename(value)}`;
}

export function sanitizeArtifactPaths(
  value: unknown,
  roots: {
    deckDirectory: string;
    outputDirectory: string;
    workspaceDirectory: string;
  },
  key?: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeArtifactPaths(item, roots));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeArtifactPaths(child, roots, childKey),
      ]),
    );
  }
  if (typeof value === "string" && key && ARTIFACT_PATH_KEYS.has(key)) {
    return sanitizePath(value, roots);
  }
  return value;
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

  if (process.env.LIVETOON_ALLOW_CUSTOM_THEME !== "1") {
    throw new Error(
      `Custom theme "${reference}" is disabled because theme modules execute code. Use "company" or "default". Set LIVETOON_ALLOW_CUSTOM_THEME=1 only for a theme you trust.`,
    );
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
        kind: element.type,
        slideId,
        elementId: element.id,
        source: element.src,
        ...(element.contentHash ? { sha256: element.contentHash } : {}),
        ...("mimeType" in element && element.mimeType
          ? { mimeType: element.mimeType }
          : {}),
      });
    } else if (element.type === "video" || element.type === "audio") {
      assets.push({
        kind: element.type,
        slideId,
        elementId: element.id,
        source: element.src,
        ...(element.contentHash ? { sha256: element.contentHash } : {}),
        mimeType: element.mimeType,
        ...(element.byteLength !== undefined ? { byteLength: element.byteLength } : {}),
        ...(element.posterSrc
          ? {
              poster: {
                source: element.posterSrc,
                ...(element.posterContentHash
                  ? { sha256: element.posterContentHash }
                  : {}),
                ...(element.posterMimeType ? { mimeType: element.posterMimeType } : {}),
              },
            }
          : {}),
        ...(element.captionSrc
          ? {
              caption: {
                source: element.captionSrc,
                ...(element.captionContentHash
                  ? { sha256: element.captionContentHash }
                  : {}),
                mimeType: "text/vtt",
                ...(element.captionLanguage
                  ? { language: element.captionLanguage }
                  : {}),
                ...(element.captionLabel ? { label: element.captionLabel } : {}),
              },
            }
          : {}),
      });
    }
    if (element.type === "group") {
      walkElements(slideId, element.children, assets);
    }
  }
}

export function collectBuildAssets(
  deck: Pick<DeckIR, "slides">,
): BuildManifest["assets"] {
  const assets: BuildManifest["assets"] = [];
  for (const slide of deck.slides) {
    walkElements(slide.id, slide.elements, assets);
  }
  return assets;
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
  const assets = collectBuildAssets(artifact.deck);
  const count = (severity: Diagnostic["severity"]) =>
    artifact.diagnostics.filter((diagnostic) => diagnostic.severity === severity)
      .length;
  const manifest: BuildManifest = {
    cliVersion: cliVersion(),
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
  return sanitizeArtifactPaths(manifest, {
    deckDirectory: artifact.deckDirectory,
    outputDirectory: artifact.outputDirectory,
    workspaceDirectory: repositoryRoot,
  }) as BuildManifest;
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

export async function startStudio(
  artifact: CompiledArtifact,
  options: {
    port?: number;
    open?: boolean;
    inheritOutput?: boolean;
  } = {},
): Promise<RunningStudio> {
  const port = options.port ?? (await freePort());
  return startPackagedStudio(artifact, repositoryRoot, {
    port,
    open: options.open,
  });
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
