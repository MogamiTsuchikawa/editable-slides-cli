import type {
  ElementIR,
  TextElementIR,
  TextRunIR,
} from "@editable-slides/slide-deck-ir";

function escapeMarkdownText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function runToMarkdown(run: TextRunIR, suppressBold = false): string {
  let value = escapeMarkdownText(run.text);
  if (run.bold && run.italic && !suppressBold) {
    value = `***${value}***`;
  } else if (run.italic) {
    value = `*${value}*`;
  } else if (run.bold && !suppressBold) {
    value = `**${value}**`;
  }
  if (run.href) {
    value = `[${value}](${run.href.replaceAll(")", "\\)")})`;
  }
  return value;
}

export function textElementToEditableMarkdown(element: TextElementIR): string {
  const suppressBold = element.role === "title";
  return element.paragraphs
    .map((paragraph) => {
      const indentation = "  ".repeat(paragraph.level ?? 0);
      const prefix = paragraph.ordered ? "1. " : paragraph.bullet ? "- " : "";
      return `${indentation}${prefix}${paragraph.runs
        .map((run) => runToMarkdown(run, suppressBold))
        .join("")}`;
    })
    .join("\n\n");
}

export function selectedTextElement(
  elements: readonly ElementIR[],
  selectedIds: ReadonlySet<string>,
): TextElementIR | undefined {
  if (selectedIds.size !== 1) return undefined;
  const [selectedId] = selectedIds;
  if (!selectedId) return undefined;
  const element = elements.find((candidate) => candidate.id === selectedId);
  return element?.type === "text" ? element : undefined;
}

export function isTextEditorTarget(target: EventTarget | null): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    Boolean(target.closest("[data-studio-text-editor]"))
  );
}

export function isTextSaveShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey);
}
