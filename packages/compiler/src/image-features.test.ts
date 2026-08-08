import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { defaultTheme } from "@editable-slides/slide-theme-default";
import { describe, expect, it } from "vitest";

import { compileSlide } from "./slide.js";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwJ7WQAAAABJRU5ErkJggg==",
  "base64",
);
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);

function slideSource(image: string): string {
  return ["---", "id: image", "layout: blank", "---", "", image].join("\n");
}

describe("Image expression features", () => {
  it("compiles crop, focal point, mask, border, shadow and GIF posterFrame", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-image-"));
    const sourcePath = path.join(directory, "slide.mdx");
    try {
      await Promise.all([
        writeFile(path.join(directory, "demo.gif"), PIXEL_GIF),
        writeFile(path.join(directory, "poster.png"), PIXEL_PNG),
      ]);
      const result = await compileSlide(
        slideSource(
          '<Image id="hero" alt="製品デモ" src="./demo.gif" posterFrame="./poster.png" crop={{ left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 }} focalPosition={{ x: 0.3, y: 0.7 }} mask="roundRect" cornerRadius={32} border={{ color: "#3366FF", width: 3, dash: "dash" }} shadow={{ color: "#000000", opacity: 0.25, blur: 12, distance: 6, angle: 45 }} x={100} y={100} w={800} h={450} />',
        ),
        sourcePath,
        directory,
        defaultTheme,
      );

      expect(result.diagnostics).toEqual([]);
      expect(result.slide.elements[0]).toMatchObject({
        id: "hero",
        type: "image",
        mimeType: "image/gif",
        fit: "crop",
        crop: { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 },
        focalPosition: { x: 0.3, y: 0.7 },
        mask: { type: "roundRect", radius: 32 },
        border: { color: "#3366FF", width: 3, dash: "dash" },
        shadow: {
          color: "#000000",
          opacity: 0.25,
          blur: 12,
          distance: 6,
          angle: 45,
        },
        posterFrame: {
          src: expect.stringMatching(/poster\.png$/),
          mimeType: "image/png",
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires a PNG posterFrame for GIF print output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-image-gif-"));
    const sourcePath = path.join(directory, "slide.mdx");
    try {
      await writeFile(path.join(directory, "demo.gif"), PIXEL_GIF);
      const result = await compileSlide(
        slideSource(
          '<Image id="hero" src="./demo.gif" x={100} y={100} w={800} h={450} />',
        ),
        sourcePath,
        directory,
        defaultTheme,
      );

      expect(result.slide.elements).toEqual([]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "MDX_COMPONENT_PROPS_INVALID",
          message: expect.stringContaining("posterFrame"),
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("compiles a local image as the formal slide background", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "livetoon-background-"));
    const sourcePath = path.join(directory, "slide.mdx");
    try {
      await writeFile(path.join(directory, "background.png"), PIXEL_PNG);
      const result = await compileSlide(
        [
          "---",
          "id: background",
          "layout: blank",
          "background:",
          "  src: ./background.png",
          "  fit: cover",
          "  focalPosition:",
          "    x: 0.25",
          "    y: 0.75",
          "---",
        ].join("\n"),
        sourcePath,
        directory,
        defaultTheme,
      );

      expect(result.diagnostics).toEqual([]);
      expect(result.slide.background).toMatchObject({
        type: "image",
        src: expect.stringMatching(/background\.png$/),
        mimeType: "image/png",
        fit: "cover",
        focalPosition: { x: 0.25, y: 0.75 },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
