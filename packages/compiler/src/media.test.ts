import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { defaultTheme } from "@livetoon/slide-theme-default";
import { describe, expect, it } from "vitest";
import {
  inspectIsoMedia,
  MAX_CAPTION_ASSET_BYTES,
  MAX_MEDIA_ASSET_BYTES,
  MEDIA_SIZE_WARNING_BYTES,
  mediaSizeIssues,
  readCaptionFile,
} from "./media.js";
import { compileSlide } from "./slide.js";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwJ7WQAAAABJRU5ErkJggg==",
  "base64",
);

function mediaSlide(body: string): string {
  return ["---", "id: media", "layout: blank", "---", "", body].join("\n");
}

function isoBox(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.byteLength + payload.byteLength, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function isoTrack(handlerType: "vide" | "soun"): Buffer {
  const handler = Buffer.alloc(12);
  handler.write(handlerType, 8, 4, "ascii");
  return isoBox("trak", isoBox("mdia", isoBox("hdlr", handler)));
}

function isoMedia(
  handlerType: "vide" | "soun",
  codecs: ReadonlyArray<"avc1" | "mp4a">,
): Buffer {
  return Buffer.concat([
    isoBox("ftyp", Buffer.from("mp42\0\0\0\0mp42", "binary")),
    isoBox("moov", isoTrack(handlerType)),
    isoBox("free", Buffer.from(codecs.join(""), "ascii")),
  ]);
}

describe("media components", () => {
  it("compiles local MP4, M4A, MP3 and PNG poster metadata", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-media-"));
    const sourcePath = path.join(directory, "slide.mdx");
    const videoBytes = isoMedia("vide", ["avc1"]);
    const m4aBytes = isoMedia("soun", ["mp4a"]);
    const mp3Bytes = Buffer.from("49443304000000000000", "hex");
    const videoCaptions = Buffer.from(
      "WEBVTT\n\n00:00.000 --> 00:02.000\n製品デモを開始します。\n",
      "utf8",
    );
    const audioCaptions = Buffer.from(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\n製品紹介です。\n",
      "utf8",
    );

    try {
      await Promise.all([
        writeFile(path.join(directory, "demo.mp4"), videoBytes),
        writeFile(path.join(directory, "narration.m4a"), m4aBytes),
        writeFile(path.join(directory, "music.mp3"), mp3Bytes),
        writeFile(path.join(directory, "poster.png"), PIXEL_PNG),
        writeFile(path.join(directory, "demo.ja.vtt"), videoCaptions),
        writeFile(path.join(directory, "narration.ja.vtt"), audioCaptions),
      ]);
      const result = await compileSlide(
        mediaSlide(
          [
            '<Video id="demo" alt="製品デモ" src="./demo.mp4" poster="./poster.png" captions="./demo.ja.vtt" captionLanguage="ja" captionLabel="日本語字幕" fit="cover" x={80} y={80} w={800} h={450} />',
            '<Audio id="narration" transcript="製品紹介のナレーション" src="./narration.m4a" poster="./poster.png" captions="./narration.ja.vtt" captionLanguage="ja" captionLabel="日本語字幕" x={80} y={600} w={800} h={120} />',
            '<Audio id="music" alt="背景音楽" src="./music.mp3" x={960} y={600} w={800} h={120} />',
          ].join("\n"),
        ),
        sourcePath,
        directory,
        defaultTheme,
      );

      expect(result.diagnostics).toEqual([]);
      expect(result.slide.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "demo",
            type: "video",
            src: expect.stringMatching(/demo\.mp4$/),
            contentHash: createHash("sha256").update(videoBytes).digest("hex"),
            mimeType: "video/mp4",
            byteLength: videoBytes.byteLength,
            posterSrc: expect.stringMatching(/poster\.png$/),
            posterMimeType: "image/png",
            captionSrc: expect.stringMatching(/demo\.ja\.vtt$/),
            captionContentHash: createHash("sha256")
              .update(videoCaptions)
              .digest("hex"),
            captionMimeType: "text/vtt",
            captionLanguage: "ja",
            captionLabel: "日本語字幕",
            fit: "cover",
          }),
          expect.objectContaining({
            id: "narration",
            type: "audio",
            transcript: "製品紹介のナレーション",
            mimeType: "audio/mp4",
            byteLength: m4aBytes.byteLength,
            posterMimeType: "image/png",
            captionSrc: expect.stringMatching(/narration\.ja\.vtt$/),
            captionContentHash: createHash("sha256")
              .update(audioCaptions)
              .digest("hex"),
            captionMimeType: "text/vtt",
            captionLanguage: "ja",
            captionLabel: "日本語字幕",
          }),
          expect.objectContaining({
            id: "music",
            type: "audio",
            mimeType: "audio/mpeg",
            byteLength: mp3Bytes.byteLength,
          }),
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts secure UTF-8 WebVTT captions and rejects unsafe or invalid files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-caption-"));
    const outside = await mkdtemp(path.join(tmpdir(), "livetoon-caption-outside-"));
    const sourcePath = path.join(directory, "slide.mdx");
    const validPath = path.join(directory, "valid.vtt");
    const outsidePath = path.join(outside, "outside.vtt");
    const options = (reference: string) => ({
      deckDirectory: directory,
      sourcePath,
      reference,
    });

    try {
      await Promise.all([
        writeFile(
          validPath,
          "\uFEFFWEBVTT\r\n\r\n00:00.000 --> 00:01.250 align:start\r\n字幕です。\r\n",
          "utf8",
        ),
        writeFile(outsidePath, "WEBVTT\n\n00:00.000 --> 00:01.000\noutside\n", "utf8"),
        writeFile(path.join(directory, "invalid-utf8.vtt"), Buffer.from([0xff])),
        writeFile(
          path.join(directory, "bad-header.vtt"),
          "NOT-WEBVTT\n\n00:00.000 --> 00:01.000\ntext\n",
          "utf8",
        ),
        writeFile(
          path.join(directory, "bad-timing.vtt"),
          "WEBVTT\n\n00:02.000 --> 00:01.000\ntext\n",
          "utf8",
        ),
        writeFile(
          path.join(directory, "too-large.vtt"),
          Buffer.alloc(MAX_CAPTION_ASSET_BYTES + 1),
        ),
      ]);
      await symlink(outsidePath, path.join(directory, "external-link.vtt"));

      await expect(readCaptionFile(options("./valid.vtt"))).resolves.toMatchObject({
        path: expect.stringMatching(/valid\.vtt$/),
        mimeType: "text/vtt",
        text: expect.stringMatching(/^WEBVTT/),
      });
      await expect(
        readCaptionFile(options("./invalid-utf8.vtt")),
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "CAPTION_UTF8_INVALID" }),
        ]),
      });
      await expect(readCaptionFile(options("./bad-header.vtt"))).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "CAPTION_WEBVTT_HEADER_INVALID" }),
        ]),
      });
      await expect(readCaptionFile(options("./bad-timing.vtt"))).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "CAPTION_TIMING_INVALID" }),
        ]),
      });
      await expect(readCaptionFile(options("./too-large.vtt"))).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "ASSET_SIZE_LIMIT_EXCEEDED" }),
        ]),
      });
      await expect(
        readCaptionFile(options("https://example.com/demo.vtt")),
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "ASSET_REMOTE_REFERENCE_FORBIDDEN" }),
        ]),
      });
      await expect(readCaptionFile(options(validPath))).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "ASSET_REFERENCE_ABSOLUTE_FORBIDDEN" }),
        ]),
      });
      await expect(
        readCaptionFile(options("./external-link.vtt")),
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "ASSET_SYMLINK_OUTSIDE_DECK" }),
        ]),
      });
    } finally {
      await Promise.all([
        rm(directory, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  it("rejects remote media and non-PNG video posters", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-media-invalid-"));
    const sourcePath = path.join(directory, "slide.mdx");
    try {
      await Promise.all([
        writeFile(path.join(directory, "demo.mp4"), isoMedia("vide", ["avc1"])),
        writeFile(
          path.join(directory, "poster.jpg"),
          Buffer.from("ffd8ffe000104a4649460001", "hex"),
        ),
      ]);
      const result = await compileSlide(
        mediaSlide(
          [
            '<Video id="remote" alt="remote" src="https://example.com/demo.mp4" poster="./poster.jpg" x={0} y={0} w={800} h={450} />',
            '<Video id="bad-poster" alt="bad poster" src="./demo.mp4" poster="./poster.jpg" x={900} y={0} w={800} h={450} />',
          ].join("\n"),
        ),
        sourcePath,
        directory,
        defaultTheme,
      );

      expect(result.slide.elements).toEqual([]);
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "ASSET_REMOTE_REFERENCE_FORBIDDEN" }),
          expect.objectContaining({
            code: "MDX_COMPONENT_PROPS_INVALID",
            message: expect.stringContaining('"poster" must be a PNG image'),
          }),
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires alt text or a transcript for video and audio", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-media-alt-"));
    const sourcePath = path.join(directory, "slide.mdx");
    try {
      await Promise.all([
        writeFile(path.join(directory, "demo.mp4"), isoMedia("vide", ["avc1"])),
        writeFile(path.join(directory, "poster.png"), PIXEL_PNG),
      ]);
      const result = await compileSlide(
        mediaSlide(
          '<Video id="demo" src="./demo.mp4" poster="./poster.png" x={0} y={0} w={800} h={450} />',
        ),
        sourcePath,
        directory,
        defaultTheme,
      );

      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "ACCESSIBILITY_ALT_REQUIRED" }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates MP4/M4A tracks and recommends H.264/AAC codecs", () => {
    expect(inspectIsoMedia(isoBox("ftyp"), "video")).toContainEqual(
      expect.objectContaining({ code: "MEDIA_MOOV_BOX_MISSING", severity: "error" }),
    );
    expect(inspectIsoMedia(isoMedia("soun", ["mp4a"]), "video")).toContainEqual(
      expect.objectContaining({ code: "MEDIA_REQUIRED_TRACK_MISSING" }),
    );
    expect(inspectIsoMedia(isoMedia("vide", []), "video")).toContainEqual(
      expect.objectContaining({
        code: "MEDIA_VIDEO_CODEC_RECOMMENDED",
        severity: "warning",
      }),
    );
    expect(inspectIsoMedia(isoMedia("soun", []), "audio")).toContainEqual(
      expect.objectContaining({
        code: "MEDIA_AUDIO_CODEC_RECOMMENDED",
        severity: "warning",
      }),
    );
  });

  it("warns above 50 MiB and rejects above 100 MiB", () => {
    expect(mediaSizeIssues(MEDIA_SIZE_WARNING_BYTES + 1)).toContainEqual(
      expect.objectContaining({ code: "MEDIA_FILE_LARGE", severity: "warning" }),
    );
    expect(mediaSizeIssues(MAX_MEDIA_ASSET_BYTES + 1)).toContainEqual(
      expect.objectContaining({ code: "ASSET_SIZE_LIMIT_EXCEEDED", severity: "error" }),
    );
  });
});
