import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { compileDeckDirectory } from "@livetoon/slide-compiler";
import { companyTheme } from "@livetoon/slide-theme-company";
import { tsuchikawaShuronTheme } from "@livetoon/slide-theme-tsuchikawa-shuron";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { newCommand } from "./commands.js";
import {
  addTemplateFromUrl,
  listTemplates,
  parseTemplateManifest,
  removeTemplate,
  resolveTemplate,
  resolveTemplateDataHome,
} from "./templates.js";

const temporaryDirectories: string[] = [];
const originalDataHome = process.env.LIVETOON_SLIDE_DATA_HOME;

afterEach(async () => {
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

function validManifest(id = "sales"): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    name: "営業提案テンプレート",
    version: "1.0.0",
    entry: "deck.mdx",
    theme: "company",
  };
}

const templateDeck = `---
schemaVersion: 1
id: template
title: "Template title"
author: Livetoon
company: Livetoon
theme: company
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: cover
    layout: cover
    notes: |
      テンプレートの表紙です。
    sources: []
---

<Slide id="cover">

# __LIVETOON_SLIDE_TITLE__

URLから追加したテンプレート

</Slide>
`;

async function templateZip(
  options: {
    wrapper?: string;
    manifest?: Record<string, unknown> | string | false;
    customize?: (root: JSZip) => void;
  } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  const root = options.wrapper === undefined ? zip : zip.folder(options.wrapper);
  if (!root) throw new Error("Could not create test ZIP root");
  if (options.manifest !== false) {
    const manifest = options.manifest ?? validManifest();
    root.file(
      "template.json",
      typeof manifest === "string"
        ? manifest
        : `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  root.file("deck.mdx", templateDeck);
  root.file(
    "layout.overrides.json",
    `${JSON.stringify({ schemaVersion: 1, slides: {} }, null, 2)}\n`,
  );
  root.file("data/example.json", '{"value":42}\n');
  options.customize?.(root);
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
}

async function withArchiveServer<T>(
  archive: Buffer,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(archive.byteLength),
      connection: "close",
    });
    response.end(archive);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not start test server");
  }
  try {
    return await run(`http://127.0.0.1:${address.port}/template.zip`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function testHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "livetoon-template-test-"));
  temporaryDirectories.push(directory);
  process.env.LIVETOON_SLIDE_DATA_HOME = path.join(directory, "slide-data");
  return directory;
}

describe("template manifest", () => {
  it("accepts the version 1 data-only manifest", () => {
    expect(parseTemplateManifest(JSON.stringify(validManifest()))).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        id: "sales",
        version: "1.0.0",
        entry: "deck.mdx",
        theme: "company",
      }),
    );
  });

  it("rejects executable themes and unknown fields", () => {
    expect(() =>
      parseTemplateManifest(
        JSON.stringify({ ...validManifest(), theme: "./theme.js" }),
      ),
    ).toThrow("限定しています");
    expect(() =>
      parseTemplateManifest(JSON.stringify({ ...validManifest(), scripts: {} })),
    ).toThrow("未対応の項目");
  });
});

describe("built-in templates", () => {
  it("materializes and compiles tsuchikawa-shuron", async () => {
    const root = await testHome();
    const target = path.join(root, "土川修論");

    const resolved = await resolveTemplate("tsuchikawa-shuron");
    expect(resolved).toMatchObject({
      registryName: "tsuchikawa-shuron",
      builtIn: true,
      manifest: { theme: "tsuchikawa-shuron" },
    });

    await newCommand(
      target,
      { template: "tsuchikawa-shuron", title: "土川修士論文" },
      { out: () => {}, error: () => {} },
    );
    const source = await readFile(path.join(target, "deck.mdx"), "utf8");
    expect(source).toContain('theme: "tsuchikawa-shuron"');
    expect(source).toContain("# 土川修士論文");

    const result = await compileDeckDirectory(target, {
      theme: tsuchikawaShuronTheme,
    });
    expect(result.deck.slides).toHaveLength(4);
    expect(result.diagnostics).toEqual([]);

    await expect(removeTemplate("tsuchikawa-shuron")).rejects.toThrow("削除できません");
    await expect(
      addTemplateFromUrl("https://example.com/template.zip", {
        name: "tsuchikawa-shuron",
      }),
    ).rejects.toThrow("上書きできません");
  });
});

describe("template storage locations", () => {
  it("uses each operating system's user data location and supports an override", () => {
    expect(
      resolveTemplateDataHome({
        platform: "darwin",
        userHome: "/Users/tester",
        environment: {},
      }),
    ).toBe("/Users/tester/Library/Application Support/Livetoon Slide");
    expect(
      resolveTemplateDataHome({
        platform: "linux",
        userHome: "/home/tester",
        environment: {},
      }),
    ).toBe("/home/tester/.local/share/livetoon-slide");
    expect(
      resolveTemplateDataHome({
        platform: "win32",
        userHome: "C:\\Users\\tester",
        environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      }),
    ).toContain("Livetoon Slide");
    expect(
      resolveTemplateDataHome({
        platform: "darwin",
        userHome: "/Users/tester",
        environment: { LIVETOON_SLIDE_DATA_HOME: "/tmp/slide-data" },
      }),
    ).toBe("/tmp/slide-data");
  });
});

