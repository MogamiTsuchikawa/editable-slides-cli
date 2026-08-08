import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { compileDeckDirectory } from "@editable-slides/slide-compiler";
import { parseDocument } from "yaml";
import { type Entry, fromBufferPromise } from "yauzl";
import { loadDeclarativeTheme } from "./declarative-theme.js";
import {
  BUILT_IN_THEME_IDS,
  type BuiltInThemeId,
  isBuiltInThemeId,
  resolveBuiltInTheme,
} from "./themes.js";

const DEFAULT_BUILT_IN_TEMPLATE = "default";
const BUILT_IN_TEMPLATES = ["default"] as const;
const TEMPLATE_SCHEMA_VERSION = 1;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ARCHIVE_ENTRIES = 1_000;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DECLARATIVE_THEME_REFERENCE = "./theme.json" as const;
const TEMPLATE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ARCHIVE_SIGNATURES = new Set(["504b0304", "504b0506", "504b0708"]);
const ALLOWED_ROOT_FILES = new Set([
  "deck.mdx",
  "layout.overrides.json",
  "LICENSE",
  "NOTICE",
  "README.md",
  "template.json",
  "theme.json",
]);
const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mp3",
  ".mp4",
  ".png",
  ".svg",
  ".vtt",
  ".webp",
]);
const ALLOWED_DATA_EXTENSIONS = new Set([".csv", ".json"]);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SENSITIVE_FILE_NAMES = new Set([
  ".netrc",
  ".npmrc",
  "credentials.json",
  "id_ed25519",
  "id_rsa",
  "service-account.json",
]);
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export interface TemplateManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  entry: "deck.mdx";
  theme: BuiltInThemeId | typeof DECLARATIVE_THEME_REFERENCE;
  description?: string;
  license?: string;
}

interface InstalledTemplateMetadata {
  schemaVersion: 1;
  registryName: string;
  manifest: TemplateManifest;
  archiveSha256: string;
  sourceUrl: string;
  installedAt: string;
}

export interface TemplateSource {
  registryName: string;
  manifest: TemplateManifest;
  filesDirectory: string;
  builtIn: boolean;
}

export interface TemplateSummary {
  id: string;
  name: string;
  version: string;
  theme: string;
  builtIn: boolean;
  sourceUrl?: string;
  archiveSha256?: string;
}

export interface AddTemplateOptions {
  name?: string;
  sha256?: string;
  force?: boolean;
  allowHttp?: boolean;
}

export interface AddedTemplate {
  summary: TemplateSummary;
  alreadyInstalled: boolean;
}

interface ValidatedArchiveEntry {
  entry: Entry;
  relativePath: string;
  directory: boolean;
}

function isBuiltInTemplate(name: string): boolean {
  return (BUILT_IN_TEMPLATES as readonly string[]).includes(name);
}

function builtInTemplateDirectory(name: string): string {
  const root = fileURLToPath(new URL("../templates", import.meta.url));
  return path.join(root, name);
}

function isTemplateTheme(value: string): value is TemplateManifest["theme"] {
  return isBuiltInThemeId(value) || value === DECLARATIVE_THEME_REFERENCE;
}

async function templateTheme(directory: string, manifest: TemplateManifest) {
  if (manifest.theme === DECLARATIVE_THEME_REFERENCE) {
    return loadDeclarativeTheme(path.join(directory, "theme.json"));
  }
  const theme = resolveBuiltInTheme(manifest.theme);
  if (!theme) {
    throw new Error(`組み込みテーマ${manifest.theme}を読み取れません。`);
  }
  return theme;
}

export function resolveTemplateDataHome(
  options: {
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    userHome?: string;
  } = {},
): string {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const userHome = options.userHome ?? homedir();
  const explicit = environment.EDITABLE_SLIDES_DATA_HOME?.trim();
  if (explicit) return path.resolve(explicit);
  if (platform === "darwin") {
    return path.join(userHome, "Library", "Application Support", "Editable Slides");
  }
  if (platform === "win32") {
    return path.join(
      environment.LOCALAPPDATA ??
        environment.APPDATA ??
        path.join(userHome, "AppData", "Local"),
      "Editable Slides",
    );
  }
  return path.join(
    environment.XDG_DATA_HOME ?? path.join(userHome, ".local", "share"),
    "editable-slides",
  );
}

