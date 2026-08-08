#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  benchmarkCommand,
  devCommand,
  doctorCommand,
  exportCommand,
  inspectCommand,
  layoutBakeCommand,
  lintCommand,
  migrateCommand,
  newCommand,
  releaseCommand,
  renameIdCommand,
  setupCommand,
  snapshotCommand,
  templateAddCommand,
  templateListCommand,
  templateRemoveCommand,
} from "./commands.js";
import { cliVersion } from "./version.js";

const HELP = `Editable Slides — 編集可能なPPTX・PDFを生成するCLI

使い方:
  slide new [-t <template>] <deck-dir> [--id <id>] [--title <title>] [--theme <path>]
  slide template add <url> [--name <id>] [--sha256 <hash>] [--force]
  slide template list
  slide template remove <id>
  slide migrate <deck-dir>
  slide layout bake <deck-dir>
  slide id rename <deck-dir> --kind <slide|element> --from <id> --to <id> [--slide <id>]
  slide benchmark <deck-dir> [--runs <number>]
  slide dev <deck-dir> [--open] [--port <number>]
  slide lint <deck-dir> [--strict-editable] [--fail-on-warnings]
  slide export <deck-dir> [--format pptx,pdf] [--port <number>]
  slide snapshot <deck-dir> [--port <number>]
  slide release <deck-dir> [--format pptx,pdf] [--port <number>]
  slide inspect <deck-dir> [--slide <id>] [--pptx <path>]
  slide doctor
  slide setup

共通:
  slide <command> --help   コマンドの詳しい使い方
  slide --version          CLIのバージョン
`;

const COMMAND_HELP: Record<string, string> = {
  new: `slide new [-t <template>] <deck-dir> [options]

新しい資料のひな形を作成します。
  -t, --template <id>  使用するテンプレート（既定: default）
  --id <id>            資料の固有ID（既定: フォルダ名から自動生成）
  --title <title>      表示タイトル（既定: フォルダ名）
  --theme <theme>      テンプレートのテーマを上書きする
`,
  template: `slide template <action>

URLのZIPテンプレートを登録・管理します。
  slide template add <url> [--name <id>] [--sha256 <hash>] [--force]
  slide template list
  slide template remove <id>

addのオプション:
  --name <id>       登録名を指定する
  --sha256 <hash>   ZIPのSHA-256を照合する
  --force           同名の登録済みテンプレートを置き換える
  --allow-http      HTTPS以外を明示的に許可する（ローカルHTTPは指定不要）
`,
  migrate: `slide migrate <deck-dir>

旧形式のdeck.yamlとページファイルを、Studioでページ操作できるdeck.mdxへまとめます。
元のファイルは削除・変更しません。
`,
  layout: `slide layout bake <deck-dir>

Studioで調整した位置・サイズを、元のdeck.mdxに反映します。
自動生成された見出しなど、元の要素がない調整値は補助ファイルへ残します。
`,
  id: `slide id rename <deck-dir> --kind <slide|element> --from <id> --to <id> [options]

安定IDを安全に変更し、接続線の参照と位置調整も一緒に更新します。
要素IDを変更するときは、対象ページを--slide <id>で指定します。
`,
  benchmark: `slide benchmark <deck-dir> [options]

資料のコンパイル時間とデータ量を複数回計測します。
  --runs <number>  計測回数（既定: 5、最大: 20）
`,
  dev: `slide dev <deck-dir> [options]

編集画面を起動し、変更を自動反映します。
  --open           ブラウザを自動で開く
  --port <number>  使用するポート（既定: 空いているポートを自動選択）
`,
  lint: `slide lint <deck-dir> [options]

資料の内容と編集性を検査します。
  --strict-editable   編集できない要素があれば失敗する
  --fail-on-warnings  警告が1件でもあれば失敗する
`,
  export: `slide export <deck-dir> [options]

PPTXとPDFを出力します。
  --format <formats>  pptx、pdf、またはpptx,pdf（既定: pptx,pdf）
  --port <number>     PDF生成に使うポート（既定: 自動選択）
`,
  snapshot: `slide snapshot <deck-dir> [options]

全ページのPNGと一覧画像を生成します。
  --port <number>  使用するポート（既定: 自動選択）
`,
  release: `slide release <deck-dir> [options]

厳格な検査、PNG、PPTX、PDFの生成をまとめて行います。
  --format <formats>  pptx、pdf、またはpptx,pdf（既定: pptx,pdf）
  --port <number>     使用するポート（既定: 自動選択）
`,
  inspect: `slide inspect <deck-dir> [options]

資料の内部情報、または生成済みPPTXを検査します。
  --slide <id>   指定したページだけを表示する
  --pptx <path>  指定したPPTXの編集性を検査する
`,
  doctor: `slide doctor

Node.js、Chromium、PDF検査ツール、フォントなどを診断します。
`,
  setup: `slide setup

初回利用に必要なChromiumを準備します。
`,
};

function requiredPosition(positionals: string[], index: number, name: string): string {
  const value = positionals[index];
  if (!value) {
    throw new Error(`Missing ${name}\n\n${HELP}`);
  }
  return value;
}

function deckDirectory(positionals: string[]): string {
  const directory = requiredPosition(positionals, 0, "deck directory");
  if (positionals.length > 1) {
    throw new Error(`Unexpected argument: ${positionals.slice(1).join(" ")}`);
  }
  return directory;
}

function numberOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "version" || command === "--version" || command === "-V") {
    if (rest.length > 0) {
      throw new Error(`Unexpected argument: ${rest.join(" ")}`);
    }
    console.log(cliVersion());
    return;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    const commandHelp = COMMAND_HELP[command];
    if (!commandHelp) {
      throw new Error(`Unknown command: ${command}\n\n${HELP}`);
    }
    console.log(commandHelp);
    return;
  }

  switch (command) {
    case "new": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          id: { type: "string" },
          template: { type: "string", short: "t" },
          title: { type: "string" },
          theme: { type: "string" },
        },
      });
      await newCommand(deckDirectory(parsed.positionals), {
        id: parsed.values.id,
        template: parsed.values.template,
        title: parsed.values.title,
        theme: parsed.values.theme,
      });
      break;
    }
    case "template": {
      const [action, ...templateArgs] = rest;
      if (action === "add") {
        const parsed = parseArgs({
          args: templateArgs,
          allowPositionals: true,
          options: {
            name: { type: "string" },
            sha256: { type: "string" },
            force: { type: "boolean", default: false },
            "allow-http": { type: "boolean", default: false },
          },
        });
        const source = requiredPosition(parsed.positionals, 0, "template URL");
        if (parsed.positionals.length > 1) {
          throw new Error(
            `Unexpected argument: ${parsed.positionals.slice(1).join(" ")}`,
          );
        }
        await templateAddCommand(source, {
          name: parsed.values.name,
          sha256: parsed.values.sha256,
          force: parsed.values.force,
          allowHttp: parsed.values["allow-http"],
        });
        break;
      }
      if (action === "list") {
        if (templateArgs.length > 0) {
          throw new Error(`Unexpected argument: ${templateArgs.join(" ")}`);
        }
        await templateListCommand();
        break;
      }
      if (action === "remove") {
        const parsed = parseArgs({
          args: templateArgs,
          allowPositionals: true,
          options: {},
        });
        const name = requiredPosition(parsed.positionals, 0, "template name");
        if (parsed.positionals.length > 1) {
          throw new Error(
            `Unexpected argument: ${parsed.positionals.slice(1).join(" ")}`,
          );
        }
        await templateRemoveCommand(name);
        break;
      }
      throw new Error(`Unknown template command: ${action ?? "<missing>"}`);
    }
    case "dev": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          open: { type: "boolean", default: false },
          port: { type: "string" },
        },
      });
      await devCommand(deckDirectory(parsed.positionals), {
        open: parsed.values.open,
        port: numberOption(parsed.values.port, "--port"),
      });
      break;
    }
    case "migrate": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {},
      });
      await migrateCommand(deckDirectory(parsed.positionals));
      break;
    }
    case "layout": {
      const [action, ...layoutArgs] = rest;
      if (action !== "bake") {
        throw new Error(`Unknown layout command: ${action ?? "<missing>"}`);
      }
      const parsed = parseArgs({
        args: layoutArgs,
        allowPositionals: true,
        options: {},
      });
      await layoutBakeCommand(deckDirectory(parsed.positionals));
      break;
    }
    case "id": {
      const [action, ...idArgs] = rest;
      if (action !== "rename") {
        throw new Error(`Unknown id command: ${action ?? "<missing>"}`);
      }
      const parsed = parseArgs({
        args: idArgs,
        allowPositionals: true,
        options: {
          kind: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          slide: { type: "string" },
        },
      });
      await renameIdCommand(deckDirectory(parsed.positionals), {
        kind: parsed.values.kind,
        from: parsed.values.from,
        to: parsed.values.to,
        slide: parsed.values.slide,
      });
      break;
    }
    case "benchmark": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { runs: { type: "string" } },
      });
      const runs =
        parsed.values.runs === undefined ? undefined : Number(parsed.values.runs);
      await benchmarkCommand(deckDirectory(parsed.positionals), { runs });
      break;
    }
    case "lint": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          "strict-editable": { type: "boolean", default: false },
          "fail-on-warnings": { type: "boolean", default: false },
        },
      });
      await lintCommand(deckDirectory(parsed.positionals), {
        strictEditable: parsed.values["strict-editable"],
        failOnWarnings: parsed.values["fail-on-warnings"],
      });
      break;
    }
    case "export": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          format: { type: "string", default: "pptx,pdf" },
          "strict-editable": { type: "boolean", default: true },
          port: { type: "string" },
        },
      });
      await exportCommand(deckDirectory(parsed.positionals), {
        format: parsed.values.format,
        strictEditable: parsed.values["strict-editable"],
        port: numberOption(parsed.values.port, "--port"),
      });
      break;
    }
    case "snapshot": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          port: { type: "string" },
        },
      });
      await snapshotCommand(deckDirectory(parsed.positionals), {
        port: numberOption(parsed.values.port, "--port"),
      });
      break;
    }
    case "release": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          format: { type: "string", default: "pptx,pdf" },
          port: { type: "string" },
        },
      });
      await releaseCommand(deckDirectory(parsed.positionals), {
        format: parsed.values.format,
        port: numberOption(parsed.values.port, "--port"),
      });
      break;
    }
    case "inspect": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          slide: { type: "string" },
          pptx: { type: "string" },
        },
      });
      await inspectCommand(deckDirectory(parsed.positionals), {
        slide: parsed.values.slide,
        pptx: parsed.values.pptx,
      });
      break;
    }
    case "doctor":
      if (rest.length > 0) {
        throw new Error(`Unexpected argument: ${rest.join(" ")}`);
      }
      await doctorCommand();
      break;
    case "setup":
      if (rest.length > 0) {
        throw new Error(`Unexpected argument: ${rest.join(" ")}`);
      }
      await setupCommand();
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
    );
  } catch {
    return (
      path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
    );
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
