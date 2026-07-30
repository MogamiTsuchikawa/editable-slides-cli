#!/usr/bin/env node

import { parseArgs } from "node:util";

import {
  devCommand,
  doctorCommand,
  exportCommand,
  inspectCommand,
  lintCommand,
  newCommand,
  releaseCommand,
  snapshotCommand,
} from "./commands.js";

const HELP = `Livetoon Slide

Usage:
  slide new <deck-dir> [--id <id>] [--title <title>] [--theme <path>]
  slide dev <deck-dir> [--open] [--port <number>]
  slide lint <deck-dir> [--strict-editable] [--fail-on-warnings]
  slide export <deck-dir> [--format pptx,pdf] [--port <number>]
  slide snapshot <deck-dir> [--port <number>]
  slide release <deck-dir> [--format pptx,pdf] [--port <number>]
  slide inspect <deck-dir> [--slide <id>] [--pptx <path>]
  slide doctor
`;

function requiredPosition(positionals: string[], index: number, name: string): string {
  const value = positionals[index];
  if (!value) {
    throw new Error(`Missing ${name}\n\n${HELP}`);
  }
  return value;
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

  switch (command) {
    case "new": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          id: { type: "string" },
          title: { type: "string" },
          theme: { type: "string" },
        },
      });
      await newCommand(requiredPosition(parsed.positionals, 0, "deck directory"), {
        id: parsed.values.id,
        title: parsed.values.title,
        theme: parsed.values.theme,
      });
      break;
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
      await devCommand(requiredPosition(parsed.positionals, 0, "deck directory"), {
        open: parsed.values.open,
        port: numberOption(parsed.values.port, "--port"),
      });
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
      await lintCommand(requiredPosition(parsed.positionals, 0, "deck directory"), {
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
      await exportCommand(requiredPosition(parsed.positionals, 0, "deck directory"), {
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
      await snapshotCommand(requiredPosition(parsed.positionals, 0, "deck directory"), {
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
      await releaseCommand(requiredPosition(parsed.positionals, 0, "deck directory"), {
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
      await inspectCommand(requiredPosition(parsed.positionals, 0, "deck directory"), {
        slide: parsed.values.slide,
        pptx: parsed.values.pptx,
      });
      break;
    }
    case "doctor":
      await doctorCommand();
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