function templatesRoot(): string {
  return path.join(resolveTemplateDataHome(), "templates");
}

function validateTemplateName(name: string, label = "テンプレート名"): string {
  const normalized = name.trim();
  if (!TEMPLATE_NAME_PATTERN.test(normalized)) {
    throw new Error(
      `${label}は英小文字で始め、英小文字・数字・ハイフンだけを64文字以内で指定してください: ${normalized || "(空)"}`,
    );
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function requiredManifestString(
  record: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    hasControlCharacters(value)
  ) {
    throw new Error(`template.jsonの${key}が不正です。`);
  }
  return value;
}

export function parseTemplateManifest(contents: string): TemplateManifest {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw new Error("template.jsonをJSONとして読み取れません。");
  }
  if (!isRecord(value)) {
    throw new Error("template.jsonの内容はオブジェクトで指定してください。");
  }
  const allowedKeys = new Set([
    "description",
    "entry",
    "id",
    "license",
    "name",
    "schemaVersion",
    "theme",
    "version",
  ]);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`template.jsonに未対応の項目があります: ${unknownKeys.join(", ")}`);
  }
  if (value.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
    throw new Error(
      `template.jsonのschemaVersionは${TEMPLATE_SCHEMA_VERSION}を指定してください。`,
    );
  }
  const id = validateTemplateName(
    requiredManifestString(value, "id", 64),
    "template.jsonのid",
  );
  const name = requiredManifestString(value, "name", 100);
  const version = requiredManifestString(value, "version", 80);
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error("template.jsonのversionは1.0.0のような形式で指定してください。");
  }
  const entry = requiredManifestString(value, "entry", 100);
  if (entry !== "deck.mdx") {
    throw new Error("template.jsonのentryはdeck.mdxを指定してください。");
  }
  const theme = requiredManifestString(value, "theme", 100);
  if (!isTemplateTheme(theme)) {
    throw new Error(
      `URLテンプレートのthemeは${BUILT_IN_THEME_IDS.join("、")}または${DECLARATIVE_THEME_REFERENCE}に限定しています。`,
    );
  }
  const description =
    value.description === undefined
      ? undefined
      : requiredManifestString(value, "description", 500);
  const license =
    value.license === undefined
      ? undefined
      : requiredManifestString(value, "license", 100);
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id,
    name,
    version,
    entry,
    theme,
    ...(description ? { description } : {}),
    ...(license ? { license } : {}),
  };
}

async function readManifest(filePath: string): Promise<TemplateManifest> {
  const data = await readFile(filePath);
  if (data.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error("template.jsonが大きすぎます。上限は64KiBです。");
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(data);
  return parseTemplateManifest(decoded);
}

async function ensureSafeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`テンプレート保存先が安全なフォルダではありません: ${directory}`);
  }
}

function safeUrl(url: URL): string {
  return `${url.origin}${url.pathname}${url.search ? "?<redacted>" : ""}`;
}

