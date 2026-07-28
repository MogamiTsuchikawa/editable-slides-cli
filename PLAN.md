# Livetoon Slide 実装計画

- ステータス: Phase 0〜6.1 実装・検証済み（単一ファイル版Studio MVP）。Phase 7の社内パイロット前
- 作成日: 2026-07-28
- 対象: ローカルでNode.jsを利用し、Codex / Claude Codeを中心に制作する社内向けスライド基盤
- 正本: `deck.mdx`（デッキ設定、スライド本文、発表者原稿）、テーマ、アセット、配置上書き
- 成果物: 編集可能なPPTX、PDF、ブラウザプレビュー

## 0. 実装・検証記録（2026-07-28〜29）

Phase 0〜6.1の実装は完了しており、現在は社内パイロットへ進めるStudio MVPの状態である。

| 範囲 | 実装実績 | 検証実績 |
|---|---|---|
| リポジトリ基盤 | mise、npm workspaces、`package-lock.json`、TypeScript strict、Biome、Vitest、Playwright、CI | `mise run setup`、`mise run qa`、`mise run build`、`npm audit`が成功。脆弱性0件 |
| DeckIR / MDX / Theme | DeckIR v1、単一`deck.mdx`、制限付き静的MDX、会社テーマ、パス／埋め込みアセット解決、配置override、diagnostics、旧形式互換 | 単一ファイルfixture、`minimal`、`component-gallery`、および10ページの`decks/example`がstrict lintを通過 |
| Studio | 常設サムネイル、Editキャンバス、プロパティパネル、Markdownテキスト保存、debug drawer、print、HMR、Moveable、Selecto、atomic override保存 | editor E2EとWeb視覚回帰が成功。テキスト変更は元の`deck.mdx`へ保存される |
| PPTX | Text、Image、Shape、Line、Connector、Table、Chart、ノートをネイティブOOXMLとして出力 | 10スライド、10ノート、37 / 37オブジェクトがネイティブ編集可能。macOS PowerPointで修復なしに開き、編集・保存・再オープンを確認 |
| PDF / CLI | `new`、`dev`、`lint`、`export`、`snapshot`、`inspect`、`doctor`、PDF構造検査、build manifest | PDF 10ページ、本文69件、フォント2系統を検査。対象フォントは埋め込み済みかつUnicode map付き |
| Livetoonテーマ | 提供PPTXからブランド素材、配色、游ゴシック／Arial、8マスター、15レイアウト、AI向けauthoring設定を再現 | 11ページのテーマ見本をPPTX/PDFへ出力。45 / 45オブジェクトがネイティブ編集可能、11ノート、PPTXはみ出し0件、PDF本文96件・フォント2系統を検査 |

Phase 7で残る作業は、利用者向けドキュメント、`corporate-golden`、2〜3件の社内パイロット、Windows PowerPoint自動検査のnightly運用である。

## 1. 目的

Markdownベースのソースから、次の条件を同時に満たすスライド制作環境を作る。

- 内容とレイアウトをGitでレビューできる
- AIが既存のレイアウト規則を再利用して、再現性のあるスライドを生成できる
- ローカルで編集内容を即座にプレビューできる
- 発表者原稿をMDXに保持し、PPTXノートへ出力できる
- テキスト、図形、表、チャートをPowerPoint上で個別に編集できる
- 画像や図形を絶対位置で配置できる
- 会社標準テーマを既定値としながら、スライド・要素単位で例外指定できる
- 必要に応じてプレビュー上で位置・サイズ・回転を手動調整できる
- フォント、はみ出し、欠損アセット、非編集可能要素をエクスポート前に検出できる

## 2. 成功条件

MVPは、以下をすべて満たした時点で完了とする。

1. 10ページ程度のサンプルデッキを、単一の`deck.mdx`と任意のローカルアセットだけで作成できる。
2. `npm run slide -- dev decks/example`で、常設サムネイル付きのEdit画面を開ける。
3. MDX変更がページ再読み込みなしでプレビューへ反映される。
4. 左のサムネイルでスライドを切り替え、選択したテキストをMarkdownとして編集し、元の`deck.mdx`へ保存できる。
5. 同じDeckIRからPPTXとPDFを生成できる。
6. PowerPoint上で、テキスト、図形、線、表、チャートを個別に選択・編集・再保存できる。
7. PPTXの発表者ノートに、MDXの原稿と出典が含まれる。
8. `--strict-editable`では、対応要素の暗黙画像化が1件でもあれば失敗する。
9. 標準フォントと要素単位の例外フォントを併用できる。
10. GUIで変更した位置・サイズ・回転が再起動後も維持され、PDFとPPTXにも反映される。
11. パス指定画像と、MDX末尾へbase64で埋め込んだ画像を同じ`Image`要素から利用できる。
12. 右上のデバッグアイコンから、現在スライドのframe、ID、診断情報をdrawerで確認できる。
13. CIで型検査、ユニットテスト、フィクスチャ、Web視覚回帰、PPTX/PDF構造検査が通る。

### 2.1 初期性能目標

基準環境と計測方法はPhase 7のパイロットで固定する。それまでは、30ページの`corporate-golden`を対象に次を目標値とする。

- 初回プレビュー表示: 3秒以内
- 1スライド変更時のHMR反映: 1秒以内
- `layout.overrides.json`保存: 操作終了後300ms以内
- PPTXエクスポート: 30秒以内
- PDFエクスポート: 30秒以内
- 50ページの`large-deck`をメモリ不足なしでエクスポートできる

数値を満たすために品質検査を省略してはならない。PRでは正しさを優先し、性能ゲートはmain / nightlyから段階的に有効化する。

## 3. 設計上の決定

### 3.1 採用方針

