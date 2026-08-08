import { describe, expect, it } from "vitest";

import theme, { tsuchikawaShuronTheme } from "./index.js";

const expectedLayouts = [
  "cover",
  "section",
  "brand",
  "title-body",
  "title-message-body",
  "title-two-column",
  "title-message-two-column",
  "title-message-two-column-flow",
  "title-message-three-column-header",
  "title-message-two-card",
  "title-three-column",
  "title-image-left",
  "title-image-right",
  "title-chart",
  "blank",
];

describe("tsuchikawaShuronTheme", () => {
  it("exports the named theme as the package default", () => {
    expect(theme).toBe(tsuchikawaShuronTheme);
    expect(theme.ir.id).toBe("tsuchikawa-shuron");
    expect(theme.ir.name).toBe("Tsuchikawa Shuron");
  });

  it("provides the complete reusable layout catalog", () => {
    expect(theme.ir.layoutIds).toEqual(expectedLayouts);
    expect(Object.keys(theme.layouts)).toEqual(expectedLayouts);
    expect(Object.keys(theme.authoring?.layouts ?? {})).toEqual(expectedLayouts);

    const masterIds = new Set(theme.ir.masters.map((master) => master.id));
    for (const layout of Object.values(theme.layouts)) {
      expect(masterIds.has(layout.masterId), layout.id).toBe(true);
    }
  });

  it("carries the complete teal source color scheme", () => {
    expect(theme.ir.colors).toMatchObject({
      canvas: "#FFFFFF",
      text: "#000000",
      dark2: "#373545",
      light2: "#CEDBE6",
      brand: "#3494BA",
      accent1: "#3494BA",
      accent2: "#58B6C0",
      accent3: "#75BDA7",
      accent4: "#7A8C8E",
      accent5: "#84ACB6",
      accent6: "#2683C6",
      hyperlink: "#6B9F25",
      followedHyperlink: "#9F6715",
    });
    expect(theme.defaults.chart.colors).toEqual([
      "#3494BA",
      "#58B6C0",
      "#75BDA7",
      "#7A8C8E",
      "#84ACB6",
      "#2683C6",
    ]);
  });

  it("uses a portable Japanese font while retaining source-font provenance", () => {
    expect(theme.ir.fonts.heading.family).toBe("Noto Sans JP");
    expect(theme.ir.fonts.body.family).toBe("Noto Sans JP");
    expect(theme.ir.fonts.body.fallbacks).toContain("UD デジタル 教科書体 NP-B");
    expect(theme.authoring?.typography.languageFonts).toMatchObject({
      source: expect.stringContaining("UD デジタル 教科書体 NP-B"),
      japanese: "Noto Sans JP",
      code: "Noto Sans Mono",
    });
    expect(theme.authoring?.typography.strategy).toContain("未同梱");
  });

  it("reproduces the source cover band and 60pt-equivalent title", () => {
    const master = theme.ir.masters.find(
      (candidate) => candidate.id === "tsuchikawa-cover",
    );
    expect(master?.background).toEqual({ type: "solid", color: "#FFFFFF" });
    expect(master?.elements).toEqual([
      expect.objectContaining({
        id: "cover-blue-band",
        type: "shape",
        frame: { x: 0, y: 177, w: 1920, h: 376 },
        fill: { type: "solid", color: "#3494BA" },
        locked: true,
        editable: false,
      }),
    ]);
    expect(theme.layouts.cover?.slots.title).toMatchObject({
      frame: { x: 240, y: 177, w: 1440, h: 376 },
      textAlign: "center",
      textStyle: {
        color: "#FFFFFF",
        fontSize: 120,
        verticalAlign: "middle",
      },
    });
  });

  it("keeps section, brand, and content masters source-faithful", () => {
    const section = theme.ir.masters.find(
      (candidate) => candidate.id === "tsuchikawa-section",
    );
    expect(section?.background).toEqual({ type: "solid", color: "#FFFFFF" });
    expect(theme.layouts.section?.slots.title).toMatchObject({
      frame: { x: 131, y: 269, w: 1656, h: 449 },
      textAlign: "center",
      textStyle: {
        color: "#000000",
        fontSize: 120,
        verticalAlign: "bottom",
      },
    });
    expect(theme.layouts.section?.slots.body.frame).toEqual({
      x: 131,
      y: 723,
      w: 1656,
      h: 236,
    });

    const brand = theme.ir.masters.find(
      (candidate) => candidate.id === "tsuchikawa-brand",
    );
    expect(brand?.background).toEqual({ type: "solid", color: "#3494BA" });
    expect(theme.layouts.brand?.slots).toEqual({});

    const content = theme.ir.masters.find(
      (candidate) => candidate.id === "tsuchikawa-content",
    );
    expect(content?.elements).toEqual([
      expect.objectContaining({
        id: "content-blue-title-band",
        frame: { x: 0, y: 0, w: 1920, h: 170 },
        fill: { type: "solid", color: "#3494BA" },
      }),
    ]);
    expect(theme.layouts["title-body"]?.slots.title).toMatchObject({
      frame: { x: 61, y: 0, w: 1658, h: 170 },
      textStyle: {
        color: "#FFFFFF",
        fontSize: 88,
        verticalAlign: "bottom",
      },
    });
    expect(theme.layouts["title-body"]?.slots.body.textStyle?.color).toBeUndefined();
    expect(theme.ir.typography.body.fontSize).toBe(56);
    expect(theme.ir.typography.body.color).toBe("#000000");
    expect(theme.layouts["title-two-column"]?.slots.left.textStyle?.fontSize).toBe(56);
  });

  it("keeps every master element and slot inside the 1920x1080 canvas", () => {
    const assertInsideCanvas = (
      frame: { x: number; y: number; w: number; h: number },
      label: string,
    ) => {
      expect(frame.x, `${label} x`).toBeGreaterThanOrEqual(0);
      expect(frame.y, `${label} y`).toBeGreaterThanOrEqual(0);
      expect(frame.w, `${label} width`).toBeGreaterThan(0);
      expect(frame.h, `${label} height`).toBeGreaterThan(0);
      expect(frame.x + frame.w, `${label} right edge`).toBeLessThanOrEqual(1920);
      expect(frame.y + frame.h, `${label} bottom edge`).toBeLessThanOrEqual(1080);
    };

    for (const master of theme.ir.masters) {
      for (const element of master.elements ?? []) {
        assertInsideCanvas(element.frame, `${master.id}/${element.id}`);
      }
    }
    for (const layout of Object.values(theme.layouts)) {
      for (const [slotId, definition] of Object.entries(layout.slots)) {
        assertInsideCanvas(definition.frame, `${layout.id}/${slotId}`);
      }
    }
  });

  it("exposes complete, internally consistent authoring guidance", () => {
    expect(theme.authoring?.schemaVersion).toBe(1);
    expect(theme.authoring?.rules.prefer).toContain(
      "青緑のタイトル帯では白文字、白背景では黒文字を使う",
    );
    expect(theme.authoring?.rules.avoid).toContain(
      "元PPTXに同梱されていないUD デジタル 教科書体 NP-Bへ描画を依存すること",
    );
    expect(
      Object.keys(theme.authoring?.colors.roles ?? {}).every((role) =>
        Object.hasOwn(theme.ir.colors, role),
      ),
    ).toBe(true);
    expect(Object.keys(theme.authoring?.typography.roles ?? {}).sort()).toEqual([
      "body",
      "caption",
      "code",
      "heading",
      "title",
    ]);
  });
});
