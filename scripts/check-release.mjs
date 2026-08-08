import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

const rootPackage = await readJson("package.json");
const expectedVersion = rootPackage.version;
const failures = [];
const publicPackage = await readJson("packages/cli/package.json");

if (publicPackage.name !== "editable-slides-cli") {
  failures.push(`public package name is ${publicPackage.name ?? "missing"}`);
}
if (publicPackage.private === true) {
  failures.push("public package must not be private");
}
if (publicPackage.license !== "MIT") {
  failures.push("public package license must be MIT");
}
if (publicPackage.publishConfig?.access !== "public") {
  failures.push("public package publishConfig.access must be public");
}
if (publicPackage.publishConfig?.registry !== "https://registry.npmjs.org/") {
  failures.push("public package registry must be https://registry.npmjs.org/");
}
if (
  publicPackage.repository?.url !==
  "git+https://github.com/MogamiTsuchikawa/editable-slides-cli.git"
) {
  failures.push(
    "public package repository metadata does not match the release repository",
  );
}

for (const workspace of rootPackage.workspaces ?? []) {
  const packagePath = path.join(workspace, "package.json");
  const packageJson = await readJson(packagePath);
  if (packageJson.version !== expectedVersion) {
    failures.push(
      `${packageJson.name ?? workspace}: version ${packageJson.version ?? "missing"} (expected ${expectedVersion})`,
    );
  }
}

const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## [${expectedVersion}]`)) {
  failures.push(`CHANGELOG.md has no section for ${expectedVersion}`);
}

const [rootLicense, packageLicense] = await Promise.all([
  readFile(path.join(root, "LICENSE"), "utf8"),
  readFile(path.join(root, "packages/cli/LICENSE"), "utf8"),
]);
if (rootLicense !== packageLicense) {
  failures.push("packages/cli/LICENSE must match the root LICENSE");
}

const releaseTag = process.env.RELEASE_TAG;
if (releaseTag && releaseTag !== `v${expectedVersion}`) {
  failures.push(`release tag ${releaseTag} does not match v${expectedVersion}`);
}

if (failures.length > 0) {
  throw new Error(`Release metadata check failed:\n- ${failures.join("\n- ")}`);
}

process.stdout.write(`Release metadata OK: ${expectedVersion}\n`);
