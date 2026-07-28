import type { Diagnostic } from "@livetoon/slide-deck-ir";
import { describe, expect, it } from "vitest";

import { formatDiagnostic } from "./runtime.js";

describe("formatDiagnostic", () => {
  it("includes source and element context", () => {
    const diagnostic: Diagnostic = {
      severity: "warning",
      code: "ORPHAN_OVERRIDE",
      message: "Unknown element",
      sourceLocation: {
        file: "/deck/layout.overrides.json",
        line: 3,
        column: 5,
      },
      slideId: "summary",
      elementId: "missing",
    };

    expect(formatDiagnostic(diagnostic)).toBe(
      "WARNING ORPHAN_OVERRIDE /deck/layout.overrides.json:3:5 [missing] Unknown element",
    );
  });
});
