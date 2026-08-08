import { createHash } from "node:crypto";

import type { Diagnostic } from "@editable-slides/slide-deck-ir";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";

import { DeckMdxConfigSchema } from "./config.js";
import { createDiagnostic, DeckCompileError } from "./diagnostics.js";
import type { AstNode } from "./mdx-ast.js";
import { parseComponentProps, sourceLocationForNode } from "./mdx-ast.js";
import { MAX_EMBEDDED_ASSET_BYTES, validateEmbeddedAsset } from "./security.js";
import type { DeckMdxConfig, EmbeddedAsset, SlideFrontmatter } from "./types.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

export interface DeckMdxSlide {
  frontmatter: SlideFrontmatter;
  children: AstNode[];
  sourceNode: AstNode;
}

export interface ParsedDeckMdx {
  config: DeckMdxConfig;
  slides: DeckMdxSlide[];
  assets: ReadonlyMap<string, EmbeddedAsset>;
  diagnostics: Diagnostic[];
}

function issueSummary(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function parseRoot(source: string, sourcePath: string): AstNode {
  try {
    return unified()
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
}

function parseFrontmatter(
  children: AstNode[],
  sourcePath: string,
): { config: DeckMdxConfig; yamlNode: AstNode } {
  const yamlNodes = children.filter((node) => node.type === "yaml");
  if (yamlNodes.length !== 1) {
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "DECK_MDX_FRONTMATTER_REQUIRED",
        message:
          yamlNodes.length === 0
            ? "deck.mdx must start with one YAML frontmatter block"
            : "deck.mdx must contain exactly one YAML frontmatter block",
        sourceLocation: { file: sourcePath, line: 1, column: 1 },
      }),
    ]);
  }

  const yamlNode = yamlNodes[0];
  if (!yamlNode) {
    throw new Error("Invariant violation: YAML node is unexpectedly missing");
  }
  if (yamlNode.position?.start?.line !== 1) {
    throw new DeckCompileError([
      createDiagnostic({
        severity: "error",
        code: "DECK_MDX_FRONTMATTER_NOT_FIRST",
        message: "The deck configuration frontmatter must be the first block",
        sourceLocation: sourceLocationForNode(yamlNode, sourcePath),
      }),
    ]);
  }

  try {
    const config = DeckMdxConfigSchema.parse(
      parseYaml(yamlNode.value ?? "") as unknown,
    );
    return { config, yamlNode };
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
        code: "DECK_MDX_FRONTMATTER_INVALID",
        message,
        sourceLocation: sourceLocationForNode(yamlNode, sourcePath),
      }),
    ]);
  }
}

function addUnknownPropsDiagnostics(
  component: "Slide" | "Assets" | "Asset",
  allowed: ReadonlySet<string>,
  props: Record<string, unknown>,
  node: AstNode,
  sourcePath: string,
  diagnostics: Diagnostic[],
  slideId?: string,
): void {
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "MDX_COMPONENT_PROP_UNKNOWN",
          message: `${component}: unknown prop "${name}"`,
          sourceLocation: sourceLocationForNode(node, sourcePath),
          slideId,
        }),
      );
    }
  }
}

function embeddedAssetText(
  node: AstNode,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const collect = (candidate: AstNode): string | undefined => {
    if (candidate.type === "text") {
      return candidate.value ?? "";
    }
    if (candidate.type !== "paragraph") {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_ASSET_CONTENT_INVALID",
          message: "Asset content must contain only base64 text",
          sourceLocation: sourceLocationForNode(candidate, sourcePath),
        }),
      );
      return undefined;
    }
    const values = (candidate.children ?? []).map(collect);
    return values.some((value) => value === undefined) ? undefined : values.join("");
  };

  const values = (node.children ?? []).map(collect);
  return values.some((value) => value === undefined) ? undefined : values.join("");
}

