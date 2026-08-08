import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  handleApiRequest,
  MAX_SERVED_ASSET_BYTES,
  rewriteAssetSources,
} from "./deck-api.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("rewriteAssetSources", () => {
  it("maps deck-local image paths to the guarded asset endpoint", () => {
    const deckDirectory = path.resolve("/tmp/example-deck");
    const result = rewriteAssetSources(
      {
        slides: [
          {
            elements: [
              {
                id: "diagram",
                type: "image",
                src: path.join(deckDirectory, "assets", "diagram.svg"),
              },
            ],
          },
        ],
      },
      "example",
      deckDirectory,
    ) as {
      slides: Array<{
        elements: Array<{ src: string }>;
      }>;
    };

    expect(result.slides[0]?.elements[0]?.src).toBe(
      "/api/assets/example?path=assets%2Fdiagram.svg",
    );
  });

  it("does not expose paths outside the deck", () => {
    const result = rewriteAssetSources(
      {
        id: "secret",
        type: "image",
        src: "/tmp/other/secret.png",
      },
      "example",
      "/tmp/example-deck",
    ) as { src: string };

    expect(result.src).toBe("/tmp/other/secret.png");
  });

  it("maps local video, poster, and audio paths", () => {
    const deckDirectory = path.resolve("/tmp/example-deck");
    const result = rewriteAssetSources(
      {
        media: [
          {
            id: "movie",
            type: "video",
            src: path.join(deckDirectory, "assets", "movie.mp4"),
            posterSrc: path.join(deckDirectory, "assets", "poster.jpg"),
            captionSrc: path.join(deckDirectory, "assets", "movie.ja.vtt"),
          },
          {
            id: "voice",
            type: "audio",
            src: path.join(deckDirectory, "assets", "voice.m4a"),
          },
          {
            id: "animation",
            type: "image",
            src: path.join(deckDirectory, "assets", "animation.gif"),
            posterFrame: {
              src: path.join(deckDirectory, "assets", "animation-poster.png"),
              mimeType: "image/png",
            },
          },
        ],
      },
      "example",
      deckDirectory,
    ) as {
      media: Array<{
        src: string;
        posterSrc?: string;
        captionSrc?: string;
        posterFrame?: { src: string; mimeType: string };
      }>;
    };

    expect(result.media[0]).toEqual({
      id: "movie",
      type: "video",
      src: "/api/assets/example?path=assets%2Fmovie.mp4",
      posterSrc: "/api/assets/example?path=assets%2Fposter.jpg",
      captionSrc: "/api/assets/example?path=assets%2Fmovie.ja.vtt",
    });
    expect(result.media[1]?.src).toBe("/api/assets/example?path=assets%2Fvoice.m4a");
    expect(result.media[2]?.posterFrame?.src).toBe(
      "/api/assets/example?path=assets%2Fanimation-poster.png",
    );
  });

  it("serves HEAD and a single byte range for media assets", async () => {
    const repositoryRoot = await mkdtemp(joinTmp("livetoon-asset-api-"));
    temporaryDirectories.push(repositoryRoot);
    const deckDirectory = path.join(repositoryRoot, "decks", "media");
    const irPath = path.join(deckDirectory, ".editable-slides", "deck.ir.json");
    const assetPath = path.join(deckDirectory, "assets", "sample.mp4");
    const captionPath = path.join(deckDirectory, "assets", "sample.ja.vtt");
    const unreferencedAssetPath = path.join(
      deckDirectory,
      "assets",
      "unreferenced.mp4",
    );
    const oversizedAssetPath = path.join(deckDirectory, "assets", "oversized.mp4");
    const outsideAssetPath = path.join(repositoryRoot, "outside.mp4");
    const linkedAssetPath = path.join(deckDirectory, "assets", "linked.mp4");
    await Promise.all([
      mkdir(path.dirname(irPath), { recursive: true }),
      mkdir(path.dirname(assetPath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        irPath,
        `${JSON.stringify({
          slides: [
            {
              elements: [
                { type: "video", src: assetPath, captionSrc: captionPath },
                { type: "video", src: oversizedAssetPath },
              ],
            },
          ],
        })}\n`,
        "utf8",
      ),
      writeFile(assetPath, Buffer.from("0123456789")),
      writeFile(captionPath, "WEBVTT\n\n00:00.000 --> 00:01.000\n字幕です。\n", "utf8"),
      writeFile(unreferencedAssetPath, Buffer.from("not referenced")),
      writeFile(oversizedAssetPath, Buffer.from("0")),
      writeFile(outsideAssetPath, Buffer.from("outside")),
    ]);
    await truncate(oversizedAssetPath, MAX_SERVED_ASSET_BYTES + 1);
    await symlink(outsideAssetPath, linkedAssetPath);

    const server = createServer((request, response) => {
      void handleApiRequest(request, response, repositoryRoot).then((handled) => {
        if (!handled) {
          response.statusCode = 404;
          response.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing address");
      const url = `http://127.0.0.1:${address.port}/api/assets/media?path=assets%2Fsample.mp4`;
      const head = await fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe("video/mp4");
      expect(head.headers.get("content-length")).toBe("10");

      const captions = await fetch(
        `http://127.0.0.1:${address.port}/api/assets/media?path=assets%2Fsample.ja.vtt`,
      );
      expect(captions.status).toBe(200);
      expect(captions.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
      expect(await captions.text()).toContain("字幕です。");

      const partial = await fetch(url, { headers: { range: "bytes=2-5" } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(await partial.text()).toBe("2345");

      const invalid = await fetch(url, { headers: { range: "bytes=20-30" } });
      expect(invalid.status).toBe(416);
      expect(invalid.headers.get("content-range")).toBe("bytes */10");

      const unreferenced = await fetch(
        `http://127.0.0.1:${address.port}/api/assets/media?path=assets%2Funreferenced.mp4`,
      );
      expect(unreferenced.status).toBe(403);

      const oversized = await fetch(
        `http://127.0.0.1:${address.port}/api/assets/media?path=assets%2Foversized.mp4`,
        { method: "HEAD" },
      );
      expect(oversized.status).toBe(413);

      const linked = await fetch(
        `http://127.0.0.1:${address.port}/api/assets/media?path=assets%2Flinked.mp4`,
      );
      expect(linked.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

function joinTmp(prefix: string): string {
  return path.join(tmpdir(), prefix);
}
