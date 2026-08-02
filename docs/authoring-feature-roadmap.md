# スライド作成機能ロードマップ

## 結論

P0とP1で計画した主要機能は、リポジトリ内の実装と自動テストまで完了している。
現在は、ローカル動画・音声、画像調整、6種類の図解、コード表示、表・グラフ、
ページ操作、発表者原稿・出典編集、Presenterを同じ資料から扱える。

動画・音声はWebで再生し、PPTXへ埋め込み、PDFとPNGでは決定的な静止表示へ
置き換える。画像、図解、コード、表、グラフは、可能な限りPowerPoint上で
選択・編集できる標準要素として出力する。

ただし、自動テストの完了とMicrosoft PowerPoint実機での確認は別である。
macOS 26.4／PowerPoint 16.111.2では、WebVTT字幕付きのMP4動画（3秒）と
M4A音声（2.97秒）の再生、字幕トラック認識、選択・編集、保存後の互換性、
アクセシビリティ検査0件まで確認済みである。Windows PowerPointでの確認は
外部確認として残っている。

## 状態の意味

| 状態 | 意味 |
|---|---|
| 実装済み | リポジトリへ実装し、自動テストで主な入出力を確認済み |
| 一部実装 | 日常利用の中心部分は使えるが、詳細な編集機能などが残る |
| 外部確認 | 自動検査はあるが、PowerPoint実機や利用者による判断が必要 |
| 未実装 | 今後の候補であり、現在の利用契約には含めない |

## 現在の対応範囲

| 分類 | 状態 | 現在できること | 残っていること |
|---|---|---|---|
| テキスト・コード | 実装済み | 見出し、本文、箇条書き、リンク、太字・斜体、コード書体。コードは行番号、強調行、主要7言語の構文色に対応 | Studioでの文字装飾の細かな編集 |
| 画像・GIF・背景 | 実装済み | PNG、JPEG、GIF、WebP、SVG、crop、焦点位置、角丸・円形、枠、影、画像背景、GIFの指定poster | GIF posterの自動生成、gradient背景 |
| 図形・図解 | 実装済み | 基本図形、線、コネクタ、グループ、Flow、Timeline、Matrix、Cycle、Funnel、OrgChart | 図形種類の追加、手動接続点の高度な自動追従 |
| 表 | 実装済み | 配列・JSON・CSVから編集可能な表を生成。見出し行、絶対指定の列幅・行高、セル結合、背景色、位置、数値書式をStudioでも保持・編集 | ドラッグによる結合、Excelの数式セル、任意の数値書式 |
| グラフ | 実装済み | bar、line、pie、doughnut、area、scatter、radar、stacked、combo。Studioで系列・項目・値・色・系列種別、軸名・単位、凡例、値・項目名ラベルを編集 | 軸の最小・最大値、第二軸、ラベルの個別配置 |
| 原稿・出典 | 実装済み | 正本へ保持し、Studioで編集し、PPTXの発表者ノートとPresenterへ反映 | 配布用notes PDF |
| 動画・音声 | 実装済み／外部確認 | MP4、M4A、MP3、WebVTT字幕。Web再生、PPTX埋め込み、動画poster・音声カードへの印刷fallback。字幕付きでmacOS実機確認済み | Windows実機確認、オンライン動画、自動再生 |
| Studio | 実装済み | ページ追加・複製・削除・並べ替え、要素の移動・拡縮・回転、文字・原稿・出典・表・グラフ編集、Presenter | layout gallery、動画・音声の選択と差し替え画面 |
| 品質・安全性 | 実装済み | 代替説明、装飾指定、文字色の見やすさ、読み順、安全領域、素材の実体パス・容量・形式・SVGを検査 | スクリーンリーダーを使う人による確認、Windows PowerPoint実機確認 |
| 動き | 未実装 | GIFと動画の再生 | オブジェクトanimation、transition、時間指定 |

## 機能を選ぶ基準

1. 実際の資料で使う頻度と効果が高い。
2. Web、PDF、PPTXで意味が失われない。
3. PPTXでは可能な限り標準要素として選択・編集できる。
4. PDFのように動きを表現できない形式には、決定的な静止fallbackがある。
5. ローカル・オフラインを既定とし、外部通信は明示的に許可された場合だけ行う。
6. 入力ファイルを未信頼データとして扱い、容量、形式、参照先を検査する。

