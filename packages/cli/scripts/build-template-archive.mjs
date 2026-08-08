import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { companyTheme } from "../../../themes/company/dist/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const defaultSourceDirectory = path.join(repositoryRoot, "templates", "livetoon");
const defaultOutputDirectory = path.join(repositoryRoot, "artifacts", "templates");
const archiveDate = new Date("2000-01-01T00:00:00.000Z");
const archiveWrapper = "livetoon-template";

async function collectFiles(directory, relativeDirectory = "") {
  const current = path.join(directory, relativeDirectory);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const filePath = path.join(directory, relativePath);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Template archives cannot contain symbolic links: ${relativePath}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(directory, relativePath)));
      continue;
    }
    if (!entry.isFile() || !(await lstat(filePath)).isFile()) {
      throw new Error(
        `Template archive contains an unsupported entry: ${relativePath}`,
      );
    }
    files.push({
      absolutePath: filePath,
      relativePath: relativePath.split(path.sep).join("/"),
    });
  }
  return files;
}

function validateManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.schemaVersion !== 1 ||
    manifest.id !== "livetoon" ||
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version) ||
    manifest.entry !== "deck.mdx" ||
    manifest.theme !== "./theme.json"
  ) {
    throw new Error("The Livetoon template manifest is invalid.");
  }
  return manifest;
}

export async function createTemplateArchive(options = {}) {
  const sourceDirectory = path.resolve(
    options.sourceDirectory ?? defaultSourceDirectory,
  );
  const manifest = validateManifest(
    JSON.parse(await readFile(path.join(sourceDirectory, "template.json"), "utf8")),
  );
  const files = await collectFiles(sourceDirectory);
  const paths = files.map((file) => file.relativePath);
  for (const required of ["deck.mdx", "layout.overrides.json", "template.json"]) {
    if (!paths.includes(required)) {
      throw new Error(`The Livetoon template is missing ${required}.`);
    }
  }
  files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.relativePath), Buffer.from(right.relativePath)),
  );
  const zip = new JSZip();
  for (const file of files) {
    zip.file(
      `${archiveWrapper}/${file.relativePath}`,
      await readFile(file.absolutePath),
      {
        createFolders: false,
        date: archiveDate,
        unixPermissions: 0o100644,
      },
    );
  }
  zip.file(`${archiveWrapper}/theme.json`, JSON.stringify(companyTheme), {
    createFolders: false,
    date: archiveDate,
    unixPermissions: 0o100644,
  });
  const data = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
    createFolders: false,
    platform: "UNIX",
    streamFiles: false,
  });
  const sha256 = createHash("sha256").update(data).digest("hex");
  const fileName = `livetoon-template-${manifest.version}.zip`;
  return { data, fileName, manifest, sha256 };
}

export async function writeTemplateArchive(options = {}) {
  const outputDirectory = path.resolve(
    options.outputDirectory ?? defaultOutputDirectory,
  );
  const archive = await createTemplateArchive(options);
  await mkdir(outputDirectory, { recursive: true });
  const archivePath = path.join(outputDirectory, archive.fileName);
  const checksumPath = `${archivePath}.sha256`;
  await Promise.all([
    writeFile(archivePath, archive.data),
    writeFile(checksumPath, `${archive.sha256}  ${archive.fileName}\n`, "utf8"),
  ]);
  return { ...archive, archivePath, checksumPath };
}

function isMainModule() {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
    : false;
}

if (isMainModule()) {
  const result = await writeTemplateArchive();
  process.stdout.write(`Created ${result.archivePath}\n`);
  process.stdout.write(`SHA-256 ${result.sha256}\n`);
}
