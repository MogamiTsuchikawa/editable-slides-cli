import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "./index.js";
import { cliVersion } from "./version.js";

const temporaryDirectories: string[] = [];
const originalDataHome = process.env.LIVETOON_SLIDE_DATA_HOME;

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalDataHome === undefined) {
    delete process.env.LIVETOON_SLIDE_DATA_HOME;
  } else {
    process.env.LIVETOON_SLIDE_DATA_HOME = originalDataHome;
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI arguments", () => {
  it("prints the package version", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["--version"]);

    expect(output).toHaveBeenCalledWith(cliVersion());
  });

  it("prints command-specific help without running the command", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["release", "--help"]);

    expect(output).toHaveBeenCalledWith(expect.stringContaining("slide release"));
    expect(output).toHaveBeenCalledWith(expect.stringContaining("厳格な検査"));
  });

  it("rejects extra deck arguments", async () => {
    await expect(main(["new", "decks/one", "decks/two"])).rejects.toThrow(
      "Unexpected argument: decks/two",
    );
  });

  it("accepts -t before a Japanese deck name", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "livetoon-slide-cli-new-"));
    temporaryDirectories.push(parent);
    const target = path.join(parent, "資料名");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["new", "-t", "livetoon", target]);

    const source = await readFile(path.join(target, "deck.mdx"), "utf8");
    expect(source).toContain('title: "資料名"');
    expect(source).toMatch(/id: deck-[0-9a-f]{8}/);
    expect(source).toContain('theme: "company"');
  });

  it("creates a deck from the tsuchikawa-shuron built-in template", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "tsuchikawa-shuron-cli-new-"));
    temporaryDirectories.push(parent);
    const target = path.join(parent, "土川修士論文");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["new", "-t", "tsuchikawa-shuron", target]);

    const source = await readFile(path.join(target, "deck.mdx"), "utf8");
    expect(source).toContain('title: "土川修士論文"');
    expect(source).toContain('theme: "tsuchikawa-shuron"');
    expect(source).toContain("# 土川修士論文");
  });

  it("lists the built-in template through the template command", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "livetoon-slide-cli-template-"));
    temporaryDirectories.push(parent);
    process.env.LIVETOON_SLIDE_DATA_HOME = path.join(parent, "slide-data");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["template", "list"]);

    expect(output).toHaveBeenCalledWith(expect.stringContaining("livetoon\tbuilt-in"));
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining("tsuchikawa-shuron\tbuilt-in"),
    );
  });

  it("rejects arguments passed to doctor", async () => {
    await expect(main(["doctor", "extra"])).rejects.toThrow(
      "Unexpected argument: extra",
    );
  });
});