## 優先順位と実装状況

| 優先度 | 機能 | 状態 | 現在の内容／残課題 |
|---|---|---|---|
| P0 | アクセシビリティ検査 | 実装済み | 代替説明、装飾指定、文字色の見やすさ、読み順、安全領域を検査する。利用者による読み上げ確認は別途行う |
| P0 | asset安全化 | 実装済み | 実体パス、資料外参照、symlink、容量、拡張子とsignature、SVGのscript・外部参照を検査する |
| P0 | 出力先ごとの機能契約 | 実装済み／外部確認 | Web、印刷、PPTXの自動テストとPPTX内部検査を実装済み。macOS PowerPoint実機確認済み、Windowsは外部確認 |
| P1 | ローカル動画 | 実装済み／外部確認 | MP4をWebで再生し、PPTXへ埋め込み、PDF・PNGはposter表示。macOSは確認済み、Windowsは未確認 |
| P1 | 画像・GIF操作 | 実装済み | crop、焦点位置、マスク、枠、影、画像背景、GIFの指定静止fallbackに対応 |
| P1 | 図解部品 | 実装済み | 6種類を標準の図形・文字・接続線・グループへ決定的に展開 |
| P1 | 表・グラフ編集 | 実装済み | 表の寸法・結合・背景・位置・数値表示と、グラフの系列・軸名・単位・凡例・データラベルをStudioから編集できる |
| P1 | ページ・原稿・出典編集 | 実装済み | ページ操作、原稿・出典編集、Presenterに対応 |
| P1 | 音声 | 実装済み／外部確認 | M4A・MP3をWebとPPTXで再生し、PDFでは音声カードへ置換。macOSは確認済み、Windowsは未確認 |
| P1 | WebVTT字幕 | 実装済み／外部確認 | 動画・音声へ任意のローカル字幕を付け、WebとPPTXへ反映。macOS実機確認済み、Windowsは未確認 |
| P1 | コード表示 | 実装済み | JavaScript、TypeScript、JSON、Python、Bash、HTML、CSSの構文色、行番号、強調行に対応 |
| P2 | オンライン動画 | 未実装 | 許可provider、通信、認証、通常リンクfallbackの方針を決めてから着手 |
| P2 | 数式・Mermaid | 未実装 | 決定的なSVGへの変換候補。PPTX内部編集は保証しない |
| P2 | 高度なグラフ・背景 | 一部前倒し | 高度なグラフと画像背景は実装済み。gradient背景が残る |
| P2 | アニメーション・画面切り替え | 未実装 | WebとPowerPointの時間モデルを検証できる段階で着手 |
| P3 | 任意Web埋め込み・3D・SmartArt | 対象外 | セキュリティ、オフライン、PDF・PPTX互換性が低いため原則扱わない |

## 出力先ごとの扱い

| 機能 | Web / Studio | PPTX | PDF / PNG | 状態 |
|---|---|---|---|---|
| ローカル動画 | 通常・発表表示でcontrols付き再生。編集・一覧ではposter | ネイティブ動画として埋め込む | poster＋再生マーク＋動画表記 | 実装済み、macOS確認済み・Windows未確認 |
| 音声 | controls付きplayer | ネイティブ音声として埋め込む | 音声カード＋説明・文字起こし | 実装済み、macOS確認済み・Windows未確認 |
| WebVTT字幕 | 動画・音声の字幕track | mediaに紐づく字幕として保持 | 静止fallbackのため非表示 | 実装済み、macOS確認済み・Windows未確認 |
| アニメーションGIF | 通常表示で再生 | GIF画像として保持 | 指定posterを静止表示 | 実装済み |
| 画像調整 | crop、焦点位置、マスク、枠、影 | 画像として配置し、必要な見た目を保持 | 同じ静止表示 | 実装済み |
| SVG / Icon | ベクター表示 | 画像として配置。内部図形の編集は保証しない | ベクターまたは高解像度表示 | 実装済み |
| Flow / Timeline等 | 標準図形・文字・線 | 編集可能な図形・文字・線 | 同じ静止表示 | 実装済み |
| コード | 構文色、行番号、強調行 | 編集可能な文字・図形 | 同じ静止表示 | 実装済み |
| 表・グラフ | 標準描画・Studioデータ編集 | ネイティブ表・グラフ | 同じ静止表示 | 実装済み |
| YouTube等 | 許可時だけ埋め込み再生 | 対応providerはonline media、それ以外はposter＋リンク | poster＋通常URL | 未実装 |
| 数式 / Mermaid | SVG表示 | SVG画像。配置は編集可、内部は編集不可 | SVG表示 | 未実装 |
| アニメーション | 将来の発表modeで再生 | OOXML対応後に限定機能 | 最終状態を静止表示 | 未実装 |
| 任意iframe | 原則禁止 | ライブ埋め込みは保証しない | poster＋リンクのみ | 対象外 |

