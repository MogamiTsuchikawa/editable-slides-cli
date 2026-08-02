# スライド要素リファレンス

この文書は、AIまたは制作担当者が`deck.mdx`へ要素を追加するときの共通仕様である。
通常の利用者は構文を覚える必要はなく、Studioまたは日本語の依頼から利用できる。

## 共通ルール

- `id`はページ内で重複しない英小文字の名前にする。
- `x`、`y`、`w`、`h`は1920×1080の画面上の位置と大きさを表す。
- layoutの領域へ置く場合は`slot`を使い、自由配置が必要な場合だけ座標を使う。
- 画像、動画、音声は資料フォルダ内の相対パスで指定する。
- 意味のある視覚要素には`alt`、音声には`alt`または`transcript`を付ける。
- 装飾だけの画像・アイコンは`decorative={true}`を明示する。
- `release`は領域外配置、文字切れ、タイトル折り返し、代替説明、色の見やすさを検査する。

## 画像

```mdx
<Image
  id="product"
  src="./assets/product.png"
  alt="製品画面の検索結果"
  fit="crop"
  crop={{ left: 0.05, top: 0.1, right: 0.05, bottom: 0 }}
  focalPosition={{ x: 0.65, y: 0.4 }}
  mask="roundRect"
  cornerRadius={24}
  border={{ color: "#2857D9", width: 2 }}
  shadow={{ color: "#000000", opacity: 0.18, blur: 12, distance: 5, angle: 45 }}
  x={980}
  y={180}
  w={760}
  h={560}
/>
```

- `fit`: `contain`、`cover`、`stretch`、`crop`
- `mask`: `roundRect`または`circle`
- GIFは通常表示で動き、印刷・PDF用のPNGを`posterFrame`で必ず指定する。

```mdx
<Image
  id="demo-gif"
  src="./assets/demo.gif"
  posterFrame="./assets/demo-poster.png"
  alt="検索条件を変更する操作"
  x={200}
  y={180}
  w={1000}
  h={600}
/>
```

## ページ背景

ページの設定欄で、ローカル画像と焦点位置を指定できる。

```yaml
slides:
  - id: product
    layout: blank
    notes: 製品の特徴を説明します。
    sources: []
    background:
      src: ./assets/background.png
      fit: cover
      focalPosition:
        x: 0.5
        y: 0.35
```

## 動画・音声

```mdx
<Video
  id="product-demo"
  src="./assets/product-demo.mp4"
  poster="./assets/product-demo-poster.png"
  captions="./assets/product-demo.ja.vtt"
  captionLanguage="ja"
  captionLabel="日本語字幕"
  alt="レポートを作成する操作デモ"
  fit="contain"
  x={220}
  y={180}
  w={1480}
  h={720}
/>

<Audio
  id="pronunciation"
  src="./assets/pronunciation.m4a"
  captions="./assets/pronunciation.ja.vtt"
  captionLanguage="ja"
  captionLabel="日本語字幕"
  transcript="製品名の英語発音"
  x={240}
  y={760}
  w={720}
  h={120}
/>
```

- 動画はMP4、音声はM4AまたはMP3。
- MP4はH.264、M4AはAACを推奨する。構造と推奨codecはコンパイル時に検査する。
- 50MiBを超える素材は警告、100MiBを超える素材はエラーになる。
- 字幕は任意。資料内のUTF-8 WebVTT（`.vtt`、最大1MiB）を`captions`で指定する。
- 字幕ファイルは`WEBVTT`で始まり、開始時刻より終了時刻が後の字幕を1件以上含める。
- `captionLanguage`と`captionLabel`を省略した場合、WebとPPTXでは資料の言語・「字幕」を既定値にする。
- 同じ字幕ファイルを複数の動画・音声で使っても、PPTXでは安全に共有して保存できる。
- WebとPPTXではクリック再生。PDFとPNGでは動画posterまたは音声カードを表示する。
- 自動再生、外部動画URL、任意iframeは対象外。

## 図解プリセット

図解は、通常の図形、文字、接続線へ展開される。Web、PDF、PPTXのどれでも同じ意味を保ち、
PowerPoint上で個別に編集できる。

```mdx
<Flow
  id="review-flow"
  direction="horizontal"
  items={[
    { key: "research", label: "調査", description: "根拠を集める" },
    { key: "draft", label: "作成", description: "下書きを作る" },
    { key: "review", label: "確認", description: "人が判断する" },
  ]}
  x={140}
  y={260}
  w={1640}
  h={420}
/>
```

| 要素 | 用途 | 主な入力 |
|---|---|---|
| `Flow` | 手順、工程、前後関係 | `items`、`direction` |
| `Timeline` | 時系列、節目 | `items`。各項目に`date`を追加可能 |
| `Matrix` | 縦横二軸の分類 | `rows`、`columns`、`cells` |
| `Cycle` | 繰り返しの流れ | 3件以上の`items` |
| `Funnel` | 絞り込み、段階減少 | 2件以上の`items` |
| `OrgChart` | 親子関係、体制 | `items`。子に`parentKey`を指定 |

各項目の`key`は図解内で重複させない。`label`は必須、`description`と`color`は任意である。

## コード表示

````mdx
<CodeBlock
  id="example-code"
  title="API呼び出し"
  showLineNumbers={true}
  highlightLines={[2]}
  x={180}
  y={200}
  w={1560}
  h={620}
