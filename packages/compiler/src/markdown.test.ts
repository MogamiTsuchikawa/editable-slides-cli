import { describe, expect, it } from "vitest";

import { markdownNodesToParagraphs } from "./markdown.js";
import type { AstNode } from "./mdx-ast.js";

describe("markdownNodesToParagraphs", () => {
  it("uses the active theme code font for inline and block code", () => {
    const nodes: AstNode[] = [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Run " },
          { type: "inlineCode", value: "slide release" },
        ],
      },
      { type: "code", value: "slide doctor" },
    ];

    const result = markdownNodesToParagraphs(nodes, "/deck/deck.mdx", "summary", {
      codeFontFace: "Arial",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.paragraphs[0]?.runs[1]).toEqual({
      text: "slide release",
      fontFace: "Arial",
    });
    expect(result.paragraphs[1]?.runs[0]).toEqual({
      text: "slide doctor",
      fontFace: "Arial",
    });
  });
});
