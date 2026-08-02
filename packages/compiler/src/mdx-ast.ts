import type { SourceLocation } from "@livetoon/slide-deck-ir";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";

import { SlideFrontmatterSchema } from "./config.js";
import { createDiagnostic, DeckCompileError } from "./diagnostics.js";
import { evaluateStaticExpression, type StaticValue } from "./static-expression.js";
import type { SlideFrontmatter } from "./types.js";

interface AstPositionPoint {
  line?: number;
  column?: number;
}

interface AstPosition {
  start?: AstPositionPoint;
  end?: AstPositionPoint;
}

export interface AstAttribute {
  type: string;
  name?: string;
  value?: string | null | { type?: string; value?: string };
  position?: AstPosition;
}

export interface AstNode {
  type: string;
  value?: string;
  lang?: string | null;
  name?: string | null;
  url?: string;
  depth?: number;
  ordered?: boolean | null;
  children?: AstNode[];
  attributes?: AstAttribute[];
  position?: AstPosition;
}

export interface ParsedMdxDocument {
  frontmatter: SlideFrontmatter;
  children: AstNode[];
}

function issueSummary(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

export function sourceLocationForNode(
  node: Pick<AstNode, "position">,
  file: string,
): SourceLocation {
  const location: SourceLocation = {
    file,
    line: node.position?.start?.line ?? 1,
    column: node.position?.start?.column ?? 1,
  };
  if (node.position?.end?.line !== undefined) {
    location.endLine = node.position.end.line;
  }
  if (node.position?.end?.column !== undefined) {
    location.endColumn = node.position.end.column;
  }
  return location;
}

export function parseSlideMdx(source: string, sourcePath: string): ParsedMdxDocument {
  let root: AstNode;
  try {
    root = unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml"])
      .use(remarkMdx)
      .parse(source) as unknown as AstNode;
  } catch (error) {
    const errorWithPosition = error as {
      message?: string;
      line?: number;
      column?: number;
    };
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "MDX_SYNTAX_ERROR",
        message: errorWithPosition.message ?? String(error),
        sourceLocation: {
          file: sourcePath,
          line: errorWithPosition.line ?? 1,
          column: errorWithPosition.column ?? 1,
        },
      }),
    ]);
  }

  const children = root.children ?? [];
  const yamlNodes = children.filter((node) => node.type === "yaml");
  if (yamlNodes.length !== 1) {
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "SLIDE_FRONTMATTER_REQUIRED",
        message:
          yamlNodes.length === 0
            ? "Each slide must have one YAML frontmatter block"
            : "Each slide must have exactly one YAML frontmatter block",
        sourceLocation: { file: sourcePath, line: 1, column: 1 },
      }),
    ]);
  }

  const yamlNode = yamlNodes[0];
  if (!yamlNode) {
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "SLIDE_FRONTMATTER_REQUIRED",
        message: "Each slide must have one YAML frontmatter block",
        sourceLocation: { file: sourcePath, line: 1, column: 1 },
      }),
    ]);
  }
  try {
    const rawFrontmatter = parseYaml(yamlNode.value ?? "") as unknown;
    const frontmatter = SlideFrontmatterSchema.parse(rawFrontmatter);
    return {
      frontmatter,
      children: children.filter((node) => node !== yamlNode),
    };
  } catch (error) {
    const message =
      error && typeof error === "object" && "issues" in error
        ? issueSummary(error as ZodError)
        : error instanceof Error
          ? error.message
          : String(error);
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "SLIDE_FRONTMATTER_INVALID",
        message,
        sourceLocation: sourceLocationForNode(yamlNode, sourcePath),
      }),
    ]);
  }
}

export interface ParsedComponentProps {
  props: Record<string, StaticValue>;
  diagnostics: ReturnType<typeof createDiagnostic>[];
}

export function parseComponentProps(
  node: AstNode,
  sourcePath: string,
  slideId: string | undefined,
): ParsedComponentProps {
  const props: Record<string, StaticValue> = {};
  const diagnostics: ReturnType<typeof createDiagnostic>[] = [];

  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute" || !attribute.name) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_SPREAD_ATTRIBUTE_FORBIDDEN",
          message: "Spread attributes and expression attributes are not allowed",
          sourceLocation: sourceLocationForNode(
            { position: attribute.position },
            sourcePath,
          ),
          slideId,
        }),
      );
      continue;
    }
    if (Object.hasOwn(props, attribute.name)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_DUPLICATE_ATTRIBUTE",
          message: `Duplicate attribute: ${attribute.name}`,
          sourceLocation: sourceLocationForNode(
            { position: attribute.position },
            sourcePath,
          ),
          slideId,
        }),
      );
      continue;
    }

    if (attribute.value === null || attribute.value === undefined) {
      props[attribute.name] = true;
      continue;
    }
    if (typeof attribute.value === "string") {
      props[attribute.name] = attribute.value;
      continue;
    }

    try {
      props[attribute.name] = evaluateStaticExpression(attribute.value.value ?? "");
    } catch (error) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_DYNAMIC_EXPRESSION_FORBIDDEN",
          message: `${attribute.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          sourceLocation: sourceLocationForNode(
            { position: attribute.position },
            sourcePath,
          ),
          slideId,
        }),
      );
    }
  }

  return { props, diagnostics };
}