function parseDownloadUrl(value: string, allowHttp: boolean): URL {
  if (value.length === 0 || value !== value.trim() || hasControlCharacters(value)) {
    throw new Error("テンプレートURLが不正です。");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("テンプレートURLが不正です。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("ユーザー名やパスワードを含むURLは使用できません。");
  }
  if (parsed.hash) {
    throw new Error("テンプレートURLの#以降は削除してください。");
  }
  if (parsed.protocol === "https:") return parsed;
  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname === "::1";
  if (parsed.protocol === "http:" && (loopback || allowHttp)) return parsed;
  throw new Error(
    "テンプレートURLはHTTPSを使用してください。HTTPが必要な場合だけ--allow-httpを指定できます。",
  );
}

async function downloadArchive(
  source: string,
  allowHttp: boolean,
): Promise<{
  data: Buffer;
  displayUrl: string;
}> {
  let current = parseDownloadUrl(source, allowHttp);
  const displayUrl = safeUrl(current);
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal,
        headers: {
          accept: "application/zip, application/octet-stream",
          "accept-encoding": "identity",
          "user-agent": "Editable-Slides-CLI",
        },
      });
    } catch {
      throw new Error(`${displayUrl}からテンプレートを取得できませんでした。`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === MAX_REDIRECTS) {
        throw new Error("テンプレートURLのリダイレクト回数が上限を超えました。");
      }
      const location = response.headers.get("location");
      if (!location) throw new Error("テンプレートURLの転送先が見つかりません。");
      let redirected: URL;
      try {
        redirected = new URL(location, current);
      } catch {
        throw new Error("テンプレートURLの転送先が不正です。");
      }
      current = parseDownloadUrl(redirected.href, allowHttp);
      continue;
    }
    if (!response.ok) {
      throw new Error(`テンプレートの取得に失敗しました（HTTP ${response.status}）。`);
    }
    const contentEncoding = response.headers.get("content-encoding");
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
      throw new Error("圧縮転送された応答は安全に確認できないため使用できません。");
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength) {
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DOWNLOAD_BYTES) {
        throw new Error("テンプレートZIPが大きすぎます。上限は25MiBです。");
      }
    }
    if (!response.body) throw new Error("テンプレートZIPの内容が空です。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_DOWNLOAD_BYTES) {
          await reader.cancel();
          throw new Error("テンプレートZIPが大きすぎます。上限は25MiBです。");
        }
        chunks.push(result.value);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("25MiB")) throw error;
      throw new Error(`${displayUrl}からテンプレートを取得できませんでした。`);
    }
    const data = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      size,
    );
    if (
      data.byteLength < 4 ||
      !ARCHIVE_SIGNATURES.has(data.subarray(0, 4).toString("hex"))
    ) {
      throw new Error("取得したファイルはZIP形式ではありません。");
    }
    return { data, displayUrl };
  }
  throw new Error("テンプレートURLのリダイレクト回数が上限を超えました。");
}

function archiveEntryKind(entry: Entry, fileName: string): "file" | "directory" {
  const nameSaysDirectory = fileName.endsWith("/");
  const origin = entry.versionMadeBy >> 8;
  if (origin === 3) {
    const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const kind = mode & 0o170000;
    if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) {
      throw new Error(`ZIPにシンボリックリンクなどの未対応項目があります: ${fileName}`);
    }
    if (kind === 0o040000 && !nameSaysDirectory) {
      throw new Error(`ZIP内のフォルダ情報が一致しません: ${fileName}`);
    }
    if (kind === 0o100000 && nameSaysDirectory) {
      throw new Error(`ZIP内のファイル情報が一致しません: ${fileName}`);
    }
  }
  return nameSaysDirectory ? "directory" : "file";
}

function normalizeArchivePath(fileName: string): string {
  if (
    !fileName ||
    fileName.includes("\\") ||
    hasControlCharacters(fileName) ||
    fileName.startsWith("/") ||
    /^[A-Za-z]:/.test(fileName)
  ) {
    throw new Error(`ZIP内に安全でないパスがあります: ${fileName}`);
  }
  const withoutTrailingSlash = fileName.endsWith("/")
    ? fileName.slice(0, -1)
    : fileName;
  const segments = withoutTrailingSlash.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("~") ||
        segment.length > 120 ||
        /[<>:"|?*]/.test(segment) ||
        /[. ]$/.test(segment) ||
        WINDOWS_RESERVED_NAME.test(segment),
    )
  ) {
    throw new Error(`ZIP内に安全でないパスがあります: ${fileName}`);
  }
  const normalized = segments.join("/").normalize("NFC");
  if (normalized.length > 240) {
    throw new Error(`ZIP内のパスが長すぎます: ${fileName}`);
  }
  return normalized;
}

function isMacMetadata(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return (
    segments[0] === "__MACOSX" ||
    segments.some((segment) => segment === ".DS_Store" || segment.startsWith("._"))
  );
}

function sensitiveFileName(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase();
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    SENSITIVE_FILE_NAMES.has(name) ||
    [".key", ".p12", ".pem", ".pfx"].includes(path.posix.extname(name))
  );
}