## 動画・音声機能の設計

### 方式の比較と現在の判断

| 方式 | メリット | デメリット | 判断 |
|---|---|---|---|
| ローカルMP4をPPTXへ埋め込む | オフラインで再生でき、ファイルを1つで渡せる | PPTXの容量が増える | 採用済み |
| ローカル動画へリンクする | PPTXを小さくできる | 移動・共有でリンクが壊れやすい | 提供しない |
| YouTube等をonline mediaにする | PPTXを小さく保てる | 通信、認証、provider、PowerPoint版に依存する | P2のopt-in候補 |
| poster画像から通常URLを開く | 最も互換性が高い | スライド内では再生できない | online mediaを実装する場合の必須fallback |

PowerPointはローカル動画について埋め込みを既定とするため、Livetoon Slideも
埋め込みを採用している。

参考:

- [PptxGenJS Media API](https://gitbrent.github.io/PptxGenJS/docs/api-media.html)
- [PowerPointへローカル動画を挿入する](https://support.microsoft.com/en-us/powerpoint/insert-and-play-a-video-file-from-your-computer)
- [PowerPointが推奨する動画・音声形式](https://support.microsoft.com/en-US/PowerPoint/video-and-audio-file-formats-supported-in-powerpoint)
- [PowerPointのオンライン動画](https://support.microsoft.com/en-us/powerpoint/training/insert-a-video-from-youtube-or-another-site)

### 現在の入力

```mdx
<Video
  id="product-demo"
  src="./assets/product-demo.mp4"
  poster="./assets/product-demo-poster.png"
  captions="./assets/product-demo.ja.vtt"
  captionLanguage="ja"
  captionLabel="日本語字幕"
  alt="管理画面でレポートを作成する操作デモ"
  fit="contain"
  x={220}
  y={160}
  w={1480}
  h={700}
/>

<Audio
  id="narration"
  src="./assets/narration.m4a"
  captions="./assets/narration.ja.vtt"
  captionLanguage="ja"
  captionLabel="日本語字幕"
  transcript="製品紹介のナレーション"
  x={240}
  y={880}
  w={720}
  h={100}
/>
```

現在は次の契約に限定している。

- 動画は資料内のローカルMP4、音声はローカルM4AまたはMP3。
- MP4はH.264、M4AはAACを推奨し、container、track、推奨codecを検査する。
- 動画には資料内のPNG posterが必須。GIFの印刷fallbackにもPNG posterを指定する。
- 再生開始はクリック。自動再生、loop、trim、任意の開始時刻は未対応。
- 動画・音声には代替説明または文字起こしを付ける。
- 字幕は任意のローカルWebVTTとし、UTF-8、`WEBVTT` header、有効な時刻行、1MiB上限を検査する。
- 同じWebVTTを複数の動画・音声で使う場合、PPTX内では字幕部品を共有し、PowerPoint保存後もメディアを保持する。
- 50MiB超は警告、100MiB超はエラーとし、build manifestへhash、形式、容量を記録する。
- リモートURL、資料外パス、symlink経由の外部参照は拒否する。

GitHubは通常のGitリポジトリで大容量ファイルに制限があるため、大きな素材は
圧縮または別の管理方法を検討する。

参考: [GitHubの大容量ファイル制限](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

### 実装済みの品質確認と外部確認

| 確認項目 | 状態 | 内容 |
|---|---|---|
| 素材参照 | 実装済み | `realpath`、資料内パス、symlink、容量、拡張子、signatureを検査 |
| 動画・音声構造 | 実装済み | MP4・M4Aのboxとtrack、推奨codec、MP3 signatureを検査 |
| 字幕 | 実装済み | WebVTTの参照先、容量、UTF-8、header、時刻行を検査し、WebとPPTXへ反映 |
| 代替表示 | 実装済み | 動画poster、音声カード、GIF posterを印刷modeで検査 |
| Web配信 | 実装済み | 素材配信の`Range`と`206 Partial Content`、controls付き表示を自動テスト |
| PPTX内部 | 実装済み | media本体、cover、字幕、relationship、形式、hashを検査 |
| 回帰 | 実装済み | 動画・音声を含まない資料を含め、rendererとpackageのテストを実行 |
| macOS PowerPoint | 確認済み | macOS 26.4／PowerPoint 16.111.2で字幕付き動画・音声の再生、字幕認識、選択・編集、保存後の互換性、アクセシビリティ検査0件を確認済み |
| Windows PowerPoint | 外部確認 | 再生、字幕、選択、移動、拡縮、保存後の再生を実機で確認する |

## 実装済み機能の補足

### 図解プリセット

`Flow`、`Timeline`、`Matrix`、`Cycle`、`Funnel`、`OrgChart`は、
既存のShape、Text、Connector、Groupへ展開する。入力順と安定IDから同じ座標と
子要素IDを生成し、WebとPPTXで編集可能性を保つ。

### 画像

- crop値と焦点位置
- 角丸・円形マスク
- 画像背景
- 透明度、枠、影
- GIFの指定posterと静止fallback
- SVGのsanitizeと外部参照禁止

### 表・グラフ

- Studioで表の値と型、列幅、行高、セル結合、背景色、横・縦位置、数値書式を編集
- Studioでグラフの系列・項目・値・色・系列種別、軸名・単位、凡例、値・項目名ラベルを編集
- bar、line、pie、doughnut、area、scatter、radar、stacked、combo
- PPTXではネイティブ表・グラフとして出力
- 代替説明とデータ検査

表の数値書式は、同じ入力から毎回同じ表示文字を作るための既定4種類であり、
PowerPoint内のExcel数式セルには変換しない。セル結合は横・縦の個数で指定する。
列幅と行高は絶対論理単位で指定し、それぞれの合計を表全体の幅・高さへ一致させる。
見出しの有無を保持し、空の表、空の行、重なる結合、表外へ延びる結合を保存前に拒否する。
Studioでは結合セルがある間、行・列の追加と削除を無効にして表の構造を保護する。
表全体を拡大・縮小した場合は列幅・行高も比例調整し、正本への焼き込みでも寸法を一緒に更新する。

グラフは1系列以上、各系列は1点以上を必須とする。円グラフとドーナツグラフは1系列に
限定し、非負かつ少なくとも1件が正の値であることを検査する。Webの凡例は項目名と扇形の色を
対応させる。カテゴリ型の複数系列は同じ項目名と順番を必須とし、複合グラフは棒・折れ線・面を
組み合わせる。散布図は有限の数値Xを必須とし、複数系列で異なるX値を保持してPPTXにも
系列ごとのX値を書き出す。軸設定は軸名と単位までをP1の範囲とし、最小・最大値や第二軸は
含めない。

参考: [PptxGenJS Charts](https://gitbrent.github.io/PptxGenJS/docs/api-charts.html)

### Studio

- ページ追加、複製、削除、並べ替え
- 要素の選択、移動、拡大・縮小、回転、undo・redo
- 文字、発表者原稿、出典、表、グラフの編集
- 外部更新を検知し、意図しない上書きを防ぐ競合確認
- Presenter、経過時間、次ページ、原稿・出典表示

## 残課題

次は、実案件の要望を確認してから順序を決める。

- Studioのlayout galleryと動画・音声の選択・差し替え
- 配布用notes PDF
- オンライン動画、poster自動生成
- gradient背景、数式、Mermaid
- 表のドラッグ結合・任意数値書式と、グラフの第二軸・目盛り範囲・ラベル個別配置
- 限定的なアニメーションと画面切り替え

任意iframe、任意JavaScript、3D、SmartArt、PowerPoint側の変更をMDXへ逆同期する
機能は、安全性と互換性の負担が大きいため、引き続き対象外とする。

## 外部で行う判断・作業

- WindowsのMicrosoft PowerPoint実機で、動画・音声、字幕、編集性を確認する。
- スクリーンリーダーを使う人を含む利用者確認で、読み順と代替説明の分かりやすさを確認する。
- オンライン動画を追加する場合は、許可provider、通信、認証、公開範囲を決める。