| 論点 | 採用案 | メリット | デメリット / 対応 |
|---|---|---|---|
| 描画契約 | DeckIRをWeb・PDF・PPTX共通の唯一の描画契約にする | レンダラーごとの解釈差を抑え、テスト可能になる | DeckIRの設計と移行管理が必要。`schemaVersion`を持たせる |
| MDXの扱い | 制限付きMDXを静的解析し、JavaScriptとして実行しない | AIが書きやすく、決定的で安全 | 任意Reactコンポーネントは使えない。許可DSLを拡張する |
| スライド構成 | デッキごとに単一の`deck.mdx`を正本とし、先頭frontmatterの`slides`で順序とメタデータを宣言する | AIが1ファイルだけでデッキ全体を生成・修正でき、設定と本文の不整合を減らせる | 大規模デッキでは差分競合やファイル肥大化が起きうる。安定したslide／element IDと埋め込み画像の利用基準で抑える |
| アセット | デッキ内相対パスに加え、末尾`Assets`のbase64画像を`asset:ID`で参照する | 単一ファイルで受け渡せる一方、大きな画像は通常ファイルとして管理できる | base64はGit差分と容量効率が悪い。小さく自己完結させたい画像へ限定する |
| PPTX | PptxGenJSでネイティブ要素を生成 | 編集可能なText、Shape、Table、Chartを生成できる | HTML/CSSの任意表現は変換できない。暗黙フォールバックを禁止する |
| PDF | React印刷ルートをPlaywrightでPDF化 | プレビューとの一致度が高く、Node中心で完結する | PowerPointとは文字組みが異なる。PPTXは別途Officeレンダリングで検証する |
| 編集UI | 常設サムネイル、React DOM + Moveable、右プロパティパネルを1画面にまとめる | スライド選択、配置、本文修正をEdit画面から離れず行える | 本格DTP機能は弱い。初期版の本文編集は選択要素のMarkdownに限定する |
| 配置保存 | `layout.overrides.json`へ機械的な差分を補助保存 | `deck.mdx`の本文や整形を壊さず、GUI調整を全出力へ反映できる | 内容の正本とは別に補助ファイルが増える。優先順位と孤立override検査を固定する |
| テンプレート | 会社テーマとSlide MasterをTypeScriptで定義 | バージョン管理、レビュー、再現性に強い | 既存PPTXテンプレートの直接読込は初期対象外 |
| PowerPoint編集 | PPTXは成果物とし、MDXへの逆変換は行わない | 正本が分裂しない | PowerPoint上の変更は再生成で失われることを明示する |

### 3.2 テンプレート管理の選択

| 案 | メリット | デメリット | 採用判断 |
|---|---|---|---|
| TypeScriptテーマ + PptxGenJS Slide Master | Git差分、テスト、AI利用、再現性に強い | 既存会社テンプレートを最初にコードへ移植する必要がある | 初期版で採用 |
| `.pptx`テンプレート + pptx-automizer | PowerPointデザイナーが既存テンプレートを直接保守しやすい | shape名やcreation IDへの依存、二重管理、検証コストが増える | 必要性が確認された後に別アダプターとして検討 |

## 4. 全体アーキテクチャ

```text
deck.mdx + optional assets + theme + layout.overrides.json
                          |
                          v
               parse / validate / resolve
                          |
                          v
                      DeckIR v1
         +----------------+----------------+
         |                |                |
         v                v                v
   React renderer   PptxGenJS renderer  QA / inspector
         |                |
   +-----+-----+          +--> editable .pptx + notes
   |           |
   v           v
 Edit Studio  Playwright
                 |
                 v
               .pdf
```

重要な原則は、MDXをReactへ直接レンダリングしないこと。MDXは一度DeckIRへ正規化し、すべての出力が同じDeckIRを参照する。

### 4.1 依存関係

```text
deck-ir
  ├─ theme-default
  ├─ compiler
  │   ├─ renderer-react
  │   │   ├─ studio
  │   │   └─ exporter-pdf
  │   └─ renderer-pptx
  ├─ qa-pptx
  └─ cli
```

`renderer-react`と`renderer-pptx`は、DeckIRとコンパイラが安定した後に並行実装できる。

## 5. リポジトリ構成

```text
.
├─ apps/
│  └─ studio/                       # Vite Edit UI、テキスト／配置編集、print
├─ packages/
│  ├─ deck-ir/                      # DeckIR型、Zodスキーマ、診断型
│  ├─ compiler/                     # MDX、frontmatter、テーマからDeckIRを生成
│  ├─ theme-default/                # 標準テーマ、マスター、レイアウト
│  ├─ renderer-react/               # DeckIRからReact DOMへ描画
│  ├─ renderer-pptx/                # DeckIRからPptxGenJSへ描画
│  ├─ exporter-pdf/                 # PlaywrightによるPDF出力
│  ├─ qa-pptx/                      # OOXML構造と編集可能性の検査
│  ├─ test-utils/                   # fixtures、画像比較、正規化
│  └─ cli/                          # new、dev、lint、export、doctor
├─ themes/
│  └─ company/                      # 会社標準テーマ
├─ decks/
│  └─ example/
│     ├─ deck.mdx                   # デッキ設定、全Slide、任意の埋め込みAssets
│     ├─ data/                      # 任意。大きなデータを外部化する場合
│     ├─ assets/                    # 任意。大きな画像を外部化する場合
│     └─ layout.overrides.json
├─ tests/
│  ├─ fixtures/
│  ├─ e2e/
│  └─ golden/
├─ docs/
│  ├─ authoring.md
│  ├─ components.md
│  ├─ theme-authoring.md
│  └─ troubleshooting.md
├─ AGENTS.md
├─ CLAUDE.md
├─ README.md
├─ mise.toml
├─ mise.lock
├─ package.json
├─ package-lock.json
├─ tsconfig.base.json
└─ biome.json
```

パッケージ名は、初期実装では次に統一する。