function decodeBase64(
  source: string,
  node: AstNode,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Buffer | undefined {
  const compact = source.replace(/\s/g, "");
  if (
    compact.length === 0 ||
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "DECK_MDX_ASSET_BASE64_INVALID",
        message: "Asset content is not valid base64",
        sourceLocation: sourceLocationForNode(node, sourcePath),
      }),
    );
    return undefined;
  }

  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor((compact.length * 3) / 4) - padding;
  if (estimatedBytes > MAX_EMBEDDED_ASSET_BYTES) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "ASSET_SIZE_LIMIT_EXCEEDED",
        message: `Embedded asset is approximately ${estimatedBytes} bytes; the limit is ${MAX_EMBEDDED_ASSET_BYTES} bytes`,
        sourceLocation: sourceLocationForNode(node, sourcePath),
      }),
    );
    return undefined;
  }

  const data = Buffer.from(compact, "base64");
  const normalizedInput = compact.replace(/=+$/, "");
  const normalizedDecoded = data.toString("base64").replace(/=+$/, "");
  if (normalizedInput !== normalizedDecoded) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "DECK_MDX_ASSET_BASE64_INVALID",
        message: "Asset content is not valid base64",
        sourceLocation: sourceLocationForNode(node, sourcePath),
      }),
    );
    return undefined;
  }
  return data;
}

function parseAssets(
  assetsNode: AstNode | undefined,
  sourcePath: string,
  diagnostics: Diagnostic[],
): ReadonlyMap<string, EmbeddedAsset> {
  const assets = new Map<string, EmbeddedAsset>();
  if (!assetsNode) {
    return assets;
  }

  const parsedAssetsProps = parseComponentProps(assetsNode, sourcePath, undefined);
  diagnostics.push(...parsedAssetsProps.diagnostics);
  addUnknownPropsDiagnostics(
    "Assets",
    new Set(),
    parsedAssetsProps.props,
    assetsNode,
    sourcePath,
    diagnostics,
  );

  for (const child of assetsNode.children ?? []) {
    if (
      (child.type !== "mdxJsxFlowElement" && child.type !== "mdxJsxTextElement") ||
      child.name !== "Asset"
    ) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_ASSETS_CHILD_INVALID",
          message: "Assets may contain only Asset components",
          sourceLocation: sourceLocationForNode(child, sourcePath),
        }),
      );
      continue;
    }

    const parsed = parseComponentProps(child, sourcePath, undefined);
    diagnostics.push(...parsed.diagnostics);
    addUnknownPropsDiagnostics(
      "Asset",
      new Set(["id", "mimeType", "encoding"]),
      parsed.props,
      child,
      sourcePath,
      diagnostics,
    );
    const id = parsed.props.id;
    const mimeType = parsed.props.mimeType;
    const encoding = parsed.props.encoding;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_ASSET_ID_INVALID",
          message:
            'Asset requires an "id" using lowercase letters, numbers, "_" or "-"',
          sourceLocation: sourceLocationForNode(child, sourcePath),
        }),
      );
      continue;
    }
    if (assets.has(id)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_ASSET_DUPLICATE",
          message: `Asset id is declared more than once: ${id}`,
          sourceLocation: sourceLocationForNode(child, sourcePath),
        }),
      );
      continue;
    }
    if (typeof mimeType !== "string" || !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_ASSET_MIME_TYPE_INVALID",
          message:
            "Asset mimeType must be image/png, image/jpeg, image/gif, image/webp or image/svg+xml",
          sourceLocation: sourceLocationForNode(child, sourcePath),
        }),
      );
      continue;
    }
    if (encoding !== "base64") {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_ASSET_ENCODING_INVALID",
          message: 'Asset encoding must be "base64"',
          sourceLocation: sourceLocationForNode(child, sourcePath),
        }),
      );
      continue;
    }
    const text = embeddedAssetText(child, sourcePath, diagnostics);
    if (text === undefined) {
      continue;
    }
    const data = decodeBase64(text, child, sourcePath, diagnostics);
    if (!data) {
      continue;
    }
    const securityIssues = validateEmbeddedAsset(data, mimeType);
    for (const issue of securityIssues) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: issue.code,
          message: `Asset "${id}": ${issue.message}`,
          sourceLocation: sourceLocationForNode(child, sourcePath),
        }),
      );
    }
    if (securityIssues.length > 0) {
      continue;
    }
    const canonicalBase64 = data.toString("base64");
    assets.set(id, {
      id,
      mimeType,
      encoding,
      data,
      dataUri: `data:${mimeType};base64,${canonicalBase64}`,
      contentHash: createHash("sha256").update(data).digest("hex"),
    });
  }
  return assets;
}