>

```ts
const response = await fetch(url);
const result = await response.json();
```

</CodeBlock>
````

JavaScript、TypeScript、JSON、Python、Bash、HTML、CSSは、文字列、数値、予約語、
コメントを編集可能な文字色で区別する。未知の言語も単色のコードとして表示できる。
行番号と強調行も通常の図形・文字として出力する。

## 表・グラフ

```mdx
<Table
  id="metrics"
  headers={[
    { value: "指標", fill: "#E8F0FF", align: "center" },
    { value: "実績", fill: "#E8F0FF", align: "center" },
  ]}
  rows={[
    ["売上", { value: 1280000, numberFormat: "currency-jpy", align: "right" }],
    ["継続率", { value: 0.924, numberFormat: "percent", align: "right" }],
  ]}
  columnWidths={[640, 960]}
  rowHeights={[120, 180, 180]}
  x={160}
  y={240}
  w={1600}
  h={480}
/>

<Chart
  id="trend"
  type="combo"
  alt="売上と成長率の推移"
  series={[
    { name: "売上", labels: ["1月", "2月"], values: [10, 18], color: "#2857D9", chartType: "bar" },
    { name: "成長率", labels: ["1月", "2月"], values: [4, 7], color: "#EA4B87", chartType: "line" },
  ]}
  categoryAxisTitle="月"
  valueAxisTitle="売上"
  valueUnit="百万円"
  showLegend={true}
  legendPosition="bottom"
  showValue={true}
  slot="chart"
/>
```

グラフは`bar`、`line`、`pie`、`doughnut`、`area`、`scatter`、`radar`、
`stacked`、`combo`に対応する。

表のセル設定には、`value`、背景色`fill`、横位置`align`、縦位置`verticalAlign`、
横結合`colSpan`、縦結合`rowSpan`を指定できる。数値には`numberFormat`として
`integer`、`decimal`、`percent`、`currency-jpy`を指定できる。これは表示文字を
揃える機能であり、PowerPoint内のExcel数式や任意書式には変換しない。

表には1行以上、各行には1セル以上が必要である。`headers`を指定すると先頭の1行を
見出し行（`headerRows: 1`）として扱い、省略するとすべて本文行（`headerRows: 0`）に
なる。Studioで保存しても、この見出し行の区別は維持される。

`columnWidths`と`rowHeights`は比率ではなく、`x`、`y`、`w`、`h`と同じ絶対論理単位で
指定する。指定する場合は全列・全行の値を揃え、`columnWidths`の合計を表の`w`、
`rowHeights`の合計を表の`h`へ一致させる。列数は結合後の見かけではなく、結合前の
論理列数で数える。結合数は1〜100とし、ほかの結合セルと重ねたり、表の外へ延ばしたり
できない。Studioで表全体を拡大・縮小すると、明示した列幅・行高も同じ比率で調整される。
`layout bake`では、表全体の大きさと列幅・行高を一緒に資料本体へ確定する。

グラフは軸名と単位、凡例の表示位置、値・項目名ラベル、系列ごとの色と種類を指定できる。
Studioからも同じ範囲を編集できる。グラフには1系列以上、各系列には同じ件数の
`labels`と`values`を1件以上指定する。`pie`と`doughnut`は1系列だけを受け付け、
値を0以上にし、少なくとも1件は0より大きくする。その系列内の各項目を扇形として
表示し、Webの凡例も系列名ではなく項目名を使って各扇形と同じ色を表示する。

複数系列の`bar`、`line`、`area`、`radar`、`stacked`は、全系列で同じ`labels`を
同じ順番で指定する。`combo`も同じ項目名を共有し、系列種別には`bar`、`line`、`area`を
指定できる。数値のX軸を持つ散布図はカテゴリ軸と意味が異なるため、`combo`には混在させない。

`scatter`では、各系列の`labels`へ有限の数値文字列を必ず入れ、その系列固有のX値として扱う。
複数系列で異なるX値を指定しても共通ラベルへ上書きせず、PPTXにも系列ごとのX値を保持する。
軸の最小・最大値、第二軸、ラベルの個別配置は未対応である。

## 出力先ごとの契約

| 要素 | Web / Studio | PPTX | PDF / PNG |
|---|---|---|---|
| 画像・GIF | 画像表示、GIF再生 | 画像として配置 | GIFは指定poster |
| 動画 | controls＋字幕track付き再生 | ネイティブ動画＋字幕 | posterと動画表示 |
| 音声 | controls＋字幕track付き再生 | ネイティブ音声＋字幕 | 音声カードと説明 |
| 図解 | 図形・文字・線 | 編集可能な図形・文字・線 | 同じ静止表示 |
| コード | 構文色、行番号、強調行 | 編集可能な文字・図形 | 同じ静止表示 |
| 表・グラフ | ネイティブ描画、Studio編集 | ネイティブ表・グラフ | 同じ静止表示 |

## 安全上の制限

- リモートURL、`data:` URL、資料外パス、外部へ抜けるシンボリックリンクを素材に使わない。
- SVG内のscript、イベント属性、外部参照、`foreignObject`を拒否する。
- 容量上限とファイルsignatureを確認し、拡張子だけを信用しない。
- 独自テーマのプログラムは、信頼できる場合に限り明示的に許可する。