- `@livetoon/slide-deck-ir`
- `@livetoon/slide-compiler`
- `@livetoon/slide-theme-default`
- `@livetoon/slide-renderer-react`
- `@livetoon/slide-renderer-pptx`
- `@livetoon/slide-exporter-pdf`
- `@livetoon/slide-qa-pptx`
- `@livetoon/slide-cli`

## 6. オーサリング仕様

### 6.1 単一`deck.mdx`

新規デッキでは、ディレクトリ直下の`deck.mdx`を唯一のスライド内容ソースにする。

```mdx
---
schemaVersion: 1
id: ai-adoption
title: AI導入計画
author: Livetoon
company: Livetoon
theme: company
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: ai-adoption-cover
    layout: cover
    notes: |
      本日はAI導入計画の全体像を説明する。
    sources: []
  - id: ai-adoption-summary
    layout: title-two-column
    notes: |
      全社導入より業務単位で始める理由を説明する。
    sources:
      - label: 社内AI活用調査 2026
        url: https://example.com/research
---

<Slide id="ai-adoption-cover">

# AI導入計画

業務単位の小さな検証から始める

</Slide>

<Slide id="ai-adoption-summary">

# AI導入は業務単位で始める

<Slot name="left">

- 定型作業から導入
- 効果を数値化
- 成功例を横展開

</Slot>

<Slot name="right">

<Image
  id="adoption-image"
  src="./assets/adoption.png"
  fit="contain"
  alt="AI導入の概要"
/>

</Slot>

<Text
  id="source-label"
  x={1040}
  y={760}
  w={700}
  h={60}
  fontFace="Noto Sans JP"
  fontSize={18}
>
  出典：社内AI活用調査 2026
</Text>

</Slide>
```

要件:

- YAML frontmatterはファイル先頭に1つだけ置き、旧`deck.yaml`のデッキ設定を含める。
- `slides`配列へ、順序、`id`、`layout`、`notes`、`sources`、任意の`masterId`を記述する。
- 各メタデータに対応する`<Slide id="...">`をちょうど1つ記述する。
- トップレベルにはfrontmatter、`Slide`、任意の`Assets`だけを許可する。
- slide IDとelement IDはデッキ内で安定かつ一意にする。
- `schemaVersion`が未対応の場合は明示的に失敗する。

既存の`deck.yaml`と`slides/*.mdx`形式は後方互換として読み込める。ディレクトリに`deck.mdx`が存在する場合はそちらを優先し、新規作成コマンドは`deck.mdx`を生成する。

### 6.2 画像アセット

デッキ内の通常ファイルは、`deck.mdx`からの相対パスで指定する。

```mdx
<Image id="photo" src="./assets/photo.webp" alt="利用風景" />
```

単一ファイルで受け渡したい画像は、原則として全`Slide`の後に`Assets`を1つ置き、base64本文を持つ`Asset`を宣言する。

```mdx
<Slide id="visual">

# 埋め込み画像

<Image id="mark" src="asset:company-mark" alt="会社ロゴ" />

</Slide>

<Assets>
  <Asset id="company-mark" mimeType="image/png" encoding="base64">
    iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=
  </Asset>
</Assets>
```

要件:

- 埋め込み参照は`asset:ID`形式とする。
- `encoding`は`base64`だけを許可する。
- `mimeType`は`image/png`、`image/jpeg`、`image/gif`、`image/webp`、`image/svg+xml`を許可する。
- base64は空白と改行を除いて検証し、DeckIRではdata URIとcontent hashへ解決する。
- リモートURLは禁止し、デッキ内相対パスまたは埋め込みアセットを使う。
- 大きな画像や頻繁に変更する画像は、Git差分とファイル容量のため通常パスを推奨する。

### 6.3 初期版で許可するMDX

- CommonMarkの見出し、段落、強調、リンク、箇条書き、番号付きリスト
- `Slot`
- `Slide`（`deck.mdx`トップレベル）
- `Text`
- `Image`
- `Shape`
- `Line`
- `Connector`
- `Group`
- `Table`
- `Chart`
- `Icon`
- `Spacer`
- `Assets` / `Asset`（`deck.mdx`トップレベル）

初期版の制約:

- JSX propsは文字列、数値、真偽値、`null`、JSON互換の配列・オブジェクトに限定する。
- 関数呼び出し、任意識別子、条件分岐、ループ、非同期処理、DOMアクセスを禁止する。
- `import` / `export`は初期版では禁止する。
- 未知のコンポーネントは警告ではなくビルドエラーにする。
- 絶対配置する要素には明示的な`id`を必須とする。
- 生のHTMLと任意CSSは許可しない。
- データはJSON互換のinline値か、`dataSrc`でローカルJSON / CSVを参照する。
- 通常のMarkdownはレイアウト内のslotへ配置し、座標をテーマ側で決定する。

### 6.4 スタイルと配置の優先順位

```text
会社テーマ既定値
  < デッキ設定
  < レイアウト既定値
  < スライドfrontmatter
  < MDX要素props
  < layout.overrides.json
```

`layout.overrides.json`は座標、サイズ、回転、重なり順だけを上書きする。本文、色、フォントなどの意味的変更はMDXへ記述する。

## 7. DeckIR

### 7.1 基本方針

- `schemaVersion`付きのJSON互換データとする。
- 全座標を`1920 × 1080`の整数論理座標で保持する。
- レンダラー固有の値を含めない。
- レイアウト解決後の絶対座標を保持する。
- アセットパスはコンパイル時に絶対パスとcontent hashへ解決する。
- すべての要素に安定した`id`を持たせる。
- 診断情報には、MDXファイル、行、列、slide ID、element IDを含める。

### 7.2 型の概略