function validateTemplatePath(relativePath: string, directory: boolean): void {
  if (sensitiveFileName(relativePath)) {
    throw new Error(
      `ZIPに認証情報の可能性があるファイルを含められません: ${relativePath}`,
    );
  }
  const [root, ...rest] = relativePath.split("/");
  if (directory) {
    if (root !== "assets" && root !== "data") {
      throw new Error(`ZIPに未対応のフォルダがあります: ${relativePath}`);
    }
    return;
  }
  if (rest.length === 0) {
    if (!ALLOWED_ROOT_FILES.has(root ?? "")) {
      throw new Error(`ZIPに未対応のファイルがあります: ${relativePath}`);
    }
    return;
  }
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (root === "assets" && ALLOWED_ASSET_EXTENSIONS.has(extension)) return;
  if (root === "data" && ALLOWED_DATA_EXTENSIONS.has(extension)) return;
  throw new Error(`ZIPに未対応のファイルがあります: ${relativePath}`);
}

function validatePathCollisions(entries: ValidatedArchiveEntry[]): void {
  const paths = new Map<string, "file" | "directory">();
  for (const item of entries) {
    const folded = item.relativePath.normalize("NFC").toLowerCase();
    if (paths.has(folded)) {
      throw new Error(
        `ZIP内で大文字・小文字を区別できないパスが重複しています: ${item.relativePath}`,
      );
    }
    const segments = folded.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join("/");
      if (paths.get(parent) === "file") {
        throw new Error(
          `ZIP内でファイルとフォルダが衝突しています: ${item.relativePath}`,
        );
      }
    }
    paths.set(folded, item.directory ? "directory" : "file");
  }
  for (const [entryPath, kind] of paths) {
    if (kind !== "file") continue;
    if ([...paths.keys()].some((candidate) => candidate.startsWith(`${entryPath}/`))) {
      throw new Error(`ZIP内でファイルとフォルダが衝突しています: ${entryPath}`);
    }
  }
}

async function inspectArchiveEntries(data: Buffer): Promise<{
  zipFile: Awaited<ReturnType<typeof fromBufferPromise>>;
  entries: ValidatedArchiveEntry[];
}> {
  let zipFile: Awaited<ReturnType<typeof fromBufferPromise>>;
  try {
    zipFile = await fromBufferPromise(data, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch {
    throw new Error("ZIPの構造を読み取れません。");
  }
  try {
    if (zipFile.entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new Error(
        `ZIP内の項目数が多すぎます。上限は${MAX_ARCHIVE_ENTRIES}件です。`,
      );
    }
    const rawEntries: Array<{
      entry: Entry;
      normalizedPath: string;
      directory: boolean;
    }> = [];
    let declaredTotal = 0;
    for await (const entry of zipFile.eachEntry()) {
      const normalizedPath = normalizeArchivePath(entry.fileName);
      const kind = archiveEntryKind(entry, entry.fileName);
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error(`暗号化または未対応形式のZIP項目があります: ${normalizedPath}`);
      }
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        entry.uncompressedSize > MAX_SINGLE_FILE_BYTES
      ) {
        throw new Error(`ZIP内のファイルが大きすぎます: ${normalizedPath}`);
      }
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > MAX_EXTRACTED_BYTES) {
        throw new Error("ZIP展開後の合計サイズが上限の100MiBを超えています。");
      }
      rawEntries.push({ entry, normalizedPath, directory: kind === "directory" });
    }
    const relevant = rawEntries.filter((item) => !isMacMetadata(item.normalizedPath));
    const relevantFiles = relevant.filter((item) => !item.directory);
    const rootHasDeck = relevantFiles.some(
      (item) => item.normalizedPath === "deck.mdx",
    );
    let wrapper: string | undefined;
    if (!rootHasDeck) {
      const roots = new Set(
        relevantFiles.map((item) => item.normalizedPath.split("/")[0]),
      );
      if (roots.size === 1) {
        wrapper = [...roots][0];
      }
    }
    const prefix = wrapper ? `${wrapper}/` : "";
    const entries: ValidatedArchiveEntry[] = [];
    for (const item of relevant) {
      if (wrapper && item.normalizedPath === wrapper && item.directory) continue;
      if (prefix && !item.normalizedPath.startsWith(prefix)) {
        throw new Error("ZIPはルート直下、または1つのフォルダ内にまとめてください。");
      }
      const relativePath = prefix
        ? item.normalizedPath.slice(prefix.length)
        : item.normalizedPath;
      if (!relativePath) continue;
      validateTemplatePath(relativePath, item.directory);
      entries.push({
        entry: item.entry,
        relativePath,
        directory: item.directory,
      });
    }
    validatePathCollisions(entries);
    const files = new Set(
      entries.filter((item) => !item.directory).map((item) => item.relativePath),
    );
    if (!files.has("template.json") || !files.has("deck.mdx")) {
      throw new Error("ZIPにはtemplate.jsonとdeck.mdxが必要です。");
    }
    const manifestEntry = entries.find((item) => item.relativePath === "template.json");
    if (!manifestEntry || manifestEntry.entry.uncompressedSize > MAX_MANIFEST_BYTES) {
      throw new Error("template.jsonが大きすぎます。上限は64KiBです。");
    }
    return { zipFile, entries };
  } catch (error) {
    zipFile.close();
    if (
      error instanceof Error &&
      (error.message.includes("invalid relative path") ||
        error.message.includes("invalid characters in fileName"))
    ) {
      throw new Error("ZIP内に安全でないパスがあります。");
    }
    throw error;
  }
}

