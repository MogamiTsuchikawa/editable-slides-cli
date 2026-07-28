import { describe, expect, it } from "vitest";
import { createEditHistory, historyReducer } from "./history.js";
import { emptyOverrides, setFrameOverride } from "./overrides.js";

const frame = {
  x: 10,
  y: 20,
  w: 300,
  h: 200,
  rotation: 0,
  zIndex: 4,
};

describe("historyReducer", () => {
  it("coalesces gesture previews into one undo entry", () => {
    const initial = emptyOverrides();
    const first = setFrameOverride(initial, "intro", "title", frame);
    const second = setFrameOverride(first, "intro", "title", {
      ...frame,
      x: 42,
    });
    let history = createEditHistory(initial);
    history = historyReducer(history, { type: "begin" });
    history = historyReducer(history, { type: "preview", document: first });
    history = historyReducer(history, { type: "preview", document: second });
    history = historyReducer(history, { type: "commit" });

    expect(history.past).toHaveLength(1);
    expect(history.present.slides.intro?.title?.x).toBe(42);
    history = historyReducer(history, { type: "undo" });
    expect(history.present).toEqual(initial);
  });

  it("supports redo after a committed edit", () => {
    const initial = emptyOverrides();
    const changed = setFrameOverride(initial, "intro", "title", frame);
    let history = historyReducer(createEditHistory(initial), {
      type: "apply",
      document: changed,
    });
    history = historyReducer(history, { type: "undo" });
    history = historyReducer(history, { type: "redo" });
    expect(history.present).toEqual(changed);
  });
});