```ts
export interface DeckIR {
  schemaVersion: 1
  metadata: {
    id: string
    title: string
    author?: string
    company?: string
    language: string
  }
  canvas: {
    width: 1920
    height: 1080
    pptxWidthInch: 13.333333
    pptxHeightInch: 7.5
  }
  theme: ResolvedThemeIR
  slides: SlideIR[]
  diagnostics: Diagnostic[]
  contentHash: string
}

export interface SlideIR {
  id: string
  sourcePath: string
  layoutId: string
  masterId?: string
  background?: FillIR
  elements: ElementIR[]
  notes: {
    markdown: string
    plainText: string
    sources: SourceIR[]
  }
}

export interface ElementBase {
  id: string
  frame: {
    x: number
    y: number
    w: number
    h: number
  }
  rotation: number
  zIndex: number
  opacity: number
  locked?: boolean
  alt?: string
  sourceLocation: SourceLocation
}

export type ElementIR =
  | TextElementIR
  | ImageElementIR
  | ShapeElementIR
  | LineElementIR
  | GroupElementIR
  | TableElementIR
  | ChartElementIR
  | IconElementIR
```

### 7.3 座標変換

```ts
const xInch = x * 13.333333 / 1920
const yInch = y * 7.5 / 1080
const wInch = w * 13.333333 / 1920
const hInch = h * 7.5 / 1080
```

PPTX側から検査する際はEMUを論理座標へ逆変換し、丸め誤差を含めて1論理単位以内を許容する。

## 8. コンパイラ

### 8.1 使用ライブラリ

- `unified`
- `remark-parse`
- `remark-mdx`
- `remark-frontmatter`
- `yaml`
- `zod`
- `fontkit`

MDXのJavaScript出力を`eval`やdynamic importで実行しない。MDAST / MDX ASTを静的に走査し、許可された構文だけをDeckIRへ変換する。

### 8.2 コンパイル手順

1. デッキディレクトリの`deck.mdx`を優先して探索し、存在しない場合だけ旧`deck.yaml`へフォールバックする。
2. `deck.mdx`先頭のYAML frontmatterを読み込み、Zodで検証する。
3. `remark-mdx`でファイル全体をASTへ変換し、frontmatterの`slides`順に対応する`Slide`を取り出す。
4. 任意の`Assets`を検証し、base64画像をdata URIとcontent hashへ解決する。
5. テーマを読み込み、トークン、フォント、レイアウト、マスターを検証する。
6. Markdownと許可コンポーネントを意味要素へ正規化する。
7. JSX propsがJSON互換の静的値だけであることを検査する。
8. theme、deck、layout、slide、elementの順に設定をマージする。
9. layoutのslotを解決し、全要素を絶対座標へ変換する。
10. `layout.overrides.json`を最後に適用する。
11. パス画像、埋め込み画像、データ、フォント、リンクを解決し、content hashを計算する。
12. ID重複、メタデータと`Slide`の不一致、孤立override、欠損アセット、未登録フォント、欠落グリフを検査する。
13. 境界外配置、文字切れ、意図しない重なり、未対応要素を診断する。
14. DeckIRと`diagnostics.json`を生成する。

後方互換入力では、従来どおり`deck.yaml`の`slides`パス順に個別MDXを読み込む。以降の正規化、DeckIR、レンダラー、品質検査は単一ファイル形式と共通にする。

### 8.3 診断レベル

| レベル | 例 | ビルド |
|---|---|---|
| error | 構文エラー、ID重複、欠損アセット、未知要素、未登録フォント、境界外配置、strict時の画像化 | 失敗 |
| warning | 孤立override、画像解像度不足、要素間の大きな重なり、本文占有率超過 | 通常ビルドは継続、CIは設定で失敗可能 |
| info | 未使用アセット、テーマ既定値の利用、推奨レイアウト候補 | 継続 |

`allowOverflow`、`allowOverlap`、`editable: false`などの例外指定には、必ず`reason`文字列を要求する。

## 9. テーマとレイアウト

### 9.1 テーマ定義

会社テーマは、次を含む純粋なTypeScriptデータとして定義する。

- カラー、余白、グリッド、角丸、線幅
- 見出し、本文、注釈、コードのタイポグラフィ
- 既定フォントとフォールバック
- ロゴ、フッター、ページ番号
- PowerPoint Slide Master
- レイアウト定義
- chart、table、shapeの既定スタイル
- safe area

### 9.2 初期レイアウト

1. `cover`
2. `section`
3. `brand`
4. `title-body`
5. `title-message-body`
6. `title-two-column`
7. `title-message-two-column`
8. `title-three-column`
9. `title-image-left`
10. `title-image-right`
11. `title-chart`
12. `blank`
13. `title-message-two-column-flow`
14. `title-message-three-column-header`
15. `title-message-two-card`

AIは、原則として既存レイアウトを選択する。`blank`と全面絶対配置は、既存レイアウトでは表現できない場合に限定する。

見出し付きの専用レイアウトは、元テンプレートのslide 8〜10を再現する。`title-message-two-column-flow`は左から右への変化・因果、`title-message-three-column-header`は同格の3分類、`title-message-two-card`は独立性の高い2案・2分類に使う。PowerPointのガイド線、選択境界、プレースホルダー破線はテーマ要素へ含めない。

### 9.3 AI向けauthoring設定

`ThemeDefinition.authoring`には、レンダラーへ渡さない制作指示を機械可読なデータとして保持する。

- `colors`: 色トークンごとの目的、推奨用途、避ける用途
- `typography`: 言語別フォント、文字階層、サイズと縮小判断
- `layouts`: 各レイアウトを選ぶ意味
- `rules`: ロゴ、図表、強調、情報量に関する推奨／禁止事項

これによりCodexやClaude Codeは、描画トークンだけでなく「どの場面で何を使うか」も同じテーマから参照できる。設定はテーマ実装と同じ変更単位でレビューし、色・フォント・レイアウトを追加した場合は対応するauthoring設定と整合性テストも更新する。

### 9.4 フォント