async function extractArchive(
  data: Buffer,
  destination: string,
): Promise<TemplateManifest> {
  const { zipFile, entries } = await inspectArchiveEntries(data);
  let actualTotal = 0;
  try {
    for (const item of entries) {
      const outputPath = path.resolve(destination, item.relativePath);
      const relativeOutput = path.relative(destination, outputPath);
      if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
        throw new Error(`ZIP内に安全でないパスがあります: ${item.relativePath}`);
      }
      if (item.directory) {
        await mkdir(outputPath, { recursive: true, mode: 0o700 });
        continue;
      }
      await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      const input = await zipFile.openReadStreamPromise(item.entry);
      let fileSize = 0;
      let crc32 = 0xffffffff;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          fileSize += chunk.byteLength;
          actualTotal += chunk.byteLength;
          for (const byte of chunk) {
            crc32 = (crc32 >>> 8) ^ (CRC32_TABLE[(crc32 ^ byte) & 0xff] ?? 0);
          }
          if (
            fileSize > MAX_SINGLE_FILE_BYTES ||
            actualTotal > MAX_EXTRACTED_BYTES ||
            fileSize > item.entry.uncompressedSize
          ) {
            callback(new Error("ZIP展開後のサイズが上限を超えています。"));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        input,
        meter,
        createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
      );
      if (fileSize !== item.entry.uncompressedSize) {
        throw new Error(`ZIP内のファイルサイズが一致しません: ${item.relativePath}`);
      }
      if ((crc32 ^ 0xffffffff) >>> 0 !== item.entry.crc32 >>> 0) {
        throw new Error(`ZIP内のファイルが破損しています: ${item.relativePath}`);
      }
    }
  } finally {
    zipFile.close();
  }
  return readManifest(path.join(destination, "template.json"));
}

async function validateTemplateDeck(
  directory: string,
  manifest: TemplateManifest,
): Promise<void> {
  try {
    await compileDeckDirectory(directory, {
      theme: await templateTheme(directory, manifest),
    });
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`テンプレートのdeck.mdxを安全な資料として読み取れません${reason}`);
  }
}

function validateExpectedHash(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("--sha256は64文字の16進数で指定してください。");
  }
  return normalized;
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

function toSummary(
  registryName: string,
  manifest: TemplateManifest,
  options: {
    builtIn: boolean;
    sourceUrl?: string;
    archiveSha256?: string;
  },
): TemplateSummary {
  return {
    id: registryName,
    name: manifest.name,
    version: manifest.version,
    theme: manifest.theme,
    builtIn: options.builtIn,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    ...(options.archiveSha256 ? { archiveSha256: options.archiveSha256 } : {}),
  };
}

function parseInstalledMetadata(contents: string): InstalledTemplateMetadata {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw new Error("登録済みテンプレートの管理情報を読み取れません。");
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== TEMPLATE_SCHEMA_VERSION ||
    typeof value.registryName !== "string" ||
    typeof value.archiveSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.archiveSha256) ||
    typeof value.sourceUrl !== "string" ||
    typeof value.installedAt !== "string" ||
    !isRecord(value.manifest)
  ) {
    throw new Error("登録済みテンプレートの管理情報が不正です。");
  }
  const manifest = parseTemplateManifest(JSON.stringify(value.manifest));
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    registryName: validateTemplateName(value.registryName),
    manifest,
    archiveSha256: value.archiveSha256,
    sourceUrl: value.sourceUrl,
    installedAt: value.installedAt,
  };
}

