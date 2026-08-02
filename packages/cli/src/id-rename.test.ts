import { describe, expect, it } from "vitest";

import { renameStableId } from "./id-rename.js";

const SOURCE = `---
schemaVersion: 1
id: rename
title: Rename
theme: default
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: first
    layout: blank
    notes: 説明
    sources: []
---

<Slide id="first">

<Shape id="start" x={100} y={100} w={200} h={100} />
<Shape id="end" x={500} y={100} w={200} h={100} />
<Connector id="arrow" from="start" to="end" x1={300} y1={150} x2={500} y2={150} />

</Slide>
`;

describe("stable ID rename", () => {
  it("renames an element, connector references, and derived override IDs", () => {
    const result = renameStableId(
      SOURCE,
      {
        schemaVersion: 1,
        slides: { first: { start: { x: 120 }, "start--text-a": { y: 130 } } },
      },
      "/deck/deck.mdx",
      { kind: "element", slideId: "first", from: "start", to: "begin" },
    );
    expect(result.source).toContain('id="begin"');
    expect(result.source).toContain('from="begin"');
    expect(result.overrides.slides.first).toEqual({
      begin: { x: 120 },
      "begin--text-a": { y: 130 },
    });
  });

  it("renames a slide in frontmatter, JSX, generated references and overrides", () => {
    const withGeneratedReference = SOURCE.replace('from="start"', 'from="first--body"');
    const result = renameStableId(
      withGeneratedReference,
      {
        schemaVersion: 1,
        slides: { first: { "first--title": { x: 80 }, end: { x: 510 } } },
      },
      "/deck/deck.mdx",
      { kind: "slide", from: "first", to: "intro" },
    );
    expect(result.source).toContain('- id: "intro"');
    expect(result.source).toContain('<Slide id="intro">');
    expect(result.source).toContain('from="intro--body"');
    expect(result.overrides.slides).toEqual({
      intro: { "intro--title": { x: 80 }, end: { x: 510 } },
    });
  });

  it("rejects collisions", () => {
    expect(() =>
      renameStableId(SOURCE, { schemaVersion: 1, slides: {} }, "/deck/deck.mdx", {
        kind: "element",
        slideId: "first",
        from: "start",
        to: "end",
      }),
    ).toThrow("既に使われています");
  });
});