`fonts.manifest.json`へ次を記録する。

```json
{
  "fonts": [
    {
      "family": "Noto Sans JP",
      "path": "./fonts/NotoSansJP-Regular.otf",
      "weight": 400,
      "style": "normal",
      "sha256": "...",
      "license": "OFL-1.1",
      "usage": ["body", "heading"]
    }
  ]
}
```

品質ルール:

- 未登録フォントの指定はエラーにする。
- ファイル欠損、hash不一致、必要グリフ欠損を検出する。
- Webの`@font-face`、DeckIR、PPTX theme、要素の`fontFace`で同じfamily名を使う。
- 初期版ではPPTXへのフォント埋め込みを行わない。
- 受信者環境でフォントが必要であることを`doctor`とドキュメントで明示する。
- 自動縮小は既定で禁止し、`textFit: "shrink"`を明示した要素だけに許可する。

## 10. React描画とStudio

### 10.1 ルート

- `/edit/:deckId/:slideId?`: 常設サムネイル付きEdit画面
- `/print/:deckId`: PDF用印刷

独立したSlide、Overview、Presenter、Debug画面は設けない。旧`/deck`、`/overview`、`/presenter`、`/debug` URLは後方互換のためEdit画面として解釈する。

### 10.2 描画

- 1920 × 1080の固定キャンバスをviewportに合わせてscaleする。
- elementの位置には`left/top/width/height`を使い、キャンバス全体だけをscaleする。
- MarkdownテキストはDeckIRのparagraph / runから描画する。
- フォント、画像、チャートのロード完了後に`window.__SLIDES_READY__ = true`を設定する。
- 発表者ノートをEdit画面と印刷DOMへ含めない。

### 10.3 Edit画面

```text
+------------------+--------------------------------+------------------+
| 常設サムネイル   | 編集キャンバス                 | プロパティ       |
|                  |                                |                  |
| 01 Cover         | 選択中のスライド               | 配置操作         |
| 02 Summary       | move / resize / rotate         | テキストMarkdown |
| 03 Metrics       |                                | undo / redo      |
+------------------+--------------------------------+------------------+
                                           右上 Debug icon -> drawer
```

- 左サムネイルは全スライドを縦表示し、クリックで選択する。
- 中央は常にEditキャンバスとし、閲覧専用モードとの切り替えを不要にする。
- 右パネルは選択要素の配置操作とテキスト内容編集を表示する。
- 右上のデバッグアイコンは現在スライドのlayout、element数、source、diagnosticsをdrawerで表示する。
- debug drawerは閉じるボタン、背景クリック、Escapeで閉じられる。
- 前後ボタンと矢印キーでのスライド移動を維持する。

## 11. 配置エディタ

GUI編集の対象は次とする。

- 選択
- 複数選択
- 移動
- リサイズ
- 回転
- z-index変更
- 1論理単位 / 10論理単位のキーボード移動
- grid、safe area、他要素へのsnap
- undo / redo
- 選択したText要素のMarkdown編集
- `Save text`または`Command/Ctrl + Enter`による元MDXへの保存

Studioのテキスト保存APIは、DeckIRのsource locationを使って対象範囲を特定し、改行形式を保ちながら元の`deck.mdx`を更新する。保存後は再コンパイル結果を再取得する。色、フォント、チャートデータ、スライドメタデータは引き続きMDXをコードで編集する。

### 11.1 保存形式

```json
{
  "schemaVersion": 1,
  "slides": {
    "ai-adoption-summary": {
      "adoption-chart": {
        "x": 1080,
        "y": 190,
        "w": 660,
        "h": 540,
        "rotation": 0,
        "zIndex": 20
      }
    }
  }
}
```

保存要件:

- ローカルNodeサーバーの専用APIを介して保存する。
- 一時ファイルへ書いた後にatomic renameする。
- キー順と数値表現を正規化し、Git差分を安定させる。
- debounceは行うが、画面遷移前にflushする。
- MDXから要素IDが消えた場合は孤立overrideとして警告する。
- 後続フェーズで`slide layout bake`によりMDX propsへ焼き戻せるようにする。

### 11.2 テキスト保存

- 選択対象は編集可能かつロックされていないText要素に限定する。
- deck ID、slide ID、element IDからサーバー側で対象を再解決し、クライアントから任意ファイルパスを受け取らない。
- DeckIRのsource locationがデッキディレクトリ内のMDXを指すことを検証する。
- Markdown由来のテキストと`Text`コンポーネント本文の両方を、対応するソース範囲だけ更新する。
- 一時ファイルとatomic renameで保存し、失敗時は元ファイルを維持する。
- UIは未保存、保存中、保存済み、失敗を明示し、変更がない場合は保存操作を無効化する。

## 12. PPTXレンダラー

### 12.1 変換表

| DeckIR | PptxGenJS | 編集可能性 |
|---|---|---|
| Text | `addText` | ネイティブText |
| Image | `addImage` | 独立Image |
| Shape | `addShape` | ネイティブShape |
| Line / Connector | `addShape` | ネイティブLine / Connector |
| Group | 座標変換後に名前付き子要素へ展開 | 子要素単位で編集。PowerPoint上のグループ化は後続対応 |
| Table | `addTable` | ネイティブTable |
| Chart | `addChart` | ネイティブChart |
| Icon | SVG Image | Imageとして編集 |
| Notes | `addNotes` | PowerPointノート |

実装ルール:

- exact wide layoutを`13.333333 × 7.5 inch`で定義する。
- themeからSlide Masterを生成する。
- PowerPointオブジェクト名を`lt:<slideId>:<elementId>`に統一する。PptxGenJSの公開APIで設定できない要素はOOXML後処理で`p:cNvPr@name`を設定する。
- コネクタは接続先Shapeより先に作成し、背面へ配置する。
- `notes.plainText`と`[Sources]`ブロックを`addNotes`へ渡す。
- 任意HTMLやCanvasを暗黙に画像化しない。
- `editable: false`を明示した要素だけ、理由付きでraster fallbackを許可する。
- `--strict-editable`ではraster fallbackをすべて失敗させる。

