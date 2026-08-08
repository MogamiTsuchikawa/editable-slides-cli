// @vitest-environment jsdom
import type { ElementIR, TextElementIR } from "@editable-slides/slide-deck-ir";
import { describe, expect, it } from "vitest";
import {
  isTextEditorTarget,
  isTextSaveShortcut,
  selectedTextElement,
  textElementToEditableMarkdown,
} from "./text-edit.js";

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
    paragraphs: [
      {
        runs: [
          { text: "Bold", bold: true },
          { text: " and " },
          { text: "italic", italic: true },
        ],
      },
      {
        runs: [{ text: "First item" }],
        bullet: true,
      },
      {
        runs: [{ text: "Nested item" }],
        bullet: true,
        level: 1,
      },
      {
        runs: [{ text: "Ordered" }],
        ordered: true,
      },
    ],
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

describe("text edit helpers", () => {
  it("reconstructs editable Markdown without losing paragraphs or list markers", () => {
    expect(textElementToEditableMarkdown(textElement())).toBe(
      ["**Bold** and *italic*", "- First item", "  - Nested item", "1. Ordered"].join(
        "\n\n",
      ),
    );
  });

  it("does not duplicate the title typography as Markdown bold", () => {
    const title = textElement();
    title.role = "title";
    title.paragraphs = [{ runs: [{ text: "Title", bold: true }] }];
    expect(textElementToEditableMarkdown(title)).toBe("Title");
  });

  it("returns a text element only for a single text selection", () => {
    const text = textElement();
    const shape = {
      ...text,
      id: "shape",
      type: "shape",
      shape: "rect",
      fill: { type: "none" },
    } as unknown as ElementIR;
    expect(selectedTextElement([text, shape], new Set([text.id]))).toBe(text);
    expect(selectedTextElement([text, shape], new Set([shape.id]))).toBeUndefined();
    expect(
      selectedTextElement([text, shape], new Set([text.id, shape.id])),
    ).toBeUndefined();
  });

  it("recognizes editor targets and the save shortcut", () => {
    const editor = document.createElement("section");
    editor.dataset.studioTextEditor = "";
    const textarea = document.createElement("textarea");
    editor.append(textarea);
    expect(isTextEditorTarget(textarea)).toBe(true);
    expect(isTextEditorTarget(document.body)).toBe(false);
    expect(isTextSaveShortcut({ key: "Enter", metaKey: true, ctrlKey: false })).toBe(
      true,
    );
    expect(isTextSaveShortcut({ key: "Enter", metaKey: false, ctrlKey: true })).toBe(
      true,
    );
    expect(isTextSaveShortcut({ key: "a", metaKey: true, ctrlKey: false })).toBe(false);
  });
});
