// @vitest-environment jsdom
import type { TextElementIR } from "@livetoon/slide-deck-ir";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextEditPanel } from "./text-edit-panel.js";

const { saveElementText } = vi.hoisted(() => ({
  saveElementText: vi.fn<() => Promise<void>>(),
}));

vi.mock("./api.js", () => ({ saveElementText }));

function textElement(): TextElementIR {
  return {
    id: "body-copy",
    type: "text",
    frame: { x: 100, y: 100, w: 800, h: 400 },
    rotation: 0,
    zIndex: 10,
    opacity: 1,
    editable: true,
    sourceLocation: { file: "slides/001.mdx", line: 10, column: 1 },
    role: "body",
    paragraphs: [{ runs: [{ text: "Original" }] }],
    style: {
      fontFace: "Noto Sans JP",
      fontSize: 30,
      color: "#172033",
      fontWeight: 400,
      align: "left",
      verticalAlign: "top",
    },
  };
}

describe("TextEditPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    saveElementText.mockReset();
    saveElementText.mockResolvedValue();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TextEditPanel deckId="example" element={textElement()} slideId="intro" />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function replaceText(value: string): Promise<HTMLTextAreaElement> {
    const textarea = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='text-editor-input']",
    );
    if (!textarea) throw new Error("textarea was not rendered");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return textarea;
  }

  it("saves edited text from the button and notifies the parent", async () => {
    const onTextSaved = vi.fn();
    await act(async () => {
      root.render(
        <TextEditPanel
          deckId="example"
          element={textElement()}
          onTextSaved={onTextSaved}
          slideId="intro"
        />,
      );
    });
    await replaceText("Updated\n\n- Item");
    const button = container.querySelector<HTMLButtonElement>(
      "[data-testid='text-editor-save']",
    );
    if (!button) throw new Error("save button was not rendered");

    await act(async () => {
      button.click();
    });

    expect(saveElementText).toHaveBeenCalledWith(
      "example",
      "intro",
      "body-copy",
      "Updated\n\n- Item",
    );
    expect(onTextSaved).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
  });

  it("uses Cmd+Enter to save and keeps editor keys away from window shortcuts", async () => {
    const textarea = await replaceText("Keyboard save");
    const canvasShortcut = vi.fn();
    window.addEventListener("keydown", canvasShortcut);
    try {
      await act(async () => {
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: "ArrowLeft",
          }),
        );
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: "Enter",
            metaKey: true,
          }),
        );
      });
    } finally {
      window.removeEventListener("keydown", canvasShortcut);
    }

    expect(canvasShortcut).not.toHaveBeenCalled();
    expect(saveElementText).toHaveBeenCalledWith(
      "example",
      "intro",
      "body-copy",
      "Keyboard save",
    );
  });
});
