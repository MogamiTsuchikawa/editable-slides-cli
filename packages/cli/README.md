# Livetoon Slide CLI

文章と素材から、ブラウザで編集できるスライド、編集可能なPPTX、PDFを生成するCLIです。

## 初回準備

```bash
npm install --global livetoon-slide
slide setup
slide doctor
```

Node.js 24以降が必要です。PDFの本文・フォント検査にはPopplerの
`pdftotext`と`pdffonts`も必要です。

PopplerはOSに合わせて次のいずれかで準備できます。

| OS | コマンド |
|---|---|
| macOS | `brew install poppler` |
| Ubuntu / Debian | `sudo apt install poppler-utils` |
| Windows / 共通 | `mise use -g conda:poppler@26.07.0` |

導入後に`slide doctor`を実行し、Node.js、npm、Chromium、Popplerが
すべて`✓`になっていることを確認してください。Xpdfの同名コマンドには対応しません。

## 使い方

```bash
slide new -t livetoon "資料名"
slide new -t tsuchikawa-shuron "修士論文発表"
slide dev "資料名" --open
slide release "資料名"
```

`livetoon`は同梱のテンプレートで、Livetoonの`company`テーマを使います。
`tsuchikawa-shuron`も同梱され、青緑の帯と白地を使う修士論文発表向けの
テーマを適用します。
日本語の資料名はそのままフォルダ名と表示名になり、内部IDは自動で作られます。

## URLからテンプレートを追加する

信頼できるHTTPS URLのZIPを、名前を付けて登録します。

```bash
slide template add https://example.com/templates/sales.zip --name sales
slide template list
slide new -t sales "営業提案資料"
```

同じ名前のテンプレートを更新するときは`--force`、配布元が示すSHA-256と
照合するときは`--sha256`を指定します。

```bash
slide template add https://example.com/templates/sales.zip \
  --name sales \
  --sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --force
```

ZIPのルート、またはZIP内の単一フォルダには、`template.json`と`deck.mdx`が
必要です。`layout.overrides.json`、`assets/`、`data/`、`README.md`も含められます。
`template.json`は次の形式です。

```json
{
  "schemaVersion": 1,
  "id": "sales",
  "name": "営業提案テンプレート",
  "version": "1.0.0",
  "entry": "deck.mdx",
  "theme": "company"
}
```

`deck.mdx`の表紙など、本文へ資料名を入れる位置には
`__LIVETOON_SLIDE_TITLE__`と書いておきます。新規作成時に安全な資料名へ
置き換わります。先頭設定の`id`、`title`、`theme`は自動で設定されます。

通常はHTTPSだけを使用します。手元の開発サーバーを除くHTTP URLを使う必要が
ある場合だけ`--allow-http`を明示します。登録したテンプレートはOS標準の
データ保存先に置かれ、`LIVETOON_SLIDE_DATA_HOME`で保存先を変更できます。

不要になったテンプレートは登録名で削除します。すでに作った資料には影響しません。

```bash
slide template remove sales
```

公式Livetoon ZIPをURL経由で確認する場合は、組み込み版と異なる登録名を
指定します。組み込みの`livetoon`と`tsuchikawa-shuron`は上書きできません。

```bash
slide template add https://example.com/livetoon-template-1.0.0.zip \
  --name livetoon-official \
  --sha256 <配布元が示すSHA-256>
```

旧形式の資料は`slide migrate <folder>`で単一ファイル形式へ移行できます。
元のファイルは削除・変更しません。
Studioの位置調整を元の資料へ反映する場合は`slide layout bake <folder>`を使います。
ページ・要素IDを変更する場合は`slide id rename <folder> --help`を確認してください。

コマンド一覧は`slide --help`、各コマンドの詳細は
`slide <command> --help`で確認できます。

公式ZIPを作る担当者は、リポジトリのルートで`npm run build:template`を
実行します。決定的なZIPとSHA-256が`artifacts/templates/`へ生成されます。

初回公開前の候補版は、GitHub Actionsのartifactまたは`npm pack`で作った
`.tgz`からも試せます。ライセンスはMITです。