### 12.2 PPTX構造検査

PPTXをZIPとして展開し、`fast-xml-parser`でOOXMLを検査する。

| DeckIR要素 | 必須OOXML | 不合格 |
|---|---|---|
| Text | `p:sp` + `a:txBody` | `p:pic` |
| Shape | `p:sp` | PNG / SVGへの暗黙変換 |
| Connector | `p:cxnSp` | 背景画像への統合 |
| Table | `p:graphicFrame` + `a:tbl` | 表全体の画像 |
| Chart | `p:graphicFrame` + `c:chart` | グラフ全体の画像 |
| Image | `p:pic` | 許可。ただし独立要素であること |

検査項目:

- slide数、notes slide数、relationshipがDeckIRと一致する。
- 各element IDに対応する名前付きオブジェクトが1個存在する。
- 要素種別が変換表と一致する。
- 全面積の95%以上を覆う画像は、明示的なbackground以外では失敗させる。
- frameをEMUから逆変換し、DeckIRとの差が許容範囲内にある。
- text、font、size、color、paragraph順を確認する。
- PPTXをLibreOfficeで開いてPDFへ変換でき、修復エラーがない。

## 13. PDFエクスポート

Playwrightで`/print/:deckId`を開き、次を待ってからPDF化する。

1. `document.fonts.ready`
2. 全画像のload / error確定
3. 全チャートの描画完了
4. `window.__SLIDES_READY__ === true`

出力条件:

- CSS `@page`で16:9のページサイズを指定する。
- marginを0にする。
- `printBackground: true`を使う。
- `-webkit-print-color-adjust: exact`を指定する。
- スライドごとに改ページする。
- 発表者ノートをPDFへ含めない。
- ページ数、MediaBox、本文テキスト、埋め込みフォントを検査する。

## 14. CLI

実行ファイル名は`slide`とする。

通常の開発・検証ではmise taskを入口にする。

```bash
mise run dev
mise run doctor
mise run export
mise run qa
```

個別オプションを指定する場合は、miseをactivateしたシェルでCLIを直接呼び出す。

```bash
npm run slide -- new decks/example --theme company
npm run slide -- dev decks/example --open
npm run slide -- lint decks/example
npm run slide -- lint decks/example --strict-editable
npm run slide -- export decks/example --format pptx,pdf
npm run slide -- snapshot decks/example
npm run slide -- inspect decks/example --slide ai-adoption-summary
npm run slide -- doctor
npm run slide -- layout bake decks/example
```

### 14.1 出力

```text
dist/example/
├─ deck.ir.json
├─ diagnostics.json
├─ example.pptx
├─ example.pdf
├─ slides/
│  ├─ 001.png
│  └─ ...
└─ build-manifest.json
```

`build-manifest.json`には、次を含める。

- CLI version
- DeckIR schema version
- Node.js version
- package lock hash
- theme version
- font hashes
- asset hashes
- source content hash
- build timestamp
- diagnostics summary

### 14.2 `doctor`

- Node.js / npm version
- Playwright Chromium
- mise Conda backendで隔離したPoppler版`pdftotext` / `pdffonts`（Xpdfは非対応として検出）
- 必須フォント
- font hash
- PowerPoint / LibreOfficeの任意検出
- 書き込み権限
- deck / theme schema互換性

## 15. テスト戦略

### 15.1 テストレイヤー

| レイヤー | 検証 | 手段 | タイミング |
|---|---|---|---|
| Unit | MDX解析、schema、座標変換、theme cascade、notes | Vitest | ローカル、PR |
| Contract | MDXからDeckIR | 正規化JSON snapshot | PR |
| React component | 各要素のDOM | Testing Library | PR |
| Web visual | スライド全体 | Playwright screenshot | PR |
| PPTX structural | OOXML、要素種別、frame、notes | ZIP + XML検査 | PR |
| PDF structural | ページ、サイズ、本文、フォント | Poppler系CLI | PR / main |
| Export visual | Web、PDF、PPTX render | Chromium、Poppler、LibreOffice | main / nightly |
| PowerPoint integration | 選択、編集、保存、再オープン | Windows PowerPoint COM | nightly / release |
| Manual acceptance | macOS / Windows PowerPoint | 目視と操作 | release |

### 15.2 標準フィクスチャ

- `minimal`: coverと本文だけの最小デッキ
- `component-gallery`: 対応要素の全バリエーション
- `absolute-layout`: 四隅、重なり、回転、crop、group
- `japanese-typography`: 禁則、句読点、長い見出し、英数字混在、URL
- `font-overrides`: 既定、スライド単位、要素単位のフォント変更
- `speaker-notes`: 複数段落、空ノート、出典、センチネル文字列
- `overflow-invalid`: 境界外配置と文字切れの失敗ケース
- `strict-editable-invalid`: 暗黙画像化が必要な失敗ケース
- `corporate-golden`: 実際の会社資料に近い10〜20ページ
- `large-deck`: 50ページ以上の性能確認

### 15.3 文字とオーバーフロー

- コンパイル時にframeがcanvasとsafe area内にあるか検査する。
- React描画後に`scrollWidth/clientWidth`と`scrollHeight/clientHeight`を比較する。
- 本文領域は計算上の占有率92%以下を既定目標とする。
- タイトルの意図しない2行化を検出する。
- 長文の場合は、フォント縮小より文章短縮またはレイアウト変更を優先する。
- Office実機テストでは`TextFrame2.TextRange.BoundWidth/BoundHeight`を検査する。
- 意図的なoverflow / overlapには理由付き例外指定を要求する。

### 15.4 ノート

