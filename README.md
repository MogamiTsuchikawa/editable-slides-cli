# Livetoon Slide

`deck.mdx` 1ファイルを内容と発表者原稿の正本として、ブラウザ上の編集、編集可能なPPTX、PDFを同じDeckIRから生成するスライド制作基盤です。Studioで手動調整した位置とサイズだけは、補助ファイルの`layout.overrides.json`へ保存します。

## AIで使う（おすすめ）

このリポジトリをCodexまたはClaude Codeで開き、作りたい資料を普通の日本語で
伝えてください。

> 営業部の新人向けに、生成AIを安全に使う方法を説明するスライドを作って。

AIは初回準備、構成、Livetoonテーマでの制作、発表者原稿、全ページの見た目確認、
編集可能なPPTXとPDFの出力まで行います。レイアウト、フォント、保存形式などを
利用者へ質問しない運用ルールを`AGENTS.md`、`CLAUDE.md`、
`AI_PLAYBOOK.md`に用意しています。

入力資料はチャットへ添付するか、`materials/`へ置いてファイル名を伝えます。
コピーして使える依頼例は[`START_HERE.md`](./START_HERE.md)にあります。

## 手動セットアップ

前提は[mise](https://mise.jdx.dev/) 2026.3.10以降だけです。

```bash
mise trust
mise run setup
```

`mise run setup`はNode.js 24.0.1、npm 11.3.0、npm依存、Playwright Chromium、Poppler 26.07.0を準備します。Popplerはmise配下へ隔離されるため、HomebrewのXpdfを`brew unlink`する必要はありません。普段のコマンドは`mise run ...`経由で実行してください。

準備済み環境を後から再確認するときだけ`mise run doctor`を実行します。

## サンプルと基盤の手動操作

```bash
mise run dev          # exampleをStudioで開く
mise run export       # exampleをPPTXとPDFへ出力
mise run qa           # lint・型検査・テスト
mise run test:visual  # Web視覚回帰
```

新しい資料は固有の英小文字名と表示タイトルを指定して作成します。
`release`は警告検査、全体一覧と全ページ画像、編集可能PPTX、
PDFの出力をまとめて行います。

```bash
mise exec -- npm run slide -- new decks/my-deck \
  --title "資料タイトル" \
  --theme company
mise exec -- npm run slide -- dev decks/my-deck --open
mise exec -- npm run slide -- release decks/my-deck
```

## Livetoonテーマ

提供されたPowerPointテンプレートを、`company`テーマとして再現しています。表紙、章区切り、ロゴバンパー、本文、メッセージ帯、汎用2／3カラム、矢印付き2カラム、見出し付き3カラム、2カード、左右画像、チャート、自由配置の15レイアウトを利用できます。

```yaml
theme: company
```

テーマには元資料から抽出したロゴ、マーク、リボン、青からピンクのグラデーションを同梱しています。通常ページは游ゴシック、英数字だけの要素はArialが標準です。一部だけArialへ変える場合は、要素へ例外を指定できます。

```mdx
<Text id="metric" fontFace="Arial">

ARR 120%

</Text>
```

AIが資料を作るときの判断基準は、[`companyTheme.authoring`](./themes/company/src/index.ts)に機械可読な設定として置いています。次の内容をテーマ本体と一緒にバージョン管理します。

- 色トークンごとの目的、推奨用途、避ける用途
- 日本語／英数字のフォントと、タイトル・本文・注釈の文字サイズ
- 15レイアウトの用途と、並列比較・方向のある比較・独立カードの使い分け
- ロゴ、強調色、図表、文字量に関する推奨／禁止ルール

再現サンプルは[`decks/livetoon-theme/deck.mdx`](./decks/livetoon-theme/deck.mdx)です。

```bash
mise exec -- npm run slide -- dev decks/livetoon-theme --open
mise exec -- npm run slide -- release decks/livetoon-theme
```

## `deck.mdx`

デッキ設定、スライド順、発表者原稿、本文を1ファイルにまとめます。先頭のYAML frontmatterが旧`deck.yaml`相当で、`slides`配列の順に対応する`<Slide id="...">`を記述します。

```mdx
---
schemaVersion: 1
id: quarterly-report
title: 四半期レポート
author: Livetoon
company: Livetoon
theme: company
canvas: wide
language: ja-JP
strictEditable: true
slides:
  - id: cover
    layout: cover
    notes: |
      このページでは今回の報告範囲を説明します。
    sources: []
  - id: summary
    layout: title-image-right
    notes: |
      主要な結果を三点説明します。
    sources:
      - label: 社内集計 2026
---

<Slide id="cover">

# 四半期レポート

再現可能なMDXから作る

</Slide>

<Slide id="summary">

# 主要な結果

- 売上は計画比105%
- 継続率は前四半期比3pt改善

<Image id="result-visual" src="./assets/result.png" alt="主要結果" />

</Slide>
```

通常の画像は`deck.mdx`からの相対パスで指定します。ファイルを分けたくない画像は、MDX末尾の`<Assets>`へbase64で埋め込み、`asset:ID`で参照できます。

```mdx
<Image id="mark" src="asset:company-mark" alt="会社ロゴ" />

<Assets>
  <Asset id="company-mark" mimeType="image/png" encoding="base64">
    iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=
  </Asset>
</Assets>
```

対応する埋め込み画像形式はPNG、JPEG、GIF、WebP、SVGです。リモートURLは利用せず、デッキ内の相対パスまたは埋め込みアセットを使います。

## Studio

StudioはEdit中心の1画面です。

- 左: 常設のスライドサムネイル。クリックしてスライドを選択
- 中央: 選択、移動、リサイズ、回転ができる編集キャンバス
- 右: レイアウト操作と、選択したテキストのMarkdown編集
- 右上: デバッグアイコン。診断情報をdrawerで開閉

テキスト変更は元の`deck.mdx`へ保存され、再コンパイル後のWeb、PPTX、PDFへ反映されます。専用のPresenter、Overview、Debug画面はありません。PDF生成用のprintルートと、PPTXへ出力する発表者ノートは維持しています。

## 後方互換

既存の`deck.yaml`と`slides/*.mdx`から成るデッキも引き続きコンパイルできます。同じディレクトリに`deck.mdx`がある場合は、単一ファイル形式を優先します。新規デッキは`deck.mdx`を使用してください。

## 任意のOffice互換環境

macOSでLibreOfficeとPowerPoint互換フォントも導入する場合は、Homebrewを用意して次を実行します。

```bash
mise run setup:office
```

LibreOffice、Noto Sans JP、Noto Sans Monoが導入されます。PowerPoint自体はmiseの管理対象外です。編集可能PPTXの実機確認が必要な端末へMicrosoft PowerPointを別途導入してください。

## 主な成果物

- `dist/example/example.pptx`
- `dist/example/example.pdf`
- `dist/example/deck.ir.json`
- `dist/example/build-manifest.json`
- `dist/livetoon-theme/livetoon-theme.pptx`
- `dist/livetoon-theme/livetoon-theme.pdf`

詳細な設計と実装状況は[`PLAN.md`](./PLAN.md)を参照してください。
