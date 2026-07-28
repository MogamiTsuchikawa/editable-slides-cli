import {
  type ResolvedThemeIR,
  ResolvedThemeIRSchema,
  type TextStyleIR,
} from "@livetoon/slide-deck-ir";

import type {
  LayoutDefinition,
  LayoutSlotDefinition,
  ThemeDefinition,
} from "./types.js";

const colors = {
  canvas: "#FFFFFF",
  text: "#172033",
  muted: "#5F6B7A",
  brand: "#2857D9",
  brandSoft: "#EAF0FF",
  accent: "#00A58E",
  border: "#CBD3DF",
  surface: "#F5F7FA",
  danger: "#D92D20",
} as const;

function textStyle(
  fontSize: number,
  fontWeight: number,
  color: string,
  overrides: Partial<TextStyleIR> = {},
): TextStyleIR {
  return {
    fontFace: "Noto Sans JP",
    fontSize,
    color,
    fontWeight,
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.35,
    textFit: "none",
    ...overrides,
  };
}

const themeIR: ResolvedThemeIR = ResolvedThemeIRSchema.parse({
  id: "default",
  name: "Livetoon Default",
  colors,
  fonts: {
    heading: {
      family: "Noto Sans JP",
      fallbacks: ["Noto Sans JP Variable", "Hiragino Sans", "Yu Gothic", "Arial"],
    },
    body: {
      family: "Noto Sans JP",
      fallbacks: ["Noto Sans JP Variable", "Hiragino Sans", "Yu Gothic", "Arial"],
    },
    code: {
      family: "Noto Sans Mono",
      fallbacks: ["Noto Sans Mono Variable", "SFMono-Regular", "Consolas", "monospace"],
    },
    registered: [
      {
        family: "Noto Sans JP",
        weight: 400,
        style: "normal",
        source: "system",
        license: "OFL-1.1",
      },
      {
        family: "Noto Sans JP",
        weight: 700,
        style: "normal",
        source: "system",
        license: "OFL-1.1",
      },
      {
        family: "Noto Sans Mono",
        weight: 400,
        style: "normal",
        source: "system",
        license: "OFL-1.1",
      },
    ],
  },
  typography: {
    title: textStyle(60, 700, colors.text, {
      lineHeight: 1.2,
      verticalAlign: "middle",
    }),
    heading: textStyle(40, 700, colors.text, { lineHeight: 1.25 }),
    body: textStyle(30, 400, colors.text),
    caption: textStyle(18, 400, colors.muted, { lineHeight: 1.3 }),
    code: textStyle(24, 400, colors.text, {
      fontFace: "Noto Sans Mono",
      lineHeight: 1.4,
    }),
  },
  safeArea: { x: 96, y: 72, w: 1728, h: 936 },
  layoutIds: [
    "cover",
    "section",
    "title-body",
    "title-two-column",
    "title-image-left",
    "title-image-right",
    "title-chart",
    "blank",
  ],
  masters: [
    {
      id: "default",
      background: { type: "solid", color: colors.canvas },
    },
    {
      id: "section",
      background: { type: "solid", color: colors.brand },
    },
  ],
});

function slot(
  frame: LayoutSlotDefinition["frame"],
  typography: LayoutSlotDefinition["typography"],
  zIndex: number,
  textAlign?: LayoutSlotDefinition["textAlign"],
  textStyle?: LayoutSlotDefinition["textStyle"],
): LayoutSlotDefinition {
  const definition: LayoutSlotDefinition = { frame, typography, zIndex };
  if (textAlign) {
    definition.textAlign = textAlign;
  }
  if (textStyle) {
    definition.textStyle = textStyle;
  }
  return definition;
}

function layout(
  definition: Omit<LayoutDefinition, "masterId"> &
    Partial<Pick<LayoutDefinition, "masterId">>,
): LayoutDefinition {
  return {
    masterId: "default",
    ...definition,
  };
}

