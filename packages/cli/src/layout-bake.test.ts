import { describe, expect, it } from "vitest";

import { bakeLayoutOverrides } from "./layout-bake.js";

const SOURCE = `---
schemaVersion: 1
id: bake
title: Bake
theme: default
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: page
    layout: blank
    notes: 説明
    sources: []
---

<Slide id="page">

<Image id="hero" src="./hero.png" alt="製品画像" x={10} y={20} w={300} h={200} />

<Text
  id="copy"
  x={20}
  y={40}
  w={500}
  h={100}
>

本文

</Text>

</Slide>
`;

const TABLE_SOURCE = `---
schemaVersion: 1
id: bake-table
title: Bake table
theme: default
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: page
    layout: blank
    notes: 説明
    sources: []
---

<Slide id="page">

<Table
  id="metrics"
  x={0}
  y={0}
  w={600}
  h={300}
  rows={[[{ value: "見出し", colSpan: 2 }], ["A", "B"]]}
  columnWidths={[200, 400]}
  rowHeights={[100, 200]}
/>

<Table id="implicit" x={0} y={320} w={600} h={300} rows={[["A", "B"]]} />

</Slide>
`;

describe("layout bake", () => {
  it("updates existing props, inserts missing props, and preserves generated overrides", () => {
    const result = bakeLayoutOverrides(
      SOURCE,
      {
        schemaVersion: 1,
        slides: {
          page: {
            hero: { x: 120.25, w: 640, rotation: 4 },
            copy: { y: 180, zIndex: 25 },
            "page--title": { x: 100 },
          },
        },
      },
      "/deck/deck.mdx",
    );

    expect(result.source).toContain('id="hero"');
    expect(result.source).toContain("x={120.25}");
    expect(result.source).toContain("w={640}");
    expect(result.source).toContain("rotation={4}");
    expect(result.source).toMatch(/id="copy"[\s\S]*y=\{180\}/);
    expect(result.source).toContain("zIndex={25}");
    expect(result.baked).toEqual([
      { slideId: "page", elementId: "hero" },
      { slideId: "page", elementId: "copy" },
    ]);
    expect(result.skipped).toEqual([{ slideId: "page", elementId: "page--title" }]);
    expect(result.overrides.slides.page).toEqual({
      "page--title": { x: 100 },
    });
  });

  it("is idempotent after source-backed overrides are removed", () => {
    const first = bakeLayoutOverrides(
      SOURCE,
      { schemaVersion: 1, slides: { page: { hero: { x: 100 } } } },
      "/deck/deck.mdx",
    );
    const second = bakeLayoutOverrides(first.source, first.overrides, "/deck/deck.mdx");
    expect(second.source).toBe(first.source);
    expect(second.baked).toEqual([]);
  });

  it("scales explicit table dimensions with horizontal and vertical overrides", () => {
    const horizontal = bakeLayoutOverrides(
      TABLE_SOURCE,
      { schemaVersion: 1, slides: { page: { metrics: { w: 900 } } } },
      "/deck/deck.mdx",
    );
    expect(horizontal.source).toContain("w={900}");
    expect(horizontal.source).toContain("columnWidths={[300, 600]}");
    expect(horizontal.source).toContain("rowHeights={[100, 200]}");

    const vertical = bakeLayoutOverrides(
      TABLE_SOURCE,
      { schemaVersion: 1, slides: { page: { metrics: { h: 600 } } } },
      "/deck/deck.mdx",
    );
    expect(vertical.source).toContain("h={600}");
    expect(vertical.source).toContain("columnWidths={[200, 400]}");
    expect(vertical.source).toContain("rowHeights={[200, 400]}");
  });

  it("uses baked table dimensions as the source for a later override", () => {
    const first = bakeLayoutOverrides(
      TABLE_SOURCE,
      {
        schemaVersion: 1,
        slides: { page: { metrics: { w: 900, h: 450 } } },
      },
      "/deck/deck.mdx",
    );
    const second = bakeLayoutOverrides(
      first.source,
      {
        schemaVersion: 1,
        slides: { page: { metrics: { w: 450, h: 225 } } },
      },
      "/deck/deck.mdx",
    );
    expect(second.source).toContain("columnWidths={[150, 300]}");
    expect(second.source).toContain("rowHeights={[75, 150]}");
  });

  it("resizes tables without explicit dimensions without inventing size props", () => {
    const result = bakeLayoutOverrides(
      TABLE_SOURCE,
      {
        schemaVersion: 1,
        slides: { page: { implicit: { w: 900, h: 450 } } },
      },
      "/deck/deck.mdx",
    );
    const implicitTag = result.source.match(/<Table id="implicit"[^>]+\/>/)?.[0];
    expect(implicitTag).toContain("w={900}");
    expect(implicitTag).toContain("h={450}");
    expect(implicitTag).not.toContain("columnWidths");
    expect(implicitTag).not.toContain("rowHeights");
  });
});