async function readInstalledMetadata(
  directory: string,
): Promise<InstalledTemplateMetadata> {
  return parseInstalledMetadata(
    await readFile(path.join(directory, "metadata.json"), "utf8"),
  );
}

export async function addTemplateFromUrl(
  source: string,
  options: AddTemplateOptions = {},
): Promise<AddedTemplate> {
  const requestedName =
    options.name === undefined
      ? undefined
      : validateTemplateName(options.name, "--name");
  if (requestedName && isBuiltInTemplate(requestedName)) {
    throw new Error(`組み込みテンプレート${requestedName}は上書きできません。`);
  }
  const expectedHash = validateExpectedHash(options.sha256);
  const downloaded = await downloadArchive(source, options.allowHttp ?? false);
  const archiveSha256 = createHash("sha256").update(downloaded.data).digest("hex");
  if (expectedHash && expectedHash !== archiveSha256) {
    throw new Error(
      `ZIPのSHA-256が一致しません（実際: ${archiveSha256}）。登録は行いませんでした。`,
    );
  }
  const root = templatesRoot();
  await ensureSafeDirectory(root);
  const temporaryRoot = await mkdtemp(path.join(root, ".install-"));
  const filesDirectory = path.join(temporaryRoot, "files");
  await mkdir(filesDirectory, { mode: 0o700 });
  let destination: string | undefined;
  let backup: string | undefined;
  try {
    const manifest = await extractArchive(downloaded.data, filesDirectory);
    const registryName = requestedName ?? manifest.id;
    if (isBuiltInTemplate(registryName)) {
      throw new Error(
        `組み込みテンプレート${registryName}は上書きできません。別名で登録する場合は--nameを指定してください。`,
      );
    }
    await validateTemplateDeck(filesDirectory, manifest);
    destination = path.join(root, registryName);
    const exists = await pathExists(destination);
    if (exists) {
      const current = await readInstalledMetadata(destination).catch(() => undefined);
      if (current?.archiveSha256 === archiveSha256) {
        return {
          summary: toSummary(registryName, current.manifest, {
            builtIn: false,
            sourceUrl: current.sourceUrl,
            archiveSha256: current.archiveSha256,
          }),
          alreadyInstalled: true,
        };
      }
      if (!options.force) {
        throw new Error(
          `テンプレート${registryName}は既に登録されています。置き換える場合は--forceを指定してください。`,
        );
      }
    }
    const metadata: InstalledTemplateMetadata = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      registryName,
      manifest,
      archiveSha256,
      sourceUrl: downloaded.displayUrl,
      installedAt: new Date().toISOString(),
    };
    await writeFile(
      path.join(temporaryRoot, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    if (exists) {
      backup = path.join(root, `.backup-${registryName}-${randomUUID()}`);
      await rename(destination, backup);
    }
    try {
      await rename(temporaryRoot, destination);
    } catch (error) {
      if (backup) await rename(backup, destination).catch(() => undefined);
      throw error;
    }
    if (backup) await rm(backup, { recursive: true, force: true });
    return {
      summary: toSummary(registryName, manifest, {
        builtIn: false,
        sourceUrl: downloaded.displayUrl,
        archiveSha256,
      }),
      alreadyInstalled: false,
    };
  } finally {
    if (!destination || (await pathExists(temporaryRoot))) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const summaries = await Promise.all(
    BUILT_IN_TEMPLATES.map(async (registryName) => {
      const manifest = await readManifest(
        path.join(builtInTemplateDirectory(registryName), "template.json"),
      );
      return toSummary(registryName, manifest, { builtIn: true });
    }),
  );
  const root = templatesRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      isBuiltInTemplate(entry.name)
    ) {
      continue;
    }
    const metadata = await readInstalledMetadata(path.join(root, entry.name));
    summaries.push(
      toSummary(metadata.registryName, metadata.manifest, {
        builtIn: false,
        sourceUrl: metadata.sourceUrl,
        archiveSha256: metadata.archiveSha256,
      }),
    );
  }
  return summaries;
}

