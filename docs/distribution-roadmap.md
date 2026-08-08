# CLI配布・運用ロードマップ

スライド自体の表現機能は、
[`authoring-feature-roadmap.md`](./authoring-feature-roadmap.md)で別に管理する。

## 結論

リポジトリをcloneせず、公開npmから導入して使う単一CLI packageは
実装済みである。package名は`editable-slides-cli`で、内部処理、中立な`default` theme、
Studioをbundleし、`slide new`、`dev`、`lint`、`snapshot`、`export`、`release`を
利用者の作業場所から実行できる。

新規資料は`slide new "資料名"`または`slide new -t default "資料名"`で開始できる。
組み込みテンプレートは中立な`default`だけである。必須manifestを持つZIPテンプレートを
HTTPS URLから登録し、
同じ`-t`指定で再利用できる。

配布用tarballの内容検査、空の一時フォルダへの導入、同梱Studioの起動、
Linux・macOS・Windowsのsmoke testも自動化済みである。`release`は完成するまで
一時出力を使い、失敗時に以前の成果物を残すtransaction方式になっている。

公開先はnpmjs.comと公開GitHub repository、任意テンプレートZIPの保管先はS3に
決定した。package metadata、tag限定のrelease workflow、OIDC権限は準備済みである。
公開npmに同梱するテンプレートは`default`だけである。
初回だけnpmへ手動publishしてpackageを作成し、その後Trusted Publisherを設定する。

## 現在の実装状況

| 分類 | 状態 | 現在の内容 | 残課題 |
|---|---|---|---|
| 単一CLI package | 実装済み | `editable-slides-cli`へCLI、内部package、`default` theme、Studioをbundle | 初回npm publish |
| CLI基本操作 | 実装済み | `--version`、コマンド別`--help`、余分な引数の拒否、`setup`、`doctor` | 公開後の案内確認 |
| テンプレート | 実装済み | 同梱`default`、URL ZIPの登録・一覧・削除、SHA-256照合、明示的な更新 | S3 bucket、独自domain、version保持規則の設定 |
| Studio同梱 | 実装済み | package内の静的Studioと編集APIを、このPC内だけで使えるserverとして起動 | 公開package上での継続的な互換性確認 |
| 配布テスト | 実装済み | tarball内容、容量、導入、version、doctor、資料作成、厳格lint、PPTX、画像、Studioを検査 | PDFを含む配布testを通常matrixへ入れるか判断 |
| 3 OS CI | 実装済み | Linux、macOS、Windowsでpackage smokeを実行 | PowerPoint実機は別環境で確認 |
| 移行 | 実装済み | 旧`deck.yaml`＋ページファイルを、元ファイルを残したまま`deck.mdx`へ統合 | 将来schema・themeの版が増えた場合のversion migration |
| layout bake | 実装済み | Studioの位置・サイズ調整を正本へ反映し、自動生成要素は補助ファイルへ残す | 複雑な自動生成要素の反映範囲拡大 |
| ID rename | 実装済み | ページ・要素ID、接続線参照、生成ID、位置調整をまとめて変更し、衝突を拒否 | 追加される新しい参照項目への追従 |
| transaction | 実装済み | `release`をstagingで完成させてから切り替え、失敗時は旧成果物を保持。単一ファイル更新も一時ファイルから置換 | 複数の正本ファイルを同時更新する機能を増やす場合は追加設計 |
| セキュリティ | 実装済み | 素材参照、symlink、容量、形式、SVG、URL、独自テーマ、Studio host・origin・CSPを制限 | 第三者レビュー。対応版のない画像依存の2件は到達不能性をtestで固定し、他の高・重大問題は公開を停止 |
| 性能計測 | 実装済み | `slide benchmark`と30・50ページの基準値を用意 | 継続計測の閾値設定は利用状況を見て判断 |
| 公開npm / GitHub | 準備中 | 公開repository、公開metadata、tag release、3 OS smoke、OIDC、provenanceを設定 | 初回npm publish、Trusted Publisher登録 |

## 配布構成

| 案 | メリット | デメリット | 判断 |
|---|---|---|---|
| 単一packageへCLI・Studio・内部処理を同梱 | 利用者は1packageだけ導入すればよく、内部packageの版ずれがない | bundleとStudioの同梱buildが必要 | `editable-slides-cli`で採用 |
| 全workspaceを個別packageとして配布 | コンパイラやrendererを個別に再利用できる | 公開順、互換性、権限、バージョン管理が複雑 | 再利用需要が確認された場合だけ検討 |
| OS別の単体実行ファイルをGitHub Releasesで配布 | Node.jsやnpmに不慣れな利用者にも導入しやすい | OS別buildと署名が必要。ChromiumとPDF検査ツールの扱いも残る | npm版の安定後に検討 |

