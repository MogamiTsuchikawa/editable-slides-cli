import { describe, expect, it } from "vitest";

import { evaluateStaticExpression } from "./static-expression.js";

describe("evaluateStaticExpression", () => {
  it("accepts JSON-compatible data with unquoted object keys", () => {
    expect(
      evaluateStaticExpression(
        '[{ label: "調査", value: 80 }, { label: "作成", value: -5 }]',
      ),
    ).toEqual([
      { label: "調査", value: 80 },
      { label: "作成", value: -5 },
    ]);
  });

  it.each(["process.env.SECRET", "loadData()", "value ? 1 : 2", "...items"])(
    "rejects executable expression %s",
    (source) => {
      expect(() => evaluateStaticExpression(source)).toThrow();
    },
  );

  it("rejects trailing expressions", () => {
    expect(() => evaluateStaticExpression("1; alert(1)")).toThrow(/Unexpected content/);
  });
});
