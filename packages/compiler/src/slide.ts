import type {
  Diagnostic,
  ElementIR,
  ParagraphIR,
  SlideIR,
  TextElementIR,
  TextStyleIR,
} from "@livetoon/slide-deck-ir";
import type {
  LayoutDefinition,
  LayoutSlotDefinition,
  ThemeDefinition,
} from "@livetoon/slide-theme-default";

import { compileImageBackground } from "./background.js";
import { compileComponent } from "./components.js";
import { createDiagnostic } from "./diagnostics.js";
import { markdownNodesToParagraphs, markdownToPlainText } from "./markdown.js";
import type { AstNode, ParsedMdxDocument } from "./mdx-ast.js";
import {
  parseComponentProps,
  parseSlideMdx,
  sourceLocationForNode,
} from "./mdx-ast.js";
import type { EmbeddedAsset, ParsedSlide } from "./types.js";

function styleForSlot(theme: ThemeDefinition, slot: LayoutSlotDefinition): TextStyleIR {
  return {
    ...theme.ir.typography[slot.typography],
    ...slot.textStyle,
    align: slot.textAlign ?? theme.ir.typography[slot.typography].align,
  };
}

function slotTextElement(
  slideId: string,
  slotName: string,
  slot: LayoutSlotDefinition,
  paragraphs: ParagraphIR[],
  sourcePath: string,
  sourceNode: AstNode,
  theme: ThemeDefinition,
): TextElementIR {
  return {
    id: `${slideId}--${slotName}`,
    type: "text",
    role: slot.typography,
    frame: { ...slot.frame },
    rotation: 0,
    zIndex: slot.zIndex,
    opacity: 1,
    editable: true,
    sourceLocation: sourceLocationForNode(sourceNode, sourcePath),
    paragraphs,
    style: styleForSlot(theme, slot),
  };
}

function defaultSlotForComponent(
  componentName: string | null | undefined,
  layout: LayoutDefinition,
): string | undefined {
  if ((componentName === "Image" || componentName === "Video") && layout.slots.image) {
    return "image";
  }
  if (componentName === "Chart" && layout.slots.chart) {
    return "chart";
  }
  return layout.slots.body ? "body" : undefined;
}

function sourceSpanForNodes(nodes: readonly AstNode[]): AstNode | undefined {
  const first = nodes.find((node) => node.position?.start);
  const last = [...nodes].reverse().find((node) => node.position?.end);
  if (!first || !last) {
    return undefined;
  }
  return {
    type: "sourceSpan",
    position: {
      start: first.position?.start,
      end: last.position?.end,
    },
  };
}

function slotNameFromNode(
  node: AstNode,
  sourcePath: string,
  slideId: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const parsed = parseComponentProps(node, sourcePath, slideId);
  diagnostics.push(...parsed.diagnostics);
  for (const propName of Object.keys(parsed.props)) {
    if (propName !== "name") {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_COMPONENT_PROP_UNKNOWN",
          message: `Slot: unknown prop "${propName}"`,
          sourceLocation: sourceLocationForNode(node, sourcePath),
          slideId,
        }),
      );
    }
  }
  const name = parsed.props.name;
  if (typeof name !== "string" || name.trim() === "") {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "SLOT_NAME_REQUIRED",
        message: 'Slot requires a non-empty string "name"',
        sourceLocation: sourceLocationForNode(node, sourcePath),
        slideId,
      }),
    );
    return undefined;
  }
  return name;
}

