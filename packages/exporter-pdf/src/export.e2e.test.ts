import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { detectChromiumExecutable, exportPdf } from "./index.js";

const browserDescribe =
  process.env.SLIDE_BROWSER_E2E === "1" ? describe : describe.skip;

browserDescribe("exportPdf browser integration", () => {
  let server: Server;
  let url = "";
  let directory = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "slide-pdf-e2e-"));
    server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <html>
          <head>
            <style>
              @page { size: 13.333333in 7.5in; margin: 0; }
              * { box-sizing: border-box; }
              html, body { margin: 0; padding: 0; }
              .slide-page {
                width: 13.333333in;
                height: 7.5in;
                break-after: page;
                display: grid;
                place-items: center;
                font: 48pt Arial, sans-serif;
              }
              .slide-page:last-child { break-after: auto; }
            </style>
          </head>
          <body>
            <section class="slide-page">Page 1</section>
            <section class="slide-page">Page 2</section>
            <script>window.__SLIDES_READY__ = true;</script>
          </body>
        </html>`);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start test HTTP server");
    }
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
  });

  it("exports one PDF page per slide", async () => {
    const outputPath = join(directory, "deck.pdf");
    const inspection = await exportPdf({
      url,
      outputPath,
      expectedPageCount: 2,
      executablePath: detectChromiumExecutable(),
    });

    expect(inspection.pageCount).toBe(2);
    expect(inspection.widthPoints).toBeCloseTo(960, 0);
    expect(inspection.heightPoints).toBeCloseTo(540, 0);
  });
});
