import { describe, expect, it } from "vitest";

import { companyTheme } from "./index.js";

describe("companyTheme", () => {
  it("provides the complete company layout catalog", () => {
    expect(companyTheme.ir.id).toBe("company");
    expect(Object.keys(companyTheme.layouts).sort()).toEqual(
      [...companyTheme.ir.layoutIds].sort(),
    );
    expect(companyTheme.ir.layoutIds).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it("matches the Livetoon brand tokens and typography", () => {
    expect(companyTheme.ir.colors).toMatchObject({
      canvas: "#FFFFFF",
      text: "#000000",
      brand: "#2896F5",
      brandSoft: "#A9D5FB",
      brandPale: "#D4EAFD",
      lavender: "#C1A5FF",
      pink: "#F1A7FF",
      danger: "#C00000",
      gold: "#AA902E",
    });
    expect(companyTheme.ir.fonts.body.family).toBe("Yu Gothic");
    expect(companyTheme.ir.fonts.code.family).toBe("Arial");
    expect(companyTheme.ir.typography.title.fontSize).toBe(48);
    expect(companyTheme.ir.typography.body.fontSize).toBe(36);
  });

  it("carries authentic brand chrome through theme masters", () => {
    const contentMaster = companyTheme.ir.masters.find(
      (master) => master.id === "livetoon-content",
    );
    expect(contentMaster?.elements).toHaveLength(4);
    expect(
      contentMaster?.elements?.find((element) => element.id === "content-mark"),
    ).toMatchObject({
      type: "image",
      fit: "contain",
      locked: true,
      editable: false,
    });
    const mark = contentMaster?.elements?.find(
      (element) => element.id === "content-mark" && element.type === "image",
    );
    expect(mark && mark.type === "image" ? mark.src : "").toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("reproduces the directional columns, headed columns, and card masters", () => {
    expect(companyTheme.layouts["title-message-two-column"]?.masterId).toBe(
      "livetoon-message",
    );

    const flowLayout = companyTheme.layouts["title-message-two-column-flow"];
    expect(Object.keys(flowLayout?.slots ?? {})).toEqual([
      "title",
      "subtitle",
      "message",
      "leftHeader",
      "left",
      "rightHeader",
      "right",
      "caption",
    ]);
    expect(flowLayout?.slots.left?.frame).toEqual({
      x: 103,
      y: 404,
      w: 769,
      h: 560,
    });
    expect(flowLayout?.slots.left?.textStyle?.fontSize).toBe(32);

    const flowMaster = companyTheme.ir.masters.find(
      (master) => master.id === "livetoon-message-two-column-flow",
    );
    expect(
      flowMaster?.elements?.find((element) => element.id === "two-column-flow-arrow"),
    ).toMatchObject({
      type: "shape",
      shape: "triangle",
      frame: { x: 709, y: 658, w: 502, h: 52 },
      rotation: 90,
      fill: { type: "solid", color: "#D9D9D9" },
    });

    const threeColumnLayout = companyTheme.layouts["title-message-three-column-header"];
    expect(threeColumnLayout?.slots.centerHeader?.frame).toEqual({
      x: 699,
      y: 325,
      w: 521,
      h: 73,
    });
    expect(threeColumnLayout?.slots.center?.textStyle?.fontSize).toBe(32);

    const cardLayout = companyTheme.layouts["title-message-two-card"];
    expect(cardLayout?.slots.leftHeader?.textStyle).toMatchObject({
      color: "#FFFFFF",
      fontSize: 36,
      fontWeight: 400,
      verticalAlign: "middle",
    });
    const cardMaster = companyTheme.ir.masters.find(
      (master) => master.id === "livetoon-message-two-card",
    );
    expect(
      cardMaster?.elements?.find((element) => element.id === "two-card-left-body"),
    ).toMatchObject({
      type: "shape",
      frame: { x: 89, y: 420, w: 797, h: 567 },
      fill: { type: "solid", color: "#F2F2F2" },
    });
  });

  it("exposes machine-readable guidance for authoring agents", () => {
    expect(companyTheme.authoring?.schemaVersion).toBe(1);
    expect(companyTheme.authoring?.typography.languageFonts).toMatchObject({
      japanese: expect.stringContaining("Yu Gothic"),
      alphanumeric: "Arial",
    });
    expect(companyTheme.authoring?.colors.roles.brand.useFor).toContain("見出し罫線");
    expect(companyTheme.authoring?.rules.avoid).toContain(
      "ロゴの変形、再着色、回転、縦横比の変更",
    );
    expect(
      Object.keys(companyTheme.authoring?.colors.roles ?? {}).every((role) =>
        Object.hasOwn(companyTheme.ir.colors, role),
      ),
    ).toBe(true);
    expect(Object.keys(companyTheme.authoring?.layouts ?? {}).sort()).toEqual(
      Object.keys(companyTheme.layouts).sort(),
    );
    expect(Object.keys(companyTheme.authoring?.typography.roles ?? {}).sort()).toEqual([
      "body",
      "caption",
      "code",
      "heading",
      "title",
    ]);
  });
});
