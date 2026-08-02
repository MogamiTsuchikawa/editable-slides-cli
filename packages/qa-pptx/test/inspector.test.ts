import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeckIR, ElementBase, TextStyleIR } from "@livetoon/slide-deck-ir";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderPptx } from "../../renderer-pptx/src/index.js";
import {
  assertPptx,
  findLibreOfficeBinary,
  inspectPptx,
  PptxInspectionError,
  smokeTestPptxWithLibreOffice,
} from "../src/index.js";

const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwJ7WQAAAABJRU5ErkJggg==";

const sourceLocation = {
  file: "slides/gallery.mdx",
  line: 1,
  column: 1,
};

const bodyStyle: TextStyleIR = {
  fontFace: "Noto Sans JP",
  fontSize: 18,
  color: "#111111",
  fontWeight: 400,
  align: "left",
  verticalAlign: "top",
  lineHeight: 24,
  letterSpacing: 0,
  textFit: "none",
};

function base(id: string, frame: ElementBase["frame"], zIndex = 10): ElementBase {
  return {
    id,
    frame,
    rotation: 0,
    zIndex,
    opacity: 1,
    sourceLocation,
  };
}

function coreDeck(): DeckIR {
  return {
    schemaVersion: 1,
    metadata: {
      id: "component-gallery",
      title: "Component Gallery",
      author: "Livetoon",
      company: "Livetoon",
      language: "ja-JP",
    },
    canvas: {
      width: 1920,
      height: 1080,
      pptxWidthInch: 13.333333,
      pptxHeightInch: 7.5,
    },
    theme: {
      id: "fixture",
      name: "Fixture",
      colors: {
        background: "#FFFFFF",
        primary: "#3366FF",
      },
      fonts: {
        heading: { family: "Noto Sans JP", fallbacks: [] },
        body: { family: "Noto Sans JP", fallbacks: [] },
        code: { family: "Noto Sans Mono", fallbacks: [] },
        registered: [],
      },
      typography: {
        title: { ...bodyStyle, fontSize: 36, fontWeight: 700 },
        heading: { ...bodyStyle, fontSize: 28, fontWeight: 700 },
        body: bodyStyle,
        caption: { ...bodyStyle, fontSize: 14 },
        code: { ...bodyStyle, fontFace: "Noto Sans Mono", fontSize: 16 },
      },
      safeArea: { x: 60, y: 60, w: 1800, h: 960 },
      layoutIds: ["blank"],
      masters: [
        {
          id: "default",
          background: { type: "solid", color: "#FFFFFF" },
        },
      ],
    },
    slides: [
      {
        id: "gallery",
        sourcePath: "slides/gallery.mdx",
        layoutId: "blank",
        masterId: "default",
        elements: [
          {
            ...base("connector", { x: 80, y: 100, w: 400, h: 180 }, 1),
            type: "connector",
            start: { x: 80, y: 100 },
            end: { x: 480, y: 280 },
            stroke: { color: "#3366FF", width: 2 },
            beginArrow: "none",
            endArrow: "triangle",
            fromElementId: "shape",
            toElementId: "title",
          },
          {
            ...base("line", { x: 80, y: 330, w: 400, h: 0 }, 2),
            type: "line",
            start: { x: 80, y: 330 },
            end: { x: 480, y: 330 },
            stroke: { color: "#333333", width: 1, dash: "dot" },
            beginArrow: "oval",
            endArrow: "stealth",
          },
          {
            ...base("title", { x: 80, y: 30, w: 800, h: 90 }),
            type: "text",
            role: "title",
            paragraphs: [
              {
                runs: [
                  { text: "編集可能な", bold: true },
                  { text: "テキスト", color: "#3366FF" },
                ],
              },
            ],
            style: {
              ...bodyStyle,
              fontSize: 28,
              fontWeight: 700,
            },
          },
          {
            ...base("shape", { x: 520, y: 150, w: 360, h: 180 }),
            type: "shape",
            shape: "roundRect",
            fill: { type: "solid", color: "#EAF0FF" },
            stroke: { color: "#3366FF", width: 2 },
          },
          {
            ...base("image", { x: 920, y: 120, w: 240, h: 180 }),
            type: "image",
            src: PIXEL_PNG,
            fit: "contain",
            role: "content",
            alt: "fixture image",
          },
          {
            ...base("icon", { x: 1200, y: 120, w: 120, h: 120 }),
            type: "icon",
            src: PIXEL_PNG,
            color: "#3366FF",
            alt: "fixture icon",
          },
          {
            ...base("table", { x: 80, y: 400, w: 800, h: 260 }),
            type: "table",
            rows: [
              {
                height: 80,
                cells: [
                  {
                    paragraphs: [{ runs: [{ text: "項目" }] }],
                    fill: { type: "solid", color: "#3366FF" },
                    textStyle: { color: "#FFFFFF", fontWeight: 700 },
                  },
                  {
                    paragraphs: [{ runs: [{ text: "値" }] }],
                    fill: { type: "solid", color: "#3366FF" },
                    textStyle: { color: "#FFFFFF", fontWeight: 700 },
                  },
                ],
              },
              {
                height: 80,
                cells: [
                  { paragraphs: [{ runs: [{ text: "調査" }] }] },
                  { paragraphs: [{ runs: [{ text: "80" }] }] },
                ],
              },
              {
                height: 80,
                cells: [
                  { paragraphs: [{ runs: [{ text: "作成" }] }] },
                  { paragraphs: [{ runs: [{ text: "55" }] }] },
                ],
              },
            ],
            columnWidths: [400, 400],
            style: {
              border: { color: "#D0D0D0", width: 1 },
              headerFill: { type: "solid", color: "#3366FF" },
              bodyFill: { type: "solid", color: "#FFFFFF" },
              text: bodyStyle,
            },
          },
          {
            ...base("bar-chart", { x: 920, y: 360, w: 300, h: 280 }),
            type: "chart",
            chartType: "bar",
            title: "棒",
            series: [
              {
                name: "スコア",
                labels: ["調査", "作成"],
                values: [80, 55],
                color: "#3366FF",
              },
            ],
            style: {
              colors: ["#3366FF"],
              showLegend: false,
              showTitle: true,
              showValue: true,
              showCategoryName: false,
            },
          },
          {
            ...base("line-chart", { x: 1240, y: 360, w: 300, h: 280 }),
            type: "chart",
            chartType: "line",
            title: "線",
            series: [
              {
                name: "スコア",
                labels: ["調査", "作成"],
                values: [80, 55],
              },
            ],
            style: {
              colors: ["#22AA88"],
              showLegend: false,
              showTitle: true,
              showValue: false,
              showCategoryName: false,
            },
          },
          {
            ...base("pie-chart", { x: 1560, y: 360, w: 280, h: 280 }),
            type: "chart",
            chartType: "pie",
            title: "円",
            series: [
              {
                name: "構成",
                labels: ["調査", "作成"],
                values: [80, 55],
              },
            ],
            style: {
              colors: ["#3366FF", "#22AA88"],
              showLegend: true,
              showTitle: true,
              showValue: false,
              showCategoryName: true,
            },
          },
        ],
        notes: {
          markdown: "",
          plainText: "このページでは各要素が編集可能であることを説明する。",
          sources: [
            {
              label: "社内AI活用調査 2026",
              url: "https://example.com/research",
            },
          ],
        },
      },
    ],
    diagnostics: [],
    contentHash: "fixture",
  };
}

