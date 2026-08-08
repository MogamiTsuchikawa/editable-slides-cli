import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { createTemplateArchive } from "./build-template-archive.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "editable-slides-cli-package-"),
);
const installRoot = path.join(temporaryRoot, "consumer");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function isAllowedPackageFile(file) {
  return (
    file === "package.json" ||
    file === "README.md" ||
    file === "LICENSE" ||
    file === "dist/bin/index.js" ||
    file.startsWith("dist/studio/") ||
    file.startsWith("dist/templates/default/")
  );
}

async function readDeckMetadata(deckDirectory) {
  const source = await readFile(path.join(deckDirectory, "deck.mdx"), "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    throw new Error(`Generated deck has no frontmatter: ${deckDirectory}`);
  }
  const metadata = parseYaml(frontmatter[1]);
  if (!metadata || typeof metadata !== "object" || typeof metadata.id !== "string") {
    throw new Error(`Generated deck has no id: ${deckDirectory}`);
  }
  return metadata;
}

function assertGeneratedDeckId(id, label) {
  if (!/^deck-[0-9a-f]{8}$/.test(id)) {
    throw new Error(`${label} generated an unexpected deck id: ${id}`);
  }
}

async function startTemplateServer(archive) {
  const server = createHttpServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/smoke-template.zip") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(archive.byteLength),
      connection: "close",
    });
    response.end(archive);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Could not start the smoke template server.");
  }
  return {
    url: `http://127.0.0.1:${address.port}/smoke-template.zip`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function run(command, args, cwd, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  return `${result.stdout}${result.stderr}`;
}

async function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  return npmCli
    ? run(process.execPath, [npmCli, ...args], cwd)
    : run(npmCommand, args, cwd, { shell: process.platform === "win32" });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a smoke-test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForUrl(url, child, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Installed Studio exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  await runNpm(["run", "build:core"], repositoryRoot);
  await runNpm(["run", "build"], packageRoot);
  await writeFile(
    path.join(temporaryRoot, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  const packed = JSON.parse(
    await runNpm(
      [
        "pack",
        packageRoot,
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        temporaryRoot,
      ],
      temporaryRoot,
    ),
  );
  const filename = packed[0]?.filename;
  if (typeof filename !== "string")
    throw new Error("npm pack did not return a tarball name.");
  const packedFiles = Array.isArray(packed[0]?.files) ? packed[0].files : [];
  const unexpected = packedFiles
    .map((file) => file?.path)
    .filter((file) => typeof file === "string" && !isAllowedPackageFile(file));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected files in package: ${unexpected.join(", ")}`);
  }
  if (typeof packed[0]?.size === "number" && packed[0].size > 25 * 1024 * 1024) {
    throw new Error(`Package is unexpectedly large: ${packed[0].size} bytes.`);
  }

  await mkdir(installRoot, { recursive: true });
  await writeFile(
    path.join(installRoot, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  await runNpm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(temporaryRoot, filename),
    ],
    installRoot,
  );

  const metadata = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  const installedPackageRoot = path.join(
    installRoot,
    "node_modules",
    ...metadata.name.split("/"),
  );
  const forbiddenPublicIdentifiers = /livetoon|tsuchikawa-shuron/i;
  for (const file of packedFiles) {
    const filePath = file?.path;
    if (
      typeof filePath !== "string" ||
      !/[.](?:css|html|js|json|md|mdx|svg)$/i.test(filePath)
    ) {
      continue;
    }
    const contents = await readFile(path.join(installedPackageRoot, filePath), "utf8");
    if (forbiddenPublicIdentifiers.test(contents)) {
      throw new Error(`Private identifier was bundled in ${filePath}.`);
    }
  }

  const slide = path.join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "slide.cmd" : "slide",
  );
  await access(slide);
  const installedBinary = path.join(installedPackageRoot, "dist", "bin", "index.js");
  const slideEnvironment = {
    ...process.env,
    EDITABLE_SLIDES_DATA_HOME: path.join(temporaryRoot, "slide-data"),
  };
  const runSlide = (args, options = {}) =>
    run(process.execPath, [installedBinary, ...args], installRoot, {
      ...options,
      env: {
        ...slideEnvironment,
        ...(options.env ?? {}),
      },
    });
  const shimVersion = (
    await run(slide, ["--version"], installRoot, {
      shell: process.platform === "win32",
    })
  ).trim();
  const version = (await runSlide(["--version"])).trim();
  if (version !== metadata.version) {
    throw new Error(`Version mismatch: expected ${metadata.version}, got ${version}`);
  }
  if (shimVersion !== metadata.version) {
    throw new Error(
      `Installed command shim mismatch: expected ${metadata.version}, got ${shimVersion}`,
    );
  }

  let doctorOutput = "";
  let doctorSucceeded = false;
  try {
    doctorOutput = await runSlide(["doctor"]);
    doctorSucceeded = true;
  } catch (error) {
    doctorOutput = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  }
  for (const required of [
    "Node.js",
    "npm",
    "Chromium",
    "Poppler pdftotext",
    "Poppler pdffonts",
  ]) {
    if (!doctorOutput.includes(required)) {
      throw new Error(`Installed doctor omitted ${required}: ${doctorOutput}`);
    }
  }
  if (
    (process.env.SLIDE_PACKAGE_BROWSER === "1" ||
      process.env.SLIDE_PACKAGE_PDF === "1") &&
    !doctorOutput.includes("✓ Chromium")
  ) {
    throw new Error(`Installed doctor did not find Chromium: ${doctorOutput}`);
  }
  if (process.env.SLIDE_PACKAGE_PDF === "1" && !doctorSucceeded) {
    throw new Error(`Installed doctor did not pass with PDF tools: ${doctorOutput}`);
  }

  const deckTarget = "Package smoke 日本語";
  const deckDirectory = path.join(installRoot, deckTarget);
  await runSlide(["new", deckTarget]);
  const deckMetadata = await readDeckMetadata(deckDirectory);
  const deckId = deckMetadata.id;
  assertGeneratedDeckId(deckId, "Built-in template");
  if (deckMetadata.title !== deckTarget) {
    throw new Error(`Generated deck title mismatch: ${String(deckMetadata.title)}`);
  }
  await runSlide(["lint", deckTarget, "--strict-editable", "--fail-on-warnings"]);

  const templates = await runSlide(["template", "list"]);
  if (!templates.includes("default\tbuilt-in")) {
    throw new Error(`Installed template list omitted default: ${templates}`);
  }
  for (const privateTemplate of ["livetoon\tbuilt-in", "tsuchikawa-shuron\tbuilt-in"]) {
    if (templates.includes(privateTemplate)) {
      throw new Error(`Private template was bundled: ${privateTemplate}`);
    }
  }

  const templateArchive = await createTemplateArchive();
  const templateServer = await startTemplateServer(templateArchive.data);
  try {
    await runSlide([
      "template",
      "add",
      templateServer.url,
      "--name",
      "livetoon-official",
      "--sha256",
      templateArchive.sha256,
    ]);
    const installedTemplates = await runSlide(["template", "list"]);
    if (!installedTemplates.includes("livetoon-official")) {
      throw new Error(
        `Installed template list omitted livetoon-official: ${installedTemplates}`,
      );
    }
    const urlDeckTarget = "URL template smoke 日本語";
    const urlDeckDirectory = path.join(installRoot, urlDeckTarget);
    await runSlide(["new", "-t", "livetoon-official", urlDeckTarget]);
    const urlDeckMetadata = await readDeckMetadata(urlDeckDirectory);
    assertGeneratedDeckId(urlDeckMetadata.id, "URL template");
    await runSlide(["lint", urlDeckTarget, "--strict-editable", "--fail-on-warnings"]);
  } finally {
    await templateServer.close();
  }
  const browserEnabled =
    process.env.SLIDE_PACKAGE_BROWSER === "1" || process.env.SLIDE_PACKAGE_PDF === "1";
  if (browserEnabled) {
    await runSlide([
      "release",
      deckTarget,
      "--format",
      process.env.SLIDE_PACKAGE_PDF === "1" ? "pptx,pdf" : "pptx",
    ]);
    await readFile(path.join(installRoot, "dist", deckId, `${deckId}.pptx`));
    await readFile(path.join(installRoot, "dist", deckId, "slides", "001.png"));
    if (process.env.SLIDE_PACKAGE_PDF === "1") {
      await readFile(path.join(installRoot, "dist", deckId, `${deckId}.pdf`));
    }
  } else {
    await runSlide(["export", deckTarget, "--format", "pptx"]);
    await readFile(path.join(installRoot, "dist", deckId, `${deckId}.pptx`));
  }
  for (const publicArtifact of [
    "deck.ir.json",
    "diagnostics.json",
    "build-manifest.json",
  ]) {
    const contents = await readFile(
      path.join(installRoot, "dist", deckId, publicArtifact),
      "utf8",
    );
    JSON.parse(contents);
    if (contents.includes(installRoot) || contents.includes(temporaryRoot)) {
      throw new Error(`${publicArtifact} leaked an absolute local path.`);
    }
  }

  const port = await freePort();
  const studio = spawn(
    process.execPath,
    [installedBinary, "dev", deckTarget, "--port", String(port)],
    {
      cwd: installRoot,
      env: slideEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let studioError = "";
  studio.stderr.on("data", (chunk) => {
    studioError = `${studioError}${chunk.toString("utf8")}`.slice(-8_000);
  });
  try {
    const response = await waitForUrl(
      `http://127.0.0.1:${port}/edit/${deckId}`,
      studio,
    );
    const html = await response.text();
    if (!html.includes("Editable Slides Studio")) {
      throw new Error("Installed Studio did not serve its application shell.");
    }
    const deckResponse = await waitForUrl(
      `http://127.0.0.1:${port}/api/decks/${deckId}`,
      studio,
    );
    const deck = await deckResponse.json();
    if (deck?.metadata?.id !== deckId) {
      throw new Error("Installed Studio returned the wrong deck.");
    }
  } finally {
    if (studio.exitCode === null && studio.signalCode === null) {
      const exited = new Promise((resolve) => studio.once("exit", resolve));
      studio.kill("SIGTERM");
      await exited;
    }
  }
  if (studio.exitCode && studio.exitCode !== 0) {
    throw new Error(
      `Installed Studio failed: ${studioError || `exit ${studio.exitCode}`}`,
    );
  }
  process.stdout.write(`Package smoke passed: ${filename}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
