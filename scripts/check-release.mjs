import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

const rootPackage = await readJson("package.json");
const expectedVersion = rootPackage.version;
const failures = [];

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

if (failures.length > 0) {
  throw new Error(`Release metadata check failed:\n- ${failures.join("\n- ")}`);
}

process.stdout.write(`Release metadata OK: ${expectedVersion}\n`);
