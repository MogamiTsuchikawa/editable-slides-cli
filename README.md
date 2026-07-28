# Livetoon Slide

`deck.mdx` 1ファイルを正本として、ブラウザ上の編集、編集可能なPPTX、PDFを同じDeckIRから生成するスライド制作基盤です。発表者原稿もMDXに保持し、PPTXのノートへ出力します。

## セットアップ

前提は[mise](https://mise.jdx.dev/) 2026.3.10以降だけです。

```bash
mise trust
mise run setup
mise run doctor
```

`mise run setup`はNode.js 24.0.1、npm 11.3.0、npm依存、Playwright Chromium、Poppler 26.07.0を準備します。Popplerはmise配下へ隔離されるため、HomebrewのXpdfを`brew unlink`する必要はありません。普段のコマンドは`mise run ...`経由で実行してください。

## 基本操作

```bash
mise run dev          # Studioを開く
mise run export       # exampleをPPTXとPDFへ出力
mise run qa           # lint・型検査・テスト
mise run test:visual  # Web視覚回帰
```

個別のCLIコマンドは、miseをactivateしたシェルで実行できます。

```bash
eval "$(mise activate zsh)"
npm run slide -- new decks/my-deck --theme company
npm run slide -- dev decks/my-deck --open
npm run slide -- export decks/my-deck --format pptx,pdf
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

詳細な設計と実装状況は[`PLAN.md`](./PLAN.md)を参照してください。
