import { basename, resolve } from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import { handleApiRequest } from "./deck-api.js";

function shouldNotify(filePath: string): "deck" | "overrides" | undefined {
  if (basename(filePath) === "layout.overrides.json") return "overrides";
  if (
    filePath.endsWith(".mdx") ||
    filePath.endsWith(".yaml") ||
    filePath.endsWith(".yml") ||
    basename(filePath) === "deck.ir.json"
  ) {
    return "deck";
  }
  return undefined;
}

function configureWatcher(server: ViteDevServer, repositoryRoot: string): void {
  const configuredDeckDirectory = process.env.EDITABLE_SLIDES_DECK_DIR;
  const configuredIr = process.env.EDITABLE_SLIDES_DECK_IR;
  server.watcher.add([
    resolve(repositoryRoot, "decks"),
    resolve(repositoryRoot, "dist"),
    ...(configuredDeckDirectory ? [resolve(configuredDeckDirectory)] : []),
    ...(configuredIr ? [resolve(configuredIr)] : []),
  ]);
  server.watcher.on("all", (_event, filePath) => {
    const kind = shouldNotify(filePath);
    if (!kind) return;
    server.ws.send({
      type: "custom",
      event: "studio:deck-changed",
      data: { kind, filePath },
    });
  });
}

export function deckApiPlugin(repositoryRoot: string): Plugin {
  return {
    name: "editable-slides-cli-deck-api",
    configureServer(server) {
      configureWatcher(server, repositoryRoot);
      server.middlewares.use((request, response, next) => {
        void handleApiRequest(request, response, repositoryRoot)
          .then((handled) => {
            if (!handled) next();
          })
          .catch((error: unknown) => {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.setHeader("cache-control", "no-store");
            response.end(
              `${JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              })}\n`,
            );
          });
      });
    },
  };
}
