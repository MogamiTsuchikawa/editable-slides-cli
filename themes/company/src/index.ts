import type {
  ElementIR,
  FrameIR,
  ImageElementIR,
  MasterIR,
  ShapeElementIR,
  TextElementIR,
  TextStyleIR,
} from "@livetoon/slide-deck-ir";
import {
  defaultTheme,
  type LayoutDefinition,
  type LayoutSlotDefinition,
} from "@livetoon/slide-theme-default";

import { companyAssets } from "./assets.js";

const colors = {
  canvas: "#FFFFFF",
  text: "#000000",
  muted: "#4D4D4D",
  brand: "#2896F5",
  brandSoft: "#A9D5FB",
  brandPale: "#D4EAFD",
  lavender: "#C1A5FF",
  pink: "#F1A7FF",
  gradientEnd: "#F3A7FF",
  surface: "#F2F2F2",
  border: "#D9D9D9",
  danger: "#C00000",
  gold: "#AA902E",
} as const;

const sourceLocation = {
  file: "@livetoon/slide-theme-company",
  line: 1,
  column: 1,
} as const;

function baseElement(
  id: string,
  frame: FrameIR,
  zIndex: number,
): Pick<
  ElementIR,
  | "id"
  | "frame"
  | "rotation"
  | "zIndex"
  | "opacity"
  | "locked"
  | "editable"
  | "sourceLocation"
> {
  return {
    id,
    frame,
    rotation: 0,
    zIndex,
    opacity: 1,
    locked: true,
    editable: false,
    sourceLocation,
  };
}

function imageElement(
  id: string,
  src: string,
  mimeType: string,
  frame: FrameIR,
  fit: ImageElementIR["fit"],
  zIndex: number,
  alt: string,
): ImageElementIR {
  return {
    ...baseElement(id, frame, zIndex),
    type: "image",
    src,
    mimeType,
    fit,
    role: "background",
    alt,
  };
}

function shapeElement(
  id: string,
  frame: FrameIR,
  fill: string,
  zIndex: number,
  options: {
    shape?: ShapeElementIR["shape"];
    rotation?: number;
  } = {},
): ShapeElementIR {
  return {
    ...baseElement(id, frame, zIndex),
    rotation: options.rotation ?? 0,
    type: "shape",
    shape: options.shape ?? "rect",
    fill: { type: "solid", color: fill },
  };
}

function textElement(
  id: string,
  text: string,
  frame: FrameIR,
  style: TextStyleIR,
  zIndex: number,
): TextElementIR {
  return {
    ...baseElement(id, frame, zIndex),
    type: "text",
    role: "caption",
    paragraphs: [{ runs: [{ text }] }],
    style,
  };
}

function footerTextStyle(): TextStyleIR {
  return {
    fontFace: "Arial",
    fontSize: 12,
    color: "#A4A3A4",
    fontWeight: 400,
    align: "center",
    verticalAlign: "middle",
    lineHeight: 1,
    textFit: "none",
  };
}

function contentChrome(prefix: string): ElementIR[] {
  return [
    imageElement(
      `${prefix}-top-rule`,
      companyAssets.gradient,
      "image/png",
      { x: 0, y: 166, w: 1740, h: 5 },
      "stretch",
      1,
      "Livetoon blue-to-pink title rule",
    ),
    imageElement(
      `${prefix}-mark`,
      companyAssets.mark,
      "image/png",
      { x: 1749, y: 10, w: 171, h: 131 },
      "contain",
      2,
      "Livetoon brand mark",
    ),
    imageElement(
      `${prefix}-bottom-rule`,
      companyAssets.gradient,
      "image/png",
      { x: 0, y: 1041, w: 1920, h: 4 },
      "stretch",
      1,
      "Livetoon blue-to-pink footer rule",
    ),
    textElement(
      `${prefix}-copyright`,
      "Livetoon, Inc. all rights reserved",
      { x: 592, y: 1046, w: 737, h: 34 },
      footerTextStyle(),
      2,
    ),
  ];
}