const layouts: Record<string, LayoutDefinition> = {
  cover: layout({
    id: "cover",
    label: "表紙",
    slots: {
      title: slot({ x: 160, y: 240, w: 1600, h: 300 }, "title", 10),
      body: slot({ x: 160, y: 600, w: 1400, h: 220 }, "body", 20),
      caption: slot({ x: 160, y: 900, w: 1600, h: 80 }, "caption", 30),
    },
  }),
  section: layout({
    id: "section",
    label: "セクション",
    masterId: "section",
    background: { type: "solid", color: colors.brand },
    slots: {
      title: slot({ x: 160, y: 350, w: 1600, h: 260 }, "title", 10, "center", {
        color: colors.canvas,
      }),
      body: slot({ x: 280, y: 650, w: 1360, h: 160 }, "body", 20, "center", {
        color: colors.canvas,
      }),
    },
  }),
  "title-body": layout({
    id: "title-body",
    label: "タイトル＋本文",
    slots: {
      title: slot({ x: 120, y: 72, w: 1680, h: 140 }, "title", 10),
      body: slot({ x: 120, y: 250, w: 1680, h: 730 }, "body", 20),
      caption: slot({ x: 120, y: 985, w: 1680, h: 55 }, "caption", 30),
    },
  }),
  "title-two-column": layout({
    id: "title-two-column",
    label: "タイトル＋2カラム",
    slots: {
      title: slot({ x: 120, y: 72, w: 1680, h: 140 }, "title", 10),
      body: slot({ x: 120, y: 250, w: 800, h: 720 }, "body", 20),
      left: slot({ x: 120, y: 250, w: 800, h: 720 }, "body", 20),
      right: slot({ x: 1000, y: 250, w: 800, h: 720 }, "body", 20),
      caption: slot({ x: 120, y: 985, w: 1680, h: 55 }, "caption", 30),
    },
  }),
  "title-image-left": layout({
    id: "title-image-left",
    label: "タイトル＋左画像",
    slots: {
      title: slot({ x: 120, y: 72, w: 1680, h: 140 }, "title", 10),
      image: slot({ x: 120, y: 250, w: 760, h: 650 }, "body", 20),
      body: slot({ x: 960, y: 250, w: 840, h: 650 }, "body", 20),
      right: slot({ x: 960, y: 250, w: 840, h: 650 }, "body", 20),
      caption: slot({ x: 120, y: 930, w: 1680, h: 70 }, "caption", 30),
    },
  }),
  "title-image-right": layout({
    id: "title-image-right",
    label: "タイトル＋右画像",
    slots: {
      title: slot({ x: 120, y: 72, w: 1680, h: 140 }, "title", 10),
      body: slot({ x: 120, y: 250, w: 840, h: 650 }, "body", 20),
      left: slot({ x: 120, y: 250, w: 840, h: 650 }, "body", 20),
      image: slot({ x: 1040, y: 250, w: 760, h: 650 }, "body", 20),
      caption: slot({ x: 120, y: 930, w: 1680, h: 70 }, "caption", 30),
    },
  }),
  "title-chart": layout({
    id: "title-chart",
    label: "タイトル＋チャート",
    slots: {
      title: slot({ x: 120, y: 72, w: 1680, h: 140 }, "title", 10),
      body: slot({ x: 120, y: 250, w: 500, h: 650 }, "body", 20),
      chart: slot({ x: 680, y: 250, w: 1120, h: 650 }, "body", 20),
      caption: slot({ x: 120, y: 930, w: 1680, h: 70 }, "caption", 30),
    },
  }),
  blank: layout({
    id: "blank",
    label: "自由配置",
    slots: {
      title: slot({ x: 96, y: 72, w: 1728, h: 140 }, "title", 10),
      body: slot({ x: 96, y: 240, w: 1728, h: 768 }, "body", 20),
    },
  }),
};

export const defaultTheme: ThemeDefinition = {
  ir: themeIR,
  layouts,
  defaults: {
    shape: {
      fill: { type: "solid", color: colors.brandSoft },
      stroke: { color: colors.brand, width: 2, dash: "solid" },
    },
    table: {
      border: { color: colors.border, width: 1, dash: "solid" },
      headerFill: { type: "solid", color: colors.brandSoft },
      bodyFill: { type: "solid", color: colors.canvas },
      text: {
        ...themeIR.typography.body,
        fontSize: 22,
      },
    },
    chart: {
      colors: [colors.brand, colors.accent, "#F79009", "#7A5AF8"],
      showLegend: true,
      showTitle: false,
      showValue: false,
      showCategoryName: false,
    },
  },
};

export function getDefaultLayout(id: string): LayoutDefinition | undefined {
  return defaultTheme.layouts[id];
}
