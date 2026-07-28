import { describe, expect, it } from "vitest";

import { defaultTheme, getDefaultLayout } from "./index.js";

describe("defaultTheme", () => {
  it("defines every advertised layout", () => {
    expect(Object.keys(defaultTheme.layouts).sort()).toEqual(
      [...defaultTheme.ir.layoutIds].sort(),
    );
  });

  it("keeps every slot inside the 1920x1080 canvas", () => {
    for (const layout of Object.values(defaultTheme.layouts)) {
      for (const slot of Object.values(layout.slots)) {
        expect(slot.frame.x).toBeGreaterThanOrEqual(0);
        expect(slot.frame.y).toBeGreaterThanOrEqual(0);
        expect(slot.frame.x + slot.frame.w).toBeLessThanOrEqual(1920);
        expect(slot.frame.y + slot.frame.h).toBeLessThanOrEqual(1080);
      }
    }
  });

  it("returns undefined for an unknown layout", () => {
    expect(getDefaultLayout("not-a-layout")).toBeUndefined();
  });
});
