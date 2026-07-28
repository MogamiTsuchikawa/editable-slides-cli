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
  authoring: {
    schemaVersion: 1,
    intent: "読み手が要点と根拠を短時間で追える、落ち着いた業務資料を作る。",
    colors: {
      strategy:
        "白を主背景にし、brandは構造と主要な強調、accentは補助的な比較だけに使う。",
      roles: {
        canvas: {
          purpose: "標準のスライド背景",
          useFor: ["通常ページの背景", "表や図の余白"],
        },
        text: {
          purpose: "主要テキスト",
          useFor: ["タイトル", "本文", "図表ラベル"],
        },
        muted: {
          purpose: "補足情報",
          useFor: ["注記", "出典", "フッター"],
          avoidFor: ["主要メッセージ"],
        },
        brand: {
          purpose: "ブランド色と主要な強調",
          useFor: ["区切り線", "重要な見出し", "主要系列"],
          avoidFor: ["長い本文の塗りつぶし"],
        },
        brandSoft: {
          purpose: "淡いブランド面",
          useFor: ["表ヘッダー", "図形の背景", "選択肢の補助"],
        },
        accent: {
          purpose: "副次的な比較色",
          useFor: ["第2系列", "肯定的な状態"],
          avoidFor: ["すべての要素への装飾"],
        },
        border: {
          purpose: "境界とガイド",
          useFor: ["表罫線", "薄い区切り"],
        },
        surface: {
          purpose: "情報をまとめる中立面",
          useFor: ["補足ボックス", "メッセージ帯"],
        },
        danger: {
          purpose: "警告と否定的な状態",
          useFor: ["リスク", "禁止", "重大な差異"],
          avoidFor: ["装飾だけの強調"],
        },
      },
    },
    typography: {
      strategy:
        "見出しと本文の階層をサイズとウェイトで作り、フォント種類は増やさない。",
      languageFonts: {
        japanese: "Noto Sans JP",
        alphanumeric: "Noto Sans JP",
        code: "Noto Sans Mono",
      },
      roles: {
        title: "スライドの主張。原則1〜2行に収める。",
        heading: "本文内のまとまりを示す短い見出し。",
        body: "説明と箇条書き。縮小より文章の短縮を優先する。",
        caption: "出典、注記、日付などの補助情報。",
        code: "コードや固定幅で揃える必要がある値だけに使う。",
      },
    },
    layouts: Object.fromEntries(
      Object.values(layouts).map((item) => [item.id, item.label]),
    ),
    rules: {
      prefer: [
        "1枚につき1つの主張を置く",
        "左右の余白と要素間隔を揃える",
        "文章を短くしてからフォントサイズを調整する",
      ],
      avoid: [
        "意味のない装飾色を増やす",
        "カードを細かく並べたUI風レイアウト",
        "テーマ色以外を理由なく追加する",
      ],
    },
  },
};

export function getDefaultLayout(id: string): LayoutDefinition | undefined {
  return defaultTheme.layouts[id];
}
