import { tmpdir } from "node:os";
import path from "node:path";

import { defaultTheme } from "@editable-slides/slide-theme-default";
import { describe, expect, it } from "vitest";

import { compileSlide } from "./slide.js";

function slide(body: string): string {
  return ["---", "id: presets", "layout: blank", "---", "", body].join("\n");
}

describe("diagram and code authoring components", () => {
  it("compiles six semantic diagram components into editable native groups", async () => {
    const commonItems =
      '[{ key: "a", label: "調査" }, { key: "b", label: "作成" }, { key: "c", label: "確認" }]';
    const result = await compileSlide(
      slide(
        [
          `<Flow id="flow" items={${commonItems}} x={20} y={20} w={600} h={260} />`,
          `<Timeline id="timeline" items={${commonItems}} x={650} y={20} w={600} h={300} />`,
          `<Cycle id="cycle" items={${commonItems}} x={1280} y={20} w={600} h={400} />`,
          `<Funnel id="funnel" items={${commonItems}} x={20} y={350} w={500} h={600} />`,
          '<Matrix id="matrix" rows={[{ key: "r1", label: "重要" }]} columns={[{ key: "c1", label: "緊急" }]} cells={[{ key: "m1", rowKey: "r1", columnKey: "c1", label: "実行" }]} x={550} y={400} w={600} h={400} />',
          '<OrgChart id="org" items={[{ key: "root", label: "責任者" }, { key: "member", label: "担当", parentKey: "root" }]} x={1200} y={480} w={600} h={400} />',
        ].join("\n"),
      ),
      path.join(tmpdir(), "livetoon-preset-components.mdx"),
      tmpdir(),
      defaultTheme,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.slide.elements).toHaveLength(6);
    for (const element of result.slide.elements) {
      expect(element).toMatchObject({ type: "group", editable: true });
      if (element.type === "group") {
        expect(element.children.length).toBeGreaterThan(2);
        expect(element.children.every((child) => child.editable !== false)).toBe(true);
      }
    }
  });

  it("accepts fenced code and preserves syntax colors in editable text runs", async () => {
    const result = await compileSlide(
      slide(
        [
          '<CodeBlock id="sample" title="例" showLineNumbers={true} highlightLines={[2]} x={120} y={120} w={1200} h={600}>',
          "",
          "```ts",
          "const value = 42;",
          "// 説明",
          "```",
          "",
          "</CodeBlock>",
        ].join("\n"),
      ),
      path.join(tmpdir(), "livetoon-code-component.mdx"),
      tmpdir(),
      defaultTheme,
    );

    expect(result.diagnostics).toEqual([]);
    const group = result.slide.elements[0];
    expect(group).toMatchObject({ id: "sample", type: "group" });
    if (group?.type !== "group") throw new Error("Expected code group");
    expect(group.children.map((child) => child.id)).toEqual(
      expect.arrayContaining([
        "sample--background",
        "sample--line-numbers",
        "sample--highlight-2",
        "sample--code",
      ]),
    );
    const code = group.children.find((child) => child.id === "sample--code");
    expect(code?.type).toBe("text");
    if (code?.type !== "text") throw new Error("Expected editable code text");
    expect(code.paragraphs.flatMap((paragraph) => paragraph.runs)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "const", color: expect.any(String) }),
        expect.objectContaining({ text: "42", color: expect.any(String) }),
        expect.objectContaining({ text: "// 説明", color: expect.any(String) }),
      ]),
    );
  });

  it("reports invalid diagram data as a component diagnostic", async () => {
    const result = await compileSlide(
      slide('<Flow id="bad" items={[]} x={20} y={20} w={600} h={260} />'),
      path.join(tmpdir(), "livetoon-invalid-preset.mdx"),
      tmpdir(),
      defaultTheme,
    );
    expect(result.slide.elements).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "MDX_COMPONENT_PROPS_INVALID",
        message: expect.stringContaining("items"),
      }),
    );
  });
});
