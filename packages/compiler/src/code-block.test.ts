import { GroupElementIRSchema } from "@livetoon/slide-deck-ir";
import { companyTheme } from "@livetoon/slide-theme-company";
import { defaultTheme } from "@livetoon/slide-theme-default";
import { describe, expect, it } from "vitest";

import { contrastRatio } from "./accessibility.js";
import {
  type CodeBlockInput,
  CodeBlockValidationError,
  expandCodeBlock,
  tokenizeCode,
  validateCodeBlockInput,
} from "./code-block.js";

const input: CodeBlockInput = {
  id: "sample-code",
  frame: { x: 240, y: 180, w: 1_200, h: 620 },
  sourceLocation: { file: "/deck/deck.mdx", line: 24, column: 1 },
  title: "API example",
  language: "typescript",
  showLineNumbers: true,
  highlightLines: [2],
  code: [
    "const total = values.reduce(",
    "  (sum, value) => sum + value,",
    "  0,",
    ");",
  ].join("\n"),
};

describe("expandCodeBlock", () => {
  it("expands to editable native background, highlights, line numbers, and code text", () => {
    const result = expandCodeBlock(input, defaultTheme);

    expect(result).toEqual(expandCodeBlock(structuredClone(input), defaultTheme));
    expect(result.children.map((element) => element.id)).toEqual([
      "sample-code--background",
      "sample-code--header",
      "sample-code--highlight-2",
      "sample-code--line-numbers",
      "sample-code--code",
    ]);
    expect(result.children.every((element) => element.editable === true)).toBe(true);
    expect(
      result.children.every((element) => ["shape", "text"].includes(element.type)),
    ).toBe(true);
    const code = result.children.find((element) => element.id === "sample-code--code");
    expect(code?.type).toBe("text");
    if (code?.type !== "text") throw new Error("code text missing");
    expect(code.role).toBe("code");
    expect(code.style.fontFace).toBe(defaultTheme.ir.typography.code.fontFace);
    expect(
      code.paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(""),
      ),
    ).toEqual(input.code.split("\n"));
    expect(code.paragraphs.some((paragraph) => paragraph.runs.length > 1)).toBe(true);
    expect(
      code.paragraphs
        .flatMap((paragraph) => paragraph.runs)
        .some((run) => run.color === defaultTheme.ir.colors.brand),
    ).toBe(true);
    const highlight = result.children.find(
      (element) => element.id === "sample-code--highlight-2",
    );
    expect(highlight?.frame.y).toBeCloseTo(
      code.frame.y + code.style.fontSize * ((code.style.lineHeight ?? 1.4) + 0.22),
      2,
    );
    expect(highlight?.frame.h).toBeCloseTo(
      code.style.fontSize * (code.style.lineHeight ?? 1.4),
      2,
    );
    expect(() => GroupElementIRSchema.parse(result)).not.toThrow();
  });

  it("uses absolute child frames contained by the group", () => {
    const result = expandCodeBlock(input, defaultTheme);
    for (const element of result.children) {
      expect(element.frame.x).toBeGreaterThanOrEqual(result.frame.x);
      expect(element.frame.y).toBeGreaterThanOrEqual(result.frame.y);
      expect(element.frame.x + element.frame.w).toBeLessThanOrEqual(
        result.frame.x + result.frame.w + 0.001,
      );
      expect(element.frame.y + element.frame.h).toBeLessThanOrEqual(
        result.frame.y + result.frame.h + 0.001,
      );
    }
  });

  it("keeps three hundred lines inside the minimum supported frame", () => {
    const result = expandCodeBlock(
      {
        ...input,
        frame: { x: 0, y: 0, w: 240, h: 120 },
        padding: 80,
        highlightLines: [300],
        code: Array.from(
          { length: 300 },
          (_, index) => `const line${index} = ${index};`,
        ).join("\n"),
      },
      defaultTheme,
    );
    for (const element of result.children) {
      expect(element.frame.x).toBeGreaterThanOrEqual(0);
      expect(element.frame.y).toBeGreaterThanOrEqual(0);
      expect(element.frame.x + element.frame.w).toBeLessThanOrEqual(240.001);
      expect(element.frame.y + element.frame.h).toBeLessThanOrEqual(120.001);
    }
    expect(() => GroupElementIRSchema.parse(result)).not.toThrow();
  });

  it("keeps blank lines and normalizes Windows line endings", () => {
    const { language: _language, title: _title, ...withoutHeader } = input;
    const result = expandCodeBlock(
      {
        ...withoutHeader,
        showLineNumbers: false,
        highlightLines: [],
        code: "first\r\n\r\nthird",
      },
      defaultTheme,
    );
    expect(result.children.map((element) => element.id)).toEqual([
      "sample-code--background",
      "sample-code--code",
    ]);
    const code = result.children[1];
    if (code?.type !== "text") throw new Error("code text missing");
    expect(
      code.paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(""),
      ),
    ).toEqual(["first", "", "third"]);
  });

  it("maps token categories to deterministic accessible colors", () => {
    const result = expandCodeBlock(
      {
        ...input,
        language: "js",
        highlightLines: [],
        code: 'const value = "x" + 42; // note',
      },
      defaultTheme,
    );
    const code = result.children.find((element) => element.id === "sample-code--code");
    if (code?.type !== "text") throw new Error("code text missing");
    const runs = code.paragraphs[0]?.runs ?? [];
    expect(runs.find((run) => run.text === "const")).toMatchObject({
      color: defaultTheme.ir.colors.brand,
      bold: true,
    });
    for (const run of runs.filter((candidate) => candidate.color)) {
      expect(
        contrastRatio(
          run.color ?? defaultTheme.ir.typography.code.color,
          defaultTheme.ir.colors.surface,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(runs.find((run) => run.text === "// note")).toMatchObject({
      color: defaultTheme.ir.colors.muted,
      italic: true,
    });
  });

  it("keeps syntax colors readable with the company theme", () => {
    const result = expandCodeBlock(
      {
        ...input,
        language: "ts",
        highlightLines: [],
        code: 'const value = "x" + 42; // note',
      },
      companyTheme,
    );
    const code = result.children.find((element) => element.id === "sample-code--code");
    if (code?.type !== "text") throw new Error("code text missing");
    for (const run of code.paragraphs.flatMap((paragraph) => paragraph.runs)) {
      if (!run.color) continue;
      expect(
        contrastRatio(run.color, companyTheme.ir.colors.surface),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("does not mutate input or theme defaults", () => {
    const beforeInput = structuredClone(input);
    const beforeTheme = structuredClone(defaultTheme);
    expandCodeBlock(input, defaultTheme);
    expect(input).toEqual(beforeInput);
    expect(defaultTheme).toEqual(beforeTheme);
  });
});

describe("tokenizeCode", () => {
  it.each([
    ["js", 'const value = "x" + 42; // note'],
    ["typescript", 'const value: string = "x"; return 42; // note'],
    ["json", '{"name": "x", "count": 42, "ok": true} // note'],
    ["python", 'if value == "x": return 42 # note'],
    ["bash", 'if count=42; then echo "x"; fi # note'],
    ["html", '<!-- note --><section data-count="x">42</section>'],
    ["css", '/* note */ color: "red"; width: 42px;'],
  ])("colors strings, numbers, keywords, and comments for %s", (language, source) => {
    const lines = tokenizeCode(source, language);
    const kinds = new Set(lines.flat().map((token) => token.kind));
    expect(kinds.has("string")).toBe(true);
    expect(kinds.has("number")).toBe(true);
    expect(kinds.has("keyword")).toBe(true);
    expect(kinds.has("comment")).toBe(true);
    expect(
      lines.map((tokens) => tokens.map((token) => token.text).join("")).join("\n"),
    ).toBe(source);
  });

  it("keeps unknown languages as one uncolored run per line", () => {
    expect(tokenizeCode("fn main() { 42 }\n// plain", "rust")).toEqual([
      [{ kind: "plain", text: "fn main() { 42 }" }],
      [{ kind: "plain", text: "// plain" }],
    ]);
  });

  it("keeps block comment state across lines", () => {
    const lines = tokenizeCode("/* first\nstill comment */ const value = 2", "js");
    expect(lines[0]).toEqual([{ kind: "comment", text: "/* first" }]);
    expect(lines[1]?.[0]).toEqual({
      kind: "comment",
      text: "still comment */",
    });
    expect(lines[1]?.some((token) => token.kind === "keyword")).toBe(true);
    expect(lines[1]?.some((token) => token.kind === "number")).toBe(true);
  });
});

describe("code block input validation", () => {
  it("rejects invalid IDs, frames, padding, languages, and highlighted lines", () => {
    const invalid = {
      ...input,
      id: "Bad ID",
      frame: { x: -1, y: 0, w: 100, h: 50 },
      language: "<script>",
      padding: 2,
      highlightLines: [0, 5, 2, 2],
    } as CodeBlockInput;
    const paths = validateCodeBlockInput(invalid).map((issue) => issue.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining([
        "id",
        "frame",
        "language",
        "padding",
        "highlightLines.0",
        "highlightLines.1",
        "highlightLines.3",
      ]),
    );
    expect(() => expandCodeBlock(invalid, defaultTheme)).toThrow(
      CodeBlockValidationError,
    );
  });

  it("returns validation issues instead of throwing for absent fields", () => {
    const issues = validateCodeBlockInput({} as CodeBlockInput);
    expect(issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["id", "frame", "sourceLocation", "code"]),
    );
  });
});
