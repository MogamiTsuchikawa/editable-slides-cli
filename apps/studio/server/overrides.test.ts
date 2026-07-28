import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeOverrideDocument, writeOverrideDocumentAtomic } from "./overrides.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("override persistence", () => {
  it("sorts keys and normalizes numeric precision", () => {
    const serialized = serializeOverrideDocument({
      schemaVersion: 1,
      slides: {
        z: {
          b: {
            x: 1.23456,
            y: -0,
            w: 10,
            h: 20,
            rotation: 0,
            zIndex: 3,
          },
        },
        a: {
          a: {
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            rotation: 0,
            zIndex: 0,
          },
        },
      },
    });
    expect(serialized.indexOf('"a"')).toBeLessThan(serialized.indexOf('"z"'));
    expect(serialized).toContain('"x": 1.235');
    expect(serialized).toContain('"y": 0');
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("atomically replaces the target without leaving temp files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "livetoon-overrides-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "layout.overrides.json");
    await writeOverrideDocumentAtomic(filePath, {
      schemaVersion: 1,
      slides: {
        intro: {
          title: {
            x: 10,
            y: 20,
            w: 300,
            h: 120,
            rotation: 0,
            zIndex: 4,
          },
        },
      },
    });

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      slides: { intro: { title: { x: 10 } } },
    });
    expect(await readdir(directory)).toEqual(["layout.overrides.json"]);
  });
});