async function captionMediaFixture(): Promise<{
  directory: string;
  deck: DeckIR;
  videoCaptionBytes: Buffer;
  audioCaptionBytes: Buffer;
}> {
  const directory = await mkdtemp(join(tmpdir(), "livetoon-qa-captions-"));
  const videoPath = join(directory, "sample.mp4");
  const audioPath = join(directory, "sample.m4a");
  const videoCaptionPath = join(directory, "sample-video.ja.vtt");
  const audioCaptionPath = join(directory, "sample-audio.en.vtt");
  const videoBytes = Buffer.from("00000018667479706d70343200000000", "hex");
  const audioBytes = Buffer.from("00000018667479704d34412000000000", "hex");
  const videoCaptionBytes = Buffer.from(
    "WEBVTT\n\n00:00.000 --> 00:01.500\n動画字幕です。\n",
    "utf8",
  );
  const audioCaptionBytes = Buffer.from(
    "WEBVTT\n\n00:00.000 --> 00:01.250\nAudio captions.\n",
    "utf8",
  );
  await Promise.all([
    writeFile(videoPath, videoBytes),
    writeFile(audioPath, audioBytes),
    writeFile(videoCaptionPath, videoCaptionBytes),
    writeFile(audioCaptionPath, audioCaptionBytes),
  ]);

  const deck = coreDeck();
  const slide = deck.slides[0];
  if (!slide) {
    throw new Error("fixture slide is missing");
  }
  slide.elements = [
    {
      ...base("caption-video", { x: 80, y: 100, w: 800, h: 450 }),
      type: "video",
      src: videoPath,
      contentHash: createHash("sha256").update(videoBytes).digest("hex"),
      mimeType: "video/mp4",
      byteLength: videoBytes.byteLength,
      posterSrc: PIXEL_PNG,
      posterMimeType: "image/png",
      captionSrc: videoCaptionPath,
      captionContentHash: createHash("sha256").update(videoCaptionBytes).digest("hex"),
      captionMimeType: "text/vtt",
      captionLanguage: "ja-JP",
      captionLabel: "日本語字幕",
      fit: "contain",
      alt: "字幕付き製品デモ動画",
    },
    {
      ...base("caption-audio", { x: 80, y: 600, w: 800, h: 120 }),
      type: "audio",
      src: audioPath,
      contentHash: createHash("sha256").update(audioBytes).digest("hex"),
      mimeType: "audio/mp4",
      byteLength: audioBytes.byteLength,
      captionSrc: audioCaptionPath,
      captionContentHash: createHash("sha256").update(audioCaptionBytes).digest("hex"),
      captionMimeType: "text/vtt",
      captionLanguage: "en-US",
      captionLabel: "English captions",
      transcript: "字幕付き音声",
    },
  ];
  slide.notes = { markdown: "", plainText: "", sources: [] };
  return { directory, deck, videoCaptionBytes, audioCaptionBytes };
}

