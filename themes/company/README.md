# Livetoon company theme

提供された`PPT template Livetoon_16_9_Main font_202410.pptx`を、再現可能なTypeScriptテーマとして移植したものです。

## 構成

- `src/index.ts`: 色、フォント、マスター、レイアウト、AI向け制作指示
- `src/assets.ts`: 同梱ブランド素材のdata URI化
- `assets/`: 元PPTXから抽出したロゴ、マーク、リボン、グラデーション
- `src/theme.test.ts`: 描画設定とAI向け設定の整合性テスト

## AI向け制作指示

`companyTheme.authoring`がCodexやClaude Code向けの正本です。

- `colors.roles`: 色の意味、推奨用途、避ける用途
- `typography`: 日本語／英数字の書体と文字階層
- `layouts`: 内容に応じたレイアウト選択
- `rules`: ロゴ、図表、強調表現、情報量のルール

色、フォント、レイアウトを変更するときは、描画設定だけでなく`authoring`と`theme.test.ts`も同じ変更で更新してください。レンダラーは`authoring`を無視するため、制作指示を追加してもPPTX/PDFの描画契約は変わりません。

### 見出し付きレイアウト

元テンプレートの見出し付き2／3列とカード面を、次の専用レイアウトで再現しています。`title`、`subtitle`、`message`、各列の見出し・本文、`caption`はMDXから変更できます。背景面、青い罫線、中央矢印はテーマ側のネイティブ図形です。

| レイアウト | 用途 | 本文slot |
|---|---|---|
| `title-message-two-column-flow` | 現在→将来、課題→解決など方向のある2列 | `left`、`right` |
| `title-message-three-column-header` | 同格の3分類・3観点 | `left`、`center`、`right` |
| `title-message-two-card` | 独立性の高い2案・2役割 | `left`、`right` |

各列の見出しは`leftHeader`、`centerHeader`、`rightHeader`へプレーンテキストで入れます。`##`を使うとMarkdown側の太字が優先されるため、テーマ標準のregular見出しには使いません。

## 使用例

```yaml
theme: company
```

全レイアウトの見本は`decks/livetoon-theme/deck.mdx`にあります。