export async function removeTemplate(name: string): Promise<void> {
  const registryName = validateTemplateName(name);
  if (isBuiltInTemplate(registryName)) {
    throw new Error(`組み込みテンプレート${registryName}は削除できません。`);
  }
  const root = templatesRoot();
  await ensureSafeDirectory(root);
  const destination = path.join(root, registryName);
  const stats = await lstat(destination).catch(() => undefined);
  if (!stats) throw new Error(`テンプレート${registryName}は登録されていません。`);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`テンプレート${registryName}の保存先が安全ではありません。`);
  }
  await rm(destination, { recursive: true });
}

export async function resolveTemplate(
  name: string | undefined,
): Promise<TemplateSource> {
  const registryName = validateTemplateName(name ?? DEFAULT_BUILT_IN_TEMPLATE);
  if (isBuiltInTemplate(registryName)) {
    const directory = builtInTemplateDirectory(registryName);
    return {
      registryName,
      manifest: await readManifest(path.join(directory, "template.json")),
      filesDirectory: directory,
      builtIn: true,
    };
  }
  const directory = path.join(templatesRoot(), registryName);
  const stats = await lstat(directory).catch(() => undefined);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      `テンプレート${registryName}は登録されていません。slide template listで確認してください。`,
    );
  }
  const metadata = await readInstalledMetadata(directory);
  if (metadata.registryName !== registryName) {
    throw new Error(`テンプレート${registryName}の管理情報が一致しません。`);
  }
  return {
    registryName,
    manifest: metadata.manifest,
    filesDirectory: path.join(directory, "files"),
    builtIn: false,
  };
}

function mdxPlainText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

function customizeDeckSource(
  source: string,
  values: { id: string; title: string; theme: string },
): string {
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) {
    throw new Error("テンプレートのdeck.mdxにYAML frontmatterがありません。");
  }
  const document = parseDocument(match[1], { keepSourceTokens: true });
  if (document.errors.length > 0 || !isRecord(document.toJS())) {
    throw new Error("テンプレートのdeck.mdxにあるYAMLを読み取れません。");
  }
  document.set("id", values.id);
  document.set("title", values.title);
  document.set("theme", values.theme);
  const body = source
    .slice(match[0].length)
    .replaceAll("__EDITABLE_SLIDES_ID__", values.id)
    .replaceAll("__EDITABLE_SLIDES_TITLE__", mdxPlainText(values.title))
    .replaceAll("__EDITABLE_SLIDES_THEME__", mdxPlainText(values.theme));
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n${body}`;
}

async function copyTemplateTree(
  sourceDirectory: string,
  destinationDirectory: string,
  values: { id: string; title: string; theme: string },
  relativeDirectory = "",
): Promise<void> {
  const currentSource = path.join(sourceDirectory, relativeDirectory);
  const entries = await readdir(currentSource, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (!relativeDirectory && entry.name === "template.json") continue;
    const sourcePath = path.join(sourceDirectory, relativePath);
    const destinationPath = path.join(destinationDirectory, relativePath);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `テンプレートにシンボリックリンクは使用できません: ${relativePath}`,
      );
    }
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true, mode: 0o700 });
      await copyTemplateTree(
        sourceDirectory,
        destinationDirectory,
        values,
        relativePath,
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`テンプレートに未対応の項目があります: ${relativePath}`);
    }
    await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
    if (relativePath === "deck.mdx") {
      const customized = customizeDeckSource(
        await readFile(sourcePath, "utf8"),
        values,
      );
      await writeFile(destinationPath, customized, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } else {
      await writeFile(destinationPath, await readFile(sourcePath), {
        flag: "wx",
        mode: 0o600,
      });
    }
  }
}

export async function materializeTemplate(
  template: TemplateSource,
  destination: string,
  values: { id: string; title: string; theme?: string },
): Promise<void> {
  const stats = await lstat(template.filesDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      `テンプレート${template.registryName}の保存先が安全ではありません。`,
    );
  }
  await copyTemplateTree(template.filesDirectory, destination, {
    id: values.id,
    title: values.title,
    theme: values.theme ?? template.manifest.theme,
  });
  await Promise.all([
    mkdir(path.join(destination, "assets"), { recursive: true, mode: 0o700 }),
    mkdir(path.join(destination, "data"), { recursive: true, mode: 0o700 }),
  ]);
}
