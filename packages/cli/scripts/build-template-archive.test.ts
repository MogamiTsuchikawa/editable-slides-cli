import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { fromBufferPromise } from "yauzl";
import { companyTheme } from "../../../themes/company/dist/index.js";

import {
  createTemplateArchive,
  writeTemplateArchive,
} from "./build-template-archive.mjs";

const outputDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    outputDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Livetoon template archive", () => {
  it("is deterministic and contains only fixed regular files", async () => {
    const first = await createTemplateArchive();
    const second = await createTemplateArchive();

    expect(first.data.equals(second.data)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toBe(
      "c23acead3caa58157639c53fb1f97db76cb404c9b7a3abeace8d7e44a9ef8bc2",
    );
    expect(first.fileName).toBe("livetoon-template-1.0.0.zip");
    expect(first.manifest.theme).toBe("./theme.json");

    const zip = await fromBufferPromise(first.data, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    const entries: Array<{
      name: string;
      mode: number;
      compressedSize: number;
      uncompressedSize: number;
    }> = [];
    try {
      for await (const entry of zip.eachEntry()) {
        entries.push({
          name: entry.fileName,
          mode: (entry.externalFileAttributes >>> 16) & 0xffff,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
        });
      }
    } finally {
      zip.close();
    }
    expect(entries.map((entry) => entry.name)).toEqual([
      "livetoon-template/deck.mdx",
      "livetoon-template/layout.overrides.json",
      "livetoon-template/template.json",
      "livetoon-template/theme.json",
    ]);
    expect(entries.every((entry) => entry.mode === 0o100644)).toBe(true);
    expect(
      entries.every((entry) => entry.compressedSize === entry.uncompressedSize),
    ).toBe(true);

    const parsedZip = await JSZip.loadAsync(first.data);
    const theme = parsedZip.file("livetoon-template/theme.json");
    if (!theme) throw new Error("theme.json was not found in the archive");
    expect(JSON.parse(await theme.async("text"))).toEqual(
      JSON.parse(JSON.stringify(companyTheme)),
    );
  });

  it("has the same SHA-256 in different time zones", async () => {
    const moduleUrl = pathToFileURL(
      path.resolve("scripts", "build-template-archive.mjs"),
    ).href;
    const source = `import { createTemplateArchive } from ${JSON.stringify(moduleUrl)}; process.stdout.write((await createTemplateArchive()).sha256);`;
    const hashes = await Promise.all(
      ["UTC", "Asia/Tokyo", "America/Los_Angeles"].map(async (timezone) => {
        const result = await execFileAsync(
          process.execPath,
          ["--input-type=module", "--eval", source],
          {
            cwd: path.resolve("."),
            env: { ...process.env, TZ: timezone },
            encoding: "utf8",
          },
        );
        return result.stdout;
      }),
    );

    expect(new Set(hashes)).toEqual(
      new Set(["c23acead3caa58157639c53fb1f97db76cb404c9b7a3abeace8d7e44a9ef8bc2"]),
    );
  });

  it("writes the ZIP and matching SHA-256 sidecar", async () => {
    const outputDirectory = path.join(
      tmpdir(),
      `livetoon-template-archive-${process.pid}-${Date.now()}`,
    );
    outputDirectories.push(outputDirectory);

    const result = await writeTemplateArchive({ outputDirectory });

    expect(await readFile(result.archivePath)).toEqual(result.data);
    expect(await readFile(result.checksumPath, "utf8")).toBe(
      `${result.sha256}  ${result.fileName}\n`,
    );
  }, 15_000);
});
