import type {
  Diagnostic,
  ParagraphIR,
  TextRunIR,
} from "@editable-slides/slide-deck-ir";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { createDiagnostic } from "./diagnostics.js";
import type { AstNode } from "./mdx-ast.js";
import { sourceLocationForNode } from "./mdx-ast.js";
import { isSafeHyperlink } from "./security.js";

interface RunMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
  fontFace?: string;
}

function createRun(text: string, marks: RunMarks): TextRunIR {
  const run: TextRunIR = { text };
  if (marks.bold) {
    run.bold = true;
  }
  if (marks.italic) {
    run.italic = true;
  }
  if (marks.underline) {
    run.underline = true;
  }
  if (marks.href) {
    run.href = marks.href;
  }
  if (marks.fontFace) {
    run.fontFace = marks.fontFace;
  }
  return run;
}

function inlineRuns(
  nodes: AstNode[],
  marks: RunMarks,
  diagnostics: Diagnostic[],
  sourcePath: string,
  slideId: string,
  codeFontFace: string,
): TextRunIR[] {
  const runs: TextRunIR[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        runs.push(createRun(node.value ?? "", marks));
        break;
      case "strong":
        runs.push(
          ...inlineRuns(
            node.children ?? [],
            { ...marks, bold: true },
            diagnostics,
            sourcePath,
            slideId,
            codeFontFace,
          ),
        );
        break;
      case "emphasis":
        runs.push(
          ...inlineRuns(
            node.children ?? [],
            { ...marks, italic: true },
            diagnostics,
            sourcePath,
            slideId,
            codeFontFace,
          ),
        );
        break;
      case "link":
        if (!node.url || !isSafeHyperlink(node.url)) {
          diagnostics.push(
            createDiagnostic({
              severity: "error",
              code: "MARKDOWN_LINK_URL_UNSAFE",
              message:
                "Markdown links must use http, https or mailto without embedded credentials",
              sourceLocation: sourceLocationForNode(node, sourcePath),
              slideId,
            }),
          );
        }
        runs.push(
          ...inlineRuns(
            node.children ?? [],
            node.url && isSafeHyperlink(node.url)
              ? { ...marks, href: node.url }
              : marks,
            diagnostics,
            sourcePath,
            slideId,
            codeFontFace,
          ),
        );
        break;
      case "inlineCode":
        runs.push(
          createRun(node.value ?? "", {
            ...marks,
            fontFace: codeFontFace,
          }),
        );
        break;
      case "break":
        runs.push(createRun("\n", marks));
        break;
      default:
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "MARKDOWN_INLINE_UNSUPPORTED",
            message: `Unsupported inline Markdown node: ${node.type}`,
            sourceLocation: sourceLocationForNode(node, sourcePath),
            slideId,
          }),
        );
    }
  }
  return runs;
}

function paragraphFromNode(
  node: AstNode,
  diagnostics: Diagnostic[],
  sourcePath: string,
  slideId: string,
  codeFontFace: string,
  options: {
    bold?: boolean;
    level?: number;
    bullet?: boolean;
    ordered?: boolean;
  } = {},
): ParagraphIR {
  const paragraph: ParagraphIR = {
    runs: inlineRuns(
      node.children ?? [],
      options.bold ? { bold: true } : {},
      diagnostics,
      sourcePath,
      slideId,
      codeFontFace,
    ),
  };
  if (options.level !== undefined) {
    paragraph.level = options.level;
  }
  if (options.bullet !== undefined) {
    paragraph.bullet = options.bullet;
  }
  if (options.ordered !== undefined) {
    paragraph.ordered = options.ordered;
  }
  return paragraph;
}

function listParagraphs(
  node: AstNode,
  diagnostics: Diagnostic[],
  sourcePath: string,
  slideId: string,
  codeFontFace: string,
  level: number,
): ParagraphIR[] {
  const paragraphs: ParagraphIR[] = [];
  for (const item of node.children ?? []) {
    for (const child of item.children ?? []) {
      if (child.type === "paragraph") {
        paragraphs.push(
          paragraphFromNode(child, diagnostics, sourcePath, slideId, codeFontFace, {
            level,
            bullet: true,
            ordered: node.ordered === true,
          }),
        );
      } else if (child.type === "list") {
        paragraphs.push(
          ...listParagraphs(
            child,
            diagnostics,
            sourcePath,
            slideId,
            codeFontFace,
            level + 1,
          ),
        );
      } else {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "MARKDOWN_LIST_CONTENT_UNSUPPORTED",
            message: `Unsupported list content: ${child.type}`,
            sourceLocation: sourceLocationForNode(child, sourcePath),
            slideId,
          }),
        );
      }
    }
  }
  return paragraphs;
}

export interface MarkdownConversion {
  paragraphs: ParagraphIR[];
  diagnostics: Diagnostic[];
}

export function markdownNodesToParagraphs(
  nodes: AstNode[],
  sourcePath: string,
  slideId: string,
  options: { codeFontFace?: string } = {},
): MarkdownConversion {
  const paragraphs: ParagraphIR[] = [];
  const diagnostics: Diagnostic[] = [];
  const codeFontFace = options.codeFontFace ?? "Noto Sans Mono";

  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
        paragraphs.push(
          paragraphFromNode(node, diagnostics, sourcePath, slideId, codeFontFace),
        );
        break;
      case "heading":
        paragraphs.push(
          paragraphFromNode(node, diagnostics, sourcePath, slideId, codeFontFace, {
            bold: true,
          }),
        );
        break;
      case "list":
        paragraphs.push(
          ...listParagraphs(node, diagnostics, sourcePath, slideId, codeFontFace, 0),
        );
        break;
      case "code":
        paragraphs.push({
          runs: [
            {
              text: node.value ?? "",
              fontFace: codeFontFace,
            },
          ],
        });
        break;
      default:
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "MARKDOWN_BLOCK_UNSUPPORTED",
            message: `Unsupported Markdown block: ${node.type}`,
            sourceLocation: sourceLocationForNode(node, sourcePath),
            slideId,
          }),
        );
    }
  }

  return { paragraphs, diagnostics };
}

export function markdownToPlainText(markdown: string): string {
  if (markdown.trim() === "") {
    return "";
  }
  const tree = unified().use(remarkParse).parse(markdown);
  return mdastToString(tree).trim();
}
