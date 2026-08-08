import type {
  ElementIR,
  FrameIR,
  MasterIR,
  ShapeElementIR,
  TextStyleIR,
} from "@editable-slides/slide-deck-ir";
import {
  defaultTheme,
  type LayoutDefinition,
  type LayoutSlotDefinition,
} from "@editable-slides/slide-theme-default";

/**
 * Color scheme extracted from shuron-slide-base.pptx.
 *
 * The semantic aliases (`brand`, `surface`, and so on) intentionally live
 * beside the original Office theme names so an author can address either the
 * visual role or the source palette directly.
 */
const colors = {
  canvas: "#FFFFFF",
  text: "#000000",
  muted: "#7A8C8E",
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
  surface: "#CEDBE6",
  border: "#84ACB6",
} as const;

const sourceLocation = {
  file: "@editable-slides/slide-theme-tsuchikawa-shuron",
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

const titleBand = (id: string): ShapeElementIR =>
  shapeElement(id, { x: 0, y: 0, w: 1920, h: 170 }, colors.brand, 1);

const masters: MasterIR[] = [
  {
    id: "tsuchikawa-cover",
    background: { type: "solid", color: colors.canvas },
    elements: [
      shapeElement(
        "cover-blue-band",
        { x: 0, y: 177, w: 1920, h: 376 },
        colors.brand,
        1,
      ),
    ],
  },
  {
    id: "tsuchikawa-section",
    background: { type: "solid", color: colors.canvas },
    elements: [],
  },
  {
    id: "tsuchikawa-brand",
    background: { type: "solid", color: colors.brand },
    elements: [],
  },
  {
    id: "tsuchikawa-content",
    background: { type: "solid", color: colors.canvas },
    elements: [titleBand("content-blue-title-band")],
  },
  {
    id: "tsuchikawa-message",
    background: { type: "solid", color: colors.canvas },
    elements: [
      titleBand("message-blue-title-band"),
      shapeElement(
        "message-light-band",
        { x: 61, y: 211, w: 1798, h: 110 },
        colors.light2,
        1,
      ),
    ],
  },
  {
    id: "tsuchikawa-flow",
    background: { type: "solid", color: colors.canvas },
    elements: [
      titleBand("flow-blue-title-band"),
      shapeElement(
        "flow-light-band",
        { x: 61, y: 211, w: 1798, h: 110 },
        colors.light2,
        1,
      ),
      shapeElement(
        "flow-direction-marker",
        { x: 928, y: 593, w: 64, h: 64 },
        colors.accent5,
        2,
        { shape: "triangle", rotation: 90 },
      ),
    ],
  },
  {
    id: "tsuchikawa-blank",
    background: { type: "solid", color: colors.canvas },
    elements: [],
  },
];

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
  slot({ x: 61, y: 0, w: 1658, h: 170 }, "title", 20, "left", {
    color: colors.canvas,
    fontSize: 88,
    fontWeight: 700,
    lineHeight: 1.05,
    verticalAlign: "bottom",
  });

const captionSlot = () =>
  slot({ x: 61, y: 988, w: 1798, h: 52 }, "caption", 30, "left", {
    color: colors.muted,
    fontSize: 20,
    lineHeight: 1.1,
    verticalAlign: "bottom",
  });

const messageSlot = () =>
  slot({ x: 81, y: 211, w: 1758, h: 110 }, "heading", 20, "center", {
    color: colors.dark2,
    fontSize: 44,
    fontWeight: 700,
    lineHeight: 1.1,
    verticalAlign: "middle",
  });

const layouts: Record<string, LayoutDefinition> = {
  cover: layout("cover", "表紙", "tsuchikawa-cover", {
    title: slot({ x: 240, y: 177, w: 1440, h: 376 }, "title", 20, "center", {
      color: colors.canvas,
      fontSize: 120,
      fontWeight: 700,
      lineHeight: 1.05,
      verticalAlign: "middle",
    }),
    body: slot({ x: 240, y: 583, w: 1440, h: 200 }, "heading", 20, "center", {
      color: colors.text,
      fontSize: 48,
      fontWeight: 400,
      lineHeight: 1.2,
      verticalAlign: "middle",
    }),
    caption: slot({ x: 240, y: 875, w: 1440, h: 100 }, "caption", 30, "center"),
  }),
  section: layout("section", "セクション見出し", "tsuchikawa-section", {
    title: slot({ x: 131, y: 269, w: 1656, h: 449 }, "title", 20, "center", {
      color: colors.text,
      fontSize: 120,
      fontWeight: 700,
      lineHeight: 1.05,
      verticalAlign: "bottom",
    }),
    body: slot({ x: 131, y: 723, w: 1656, h: 236 }, "heading", 30, "center", {
      color: colors.muted,
      fontSize: 48,
      fontWeight: 400,
      lineHeight: 1.2,
      verticalAlign: "top",
    }),
  }),
  brand: layout("brand", "青緑バンパー", "tsuchikawa-brand", {}),
  "title-body": layout("title-body", "タイトル＋本文", "tsuchikawa-content", {
    title: titleSlot(),
    body: slot({ x: 61, y: 212, w: 1798, h: 748 }, "body", 20),
    caption: captionSlot(),
  }),
  "title-message-body": layout(
    "title-message-body",
    "メッセージ帯＋本文",
    "tsuchikawa-message",
    {
      title: titleSlot(),
      message: messageSlot(),
      body: slot({ x: 61, y: 352, w: 1798, h: 608 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-two-column": layout(
    "title-two-column",
    "タイトル＋2カラム",
    "tsuchikawa-content",
    {
      title: titleSlot(),
      body: slot({ x: 132, y: 288, w: 816, h: 672 }, "body", 20, "left", {
        fontSize: 56,
      }),
      left: slot({ x: 132, y: 288, w: 816, h: 672 }, "body", 20, "left", {
        fontSize: 56,
      }),
      right: slot({ x: 972, y: 288, w: 816, h: 672 }, "body", 20, "left", {
        fontSize: 56,
      }),
      caption: captionSlot(),
    },
  ),
  "title-message-two-column": layout(
    "title-message-two-column",
    "メッセージ帯＋2カラム",
    "tsuchikawa-message",
    {
      title: titleSlot(),
      message: messageSlot(),
      body: slot({ x: 96, y: 352, w: 816, h: 608 }, "body", 20, "left", {
        fontSize: 40,
      }),
      left: slot({ x: 96, y: 352, w: 816, h: 608 }, "body", 20, "left", {
        fontSize: 40,
      }),
      right: slot({ x: 1008, y: 352, w: 816, h: 608 }, "body", 20, "left", {
        fontSize: 40,
      }),
      caption: captionSlot(),
    },
  ),
  "title-message-two-column-flow": layout(
    "title-message-two-column-flow",
    "メッセージ帯＋矢印付き2カラム",
    "tsuchikawa-flow",
    {
      title: titleSlot(),
      message: messageSlot(),
      leftHeader: slot({ x: 96, y: 350, w: 790, h: 76 }, "heading", 20, "center", {
        color: colors.brand,
        fontSize: 44,
        verticalAlign: "middle",
      }),
      left: slot({ x: 96, y: 442, w: 790, h: 518 }, "body", 20, "left", {
        fontSize: 38,
      }),
      rightHeader: slot({ x: 1034, y: 350, w: 790, h: 76 }, "heading", 20, "center", {
        color: colors.brand,
        fontSize: 44,
        verticalAlign: "middle",
      }),
      right: slot({ x: 1034, y: 442, w: 790, h: 518 }, "body", 20, "left", {
        fontSize: 38,
      }),
      caption: captionSlot(),
    },
  ),
  "title-message-three-column-header": layout(
    "title-message-three-column-header",
    "メッセージ帯＋見出し付き3カラム",
    "tsuchikawa-message",
    {
      title: titleSlot(),
      message: messageSlot(),
      leftHeader: slot({ x: 61, y: 350, w: 551, h: 76 }, "heading", 20, "center", {
        color: colors.brand,
        fontSize: 40,
        verticalAlign: "middle",
      }),
      left: slot({ x: 61, y: 442, w: 551, h: 518 }, "body", 20, "left", {
        fontSize: 36,
      }),
      centerHeader: slot({ x: 685, y: 350, w: 550, h: 76 }, "heading", 20, "center", {
        color: colors.brand,
        fontSize: 40,
        verticalAlign: "middle",
      }),
      center: slot({ x: 685, y: 442, w: 550, h: 518 }, "body", 20, "left", {
        fontSize: 36,
      }),
      rightHeader: slot({ x: 1308, y: 350, w: 551, h: 76 }, "heading", 20, "center", {
        color: colors.brand,
        fontSize: 40,
        verticalAlign: "middle",
      }),
      right: slot({ x: 1308, y: 442, w: 551, h: 518 }, "body", 20, "left", {
        fontSize: 36,
      }),
      caption: captionSlot(),
    },
  ),
  "title-message-two-card": layout(
    "title-message-two-card",
    "メッセージ帯＋2分類",
    "tsuchikawa-message",
    {
      title: titleSlot(),
      message: messageSlot(),
      leftHeader: slot({ x: 96, y: 350, w: 816, h: 76 }, "heading", 20, "center", {
        color: colors.brand,
        fontSize: 44,
        verticalAlign: "middle",
      }),
      left: slot({ x: 96, y: 442, w: 816, h: 518 }, "body", 20, "left", {
        fontSize: 40,
      }),
      rightHeader: slot({ x: 1008, y: 350, w: 816, h: 76 }, "heading", 20, "center", {
        color: colors.brand,
        fontSize: 44,
        verticalAlign: "middle",
      }),
      right: slot({ x: 1008, y: 442, w: 816, h: 518 }, "body", 20, "left", {
        fontSize: 40,
      }),
      caption: captionSlot(),
    },
  ),
  "title-three-column": layout(
    "title-three-column",
    "タイトル＋3カラム",
    "tsuchikawa-content",
    {
      title: titleSlot(),
      left: slot({ x: 61, y: 240, w: 551, h: 720 }, "body", 20, "left", {
        fontSize: 38,
      }),
      center: slot({ x: 685, y: 240, w: 550, h: 720 }, "body", 20, "left", {
        fontSize: 38,
      }),
      right: slot({ x: 1308, y: 240, w: 551, h: 720 }, "body", 20, "left", {
        fontSize: 38,
      }),
      caption: captionSlot(),
    },
  ),
  "title-image-left": layout(
    "title-image-left",
    "タイトル＋左画像",
    "tsuchikawa-content",
    {
      title: titleSlot(),
      image: slot({ x: 61, y: 240, w: 820, h: 660 }, "body", 20),
      body: slot({ x: 985, y: 240, w: 874, h: 660 }, "body", 20),
      right: slot({ x: 985, y: 240, w: 874, h: 660 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-image-right": layout(
    "title-image-right",
    "タイトル＋右画像",
    "tsuchikawa-content",
    {
      title: titleSlot(),
      body: slot({ x: 61, y: 240, w: 874, h: 660 }, "body", 20),
      left: slot({ x: 61, y: 240, w: 874, h: 660 }, "body", 20),
      image: slot({ x: 1039, y: 240, w: 820, h: 660 }, "body", 20),
      caption: captionSlot(),
    },
  ),
  "title-chart": layout("title-chart", "タイトル＋チャート", "tsuchikawa-content", {
    title: titleSlot(),
    body: slot({ x: 61, y: 240, w: 430, h: 660 }, "body", 20, "left", {
      fontSize: 40,
    }),
    chart: slot({ x: 555, y: 240, w: 1304, h: 660 }, "body", 20),
    caption: captionSlot(),
  }),
  blank: layout("blank", "自由配置", "tsuchikawa-blank", {
    title: slot({ x: 96, y: 72, w: 1728, h: 140 }, "title", 20, "left", {
      color: colors.text,
      fontSize: 80,
      fontWeight: 700,
      verticalAlign: "middle",
    }),
    body: slot({ x: 96, y: 240, w: 1728, h: 768 }, "body", 20),
  }),
};

const tsuchikawaShuronTheme = structuredClone(defaultTheme);
tsuchikawaShuronTheme.ir.id = "tsuchikawa-shuron";
tsuchikawaShuronTheme.ir.name = "Tsuchikawa Shuron";
tsuchikawaShuronTheme.ir.colors = { ...colors };
tsuchikawaShuronTheme.ir.fonts = {
  heading: {
    family: "Noto Sans JP",
    fallbacks: [
      "Noto Sans JP Variable",
      "UD デジタル 教科書体 NP-B",
      "Hiragino Sans",
      "Yu Gothic",
      "Arial",
    ],
  },
  body: {
    family: "Noto Sans JP",
    fallbacks: [
      "Noto Sans JP Variable",
      "UD デジタル 教科書体 NP-B",
      "Hiragino Sans",
      "Yu Gothic",
      "Arial",
    ],
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
};
tsuchikawaShuronTheme.ir.typography = {
  title: textStyle(88, 700, colors.text, {
    lineHeight: 1.05,
    verticalAlign: "middle",
  }),
  heading: textStyle(48, 700, colors.text, { lineHeight: 1.15 }),
  body: textStyle(56, 400, colors.text, { lineHeight: 1.3 }),
  caption: textStyle(20, 400, colors.muted, { lineHeight: 1.2 }),
  code: textStyle(32, 400, colors.dark2, {
    fontFace: "Noto Sans Mono",
    lineHeight: 1.3,
  }),
};
tsuchikawaShuronTheme.ir.safeArea = { x: 61, y: 0, w: 1798, h: 1040 };
tsuchikawaShuronTheme.ir.layoutIds = Object.keys(layouts);
tsuchikawaShuronTheme.ir.masters = masters;
tsuchikawaShuronTheme.layouts = layouts;
tsuchikawaShuronTheme.defaults = {
  shape: {
    fill: { type: "solid", color: colors.light2 },
    stroke: { color: colors.brand, width: 2, dash: "solid" },
  },
  table: {
    border: { color: colors.border, width: 1, dash: "solid" },
    headerFill: { type: "solid", color: colors.brand },
    bodyFill: { type: "solid", color: colors.canvas },
    text: textStyle(36, 400, colors.text),
  },
  chart: {
    colors: [
      colors.accent1,
      colors.accent2,
      colors.accent3,
      colors.accent4,
      colors.accent5,
      colors.accent6,
    ],
    showLegend: true,
    showTitle: false,
    showValue: false,
    showCategoryName: false,
  },
};
tsuchikawaShuronTheme.authoring = {
  schemaVersion: 1,
  intent:
    "土川修論発表のため、白地と青緑の大きな帯を軸に、研究の問い・根拠・結論を落ち着いて明快に伝える。",
  colors: {
    strategy:
      "白を主背景、#3494BAを表紙とタイトルの構造色にする。残りの青緑は図表の系列に順番を決めて使い、1枚で色を増やしすぎない。",
    roles: {
      canvas: {
        purpose: "通常ページと章区切りの白背景",
        useFor: ["本文ページ", "セクションページ", "図表の余白"],
      },
      text: {
        purpose: "白背景上の主要テキスト",
        useFor: ["本文", "セクション見出し", "図表ラベル"],
      },
      muted: {
        purpose: "補助テキスト",
        useFor: ["出典", "注記", "日付"],
        avoidFor: ["主要な結論"],
      },
      dark2: {
        purpose: "元テーマの濃い紫がかった中立色",
        useFor: ["コード", "強い補助見出し"],
      },
      light2: {
        purpose: "元テーマの淡い青灰色",
        useFor: ["メッセージ帯", "表の補助面"],
      },
      brand: {
        purpose: "元テーマの主色 #3494BA",
        useFor: ["表紙帯", "タイトル帯", "ブランドページ", "主要系列"],
        avoidFor: ["長い本文", "白文字を伴わない細い文字"],
      },
      accent1: {
        purpose: "Officeテーマのaccent1。brandと同じ主色",
        useFor: ["主要系列", "重要な図形"],
      },
      accent2: {
        purpose: "明るい青緑",
        useFor: ["第2系列", "比較対象"],
      },
      accent3: {
        purpose: "緑寄りの青緑",
        useFor: ["第3系列", "肯定的な状態"],
      },
      accent4: {
        purpose: "中立的な灰青緑",
        useFor: ["基準系列", "補助ラベル"],
      },
      accent5: {
        purpose: "淡い青緑",
        useFor: ["補助系列", "方向マーカー", "罫線"],
      },
      accent6: {
        purpose: "鮮やかな青",
        useFor: ["第6系列", "一箇所の比較強調"],
      },
      hyperlink: {
        purpose: "元テーマのリンク緑",
        useFor: ["閲覧可能なリンク"],
        avoidFor: ["通常の強調"],
      },
      followedHyperlink: {
        purpose: "元テーマの閲覧済みリンク色",
        useFor: ["閲覧済みリンクを区別する必要がある場合"],
        avoidFor: ["通常の強調"],
      },
      surface: {
        purpose: "淡い情報面",
        useFor: ["メッセージ帯", "表ヘッダーの補助"],
      },
      border: {
        purpose: "中立の罫線",
        useFor: ["表罫線", "図の区切り"],
      },
    },
  },
  typography: {
    strategy:
      "元PPTXはUD デジタル 教科書体 NP-Bを指定するが、フォントファイルは未同梱で制作環境にもないため、描画はNoto Sans JPへ統一する。表紙60pt相当、通常タイトル44pt相当を維持し、本文は縮小より短文化を優先する。",
    languageFonts: {
      source: "UD デジタル 教科書体 NP-B（元PPTX指定。未同梱・未検出）",
      japanese: "Noto Sans JP",
      alphanumeric: "Noto Sans JP",
      code: "Noto Sans Mono",
      fallback: "Hiragino Sans / Yu Gothic / Arial",
    },
    roles: {
      title:
        "通常タイトル44pt相当。青緑帯では白・太字・原則1行。表紙とセクションは60pt相当。",
      heading: "本文内の短い見出し。24pt相当を基準にする。",
      body: "標準本文と元PPTX由来の2列は28pt相当。追加の高密度レイアウトでは2列24pt相当、3列18〜19pt相当を下限とし、入り切らない場合は文章を短くする。",
      caption: "出典・注記・日付は10pt相当を基準にする。",
      code: "コード、式、固定幅で揃える値だけにNoto Sans Monoを使う。",
    },
  },
  layouts: {
    cover:
      "表紙。白地の中央寄りに青緑の帯を置き、白いタイトルを中央揃えにする。副題・氏名・日付は帯の下へ簡潔に置く。",
    section:
      "章区切り。白地の中央下寄りに黒い短い見出しを下揃えで置き、その直下に補足を置く。",
    brand: "青緑一色の区切り・終端。内容を追加しない。",
    "title-body": "標準本文。青緑のタイトル帯と、白地の本文を使う。",
    "title-message-body": "結論を淡い帯へ1文、その下に根拠を置く。",
    "title-two-column": "方向性のない2案比較、左右対応に使う。",
    "title-message-two-column": "結論を上で固定し、その下で中立的な2案を比較する。",
    "title-message-two-column-flow":
      "課題→対応、現状→将来など、左から右への変化だけに使う。",
    "title-message-three-column-header":
      "同じ粒度の3分類に使う。各見出しを1行にし、情報量を揃える。",
    "title-message-two-card":
      "独立性の高い2分類・2役割に使う。カード風の装飾は追加しない。",
    "title-three-column": "単純な3項目を並列に示す。4項目以上を詰め込まない。",
    "title-image-left": "画像を先に見せ、右側で画像の意味を説明する。",
    "title-image-right": "左側で主張し、右側の画像を証拠として示す。",
    "title-chart": "左側に読み取り、右側に主チャートを1つ置く。",
    blank: "タイムライン、工程、マトリクスなど、既定レイアウトで表せない構成に使う。",
  },
  rules: {
    prefer: [
      "1枚につき主張を1つに絞り、タイトルは原則1行にする",
      "青緑のタイトル帯では白文字、白背景では黒文字を使う",
      "図表の系列色はaccent1から順に使い、同じ意味へ同じ色を割り当てる",
      "表、線、単純図形、チャートは編集可能なネイティブ要素で作る",
      "画像には出典と説明を付け、縦横比を維持する",
      "修論の数値・引用・出典は提供資料または確認済み一次資料だけを使う",
    ],
    avoid: [
      "元PPTXに同梱されていないUD デジタル 教科書体 NP-Bへ描画を依存すること",
      "青緑のタイトル帯へ黒文字を置くこと",
      "1枚でaccent1からaccent6をすべて装飾として使うこと",
      "本文を18pt相当未満へ縮小して情報を詰め込むこと",
      "影、立体効果、過剰な角丸カード、UI風の装飾を追加すること",
      "根拠のない数値、引用、研究結果を作ること",
    ],
  },
};

export { tsuchikawaShuronTheme };
export default tsuchikawaShuronTheme;
