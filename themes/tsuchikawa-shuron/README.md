# Tsuchikawa Shuron theme

`shuron-slide-base.pptx`のデザインを、Editable Slidesで再利用できるTypeScriptテーマへ移植したものです。テーマIDは`tsuchikawa-shuron`です。

## デザインの正本

- 画面比率: 16:9（論理キャンバス 1920 × 1080）
- 主色: `#3494BA`
- 表紙: 白背景、`y=177`から高さ`376`の青緑帯、帯内に白い中央揃えの60pt相当タイトル
- 通常ページ: 高さ`170`の青緑タイトル帯、白い44pt相当タイトル、白背景に黒い28pt相当本文
- セクション: 白背景の中央下寄りに黒い中央揃え・下揃えタイトル
- ブランドページ: `#3494BA`の単色背景

元PPTXのOfficeテーマに含まれる色は、`dark2`、`light2`、`accent1`〜`accent6`、`hyperlink`、`followedHyperlink`としてすべて保持しています。図表は`accent1`から順に使い、同じ意味には同じ色を割り当てます。

## フォント

元PPTXは`UD デジタル 教科書体 NP-B`を指定していますが、フォントファイルはPPTXへ埋め込まれておらず、制作環境にもありません。そのため、Web・PDF・PPTXで安定して再現できる`Noto Sans JP`を描画フォントに採用しました。

- 見出し・本文: `Noto Sans JP`
- コード・固定幅の値: `Noto Sans Mono`
- 元書体の記録: `tsuchikawaShuronTheme.authoring.typography.languageFonts.source`

## レイアウト

| layout ID | 用途 |
|---|---|
| `cover` | 表紙 |
| `section` | 章区切り |
| `brand` | 青緑一色の区切り・終端 |
| `title-body` | 標準本文 |
| `title-message-body` | 結論1文＋根拠 |
| `title-two-column` | 中立的な2案比較 |
| `title-message-two-column` | 結論付き2案比較 |
| `title-message-two-column-flow` | 現状→将来、課題→対応 |
| `title-message-three-column-header` | 見出し付き3分類 |
| `title-message-two-card` | 独立性の高い2分類 |
| `title-three-column` | 単純な3項目 |
| `title-image-left` | 画像を先に見せる構成 |
| `title-image-right` | 主張の証拠として画像を見せる構成 |
| `title-chart` | 解釈＋主チャート |
| `blank` | タイムライン、工程、マトリクスなどの自由配置 |

レイアウト選択、配色、文字階層、避ける表現の機械可読な正本は`tsuchikawaShuronTheme.authoring`です。タイトルは原則1行に収め、本文が入り切らない場合は文字を縮める前に短文化またはスライド分割を行います。

## 使用例

```yaml
theme: tsuchikawa-shuron
```

名前付きexportとdefault exportの両方が利用できます。

```ts
import tsuchikawaShuronTheme, {
  tsuchikawaShuronTheme as namedTheme,
} from "@editable-slides/slide-theme-tsuchikawa-shuron";
```