export function parseDeckMdx(source: string, sourcePath: string): ParsedDeckMdx {
  const root = parseRoot(source, sourcePath);
  const children = root.children ?? [];
  const { config, yamlNode } = parseFrontmatter(children, sourcePath);
  const diagnostics: Diagnostic[] = [];
  const slideNodes = new Map<string, AstNode>();
  let assetsNode: AstNode | undefined;

  for (const node of children) {
    if (node === yamlNode) {
      continue;
    }
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      node.name === "Slide"
    ) {
      const parsed = parseComponentProps(node, sourcePath, undefined);
      diagnostics.push(...parsed.diagnostics);
      const id = parsed.props.id;
      addUnknownPropsDiagnostics(
        "Slide",
        new Set(["id"]),
        parsed.props,
        node,
        sourcePath,
        diagnostics,
        typeof id === "string" ? id : undefined,
      );
      if (typeof id !== "string" || !ID_PATTERN.test(id)) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "DECK_MDX_SLIDE_ID_INVALID",
            message:
              'Slide requires an "id" using lowercase letters, numbers, "_" or "-"',
            sourceLocation: sourceLocationForNode(node, sourcePath),
          }),
        );
        continue;
      }
      if (slideNodes.has(id)) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "DECK_MDX_SLIDE_DUPLICATE",
            message: `Slide is declared more than once: ${id}`,
            sourceLocation: sourceLocationForNode(node, sourcePath),
            slideId: id,
          }),
        );
        continue;
      }
      slideNodes.set(id, node);
      continue;
    }
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      node.name === "Assets"
    ) {
      if (assetsNode) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "DECK_MDX_ASSETS_DUPLICATE",
            message: "deck.mdx may contain only one Assets component",
            sourceLocation: sourceLocationForNode(node, sourcePath),
          }),
        );
      } else {
        assetsNode = node;
      }
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "DECK_MDX_TOP_LEVEL_INVALID",
        message: "After frontmatter, deck.mdx may contain only Slide and Assets",
        sourceLocation: sourceLocationForNode(node, sourcePath),
      }),
    );
  }

  const configuredIds = new Set(config.slides.map((slide) => slide.id));
  for (const [id, node] of slideNodes) {
    if (!configuredIds.has(id)) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_SLIDE_UNDECLARED",
          message: `Slide "${id}" is missing from frontmatter slides`,
          sourceLocation: sourceLocationForNode(node, sourcePath),
          slideId: id,
        }),
      );
    }
  }

  const slides: DeckMdxSlide[] = [];
  for (const frontmatter of config.slides) {
    const sourceNode = slideNodes.get(frontmatter.id);
    if (!sourceNode) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "DECK_MDX_SLIDE_MISSING",
          message: `Frontmatter slide "${frontmatter.id}" has no matching Slide component`,
          sourceLocation: { file: sourcePath, line: 1, column: 1 },
          slideId: frontmatter.id,
        }),
      );
      continue;
    }
    slides.push({
      frontmatter,
      children: sourceNode.children ?? [],
      sourceNode,
    });
  }

  return {
    config,
    slides,
    assets: parseAssets(assetsNode, sourcePath, diagnostics),
    diagnostics,
  };
}
