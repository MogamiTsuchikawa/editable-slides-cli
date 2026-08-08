import { defaultTheme } from "@editable-slides/slide-theme-default";
import { describe, expect, it } from "vitest";

import { parseDeclarativeTheme } from "./declarative-theme.js";

describe("declarative themes", () => {
  it("round-trips a data-only ThemeDefinition", () => {
    const parsed = parseDeclarativeTheme(JSON.stringify(defaultTheme));

    expect(parsed.ir.id).toBe("default");
    expect(parsed.layouts.cover?.id).toBe("cover");
    expect(parsed).toEqual(defaultTheme);
  });

  it("rejects malformed definitions and unsafe object keys", () => {
    expect(() => parseDeclarativeTheme("not json")).toThrow("JSON");
    expect(() =>
      parseDeclarativeTheme(
        JSON.stringify({ ...defaultTheme, layouts: { cover: { id: "cover" } } }),
      ),
    ).toThrow("layout cover");
    expect(() =>
      parseDeclarativeTheme(
        `{"ir":{},"layouts":{},"defaults":{},"__proto__":{"polluted":true}}`,
      ),
    ).toThrow("不正");
  });
});