async function compileSlot(
  slotName: string,
  nodes: AstNode[],
  sourceNode: AstNode,
  sourcePath: string,
  deckDirectory: string,
  slideId: string,
  theme: ThemeDefinition,
  layout: LayoutDefinition,
  diagnostics: Diagnostic[],
  embeddedAssets?: ReadonlyMap<string, EmbeddedAsset>,
): Promise<ElementIR[]> {
  const slot = layout.slots[slotName];
  if (!slot) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "LAYOUT_SLOT_UNKNOWN",
        message: `Layout "${layout.id}" has no slot "${slotName}"`,
        sourceLocation: sourceLocationForNode(sourceNode, sourcePath),
        slideId,
      }),
    );
    return [];
  }

  const markdownNodes: AstNode[] = [];
  const elements: ElementIR[] = [];
  for (const node of nodes) {
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      if (node.name === "Spacer") {
        markdownNodes.push({
          type: "paragraph",
          children: [{ type: "text", value: "\n" }],
          position: node.position,
        });
        continue;
      }
      const element = await compileComponent(node, {
        sourcePath,
        deckDirectory,
        slideId,
        theme,
        layout,
        diagnostics,
        defaultSlot: slotName,
        embeddedAssets,
      });
      if (element) {
        elements.push(element);
      }
    } else {
      markdownNodes.push(node);
    }
  }

  if (markdownNodes.length > 0) {
    const conversion = markdownNodesToParagraphs(markdownNodes, sourcePath, slideId, {
      codeFontFace: theme.ir.fonts.code.family,
    });
    diagnostics.push(...conversion.diagnostics);
    if (conversion.paragraphs.length > 0) {
      const textSourceNode = sourceSpanForNodes(markdownNodes) ?? sourceNode;
      elements.unshift(
        slotTextElement(
          slideId,
          slotName,
          slot,
          conversion.paragraphs,
          sourcePath,
          textSourceNode,
          theme,
        ),
      );
    }
  }

  return elements;
}

export async function compileSlide(
  source: string,
  sourcePath: string,
  deckDirectory: string,
  theme: ThemeDefinition,
  embeddedAssets?: ReadonlyMap<string, EmbeddedAsset>,
): Promise<ParsedSlide> {
  const parsed = parseSlideMdx(source, sourcePath);
  return compileSlideDocument(parsed, sourcePath, deckDirectory, theme, embeddedAssets);
}