function relationshipElementPattern(relationshipId: string): RegExp {
  const escaped = relationshipId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<Relationship\\b(?=[^>]*\\bId="${escaped}")[^>]*/>`, "g");
}

describe("qa-pptx", () => {
  it("accepts all core DeckIR components as native editable OOXML", async () => {
    const deck = coreDeck();
    const rendered = await renderPptx(deck, { strictEditable: true });
    const report = await inspectPptx(rendered.data, deck, {
      strictEditable: true,
    });

    expect(report.valid, JSON.stringify(report.issues, null, 2)).toBe(true);
    expect(report.slideCount).toBe(1);
    expect(report.notesSlideCount).toBe(1);
    expect(report.expectedEditableObjects).toBe(10);
    expect(report.verifiedNativeObjects).toBe(10);
    expect(report.nativeEditabilityRate).toBe(1);
    expect(report.semanticHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.slides[0]?.objects.map((object) => object.nativeKind)).toEqual(
      expect.arrayContaining([
        "text",
        "shape",
        "line",
        "connector",
        "image",
        "table",
        "chart",
      ]),
    );
    expect(report.slides[0]?.notesText).toContain("[Sources]");
  });

  it("preserves boolean text after merged table cells", async () => {
    const deck = coreDeck();
    const slide = deck.slides[0];
    if (!slide) {
      throw new Error("fixture slide is missing");
    }
    slide.elements = [
      {
        ...base("merged-table", { x: 80, y: 100, w: 900, h: 360 }),
        type: "table",
        columnWidths: [300, 300, 300],
        rows: [
          {
            cells: [
              {
                paragraphs: [{ runs: [{ text: "区分" }] }],
                rowSpan: 2,
              },
              { paragraphs: [{ runs: [{ text: "状態" }] }] },
              { paragraphs: [{ runs: [{ text: "true" }] }], value: true },
            ],
          },
          {
            cells: [
              { paragraphs: [{ runs: [{ text: "確認" }] }] },
              { paragraphs: [{ runs: [{ text: "false" }] }], value: false },
            ],
          },
          {
            cells: [
              {
                paragraphs: [{ runs: [{ text: "まとめ" }] }],
                colSpan: 2,
              },
              { paragraphs: [{ runs: [{ text: "true" }] }], value: true },
            ],
          },
        ],
        style: {
          border: { color: "#D0D0D0", width: 1 },
          headerFill: { type: "solid", color: "#FFFFFF" },
          bodyFill: { type: "solid", color: "#FFFFFF" },
          text: bodyStyle,
        },
      },
    ];
    slide.notes = { markdown: "", plainText: "", sources: [] };

    const rendered = await renderPptx(deck, { strictEditable: true });
    const report = await inspectPptx(rendered.data, deck, {
      strictEditable: true,
    });

    expect(report.valid, JSON.stringify(report.issues, null, 2)).toBe(true);
    expect(report.slides[0]?.objects[0]?.text).toContain("true");
    expect(report.slides[0]?.objects[0]?.text).toContain("false");
  });

  it("accepts a declared full-slide image background", async () => {
    const deck = coreDeck();
    const slide = deck.slides[0];
    if (!slide) {
      throw new Error("fixture slide is missing");
    }
    slide.background = {
      type: "image",
      src: PIXEL_PNG,
      mimeType: "image/png",
      fit: "cover",
      focalPosition: { x: 0.25, y: 0.75 },
    };

    const rendered = await renderPptx(deck, { strictEditable: true });
    const report = await inspectPptx(rendered.data, deck, {
      strictEditable: true,
    });

    expect(report.valid, JSON.stringify(report.issues, null, 2)).toBe(true);
    expect(report.slides[0]?.objects).toContainEqual(
      expect.objectContaining({
        name: "background:gallery",
        nativeKind: "image",
      }),
    );
  });

  it("identifies embedded video and audio and verifies their bytes", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "livetoon-qa-media-"));
    const videoPath = join(fixtureDirectory, "sample.mp4");
    const audioPath = join(fixtureDirectory, "sample.m4a");
    const videoBytes = Buffer.from("00000018667479706d70343200000000", "hex");
    const audioBytes = Buffer.from("00000018667479704d34412000000000", "hex");

    try {
      await Promise.all([
        writeFile(videoPath, videoBytes),
        writeFile(audioPath, audioBytes),
      ]);
      const deck = coreDeck();
      const slide = deck.slides[0];
      if (!slide) {
        throw new Error("fixture slide is missing");
      }
      slide.elements = [
        {
          ...base("video", { x: 80, y: 100, w: 800, h: 450 }),
          type: "video",
          src: videoPath,
          contentHash: createHash("sha256").update(videoBytes).digest("hex"),
          mimeType: "video/mp4",
          byteLength: videoBytes.byteLength,
          posterSrc: PIXEL_PNG,
          posterMimeType: "image/png",
          fit: "contain",
          alt: "製品デモ動画",
        },
        {
          ...base("audio", { x: 80, y: 600, w: 800, h: 120 }),
          type: "audio",
          src: audioPath,
          contentHash: createHash("sha256").update(audioBytes).digest("hex"),
          mimeType: "audio/mp4",
          byteLength: audioBytes.byteLength,
          transcript: "製品紹介のナレーション",
        },
      ];
      slide.notes = { markdown: "", plainText: "", sources: [] };

      const rendered = await renderPptx(deck, { strictEditable: true });
      const report = await inspectPptx(rendered.data, deck, {
        strictEditable: true,
      });
      const mediaObjects = report.slides[0]?.objects.filter(
        (object) => object.nativeKind === "video" || object.nativeKind === "audio",
      );

      expect(report.valid, JSON.stringify(report.issues, null, 2)).toBe(true);
      expect(report.verifiedNativeObjects).toBe(2);
      expect(mediaObjects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "lt:gallery:video",
            nativeKind: "video",
            mediaMimeType: "video/mp4",
            mediaByteLength: videoBytes.byteLength,
            mediaContentHash: createHash("sha256").update(videoBytes).digest("hex"),
          }),
          expect.objectContaining({
            name: "lt:gallery:audio",
            nativeKind: "audio",
            mediaMimeType: "audio/mp4",
            mediaByteLength: audioBytes.byteLength,
            mediaContentHash: createHash("sha256").update(audioBytes).digest("hex"),
          }),
        ]),
      );

      const zip = await JSZip.loadAsync(rendered.data);
      const embeddedVideo = Object.keys(zip.files).find((name) =>
        /^ppt\/media\/.*\.mp4$/.test(name),
      );
      expect(embeddedVideo).toBeTruthy();
      zip.file(embeddedVideo ?? "", Buffer.from("changed"));
      const tampered = await zip.generateAsync({ type: "uint8array" });
      const tamperedReport = await inspectPptx(tampered, deck);
      expect(tamperedReport.valid).toBe(false);
      expect(tamperedReport.issues).toContainEqual(
        expect.objectContaining({
          code: "media.contentHash-mismatch",
          elementId: "video",
        }),
      );
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("verifies embedded video and audio WebVTT tracks against DeckIR", async () => {
    const fixture = await captionMediaFixture();
    try {
      const rendered = await renderPptx(fixture.deck, { strictEditable: true });
      const report = await inspectPptx(rendered.data, fixture.deck, {
        strictEditable: true,
      });

      expect(report.valid, JSON.stringify(report.issues, null, 2)).toBe(true);
      expect(report.verifiedNativeObjects).toBe(2);
      expect(report.slides[0]?.objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "lt:gallery:caption-video",
            nativeKind: "video",
            captionTrackPresent: true,
            captionRelationshipId: expect.any(String),
            captionRelationshipType:
              "http://schemas.microsoft.com/office/2017/04/relationships/track",
            captionTarget: expect.stringMatching(/^ppt\/media\/.*\.vtt$/),
            captionMimeType: "text/vtt",
            captionContentHash: createHash("sha256")
              .update(fixture.videoCaptionBytes)
              .digest("hex"),
            captionLanguage: "ja-JP",
            captionLabel: "日本語字幕",
          }),
          expect.objectContaining({
            name: "lt:gallery:caption-audio",
            nativeKind: "audio",
            captionTrackPresent: true,
            captionRelationshipId: expect.any(String),
            captionRelationshipType:
              "http://schemas.microsoft.com/office/2017/04/relationships/track",
            captionTarget: expect.stringMatching(/^ppt\/media\/.*\.vtt$/),
            captionMimeType: "text/vtt",
            captionContentHash: createHash("sha256")
              .update(fixture.audioCaptionBytes)
              .digest("hex"),
            captionLanguage: "en-US",
            captionLabel: "English captions",
          }),
        ]),
      );
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("recognizes the native a:audioFile form written by PowerPoint", async () => {
    const fixture = await captionMediaFixture();
    try {
      const rendered = await renderPptx(fixture.deck, { strictEditable: true });
      const zip = await JSZip.loadAsync(rendered.data);
      const slideFile = zip.file("ppt/slides/slide1.xml");
      expect(slideFile).not.toBeNull();
      const slideXml = (await slideFile?.async("string")) ?? "";
      const marker = 'name="lt:gallery:caption-audio"';
      const markerIndex = slideXml.indexOf(marker);
      const blockStart = slideXml.lastIndexOf("<p:pic>", markerIndex);
      const blockEndStart = slideXml.indexOf("</p:pic>", markerIndex);
      expect(markerIndex).toBeGreaterThanOrEqual(0);
      expect(blockStart).toBeGreaterThanOrEqual(0);
      expect(blockEndStart).toBeGreaterThanOrEqual(0);
      const blockEnd = blockEndStart + "</p:pic>".length;
      const audioBlock = slideXml
        .slice(blockStart, blockEnd)
        .replace("<a:videoFile", "<a:audioFile")
        .replace("</a:videoFile>", "</a:audioFile>");
      zip.file(
        "ppt/slides/slide1.xml",
        `${slideXml.slice(0, blockStart)}${audioBlock}${slideXml.slice(blockEnd)}`,
      );

      const report = await inspectPptx(
        await zip.generateAsync({ type: "uint8array" }),
        fixture.deck,
        { strictEditable: true },
      );

      expect(report.valid, JSON.stringify(report.issues, null, 2)).toBe(true);
      expect(report.slides[0]?.objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "lt:gallery:caption-audio",
            nativeKind: "audio",
            captionTrackPresent: true,
          }),
        ]),
      );
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("detects modified WebVTT caption bytes", async () => {
    const fixture = await captionMediaFixture();
    try {
      const rendered = await renderPptx(fixture.deck);
      const originalReport = await inspectPptx(rendered.data, fixture.deck);
      const video = originalReport.slides[0]?.objects.find(
        (object) => object.name === "lt:gallery:caption-video",
      );
      expect(video?.captionTarget).toBeTruthy();

      const zip = await JSZip.loadAsync(rendered.data);
      zip.file(
        video?.captionTarget ?? "",
        Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.500\n改ざん済み。\n", "utf8"),
      );
      const tampered = await zip.generateAsync({ type: "uint8array" });
      const report = await inspectPptx(tampered, fixture.deck);

      expect(report.valid).toBe(false);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: "caption.contentHash-mismatch",
          elementId: "caption-video",
        }),
      );
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("detects missing caption relationships, parts, and text/vtt declarations", async () => {
    const fixture = await captionMediaFixture();
    try {
      const rendered = await renderPptx(fixture.deck);
      const originalReport = await inspectPptx(rendered.data, fixture.deck);
      const video = originalReport.slides[0]?.objects.find(
        (object) => object.name === "lt:gallery:caption-video",
      );
      expect(video?.captionRelationshipId).toBeTruthy();
      expect(video?.captionTarget).toBeTruthy();

      const relationshipZip = await JSZip.loadAsync(rendered.data);
      const relationshipsFile = relationshipZip.file(
        "ppt/slides/_rels/slide1.xml.rels",
      );
      expect(relationshipsFile).not.toBeNull();
      const relationshipsXml = await relationshipsFile?.async("string");
      const withoutRelationship = relationshipsXml?.replace(
        relationshipElementPattern(video?.captionRelationshipId ?? ""),
        "",
      );
      expect(withoutRelationship).not.toBe(relationshipsXml);
      relationshipZip.file(
        "ppt/slides/_rels/slide1.xml.rels",
        withoutRelationship ?? "",
      );
      const missingRelationshipReport = await inspectPptx(
        await relationshipZip.generateAsync({ type: "uint8array" }),
        fixture.deck,
      );
      expect(missingRelationshipReport.issues).toContainEqual(
        expect.objectContaining({
          code: "caption.missing-relationship",
          elementId: "caption-video",
        }),
      );

      const partZip = await JSZip.loadAsync(rendered.data);
      partZip.remove(video?.captionTarget ?? "");
      const missingPartReport = await inspectPptx(
        await partZip.generateAsync({ type: "uint8array" }),
        fixture.deck,
      );
      expect(missingPartReport.issues).toContainEqual(
        expect.objectContaining({
          code: "caption.missing-part",
          elementId: "caption-video",
        }),
      );

      const contentTypeZip = await JSZip.loadAsync(rendered.data);
      const contentTypesFile = contentTypeZip.file("[Content_Types].xml");
      expect(contentTypesFile).not.toBeNull();
      const contentTypesXml = await contentTypesFile?.async("string");
      const wrongContentType = contentTypesXml?.replaceAll(
        'ContentType="text/vtt"',
        'ContentType="text/plain"',
      );
      expect(wrongContentType).not.toBe(contentTypesXml);
      contentTypeZip.file("[Content_Types].xml", wrongContentType ?? "");
      const wrongContentTypeReport = await inspectPptx(
        await contentTypeZip.generateAsync({ type: "uint8array" }),
        fixture.deck,
      );
      expect(wrongContentTypeReport.issues).toContainEqual(
        expect.objectContaining({
          code: "caption.content-type-mismatch",
          elementId: "caption-video",
          expected: "text/vtt",
          actual: "text/plain",
        }),
      );
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("detects a connector flattened back to a normal line shape", async () => {
    const deck = coreDeck();
    const rendered = await renderPptx(deck);
    const zip = await JSZip.loadAsync(rendered.data);
    const file = zip.file("ppt/slides/slide1.xml");
    expect(file).not.toBeNull();
    if (!file) {
      throw new Error("slide1.xml is missing");
    }
    const xml = await file.async("string");
    zip.file(
      "ppt/slides/slide1.xml",
      xml
        .replace("<p:cxnSp>", "<p:sp>")
        .replace("</p:cxnSp>", "</p:sp>")
        .replace("<p:nvCxnSpPr>", "<p:nvSpPr>")
        .replace("</p:nvCxnSpPr>", "</p:nvSpPr>")
        .replace("<p:cNvCxnSpPr/>", "<p:cNvSpPr/>"),
    );
    const tampered = await zip.generateAsync({ type: "uint8array" });

    const report = await inspectPptx(tampered, deck, { strictEditable: true });

    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "element.wrong-native-kind",
        elementId: "connector",
        expected: "connector",
        actual: "line",
      }),
    );
  });

  it("rejects an implicit full-slide raster image", async () => {
    const deck = coreDeck();
    const slide = deck.slides[0];
    if (!slide) {
      throw new Error("fixture slide is missing");
    }
    slide.elements = [
      {
        ...base("screenshot", { x: 0, y: 0, w: 1920, h: 1080 }),
        type: "image",
        src: PIXEL_PNG,
        fit: "cover",
        role: "content",
      },
    ];
    slide.notes = {
      markdown: "",
      plainText: "",
      sources: [],
    };
    const rendered = await renderPptx(deck);

    const report = await inspectPptx(rendered.data, deck);

    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "image.implicit-full-slide-raster",
        elementId: "screenshot",
      }),
    );
  });

  it("assertPptx throws a report-bearing error for a malformed package", async () => {
    await expect(
      assertPptx(new TextEncoder().encode("not a pptx")),
    ).rejects.toBeInstanceOf(PptxInspectionError);
  });

  it("opens and renders through LibreOffice when it is available", async () => {
    const binary = await findLibreOfficeBinary();
    const rendered = await renderPptx(coreDeck());
    const result = await smokeTestPptxWithLibreOffice(rendered.data, {
      binary,
      required: Boolean(binary),
    });

    if (binary) {
      expect(result.success, result.error ?? result.output).toBe(true);
      expect(result.generatedPdfBytes).toBeGreaterThan(0);
    } else {
      expect(result.available).toBe(false);
    }
  }, 40_000);
});