function messageSurface(prefix: string): ShapeElementIR {
  return shapeElement(
    `${prefix}-message-surface`,
    { x: 89, y: 195, w: 1743, h: 101 },
    colors.surface,
    1,
    { shape: "roundRect" },
  );
}

const masters: MasterIR[] = [
  {
    id: "livetoon-cover",
    background: { type: "solid", color: colors.canvas },
    elements: [
      imageElement(
        "cover-logo",
        companyAssets.logoBlack,
        "image/svg+xml",
        { x: 53, y: 50, w: 970, h: 127 },
        "contain",
        2,
        "Livetoon logo",
      ),
      imageElement(
        "cover-ribbon",
        companyAssets.coverRibbon,
        "image/png",
        { x: 1219, y: 33, w: 701, h: 536 },
        "contain",
        1,
        "Livetoon brand ribbon",
      ),
      imageElement(
        "cover-title-rule",
        companyAssets.gradient,
        "image/png",
        { x: 0, y: 670, w: 1740, h: 5 },
        "stretch",
        1,
        "Livetoon blue-to-pink title rule",
      ),
      imageElement(
        "cover-bottom-rule",
        companyAssets.gradient,
        "image/png",
        { x: 0, y: 1041, w: 1920, h: 4 },
        "stretch",
        1,
        "Livetoon blue-to-pink footer rule",
      ),
      textElement(
        "cover-copyright",
        "Livetoon, Inc. all rights reserved",
        { x: 592, y: 1046, w: 737, h: 34 },
        footerTextStyle(),
        2,
      ),
    ],
  },
  {
    id: "livetoon-content",
    background: { type: "solid", color: colors.canvas },
    elements: contentChrome("content"),
  },
  {
    id: "livetoon-message",
    background: { type: "solid", color: colors.canvas },
    elements: [...contentChrome("message"), messageSurface("message")],
  },
  {
    id: "livetoon-message-two-column-flow",
    background: { type: "solid", color: colors.canvas },
    elements: [
      ...contentChrome("two-column-flow"),
      messageSurface("two-column-flow"),
      shapeElement(
        "two-column-flow-left-rule",
        { x: 89, y: 390, w: 797, h: 4 },
        colors.brand,
        2,
      ),
      shapeElement(
        "two-column-flow-right-rule",
        { x: 1034, y: 390, w: 797, h: 4 },
        colors.brand,
        2,
      ),
      shapeElement(
        "two-column-flow-arrow",
        { x: 709, y: 658, w: 502, h: 52 },
        colors.border,
        2,
        { shape: "triangle", rotation: 90 },
      ),
    ],
  },
  {
    id: "livetoon-message-three-column-header",
    background: { type: "solid", color: colors.canvas },
    elements: [
      ...contentChrome("three-column-header"),
      messageSurface("three-column-header"),
      shapeElement(
        "three-column-header-left-rule",
        { x: 89, y: 397, w: 521, h: 4 },
        colors.brand,
        2,
      ),
      shapeElement(
        "three-column-header-center-rule",
        { x: 699, y: 397, w: 521, h: 4 },
        colors.brand,
        2,
      ),
      shapeElement(
        "three-column-header-right-rule",
        { x: 1310, y: 397, w: 521, h: 4 },
        colors.brand,
        2,
      ),
    ],
  },
  {
    id: "livetoon-message-two-card",
    background: { type: "solid", color: colors.canvas },
    elements: [
      ...contentChrome("two-card"),
      messageSurface("two-card"),
      shapeElement(
        "two-card-left-header",
        { x: 89, y: 336, w: 797, h: 84 },
        colors.brand,
        2,
      ),
      shapeElement(
        "two-card-left-body",
        { x: 89, y: 420, w: 797, h: 567 },
        colors.surface,
        1,
      ),
      shapeElement(
        "two-card-right-header",
        { x: 1034, y: 336, w: 797, h: 84 },
        colors.brand,
        2,
      ),
      shapeElement(
        "two-card-right-body",
        { x: 1034, y: 420, w: 797, h: 567 },
        colors.surface,
        1,
      ),
    ],
  },
  {
    id: "livetoon-section",
    background: { type: "solid", color: colors.brand },
    elements: [
      imageElement(
        "section-gradient",
        companyAssets.gradient,
        "image/png",
        { x: 0, y: 0, w: 1920, h: 1080 },
        "stretch",
        1,
        "Livetoon blue-to-pink gradient",
      ),
    ],
  },
  {
    id: "livetoon-brand",
    background: { type: "solid", color: colors.brand },
    elements: [
      imageElement(
        "brand-gradient",
        companyAssets.gradient,
        "image/png",
        { x: 0, y: 0, w: 1920, h: 1080 },
        "stretch",
        1,
        "Livetoon blue-to-pink gradient",
      ),
      imageElement(
        "brand-logo",
        companyAssets.logoWhite,
        "image/png",
        { x: 390, y: 430, w: 1140, h: 150 },
        "contain",
        2,
        "Livetoon white logo",
      ),
    ],
  },
];