describe("URL templates", () => {
  it("installs a wrapped ZIP, works offline, and never stores URL query secrets", async () => {
    const root = await testHome();
    const archive = await templateZip({ wrapper: "sales-template" });

    await withArchiveServer(archive, async (url) => {
      const first = await addTemplateFromUrl(`${url}?token=top-secret`);
      expect(first.alreadyInstalled).toBe(false);
      expect(first.summary).toEqual(
        expect.objectContaining({ id: "sales", name: "営業提案テンプレート" }),
      );

      const second = await addTemplateFromUrl(`${url}?token=top-secret`);
      expect(second.alreadyInstalled).toBe(true);
    });

    const metadata = await readFile(
      path.join(
        process.env.LIVETOON_SLIDE_DATA_HOME ?? "",
        "templates",
        "sales",
        "metadata.json",
      ),
      "utf8",
    );
    expect(metadata).not.toContain("top-secret");
    expect(metadata).toContain("?<redacted>");

    const summaries = await listTemplates();
    expect(summaries.map((item) => item.id)).toEqual([
      "livetoon",
      "tsuchikawa-shuron",
      "sales",
    ]);

    const target = path.join(root, "営業提案資料");
    await newCommand(
      target,
      { template: "sales", title: "AI <活用> {2026}\n全社" },
      { out: () => {}, error: () => {} },
    );
    const source = await readFile(path.join(target, "deck.mdx"), "utf8");
    expect(source).toContain('title: "AI <活用> {2026} 全社"');
    expect(source).toContain("# AI &lt;活用&gt; &#123;2026&#125; 全社");
    expect(await readFile(path.join(target, "data", "example.json"), "utf8")).toBe(
      '{"value":42}\n',
    );
    await expect(
      compileDeckDirectory(target, { theme: companyTheme }),
    ).resolves.toEqual(
      expect.objectContaining({
        deck: expect.objectContaining({ slides: expect.any(Array) }),
      }),
    );

    await removeTemplate("sales");
    await expect(resolveTemplate("sales")).rejects.toThrow("登録されていません");
    await expect(access(path.join(target, "deck.mdx"))).resolves.toBeUndefined();
  });

  it("checks an optional archive SHA-256 before creating the data directory", async () => {
    const root = await testHome();
    const archive = await templateZip();
    const actualHash = createHash("sha256").update(archive).digest("hex");

    await withArchiveServer(archive, async (url) => {
      await expect(addTemplateFromUrl(url, { sha256: "0".repeat(64) })).rejects.toThrow(
        "SHA-256が一致しません",
      );
      await expect(addTemplateFromUrl(url, { sha256: actualHash })).resolves.toEqual(
        expect.objectContaining({ alreadyInstalled: false }),
      );
    });

    await expect(
      access(path.join(root, "slide-data", "templates", "sales", "metadata.json")),
    ).resolves.toBeUndefined();
  });

  it("allows the official Livetoon ZIP only under an explicit alias", async () => {
    await testHome();
    const archive = await templateZip({ manifest: validManifest("livetoon") });

    await withArchiveServer(archive, async (url) => {
      await expect(addTemplateFromUrl(url)).rejects.toThrow("--name");
      await expect(
        addTemplateFromUrl(url, { name: "livetoon-official" }),
      ).resolves.toEqual(
        expect.objectContaining({
          summary: expect.objectContaining({ id: "livetoon-official" }),
        }),
      );
    });
  });

  it("rejects non-HTTPS internet URLs before making a request", async () => {
    await expect(addTemplateFromUrl("http://example.com/template.zip")).rejects.toThrow(
      "HTTPS",
    );
    await expect(
      addTemplateFromUrl("https://user:password@example.com/template.zip"),
    ).rejects.toThrow("ユーザー名やパスワード");
  });

  it.each([
    {
      label: "missing manifest",
      archive: () => templateZip({ manifest: false }),
      message: "template.jsonとdeck.mdx",
    },
    {
      label: "invalid manifest",
      archive: () => templateZip({ manifest: "not json" }),
      message: "JSONとして読み取れません",
    },
    {
      label: "script file",
      archive: () =>
        templateZip({ customize: (zip) => zip.file("assets/install.js", "alert(1)") }),
      message: "未対応のファイル",
    },
    {
      label: "secret file",
      archive: () =>
        templateZip({ customize: (zip) => zip.file("data/.env", "TOKEN=secret") }),
      message: "認証情報",
    },
    {
      label: "path traversal",
      archive: () =>
        templateZip({ customize: (zip) => zip.file("assets/../../outside.png", "x") }),
      message: "安全でないパス",
    },
    {
      label: "symlink",
      archive: () =>
        templateZip({
          customize: (zip) =>
            zip.file("assets/link.png", "target", { unixPermissions: 0o120777 }),
        }),
      message: "シンボリックリンク",
    },
  ])("rejects an unsafe ZIP: $label", async ({ archive, message }) => {
    const root = await testHome();
    await withArchiveServer(await archive(), async (url) => {
      await expect(addTemplateFromUrl(url)).rejects.toThrow(message);
    });
    await expect(
      access(path.join(root, "slide-data", "templates", "sales")),
    ).rejects.toEqual(expect.objectContaining({ code: "ENOENT" }));
  });
});
