import { describe, expect, it } from "vitest";
import { parseStudioRoute, routePath } from "./routes.js";

describe("Studio routes", () => {
  it("round-trips an editable slide route", () => {
    const route = parseStudioRoute("/edit/quarterly/market%20map");
    expect(route).toEqual({
      kind: "edit",
      deckId: "quarterly",
      slideId: "market map",
    });
    expect(routePath(route)).toBe("/edit/quarterly/market%20map");
  });

  it("defaults the landing page to an example deck", () => {
    expect(parseStudioRoute("/")).toEqual({
      kind: "edit",
      deckId: "example",
    });
  });

  it.each([
    ["/deck/quarterly/intro", "intro"],
    ["/debug/quarterly/intro", "intro"],
    ["/overview/quarterly", undefined],
    ["/presenter/quarterly", undefined],
  ])("normalizes the legacy route %s to edit", (pathname, slideId) => {
    expect(parseStudioRoute(pathname)).toEqual({
      kind: "edit",
      deckId: "quarterly",
      ...(slideId ? { slideId } : {}),
    });
  });

  it("keeps the print-only route", () => {
    const route = parseStudioRoute("/print/quarterly");
    expect(route).toEqual({ kind: "print", deckId: "quarterly" });
    expect(routePath(route)).toBe("/print/quarterly");
  });
});