function textStyle(
  fontSize: number,
  fontWeight: number,
  color: string,
  overrides: Partial<TextStyleIR> = {},
): TextStyleIR {
  return {
    fontFace: "Yu Gothic",
    fontSize,
    color,
    fontWeight,
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.3,
    textFit: "none",
    ...overrides,
  };
}

function slot(
  frame: FrameIR,
  typography: LayoutSlotDefinition["typography"],
  zIndex: number,
  textAlign?: LayoutSlotDefinition["textAlign"],
  textStyleOverride?: LayoutSlotDefinition["textStyle"],
): LayoutSlotDefinition {
  return {
    frame,
    typography,
    zIndex,
    ...(textAlign ? { textAlign } : {}),
    ...(textStyleOverride ? { textStyle: textStyleOverride } : {}),
  };
}

function layout(
  id: string,
  label: string,
  masterId: string,
  slots: LayoutDefinition["slots"],
): LayoutDefinition {
  return { id, label, masterId, slots };
}

const titleSlot = () =>
  slot({ x: 89, y: 26, w: 1653, h: 131 }, "title", 20, "left", {
    fontSize: 48,
    fontWeight: 400,
    lineHeight: 1.15,
    verticalAlign: "bottom",
  });

const titleWithSubtitleSlot = () =>
  slot({ x: 89, y: 45, w: 1653, h: 52 }, "title", 20, "left", {
    fontSize: 48,
    fontWeight: 400,
    lineHeight: 1.05,
    verticalAlign: "middle",
  });

const subtitleSlot = () =>
  slot({ x: 89, y: 100, w: 1653, h: 49 }, "heading", 20, "left", {
    fontSize: 40,
    fontWeight: 400,
    lineHeight: 1.05,
    verticalAlign: "middle",
  });

const captionSlot = () => slot({ x: 89, y: 987, w: 1653, h: 52 }, "caption", 30);

const sourceCaptionSlot = () =>
  slot({ x: 89, y: 987, w: 1653, h: 52 }, "caption", 30, "left", {
    color: colors.text,
    fontSize: 16,
    lineHeight: 1.05,
    verticalAlign: "bottom",
  });

const messageSlot = () =>
  slot({ x: 89, y: 195, w: 1743, h: 101 }, "body", 20, "center", {
    fontSize: 36,
    lineHeight: 1.15,
    verticalAlign: "middle",
  });

