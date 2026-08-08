# 変更履歴

公開npm packageに同梱するテンプレートは中立な`default`だけである。

## [Unreleased]

- PowerPoint由来の青緑デザインを`tsuchikawa-shuron`テーマ・テンプレート原本として追加。
- 公開package名を`editable-slides-cli`に確定し、npm Trusted Publishing向けの
  tag release workflow、3 OS package検査、成果物の来歴証明を追加。
- 中立な`default`テンプレートから資料名だけで作成する操作と、HTTPS URLの
  ZIPテンプレートを登録・一覧・削除する操作を追加。
- LivetoonテンプレートのZIPとSHA-256を再現可能に生成し、会社テーマを検証可能な
  `theme.json`としてZIPへ含める処理を追加。Livetoonと
  `tsuchikawa-shuron`の原本はリポジトリ直下の`templates/`に置き、公開npmや
  GitHub Releaseへは含めない。

## [0.1.0] - 2026-08-01

- 空のフォルダへ導入できる単一CLI packageと、同梱Studioを追加。
- ローカル動画・音声、画像調整、図解、コード表示、拡張グラフを追加。
- 動画・音声へローカルWebVTT字幕を付け、同じ字幕の再利用を含めてWebとPowerPointへ保持できるようにした。
- Studioへページ操作、発表者原稿・出典、表の寸法・結合・数値表示、グラフの軸・凡例・系列編集、Presenterを追加。
- 表の見出し・寸法・結合を検査し、空データや不正な結合を保存前に防止。表全体の拡縮と列幅・行高を連動。
- 円・ドーナツの系列・値域、カテゴリ系列の項目名、複合グラフの系列種別を検査。真のXY軸を持つ散布図の系列別X値と、Webの円グラフ凡例を出力間で統一。
- アクセシビリティ、素材参照、ブラウザ表示、PPTX編集性の品質検査を強化。
- PowerPointのスライドタイトル、装飾指定、表見出し、グラフ代替説明、読み上げ順を改善。
- macOSの`/tmp`経由でも動画posterなどの資料内素材を正しく解決するよう修正。
- Linux、macOS、Windows向けpackage smoke workflowを追加。
