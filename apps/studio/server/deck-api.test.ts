import path from "node:path";

import { describe, expect, it } from "vitest";

import { rewriteAssetSources } from "./deck-api.js";

describe("rewriteAssetSources", () => {
  it("maps deck-local image paths to the guarded asset endpoint", () => {
    const deckDirectory = path.resolve("/tmp/example-deck");
    const result = rewriteAssetSources(
      {
        slides: [
          {
            elements: [
              {
                id: "diagram",
                type: "image",
                src: path.join(deckDirectory, "assets", "diagram.svg"),
              },
            ],
          },
        ],
      },
      "example",
      deckDirectory,
    ) as {
      slides: Array<{
        elements: Array<{ src: string }>;
      }>;
    };

    expect(result.slides[0]?.elements[0]?.src).toBe(
      "/api/assets/example?path=assets%2Fdiagram.svg",
    );
  });

  it("does not expose paths outside the deck", () => {
    const result = rewriteAssetSources(
      {
        id: "secret",
        type: "image",
        src: "/tmp/other/secret.png",
      },
      "example",
      "/tmp/example-deck",
    ) as { src: string };

    expect(result.src).toBe("/tmp/other/secret.png");
  });
});
