import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  LibreOfficeSmokeOptions,
  LibreOfficeSmokeResult,
  PptxInput,
} from "./types.js";

interface CommandResult {
  found: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function smokeTestPptxWithLibreOffice(
  input: PptxInput,
  options: LibreOfficeSmokeOptions = {},
): Promise<LibreOfficeSmokeResult> {
  const binary = await findLibreOfficeBinary(options.binary);
  if (!binary) {
    const error = "LibreOffice/soffice was not found on PATH.";
    if (options.required) {
      throw new Error(error);
    }
    return {
      available: false,
      success: false,
      output: "",
      error,
    };
  }

  const directory = await mkdtemp(path.join(tmpdir(), "livetoon-slide-lo-"));
  const inputPath = path.join(directory, "deck.pptx");
  const outputPath = path.join(directory, "deck.pdf");
  try {
    await writeFile(inputPath, await loadInput(input));
    const command = await runCommand(
      binary,
      ["--headless", "--convert-to", "pdf", "--outdir", directory, inputPath],
      options.timeoutMs ?? 30_000,
    );
    const output = [command.stdout, command.stderr].filter(Boolean).join("\n").trim();
    if (command.timedOut) {
      return {
        available: true,
        success: false,
        binary,
        output,
        error: `LibreOffice conversion timed out after ${options.timeoutMs ?? 30_000}ms.`,
      };
    }
    if (command.exitCode !== 0) {
      return {
        available: true,
        success: false,
        binary,
        output,
        error: `LibreOffice exited with code ${command.exitCode ?? "unknown"}.`,
      };
    }
    try {
      const pdf = await stat(outputPath);
      if (!pdf.isFile() || pdf.size === 0) {
        return {
          available: true,
          success: false,
          binary,
          output,
          error: "LibreOffice did not produce a non-empty PDF.",
        };
      }
      return {
        available: true,
        success: true,
        binary,
        output,
        generatedPdfBytes: pdf.size,
      };
    } catch {
      return {
        available: true,
        success: false,
        binary,
        output,
        error: "LibreOffice did not produce deck.pdf.",
      };
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function findLibreOfficeBinary(
  preferred?: string,
): Promise<string | undefined> {
  const candidates = [
    preferred,
    process.env.LIBREOFFICE_BIN,
    "soffice",
    "libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of [...new Set(candidates)]) {
    if (path.isAbsolute(candidate)) {
      try {
        await access(candidate);
      } catch {
        continue;
      }
    }
    const probe = await runCommand(candidate, ["--version"], 5_000);
    if (probe.found && !probe.timedOut && probe.exitCode === 0) {
      return candidate;
    }
  }
  return undefined;
}

async function loadInput(input: PptxInput): Promise<Uint8Array> {
  if (typeof input === "string") {
    return readFile(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  return new Uint8Array(input);
}

function runCommand(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let found = true;
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({
        found,
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      found = error.code !== "ENOENT";
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        found,
        stdout,
        stderr: `${stderr}${error.message}`,
        timedOut: false,
      });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        found,
        exitCode: exitCode ?? undefined,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}