export async function compileSlideDocument(
  parsed: ParsedMdxDocument,
  sourcePath: string,
  deckDirectory: string,
  theme: ThemeDefinition,
  embeddedAssets?: ReadonlyMap<string, EmbeddedAsset>,
): Promise<ParsedSlide> {
  const diagnostics: Diagnostic[] = [];
  const { frontmatter } = parsed;
  const layout = theme.layouts[frontmatter.layout];
  if (!layout) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "LAYOUT_UNKNOWN",
        message: `Unknown layout "${frontmatter.layout}"`,
        sourceLocation: { file: sourcePath, line: 1, column: 1 },
        slideId: frontmatter.id,
      }),
    );
    return {
      slide: {
        id: frontmatter.id,
        sourcePath,
        layoutId: frontmatter.layout,
        elements: [],
        notes: {
          markdown: frontmatter.notes,
          plainText: markdownToPlainText(frontmatter.notes),
          sources: frontmatter.sources,
        },
      },
      diagnostics,
    };
  }

  const slotNodes = new Map<string, { sourceNode: AstNode; children: AstNode[] }>();
  const titleNodes: AstNode[] = [];
  const bodyNodes: AstNode[] = [];
  const explicitElements: ElementIR[] = [];

  for (const originalNode of parsed.children) {
    const node =
      originalNode.type === "paragraph" &&
      originalNode.children?.length === 1 &&
      originalNode.children[0]?.type === "mdxJsxTextElement"
        ? originalNode.children[0]
        : originalNode;
    if (node.type === "mdxjsEsm") {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_ESM_FORBIDDEN",
          message: "import and export declarations are not allowed",
          sourceLocation: sourceLocationForNode(node, sourcePath),
          slideId: frontmatter.id,
        }),
      );
      continue;
    }
    if (node.type === "html") {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_HTML_FORBIDDEN",
          message: "Raw HTML is not allowed",
          sourceLocation: sourceLocationForNode(node, sourcePath),
          slideId: frontmatter.id,
        }),
      );
      continue;
    }
    if (node.type === "heading" && node.depth === 1) {
      if (titleNodes.length > 0) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "SLIDE_MULTIPLE_H1",
            message: "A slide may contain only one level-1 heading",
            sourceLocation: sourceLocationForNode(node, sourcePath),
            slideId: frontmatter.id,
          }),
        );
      }
      titleNodes.push(node);
      continue;
    }
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      node.name === "Slot"
    ) {
      const slotName = slotNameFromNode(node, sourcePath, frontmatter.id, diagnostics);
      if (slotName) {
        const existing = slotNodes.get(slotName);
        if (existing) {
          existing.children.push(...(node.children ?? []));
        } else {
          slotNodes.set(slotName, {
            sourceNode: node,
            children: [...(node.children ?? [])],
          });
        }
      }
      continue;
    }
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      const element = await compileComponent(node, {
        sourcePath,
        deckDirectory,
        slideId: frontmatter.id,
        theme,
        layout,
        diagnostics,
        defaultSlot: defaultSlotForComponent(node.name, layout),
        embeddedAssets,
      });
      if (element) {
        explicitElements.push(element);
      }
      continue;
    }
    bodyNodes.push(node);
  }

  const elements: ElementIR[] = [];
  if (titleNodes.length > 0) {
    const titleNode = titleNodes[0];
    if (!titleNode) {
      throw new Error("Invariant violation: titleNodes is unexpectedly empty");
    }
    const slot = layout.slots.title;
    if (!slot) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "LAYOUT_TITLE_SLOT_MISSING",
          message: `Layout "${layout.id}" cannot accept a level-1 heading`,
          sourceLocation: sourceLocationForNode(titleNode, sourcePath),
          slideId: frontmatter.id,
        }),
      );
    } else {
      // A level-1 heading selects the title slot; the theme decides the title
      // weight. Treat it as a paragraph here so Markdown does not force bold,
      // while explicit **strong** runs inside the heading remain bold.
      const conversion = markdownNodesToParagraphs(
        titleNodes.map((node) => ({ ...node, type: "paragraph" })),
        sourcePath,
        frontmatter.id,
        { codeFontFace: theme.ir.fonts.code.family },
      );
      diagnostics.push(...conversion.diagnostics);
      elements.push(
        slotTextElement(
          frontmatter.id,
          "title",
          slot,
          conversion.paragraphs,
          sourcePath,
          sourceSpanForNodes(titleNodes) ?? titleNode,
          theme,
        ),
      );
    }
  }

  if (bodyNodes.length > 0) {
    const bodyNode = bodyNodes[0];
    if (!bodyNode) {
      throw new Error("Invariant violation: bodyNodes is unexpectedly empty");
    }
    const slot = layout.slots.body;
    if (!slot) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "LAYOUT_BODY_SLOT_MISSING",
          message: `Layout "${layout.id}" cannot accept top-level Markdown body`,
          sourceLocation: sourceLocationForNode(bodyNode, sourcePath),
          slideId: frontmatter.id,
        }),
      );
    } else {
      const conversion = markdownNodesToParagraphs(
        bodyNodes,
        sourcePath,
        frontmatter.id,
        { codeFontFace: theme.ir.fonts.code.family },
      );
      diagnostics.push(...conversion.diagnostics);
      if (conversion.paragraphs.length > 0) {
        elements.push(
          slotTextElement(
            frontmatter.id,
            "body",
            slot,
            conversion.paragraphs,
            sourcePath,
            sourceSpanForNodes(bodyNodes) ?? bodyNode,
            theme,
          ),
        );
      }
    }
  }

  for (const [slotName, slotContent] of slotNodes) {
    elements.push(
      ...(await compileSlot(
        slotName,
        slotContent.children,
        slotContent.sourceNode,
        sourcePath,
        deckDirectory,
        frontmatter.id,
        theme,
        layout,
        diagnostics,
        embeddedAssets,
      )),
    );
  }
  elements.push(...explicitElements);

  const background = frontmatter.background
    ? await compileImageBackground({
        input: frontmatter.background,
        sourcePath,
        deckDirectory,
        slideId: frontmatter.id,
        diagnostics,
        embeddedAssets,
      })
    : layout.background;

  const slide: SlideIR = {
    id: frontmatter.id,
    sourcePath,
    layoutId: layout.id,
    masterId: frontmatter.masterId ?? layout.masterId,
    background,
    elements,
    notes: {
      markdown: frontmatter.notes,
      plainText: markdownToPlainText(frontmatter.notes),
      sources: frontmatter.sources,
    },
  };

  return { slide, diagnostics };
}