const layouts: Record<string, LayoutDefinition> = {
  cover: layout("cover", "表紙", "livetoon-cover", {
    title: slot({ x: 53, y: 495, w: 1686, h: 148 }, "title", 20, "left", {
      fontSize: 72,
      lineHeight: 1.1,
      verticalAlign: "bottom",
    }),
    body: slot({ x: 53, y: 715, w: 1500, h: 170 }, "heading", 20),
    caption: slot({ x: 53, y: 950, w: 1686, h: 70 }, "caption", 30),
  }),
  section: layout("section", "グラデーション区切り", "livetoon-section", {
    title: slot({ x: 81, y: 466, w: 1759, h: 148 }, "title", 20, "left", {
      color: colors.canvas,
      fontSize: 96,
      fontWeight: 700,
      lineHeight: 1.05,
      verticalAlign: "middle",
    }),
    body: slot({ x: 81, y: 650, w: 1600, h: 140 }, "heading", 30, "left", {
      color: colors.canvas,
    }),
  }),
  brand: layout("brand", "ロゴバンパー", "livetoon-brand", {}),
  "title-body": layout("title-body", "タイトル＋本文", "livetoon-content", {
    title: titleSlot(),
    body: slot({ x: 89, y: 237, w: 1743, h: 723 }, "body", 20),
    caption: captionSlot(),
  }),
  "title-message-body": layout(
    "title-message-body",
    "メッセージ帯＋本文",
    "livetoon-message",
    {
      title: titleSlot(),
      message: messageSlot(),
      body: slot({ x: 89, y: 330, w: 1743, h: 630 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-two-column": layout(
    "title-two-column",
    "タイトル＋2カラム",
    "livetoon-content",
    {
      title: titleSlot(),
      body: slot({ x: 89, y: 237, w: 820, h: 723 }, "body", 20),
      left: slot({ x: 89, y: 237, w: 820, h: 723 }, "body", 20),
      right: slot({ x: 1012, y: 237, w: 820, h: 723 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-message-two-column": layout(
    "title-message-two-column",
    "メッセージ帯＋2カラム",
    "livetoon-message",
    {
      title: titleSlot(),
      message: messageSlot(),
      body: slot({ x: 89, y: 330, w: 820, h: 630 }, "body", 20),
      left: slot({ x: 89, y: 330, w: 820, h: 630 }, "body", 20),
      right: slot({ x: 1012, y: 330, w: 820, h: 630 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-message-two-column-flow": layout(
    "title-message-two-column-flow",
    "サブタイトル＋メッセージ帯＋矢印付き2カラム",
    "livetoon-message-two-column-flow",
    {
      title: titleWithSubtitleSlot(),
      subtitle: subtitleSlot(),
      message: messageSlot(),
      leftHeader: slot({ x: 89, y: 316, w: 797, h: 73 }, "heading", 20, "center", {
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.05,
        verticalAlign: "bottom",
      }),
      left: slot({ x: 103, y: 404, w: 769, h: 560 }, "body", 20, "left", {
        fontSize: 32,
        lineHeight: 1.25,
      }),
      rightHeader: slot({ x: 1034, y: 316, w: 797, h: 73 }, "heading", 20, "center", {
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.05,
        verticalAlign: "bottom",
      }),
      right: slot({ x: 1048, y: 404, w: 769, h: 560 }, "body", 20, "left", {
        fontSize: 32,
        lineHeight: 1.25,
      }),
      caption: sourceCaptionSlot(),
    },
  ),
  "title-message-three-column-header": layout(
    "title-message-three-column-header",
    "サブタイトル＋メッセージ帯＋見出し付き3カラム",
    "livetoon-message-three-column-header",
    {
      title: titleWithSubtitleSlot(),
      subtitle: subtitleSlot(),
      message: messageSlot(),
      leftHeader: slot({ x: 89, y: 325, w: 521, h: 73 }, "heading", 20, "center", {
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.05,
        verticalAlign: "bottom",
      }),
      left: slot({ x: 103, y: 411, w: 493, h: 539 }, "body", 20, "left", {
        fontSize: 32,
        lineHeight: 1.25,
      }),
      centerHeader: slot({ x: 699, y: 325, w: 521, h: 73 }, "heading", 20, "center", {
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.05,
        verticalAlign: "bottom",
      }),
      center: slot({ x: 713, y: 411, w: 493, h: 539 }, "body", 20, "left", {
        fontSize: 32,
        lineHeight: 1.25,
      }),
      rightHeader: slot({ x: 1310, y: 325, w: 521, h: 73 }, "heading", 20, "center", {
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.05,
        verticalAlign: "bottom",
      }),
      right: slot({ x: 1324, y: 411, w: 493, h: 539 }, "body", 20, "left", {
        fontSize: 32,
        lineHeight: 1.25,
      }),
      caption: sourceCaptionSlot(),
    },
  ),
  "title-message-two-card": layout(
    "title-message-two-card",
    "サブタイトル＋メッセージ帯＋2カード",
    "livetoon-message-two-card",
    {
      title: titleWithSubtitleSlot(),
      subtitle: subtitleSlot(),
      message: messageSlot(),
      leftHeader: slot({ x: 103, y: 350, w: 769, h: 56 }, "heading", 20, "center", {
        color: colors.canvas,
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.05,
        verticalAlign: "middle",
      }),
      left: slot({ x: 103, y: 434, w: 769, h: 539 }, "body", 20, "left", {
        fontSize: 32,
        lineHeight: 1.25,
      }),
      rightHeader: slot({ x: 1048, y: 350, w: 769, h: 56 }, "heading", 20, "center", {
        color: colors.canvas,
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.05,
        verticalAlign: "middle",
      }),
      right: slot({ x: 1048, y: 434, w: 769, h: 539 }, "body", 20, "left", {
        fontSize: 32,
        lineHeight: 1.25,
      }),
      caption: sourceCaptionSlot(),
    },
  ),
  "title-three-column": layout(
    "title-three-column",
    "タイトル＋3カラム",
    "livetoon-content",
    {
      title: titleSlot(),
      left: slot({ x: 89, y: 237, w: 535, h: 723 }, "body", 20),
      center: slot({ x: 693, y: 237, w: 535, h: 723 }, "body", 20),
      right: slot({ x: 1297, y: 237, w: 535, h: 723 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-image-left": layout(
    "title-image-left",
    "タイトル＋左画像",
    "livetoon-content",
    {
      title: titleSlot(),
      image: slot({ x: 89, y: 237, w: 820, h: 650 }, "body", 20),
      body: slot({ x: 1012, y: 237, w: 820, h: 650 }, "body", 20),
      right: slot({ x: 1012, y: 237, w: 820, h: 650 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-image-right": layout(
    "title-image-right",
    "タイトル＋右画像",
    "livetoon-content",
    {
      title: titleSlot(),
      body: slot({ x: 89, y: 237, w: 820, h: 650 }, "body", 20),
      left: slot({ x: 89, y: 237, w: 820, h: 650 }, "body", 20),
      image: slot({ x: 1012, y: 237, w: 820, h: 650 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-chart": layout("title-chart", "タイトル＋チャート", "livetoon-content", {
    title: titleSlot(),
    body: slot({ x: 89, y: 237, w: 450, h: 650 }, "body", 20),
    chart: slot({ x: 590, y: 237, w: 1242, h: 650 }, "body", 20),
    caption: captionSlot(),
  }),
  blank: layout("blank", "自由配置", "livetoon-content", {
    title: titleSlot(),
    body: slot({ x: 89, y: 237, w: 1743, h: 723 }, "body", 20),
    caption: captionSlot(),
  }),
};

const companyTheme = structuredClone(defaultTheme);
companyTheme.ir.id = "company";
companyTheme.ir.name = "Livetoon Company";
companyTheme.ir.colors = { ...colors };
companyTheme.ir.fonts = {
  heading: {
    family: "Yu Gothic",
    fallbacks: ["YuGothic", "游ゴシック体", "Hiragino Sans", "Noto Sans JP", "Arial"],
  },
  body: {
    family: "Yu Gothic",
    fallbacks: ["YuGothic", "游ゴシック体", "Hiragino Sans", "Noto Sans JP", "Arial"],
  },
  code: {
    family: "Arial",
    fallbacks: ["Helvetica Neue", "Noto Sans Mono", "monospace"],
  },
  registered: [
    {
      family: "Yu Gothic",
      weight: 400,
      style: "normal",
      source: "system",
    },
    {
      family: "Yu Gothic",
      weight: 700,
      style: "normal",
      source: "system",
    },
    {
      family: "Arial",
      weight: 400,
      style: "normal",
      source: "system",
    },
    {
      family: "Arial",
      weight: 700,
      style: "normal",
      source: "system",
    },
  ],
};
companyTheme.ir.typography = {
  title: textStyle(48, 400, colors.text, {
    lineHeight: 1.15,
    verticalAlign: "bottom",
  }),
  heading: textStyle(40, 400, colors.text, { lineHeight: 1.2 }),
  body: textStyle(36, 400, colors.text),
  caption: textStyle(18, 400, colors.muted, { lineHeight: 1.2 }),
  code: textStyle(28, 400, colors.text, {
    fontFace: "Arial",
    lineHeight: 1.25,
  }),
};
companyTheme.ir.safeArea = { x: 89, y: 26, w: 1743, h: 1013 };
companyTheme.ir.layoutIds = Object.keys(layouts);
companyTheme.ir.masters = masters;
companyTheme.layouts = layouts;
companyTheme.defaults = {
  shape: {
    fill: { type: "solid", color: colors.brandPale },
    stroke: { color: colors.brand, width: 2, dash: "solid" },
  },
  table: {
    border: { color: colors.border, width: 1, dash: "solid" },
    headerFill: { type: "solid", color: colors.brandSoft },
    bodyFill: { type: "solid", color: colors.canvas },
    text: textStyle(28, 400, colors.text),
  },
  chart: {
    colors: [
      colors.lavender,
      colors.brandSoft,
      colors.brand,
      "#FFC000",
      "#FFE699",
      colors.border,
      colors.danger,
      colors.gold,
    ],
    showLegend: true,
    showTitle: false,
    showValue: false,
    showCategoryName: false,
  },
};
companyTheme.authoring = {
  schemaVersion: 1,
  intent:
    "Livetoonの提案・報告資料として、余白のある白地に青い構造線を置き、結論と根拠を明快に伝える。",
  colors: {
    strategy:
      "白を主役にし、青は構造、ピンクはブランド装飾、赤と金は意味を限定した強調に使う。",
    roles: {
      canvas: {
        purpose: "通常ページの背景",
        useFor: ["本文ページ", "図表ページ", "アジェンダ"],
      },
      text: {
        purpose: "主要テキスト",
        useFor: ["タイトル", "本文", "図表ラベル"],
      },
      muted: {
        purpose: "補助テキスト",
        useFor: ["出典", "注記", "補足"],
        avoidFor: ["主要な結論"],
      },
      brand: {
        purpose: "Livetoonの主要ブルー",
        useFor: ["見出し罫線", "表ヘッダー", "主要系列", "プロセス"],
        avoidFor: ["長文本文", "全面塗りの多用"],
      },
      brandSoft: {
        purpose: "第1段階の淡いブルー",
        useFor: ["補助系列", "表の階層", "比較領域"],
      },
      brandPale: {
        purpose: "第2段階の淡いブルー",
        useFor: ["図形背景", "順序を示す濃淡"],
      },
      lavender: {
        purpose: "ブランドの補助色",
        useFor: ["第2系列", "Vennや比較の交差領域"],
        avoidFor: ["警告"],
      },
      pink: {
        purpose: "ブランドグラデーションの終端",
        useFor: ["罫線", "背景グラデーション"],
        avoidFor: ["本文", "単独の大面積塗り"],
      },
      gradientEnd: {
        purpose: "抽出元PPTXの装飾グラデーション終端",
        useFor: ["ブランド罫線の再現"],
      },
      surface: {
        purpose: "メッセージ帯とカード本文面",
        useFor: ["ページの要点を1文で示す帯", "独立項目を強く区切るカード本文"],
      },
      border: {
        purpose: "中立の罫線、区切り、方向を示す補助図形",
        useFor: ["表罫線", "タイムラインの補助線", "2列flowの中央矢印"],
      },
      danger: {
        purpose: "リスク、禁止、機密",
        useFor: ["警告", "NG", "STRICTLY CONFIDENTIAL"],
        avoidFor: ["装飾", "通常の強調"],
      },
      gold: {
        purpose: "注意または一箇所だけの強調",
        useFor: ["注意事項", "重点項目"],
        avoidFor: ["複数箇所への反復", "主要ブランド色の代用"],
      },
    },
  },
  typography: {
    strategy:
      "和文は游ゴシック、英数字だけの要素はArialを使う。通常タイトルは24pt相当のregularで1行を原則とし、列・カード本文だけは元テンプレートに合わせて16pt相当まで許容する。",
    languageFonts: {
      japanese: "Yu Gothic（游ゴシック）",
      alphanumeric: "Arial",
      fallback: "Hiragino Sans / Noto Sans JP",
    },
    roles: {
      title: "通常タイトル24pt相当。1行、regular。表紙のみ36pt相当。",
      heading: "サブタイトル20pt相当、本文見出し18〜20pt相当。",
      body: "標準本文は18pt相当。見出し付き列・カードの専用レイアウトは16pt相当を下限とし、それ未満へ縮小せず文章かレイアウトを調整する。",
      caption: "出典・注記・フッターは9pt相当を基準にする。",
      code: "英数字のコードや値だけにArialを使う。",
    },
  },
  layouts: {
    cover: "表紙。黒いフルロゴ、右上リボン、タイトル、日付だけで簡潔にする。",
    section: "章区切り。グラデーション背景に白い短い見出しを置く。",
    brand: "ロゴバンパー。内容を追加せず、そのまま使う。",
    "title-body": "標準の本文ページ。1つの主張と、その根拠を配置する。",
    "title-message-body": "上部の灰色帯に結論を1文、下部に根拠を置く。",
    "title-two-column": "比較、対比、左右対応に使う。",
    "title-message-two-column":
      "結論を固定し、その下で方向性を持たない2案を中立的に比較する。",
    "title-message-two-column-flow":
      "現在→将来、課題→解決など左から右への変化・因果・移行に使う。見出しは各1行とし、単純な並列比較には使わない。",
    "title-message-three-column-header":
      "同格の3分類・3観点に使う。各列の粒度と情報量を揃え、4項目以上を詰め込まない。",
    "title-message-two-card":
      "強く区切る2案・2分類・2役割に使う。見出しは各1行とし、カード内へ別のカードを入れない。",
    "title-three-column": "並列する3項目だけに使い、各列の情報量を揃える。",
    "title-image-left": "画像を先に見せ、右側で意味を説明する。",
    "title-image-right": "左側で主張し、右側の画像を証拠にする。",
    "title-chart": "左側に解釈、右側に主チャートを1つ置く。",
    blank: "タイムライン、マトリクス、プロセスなどの自由配置に使う。",
  },
  rules: {
    prefer: [
      "通常ページでは右上にマーク、表紙では黒いフルロゴ、グラデーション面では白いフルロゴを使う",
      "順序や量を示す図表はブランドブルーの濃淡を優先する",
      "メッセージ帯にはスライドの結論を1文だけ置く",
      "タイトルとサブタイトルをそれぞれ1行に収める",
      "見出し付きの列とカードでは、見出しを短くし、列間の本文量を揃える",
      "表、線、単純図形は編集可能なネイティブ要素で作る",
    ],
    avoid: [
      "ロゴの変形、再着色、回転、縦横比の変更",
      "赤をリスク・禁止・機密以外へ使うこと",
      "順序のあるデータへレインボー配色を使うこと",
      "明朝体や3種類以上のフォントを混在させること",
      "通常タイトルをすべて太字にすること",
      "影、立体効果、装飾的な枠線、角丸UIカードを多用すること",
      "PowerPointのガイド線、選択境界、プレースホルダーの破線をスライド要素として再現すること",
    ],
  },
};

export { companyTheme };
export default companyTheme;
