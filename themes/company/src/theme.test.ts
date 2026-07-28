import { describe, expect, it } from "vitest";

import { companyTheme } from "./index.js";

describe("companyTheme", () => {
  it("provides the complete company layout catalog", () => {
    expect(companyTheme.ir.id).toBe("company");
    expect(Object.keys(companyTheme.layouts).sort()).toEqual(
      [...companyTheme.ir.layoutIds].sort(),
    );
    expect(companyTheme.ir.layoutIds).toHaveLength(8);
  });
});
