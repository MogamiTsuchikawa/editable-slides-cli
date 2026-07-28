import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import {
  detectChromiumExecutable,
  inspectPdf,
  PDF_HEIGHT_INCHES,
  PDF_WIDTH_INCHES,
  parsePdfFonts,
  probePdfTool,
  validatePdf,
} from "./index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFakePopplerTools(directory: string): Promise<{
  pdftotextPath: string;
  pdffontsPath: string;
}> {
  const pdftotextPath = join(directory, "pdftotext");
  const pdffontsPath = join(directory, "pdffonts");
  await Promise.all([
    writeFile(
      pdftotextPath,
      `#!/bin/sh
if [ "$1" = "-v" ]; then
  echo "pdftotext version 24.01.0" >&2
  echo "Copyright 2005-2024 The Poppler Developers" >&2
  exit 0
fi
printf "Livetoon PDF inspection\\n"
`,
    ),
    writeFile(
      pdffontsPath,
      `#!/bin/sh
if [ "$1" = "-v" ]; then
  echo "pdffonts version 24.01.0" >&2
  echo "Copyright 2005-2024 The Poppler Developers" >&2
  exit 0
fi
printf "name                                 type              encoding         emb sub uni object ID\\n"
printf "%s\\n" "------------------------------------ ----------------- ---------------- --- --- --- ---------"
printf "%s\\n" "AAAAAA+Helvetica                     Type 1            WinAnsi          yes yes yes      4  0"
printf "%s\\n" "BAAAAA+NotoSansJP-Thin_Bold          Type 3            Custom           yes yes yes      5  0"
printf "%s\\n" "CAAAAA+NotoSansMono-Regular          Type 3            Custom           yes yes yes      6  0"
`,
    ),
  ]);
  await Promise.all([chmod(pdftotextPath, 0o755), chmod(pdffontsPath, 0o755)]);
  return { pdftotextPath, pdffontsPath };
}

describe("inspectPdf", () => {
  it("returns page count and dimensions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "slide-pdf-"));
    directories.push(directory);
    const path = join(directory, "sample.pdf");
    const document = await PDFDocument.create();
    const width = PDF_WIDTH_INCHES * 72;
    const height = PDF_HEIGHT_INCHES * 72;
    const font = await document.embedFont(StandardFonts.Helvetica);
    const firstPage = document.addPage([width, height]);
    firstPage.drawText("Livetoon PDF inspection", { font, x: 24, y: 24 });
    document.addPage([width, height]);
    const bytes = await document.save();
    await writeFile(path, bytes);
    const toolPaths = await createFakePopplerTools(directory);

    const inspection = await inspectPdf(path, toolPaths);
    expect(inspection.pageCount).toBe(2);
    expect(inspection.widthPoints).toBeCloseTo(width, 4);
    expect(inspection.heightPoints).toBeCloseTo(height, 4);
    expect(inspection.text).toContain("Livetoon PDF inspection");
    expect(inspection.fonts.some((name) => name.includes("Helvetica"))).toBe(true);

    await expect(
      validatePdf(
        path,
        {
          expectedPageCount: 2,
          expectedWidthPoints: width,
          expectedHeightPoints: height,
          expectedText: ["Livetoon PDF inspection"],
          expectedFonts: ["Helvetica", "Noto Sans JP", "Noto Sans Mono"],
          requireEmbeddedFonts: true,
          requireUnicodeFonts: true,
        },
        toolPaths,
      ),
    ).resolves.toMatchObject({ pageCount: 2 });
  });

  it("reports missing expected content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "slide-pdf-invalid-"));
    directories.push(directory);
    const path = join(directory, "sample.pdf");
    const document = await PDFDocument.create();
    document.addPage([PDF_WIDTH_INCHES * 72, PDF_HEIGHT_INCHES * 72]);
    const bytes = await document.save();
    await writeFile(path, bytes);
    const toolPaths = await createFakePopplerTools(directory);

    await expect(
      validatePdf(path, { expectedText: ["not present"] }, toolPaths),
    ).rejects.toThrow("text not found: not present");
  });
});

describe("Poppler validation", () => {
  it("parses subset font names and embedding metadata", () => {
    const records =
      parsePdfFonts(`name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
AAAAAA+NotoSansJP-Thin_Bold          Type 3            Custom           yes yes yes      4  0
BAAAAA+NotoSansMono-Regular          Type 3            Custom           yes yes yes      5  0
`);
    expect(records).toEqual([
      {
        name: "NotoSansJP-Thin_Bold",
        type: "Type 3",
        encoding: "Custom",
        embedded: true,
        subset: true,
        unicode: true,
        objectId: "4 0",
      },
      {
        name: "NotoSansMono-Regular",
        type: "Type 3",
        encoding: "Custom",
        embedded: true,
        subset: true,
        unicode: true,
        objectId: "5 0",
      },
    ]);
  });

  it("identifies Xpdf instead of accepting it as Poppler", async () => {
    const directory = await mkdtemp(join(tmpdir(), "slide-xpdf-"));
    directories.push(directory);
    const executable = join(directory, "pdftotext");
    await writeFile(
      executable,
      `#!/bin/sh
echo "pdftotext version 4.06 [www.xpdfreader.com]" >&2
exit 99
`,
    );
    await chmod(executable, 0o755);

    await expect(probePdfTool("pdftotext", executable)).resolves.toMatchObject({
      implementation: "xpdf",
      version: "pdftotext version 4.06 [www.xpdfreader.com]",
    });
  });
});

describe("detectChromiumExecutable", () => {
  it("uses the explicit environment override", () => {
    const previous = process.env.SLIDE_CHROMIUM_PATH;
    process.env.SLIDE_CHROMIUM_PATH = "/custom/chromium";
    expect(detectChromiumExecutable()).toBe("/custom/chromium");

    if (previous === undefined) {
      delete process.env.SLIDE_CHROMIUM_PATH;
    } else {
      process.env.SLIDE_CHROMIUM_PATH = previous;
    }
  });
});
