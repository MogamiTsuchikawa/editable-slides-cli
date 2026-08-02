import { readFileSync } from "node:fs";

interface PackageMetadata {
  version?: unknown;
}

let cachedVersion: string | undefined;

export function cliVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }
  const packagePaths = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];
  const packagePath = packagePaths.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!packagePath) {
    throw new Error("CLI package metadata could not be found.");
  }
  const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as PackageMetadata;
  if (typeof metadata.version !== "string" || !metadata.version) {
    throw new Error(`CLI version is missing from ${packagePath.pathname}`);
  }
  cachedVersion = metadata.version;
  return cachedVersion;
}
