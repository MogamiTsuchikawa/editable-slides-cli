import type { SlideIR } from "@livetoon/slide-deck-ir";
import { describe, expect, it } from "vitest";
import {
  emptyOverrides,
  findOrphanOverrides,
  parseOverrideDocument,
  setFrameOverride,
} from "./overrides.js";

const frame = {
  x: 10,
  y: 20,
  w: 300,
  h: 200,
  rotation: 0,
  zIndex: 4,
};

describe("layout overrides", () => {
  it("rejects invalid frames while retaining valid entries", () => {
    const parsed = parseOverrideDocument({
      schemaVersion: 1,
      slides: {
        intro: {
          title: frame,
          invalid: { ...frame, x: Number.NaN },
        },
      },
    });
    expect(parsed.slides.intro).toEqual({ title: frame });
  });

  it("finds stable orphan element paths", () => {
    let document = emptyOverrides();
    document = setFrameOverride(document, "intro", "missing", frame);
    document = setFrameOverride(document, "gone-slide", "title", frame);
    const slides = [
      {
        id: "intro",
        elements: [],
      },
    ] as unknown as SlideIR[];
    expect(findOrphanOverrides(document, slides)).toEqual([
      "gone-slide/title",
      "intro/missing",
    ]);
  });
});
