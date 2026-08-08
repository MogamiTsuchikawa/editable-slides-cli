# CLI利用ガイド

## 初回準備

公開版をnpmから導入する。

```bash
npm install --global editable-slides-cli
slide setup
slide doctor
```

`slide setup`は、プレビュー、画像、PDFの生成に使うChromiumを準備する。
`slide doctor`で`✓`になっていない必須項目があれば、表示された案内に沿って準備する。

Node.jsは24以降が必要である。PDFの本文とフォントを検査する場合は、
Popplerの`pdftotext`と`pdffonts`も必要になる。Xpdfの同名コマンドには対応しない。

### Popplerを準備する

macOS、Windows、Linuxで手順を揃える場合は、miseを利用できる。

```bash
mise use -g conda:poppler@26.07.0
slide doctor
```

miseのconda backendは、OSに合う実行ファイルを選び、conda自体を別途導入せずに
利用できる。詳細は[mise公式のconda backend説明](https://mise.jdx.dev/dev-tools/backends/conda.html)を参照する。

OS標準のパッケージ管理を使う場合は、次を利用する。

| OS | 導入方法 | 確認方法 |
|---|---|---|
| macOS | `brew install poppler` | `pdftotext -v`と`pdffonts -v` |
| Ubuntu / Debian | `sudo apt install poppler-utils` | `pdftotext -v`と`pdffonts -v` |
| Windows | 上記のmise方式を推奨 | PowerShellで`pdftotext -v`と`pdffonts -v` |

macOSのpackage情報は[Homebrew公式のPopplerページ](https://formulae.brew.sh/formula/poppler.html)、
Ubuntuの収録コマンドは[Ubuntu公式package一覧](https://packages.ubuntu.com/jammy/all/poppler-utils/filelist)で確認できる。

## 新しい資料を作る

```bash
slide new "資料名"
slide dev "資料名" --open
```

組み込みテンプレートは中立な`default`だけである。`slide new -t default "資料名"`と
明示することもできる。
日本語の資料名はそのままフォルダ名と表示名になる。資料の処理に必要な英数字の
内部IDは自動で作られるため、利用者が決める必要はない。

編集画面で内容を仕上げたら、次の1コマンドで厳格な検査、全ページ画像、
編集可能なPPTX、PDFを生成する。

```bash
slide release "資料名"
```

成果物はコマンドを実行した場所の`dist/<資料ID>/`へ保存される。

## URLからテンプレートを追加する

繰り返し使うひな形は、信頼できるHTTPS URLからZIPとして登録できる。

```bash
slide template add https://example.com/templates/sales.zip --name sales
slide template list
slide new -t sales "営業提案資料"
```

`--name`を省略した場合は、ZIP内の`template.json`にある`id`が登録名になる。
同じ登録名を新しい版へ置き換えるときだけ`--force`を付ける。配布元が
SHA-256を案内している場合は、取り違えや改変を検出できるよう`--sha256`も指定する。

```bash
slide template add https://example.com/templates/sales.zip \
  --name sales \
  --sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --force
```

登録したテンプレートはOS標準のデータ保存先に保管される。自動処理や一時環境で
保存先を固定したい場合は、`EDITABLE_SLIDES_DATA_HOME`を指定できる。

### ZIPの構成

ZIPのルート、またはZIP内の単一フォルダに、次のファイルを入れる。

```text
sales-template/
├── template.json            必須
├── deck.mdx                 必須
├── theme.json               独自デザインを使う場合
├── layout.overrides.json    任意
├── assets/                  任意
├── data/                    任意
└── README.md                任意
```

`template.json`は次の形式にする。`entry`は`deck.mdx`、標準テンプレートと
同じ構成にする場合は`theme`へ`default`を指定する。

```json
{
  "schemaVersion": 1,
  "id": "sales",
  "name": "営業提案テンプレート",
  "version": "1.0.0",
  "entry": "deck.mdx",
  "theme": "default"
}
```

独自デザインを配布する場合は、実行コードではない`theme.json`をZIPへ含め、
`theme`を`./theme.json`にする。CLIは登録時にテーマ定義とデッキを検証する。
JavaScriptのテーマはURLテンプレートに含められない。

`deck.mdx`先頭の`id`、`title`、`theme`は、`slide new`が作成時に設定する。
表紙など本文にも資料名を入れる場合は、次の固定文字を置いておく。

```mdx
# __EDITABLE_SLIDES_TITLE__
```

作成時に、この固定文字が安全に処理された資料名へ置き換わる。必要な場合は
`__EDITABLE_SLIDES_ID__`と`__EDITABLE_SLIDES_THEME__`も本文で使用できる。
テンプレートの`assets/`と`data/`も新しい資料へコピーされる。

通常はHTTPS URLだけを使う。`localhost`、`127.0.0.1`など手元の開発サーバーは
HTTPでも登録できる。それ以外のHTTP URLが業務上必要な場合に限り、通信内容を
確認したうえで`--allow-http`を明示する。

```bash
slide template add http://templates.example.local/sales.zip \
  --name sales \
  --allow-http
```

不要になったテンプレートは登録名で削除する。削除しても、そのテンプレートから
すでに作った資料には影響しない。

```bash
slide template remove sales
```

Livetoonなどの会社用テンプレートも、URLから明示的に登録する。テンプレート原本は
リポジトリ直下の`templates/`に置くが、
公開npm packageには同梱しない。配布URLとSHA-256はS3などの管理された配布元から
受け取る。

```bash
slide template add https://example.com/livetoon-template-1.0.0.zip \
  --name livetoon-official \
  --sha256 <配布元が示すSHA-256>
```

## 主なコマンド

| コマンド | 用途 |
|---|---|
| `slide new -t <template> <folder>` | 指定したテンプレートから新しい資料を作る |
| `slide template add <https-url>` | URLのZIPテンプレートを登録する |
| `slide template list` | 組み込みの`default`と登録済みテンプレートを一覧表示する |
| `slide template remove <id>` | 登録済みテンプレートを削除する |
| `slide migrate <folder>` | 旧形式の資料を、Studioでページ操作できる単一ファイル形式へ移行する |
| `slide layout bake <folder>` | Studioの位置・サイズ調整を元の資料へ反映する |
| `slide id rename <folder> ...` | ページ・要素の安定IDと関連する参照をまとめて変更する |
| `slide benchmark <folder>` | ページ数、コンパイル時間、資料データ量を計測する |
| `slide dev <folder> --open` | 編集画面を開く |
| `slide lint <folder> --strict-editable --fail-on-warnings` | 内容、安全性、編集性を検査する |
| `slide snapshot <folder>` | 全ページ画像と一覧画像を作る |
| `slide export <folder>` | PPTXとPDFを出力する |
| `slide release <folder>` | 厳格な検査から全形式の出力までまとめて行う |
| `slide inspect <folder>` | 資料やPPTXの内部検査結果を表示する |
| `slide doctor` | 必要な実行環境を診断する |

各コマンドの詳しい説明は`slide <command> --help`で確認できる。

## よくある問題

| 表示・症状 | 対処 |
|---|---|
| Chromiumが見つからない | `slide setup`を実行してから`slide doctor`で再確認する |
| Popplerが見つからない | 上記の手順でPopplerを導入し、`pdftotext`と`pdffonts`をPATHへ通す |
| Xpdfと表示される | XpdfではなくPopplerのコマンドが先に見つかるようPATHを調整する |
| ポートが使用中 | `--port`を外す。空いている番号が自動で選ばれる |
| 警告でreleaseが止まる | 代替説明、文字量、領域外配置、出典など、表示された箇所をStudioで直す |
| テンプレートを登録できない | URLがHTTPSか、ZIPに`template.json`と`deck.mdx`があるかを確認する |
| SHA-256が一致しない | 登録を中止し、配布元のURLとSHA-256を確認する。`--force`で回避しない |
| 同じテンプレート名がある | 内容を確認し、更新する場合だけ`--force`を付ける |
| 独自テーマが拒否される | 同梱テーマを使うか、信頼できるテーマだけ`EDITABLE_SLIDES_ALLOW_CUSTOM_THEME=1`を明示して実行する |
| 大きな動画を追加できない | 動画を圧縮する。100MiBを超える素材は通常のGit管理へ直接追加しない |

旧形式を移行するとき、元の`deck.yaml`とページファイルは削除・変更しない。
新しい`deck.mdx`を確認し、PPTXとPDFが正しく出力できたあとも、元ファイルの整理は
Gitの履歴を確認できる担当者が別途行う。

`slide layout bake`は、元の資料に直接書かれた画像、図形、文字などの位置・サイズを
`deck.mdx`へ反映する。レイアウトから自動生成された見出しなどは、元の要素がないため
`layout.overrides.json`へ残す。実行前後の差分はGitで確認できる。

ID変更は、接続線の参照と位置調整も同時に更新する。ページIDは
`--kind slide --from <現在> --to <変更後>`、要素IDはこれに
`--kind element --slide <ページID>`を指定する。通常の資料制作ではIDを安易に
変更せず、重複の解消や名称整理が必要な場合だけ利用する。

## 安全上の既定値

- 画像、動画、音声は資料フォルダ内のローカルファイルだけを扱う。
- リモートURL、資料外への参照、シンボリックリンク経由の参照を拒否する。
- URLテンプレートは通常HTTPSだけを受け付け、ZIPの必須構成を登録前に検査する。
- 同名テンプレートを自動で上書きせず、更新時は`--force`を必要とする。
- SVG内のscript、外部参照、イベント処理を拒否する。
- 独自テーマのプログラムは、明示的に許可した場合だけ実行する。
- 入力資料や素材をCLIから外部サービスへ送信しない。

## packageを作る担当者向け

```bash
npm run build:template
npm run test:package
npm pack --workspace=editable-slides-cli
```

`build:template`はLivetoonテンプレートのZIPとSHA-256を
`artifacts/templates/`へ生成する。ZIPはnpm packageやGitHub Releaseへ添付せず、
必要な場合だけS3などの管理されたURLへ配置する。

`test:package`は一時フォルダにtarballを導入し、`new`、厳格な`lint`、
PPTX出力、同梱Studioの起動を確認する。`SLIDE_PACKAGE_PDF=1`を付けた場合は
PDF出力も確認する。

`editable-slides-cli@0.1.0`は2026年8月8日に手動publish済みである。開発中の版は
`npm pack --workspace=editable-slides-cli`で作った`.tgz`を使って確認する。
ライセンスはMITである。Trusted Publisherは登録済みであり、0.1.1以降は
`v<version>`タグのrelease workflowから公開し、自動公開を確認する。
