import { chmod, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const outputRoot = path.join(packageRoot, "dist");
const binaryPath = path.join(outputRoot, "bin", "index.js");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.dirname(binaryPath), { recursive: true });

await esbuild({
  entryPoints: [path.join(packageRoot, "src", "index.ts")],
  outfile: binaryPath,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: false,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  external: ["playwright"],
  logLevel: "info",
});
await chmod(binaryPath, 0o755);

await cp(
  path.join(repositoryRoot, "themes", "company", "assets"),
  path.join(outputRoot, "assets"),
  { recursive: true },
);
await cp(path.join(packageRoot, "templates"), path.join(outputRoot, "templates"), {
  recursive: true,
});

await viteBuild({
  root: path.join(repositoryRoot, "apps", "studio"),
  configFile: path.join(repositoryRoot, "apps", "studio", "vite.config.ts"),
  build: {
    outDir: path.join(outputRoot, "studio"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