- DeckIRのnotesとPPTXから抽出したnotesが一致する。
- frontmatterの`slides[].notes`と`sources`が、対応する`Slide`のPPTXノートへ出力される。
- ノート専用センチネルがEdit DOM、PDF、slide本体XMLへ漏れない。
- 空ノートでもPPTX出力が壊れない。

### 15.5 再現性

PPTX ZIPにはtimestampや内部IDが含まれる可能性があるため、初期版ではバイナリ完全一致を要求しない。次を正規化してsemantic hashを比較する。

- DeckIR
- OOXML
- PDF metadataを除いた構造
- レンダリング画像

## 16. CI品質ゲート

```bash
npm run lint
npm run typecheck
npm run test
npm run test:fixtures
npm run test:visual
npm run test:pptx
npm run test:pdf
npm run qa
```

| ゲート | 必須検査 | 失敗時 |
|---|---|---|
| pre-commit | format、lint、typecheck、関連unit | コミット前に修正 |
| Pull Request | unit、DeckIR contract、fixtures、Web visual、PPTX/PDF構造 | マージ不可 |
| main | PR検査 + LibreOffice render + large-deck | release candidate作成不可 |
| nightly | Windows PowerPoint COM、全visual、性能 | トリアージ |
| release | Windows / macOS PowerPoint目視、corporate-golden、編集保存 | リリース不可 |

スナップショット失敗時の一括更新は禁止する。変更理由、対象スライド、期待画像、実画像、差分画像をレビューする。

## 17. 実装フェーズ

### Phase 0: リポジトリ基盤

実装:

- miseによるNode.js / npm / Popplerのバージョン固定
- `mise run setup`によるnpm依存とPlaywright Chromiumの導入
- npm workspaces
- Node.js version固定
- TypeScript strict
- ESLintまたはBiome、Prettier
- Vitest
- Playwright
- package build設定
- CI雛形
- `decks/example`雛形

完了条件:

- `mise run setup`
- `mise run qa`

が空実装上で成功する。

### Phase 1: DeckIRと品質契約

実装:

- DeckIR型
- Zod schema
- Diagnostic型
- 座標変換
- content hash
- element ID規約
- 正規化JSON serializer
- 正常 / 異常fixture

完了条件:

- 同一入力から同じ正規化DeckIR hashが生成される。
- 不正frame、重複ID、未知elementが行番号付きで失敗する。

### Phase 2: テーマ、レイアウト、MDXコンパイラ

実装:

- 単一`deck.mdx` parser
- デッキ設定とslideメタデータを持つ先頭frontmatter parser
- 複数`Slide`の対応・順序検査
- `Assets` / `Asset`とbase64画像解決
- 旧`deck.yaml` + 複数MDX parser（後方互換）
- static MDX AST parser
- 許可component registry
- Markdownからrich textへの変換
- 会社テーマ
- 8レイアウト
- asset / data resolution
- font manifest / glyph check
- layout override merge
- lint

完了条件:

- 単一ファイルfixture、`minimal`、`component-gallery`が同じDeckIR契約へ変換できる。
- 未知component、slideメタデータ不一致、不正base64、欠損asset、未登録font、孤立overrideを検出できる。

### Phase 3: React描画とStudio基盤

実装:

- React renderer
- Vite studio
- Edit / print route
- HMR
- keyboard navigation
- browser overflow検査

完了条件:

- example deckをEdit画面とprint画面で閲覧できる。
- MDX変更がHMRで反映される。
- notesがEdit画面とprint DOMへ漏れない。

### Phase 4: 編集可能PPTX

実装:

- PptxGenJS renderer
- theme / Slide Master
- Text、Image、Shape、Line、Connector
- 論理Groupの子要素展開
- Table
- Bar、Line、Pie chart
- speaker notes
- object naming
- strict editable
- OOXML inspector
- LibreOffice smoke test

完了条件:

- component galleryの対応要素がネイティブOOXMLになる。
- 暗黙画像化が0件になる。
- notesとsourcesがPowerPointノート欄に表示される。
- PowerPointで修復なしに開き、編集・保存できる。

### Phase 5: PDFと統合CLI

実装:

- Playwright PDF exporter
- print readiness
- PDF構造検査
- `new`、`dev`、`lint`、`export`、`snapshot`、`inspect`、`doctor`
- build manifest
- dist管理

完了条件:

- 1コマンドでPPTXとPDFを生成できる。
- PDFのページ数、サイズ、本文、フォントが検証される。
- `doctor`が不足依存を具体的に案内する。

この時点を「CLI MVP」とする。

### Phase 6: 配置エディタ

実装:

- 全スライドを縦表示する常設サムネイル
- Edit中心の単一画面レイアウト
- Moveable
- Selectoまたは同等の複数選択
- drag / resize / rotate
- snap / guides / safe area
- keyboard nudge
- z-index
- undo / redo
- 選択したText要素のMarkdown編集
- 元MDXへのatomicテキスト保存API
- 右上debugアイコンとdrawer
- Node保存API
- atomic `layout.overrides.json`保存
- editor E2E

完了条件:

- 左サムネイルから任意スライドを選択できる。
- 選択したテキストを変更し、再コンパイル後も`deck.mdx`へ維持できる。
- debug drawerを開閉し、現在スライドの診断を確認できる。
- GUI調整が再起動後も維持される。
- GUI調整がWeb、PDF、PPTXすべてへ反映される。
- 孤立overrideが警告される。

この時点を「Studio MVP」とする。

### Phase 6.1: 単一ファイル移行

実装:

- `slide new`の出力を`deck.mdx`へ変更
- exampleデッキを10個のslide MDXから単一`deck.mdx`へ移行
- パス画像と埋め込み画像の両方をDeckIRへ解決
- Studioテキスト編集を単一`deck.mdx`のsource locationへ接続
- 旧形式fixtureによる後方互換テスト