初期の技術構成は単一packageで確定している。公開先はnpmjs.comと公開GitHub
repositoryである。GitHub Actionsはpackageを検査し、`.tgz`を作り、`v<version>`タグの場合だけ
npm publishとGitHub Releaseを行う。

| 公開範囲 | メリット | デメリット | 判断 |
|---|---|---|---|
| 非公開のGitHub Packagesへ全機能を配布 | 会社テーマとブランド素材を社内だけで共有できる | 利用者ごとにGitHub Packagesの認証が必要 | 不採用 |
| 公開npmへcore/CLI、非公開packageへ会社テーマを分離 | 一般機能を簡単に導入でき、ブランド素材を保護できる | package分割と2系統のrelease管理が必要 | 将来の候補 |
| 公開npmには中立なCLI・`default`テンプレートだけを配布し、任意テンプレートをURL配布 | 導入を簡単に保ちつつ、テンプレートの公開範囲を管理できる | template URLの運用が必要 | 採用 |

## P0: インストール可能なCLI

### 実装済み

- コマンドを実行した場所を利用者の作業場所として扱い、成果物もそこへ生成する。
- CLIの実行コードへ内部packageをbundleし、Studioの静的ファイルと中立な`default` themeを同梱する。
- `slide --version`、コマンド別`--help`、未知のコマンドと余分な引数の検出を提供する。
- `slide new "資料名"`または`slide new -t default "資料名"`で、表示名を保ったまま内部IDを自動生成する。
- 必須manifestを持つZIPテンプレートをURLから登録・一覧・削除し、HTTPS、
  SHA-256照合、同名更新の明示指定を扱う。
- LivetoonテンプレートのZIPとSHA-256を決定的に生成する。会社テーマは検証可能な
  `theme.json`としてZIPへ含める。Livetoonと`tsuchikawa-shuron`の原本は
  リポジトリ直下の`templates/`に残すが、npm packageとGitHub Releaseには含めない。
- Chromiumを`slide setup`で準備し、Node.js、npm、Chromium、Poppler、任意のOffice環境を`slide doctor`で診断する。
- `.tgz`を空の一時フォルダへ導入し、monorepo外からコマンドとStudioを動かす。
- Linux、macOS、WindowsのCIで同じpackage smokeを実行する。
- packageには`package.json`、README、`dist/`以外が入らないことと、想定外の肥大化を検査する。
- 公開成果物から利用者固有の絶対パスを除去する。

### 現在満たしている完了条件

1. リポジトリ外の空ディレクトリでtarballを導入できる。
2. `slide new`から厳格lint、PPTX・全ページ画像の生成、Studio起動まで、monorepoの実行ファイルを参照せず成功する。
3. `slide release`の成果物は利用者の作業場所へ生成され、packageのインストール先を変更しない。
4. PDFを含む確認はローカルで`SLIDE_PACKAGE_PDF=1`を付けて実行できる。通常の3 OS smokeでは外部Poppler依存を避けている。

## P0: 品質・安全な一括切り替え（transaction）・安全性

### 実装済み

- 実ブラウザ描画から、文字切れ、意図しないタイトル折り返し、領域外配置を検出する。
- companyテーマを含む資料と各rendererの回帰testを実行する。
- 未信頼のデッキから独自テーマコードを既定で実行せず、明示許可を必要とする。
- URL scheme、資料外参照、symlink、入力・埋め込み素材の容量、ファイルsignature、SVGのscript・外部参照を制限する。
- Studioは`127.0.0.1`へ限定し、Host・Origin確認とCSPなどのsecurity headerを適用する。
- `release`は一時ディレクトリへ全成果物を作り、成功後に既存成果物と入れ替える。切り替え失敗時は以前の成果物へ戻す。
- Studioの正本更新は内容hashで外部変更を検知し、一時ファイルからの置換で書き込む。
- component API、CLI、Studio、トラブル対応の文書を用意する。

### 残課題

- WindowsのMicrosoft PowerPointで、動画・音声・字幕、選択・編集、保存後の互換性を確認する。macOS 26.4／PowerPoint 16.111.2では字幕付き成果物まで確認済み。
- 公開候補packageに対して第三者のセキュリティレビューを行う。

## P1: 日常利用と正本管理

### 実装済み

