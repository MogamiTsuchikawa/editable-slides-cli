import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { deckApiPlugin } from "./server/vite-plugin.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react(), deckApiPlugin(repositoryRoot)],
  resolve: {
    alias: [
      {
        find: "@editable-slides/slide-renderer-react/styles.css",
        replacement: fileURLToPath(
          new URL("../../packages/renderer-react/styles.css", import.meta.url),
        ),
      },
      {
        find: "@editable-slides/slide-renderer-react",
        replacement: fileURLToPath(
          new URL("../../packages/renderer-react/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@editable-slides/slide-deck-ir",
        replacement: fileURLToPath(
          new URL("../../packages/deck-ir/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    sourcemap: true,
  },
});