完了条件:

- 新規デッキが`deck.mdx`と`layout.overrides.json`だけで開始できる。
- exampleのWeb、PPTX、PDF、notesが移行前と同じ意味内容を保つ。
- `deck.mdx`があるディレクトリでは、旧`deck.yaml`より優先してコンパイルされる。

### Phase 7: AI制作DXとパイロット

実装:

- `docs/authoring.md`
- component APIリファレンス
- layout gallery
- theme authoring guide
- troubleshooting
- `AGENTS.md`
- `CLAUDE.md`
- AI向け禁止事項と品質チェックリスト
- corporate golden deck
- 2〜3本の実案件パイロット

完了条件:

- 新規参加者がサンプルからデッキを作成できる。
- Codex / Claude Codeが既存layoutとcomponentだけで正常なdeckを生成できる。
- 別の社員が出力PPTXをPowerPointで編集・再保存できる。

### Phase 8: 運用強化

必要性を確認してから着手する。

- `slide layout bake`
- 既存PPTXテンプレートadapter
- remote asset取り込みとprovenance
- image deduplication / optimization
- incremental compile / cache
- Windows PowerPoint COM nightly
- theme migration
- plugin API

## 18. 初期スコープ外

- PPTXからMDXへの逆変換
- PowerPoint側の変更との双方向同期
- 任意HTML、CSS、Reactコンポーネント
- PowerPointテンプレートファイルの直接インポート
- アニメーション、画面切り替え効果
- GUI上でのWYSIWYGリッチテキスト、色、フォント、チャートデータ編集
- 専用の発表者画面、タイマー、別ウィンドウ同期
- 編集可能なMermaid / SmartArt
- リアルタイム共同編集
- クラウド保存、認証、権限管理
- PPTXへのフォント埋め込み
- WebとPowerPointのpixel-perfectな文字組み一致
- Google Slidesへのネイティブ出力

## 19. 主なリスク

| リスク | 影響 | 対策 |
|---|---|---|
| WebとPowerPointの文字計測差 | 改行変化、文字切れ | フォント固定、8%以上の余白、明示改行、ブラウザoverflow検査、Office実機検査 |
| 受信者にフォントがない | 代替フォントで崩れる | `doctor`、font manifest、社内配布手順、標準フォント優先、PDF併記 |
| 任意MDXの画像化 | PPTX編集可能性を失う | static DSL、未知要素エラー、strict editable、暗黙fallback禁止 |
| PptxGenJS更新 | OOXML差分、出力崩れ | version固定、OOXML contract test、golden deck |
| LibreOfficeとPowerPointの差 | CI成功でもPowerPointで崩れる | LibreOfficeはpreflight、PowerPoint実機をrelease gateにする |
| MDXとoverrideの二重管理 | 調整消失、意図しない上書き | 優先順位固定、ID必須、孤立override警告、将来のbake |
| PowerPoint編集を正本へ戻したくなる | 正本が分裂する | PPTXは成果物と明記し、再入力を非対応にする |
| 大量画像・大きなbase64 | `deck.mdx`肥大化、Git差分悪化、出力低速 | 埋め込みは小さな自己完結アセットへ限定し、大きな画像は相対パス、解像度上限、重複排除、サイズ予算、large-deck test |
| visual test不安定化 | 偽陽性が増える | OS、Chromium、font固定、差分artifact、理由なきmask禁止 |
| element ID変更 | GUI配置が失われる | ID一意検査、孤立警告、rename補助を後続実装 |

## 20. 初回実装スライス（完了済みの履歴）

最初のPull Requestは、Phase 0とPhase 1の一部に限定する。

1. npm workspacesを作成する。
2. `packages/deck-ir`と`packages/cli`を作成する。
3. DeckIRの最小schemaを実装する。
4. 最小デッキfixtureを追加する（その後、正本を単一`decks/example/deck.mdx`へ移行）。
5. MDX本体はまだ描画せず、手書きfixtureからDeckIRを生成する。
6. 座標変換、ID重複、canvas境界のunit testを追加する。
7. `npm run slide -- doctor`と`npm run slide -- lint`のコマンド骨格を作る。
8. CIでlint、typecheck、testを実行する。

このスライスではPPTXやReactを入れない。DeckIRと品質契約を先に固定し、以降のrendererが同じ契約へ依存できる状態を作る。

## 21. 実装開始前に確定するもの

実装を止めるほどの未決事項はない。次は暫定値で開始し、Phase 7のパイロットで見直す。

- 会社標準フォント: Livetoonテーマは游ゴシック、英数字要素はArial。default fixtureはNoto Sans JPを使用
- 第一サポートPowerPoint: Microsoft 365最新版
- 第一サポートOS: 制作はmacOS、最終互換性はWindows PowerPointも確認
- canvas: 1920 × 1080
- PowerPointサイズ: 13.333333 × 7.5 inch
- theme layout数: Livetoonテーマは12
- GUI編集対象: 位置、サイズ、回転、z-index、選択Text要素のMarkdown本文
- PDF: Chromium描画を基準

## 22. 参考一次情報

- MDX: https://mdxjs.com/docs/what-is-mdx/
- PptxGenJS: https://gitbrent.github.io/PptxGenJS/docs/introduction/
- PptxGenJS Speaker Notes: https://gitbrent.github.io/PptxGenJS/docs/speaker-notes/
- PptxGenJS Masters: https://gitbrent.github.io/PptxGenJS/docs/masters/
- Playwright PDF: https://playwright.dev/docs/api/class-page#page-pdf
- Moveable: https://daybrush.com/moveable/release/latest/doc/
- Slidev Export: https://sli.dev/guide/exporting.html
- Slidev Draggable Elements: https://sli.dev/features/draggable.html
- Marp editable PPTX: https://github.com/marp-team/marp-cli#convert-to-powerpoint-document---pptx-