- Studioでページ追加、複製、削除、並べ替えを行う。
- 発表者原稿、出典、文字、表、グラフをStudioから編集する。
- Presenterで現在ページ、次ページ、原稿、出典、経過時間を表示する。
- `slide migrate`で旧複数ファイル形式を単一`deck.mdx`へ移行し、元ファイルは変更しない。
- `slide layout bake`で正本に存在する要素の位置・サイズ・回転などを反映する。
- `slide id rename`でページまたは要素の安定IDと関連参照、位置調整を一括変更する。
- `slide benchmark`でページ数、コンパイル時間、資料データ量を計測する。

### 残課題

- 将来schemaやthemeの版が増えたときの、版ごとのmigrationを追加する。
- 実案件の資料で継続計測し、必要な場合だけcacheや画像最適化を追加する。

## 性能確認

macOS arm64、Node.js 24で、同じ資料を各5回コンパイルした基準値は次の通り。

| ページ数 | median | p95 | Deck IR | 診断 |
|---:|---:|---:|---:|---:|
| 30 | 13.16ms | 44.76ms | 92,262B | 0 |
| 50 | 21.36ms | 59.46ms | 151,282B | 0 |

ページ数に対してほぼ線形で、現時点では明確なボトルネックは見つかっていない。
5回計測のp95は実質的に最大値であり、初回実行（cold run）の影響を含む。公開後の性能保証値ではなく、
今後の回帰を見つけるための初期基準値として扱う。

## P1: 公開npm / GitHubリリース

公開に必要なrepository側の実装は準備中であり、npmへの実publishとは区別する。

| 項目 | 現在 | 公開前に必要なこと |
|---|---|---|
| package名・scope | `editable-slides-cli`、公開npm | 初回publish時に名前を最終確認する |
| LICENSE | MIT Licenseを配置 | 年や著作権表示を変更する場合だけ更新する |
| ブランド権利 | 公開npmから会社テーマ・素材を除外 | GitHub sourceとS3テンプレートの公開範囲を最終確認する |
| GitHub repository | `MogamiTsuchikawa/editable-slides-cli`を公開repositoryとして作成 | branch保護とnpm環境の承認者を設定する |
| package metadata | `files`、`bin`、`engines`、`repository`、`bugs`、`publishConfig`を設定 | 初回tarballを最終確認する |
| version・変更履歴 | 0.1.0、CHANGELOG、`v<version>`tag規則 | 初回手動publish後は0.1.1以降へ更新してtagを作成する |
| npm認証 | npm 11.5.1、GitHub Actions OIDCを設定 | 初回publish後に`release.yml`、environment `npm`でTrusted Publisherを登録する |
| テンプレート配布 | S3に決定。決定的ZIPとSHA-256を生成 | bucket、独自domain、cache、version保持を設定する |
| 実公開 | 未実施 | 0.1.0の初回手動publish、Trusted Publisher登録、次versionのtag releaseの順で実施する |

公開前には、利用する時点のnpm公式要件に合うNode.js・npmへrelease環境を固定し、
tarball内容、機密情報、依存脆弱性、golden deckを再検査する。

## リリース受入条件の現在地

| 受入条件 | 状態 |
|---|---|
| Linux、macOS、Windowsで`slide --version`と`slide doctor`が動く | CIで確認済み |
| clean tarballを空のフォルダへ導入できる | 確認済み |
| 厳格lintのwarningが0件である | package smokeで確認済み |
| 全ページPNG、PPTX、PDFを生成できる | 通常QAで確認。package smokeのPDFは任意実行 |
| PPTXの対応要素が標準要素として編集可能である | 内部検査とmacOS PowerPoint実機で確認済み。Windows実機確認は外部作業 |
| PDFのページ、本文、フォント検査が成功する | Popplerを含む通常QAで確認 |
| packageに入力資料、元PPTX、テスト成果物、秘密情報が含まれない | tarball allowlistで確認済み |
| 公開releaseを承認、タグ、CHANGELOGから追跡できる | 未実施 |

## 外部で行う判断・作業

1. 公開GitHub repositoryでCI結果を確認し、branch保護と`npm` environmentを設定する。
2. GitHub sourceとS3テンプレートで、ブランド素材・名称を共有できる範囲を最終確認する。
3. npmへ0.1.0を初回publishし、`release.yml`をTrusted Publisherへ登録する。次回は
   versionを0.1.1以降へ上げてからtagを作成する。
4. S3へversion付きテンプレートZIPとSHA-256を配置し、URLを案内へ反映する。
5. Windows PowerPointで動画・音声・字幕を含む成果物を確認する。
