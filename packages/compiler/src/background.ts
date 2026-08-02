import type { Diagnostic, ImageBackgroundIR } from "@livetoon/slide-deck-ir";

import { createDiagnostic } from "./diagnostics.js";
import {
  IMAGE_FILE_POLICIES,
  MAX_IMAGE_ASSET_BYTES,
  readSecureDeckFile,
  SecurityValidationError,
  validateEmbeddedAsset,
} from "./security.js";
import type { EmbeddedAsset, SlideFrontmatter } from "./types.js";

type BackgroundInput = NonNullable<SlideFrontmatter["background"]>;

function addIssues(
  diagnostics: Diagnostic[],
  sourcePath: string,
  slideId: string,
  issues: ReadonlyArray<{ code: string; message: string }>,
): void {
  for (const issue of issues) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: issue.code,
        message: `Background: ${issue.message}`,
        sourceLocation: { file: sourcePath, line: 1, column: 1 },
        slideId,
      }),
    );
  }
}

function rejectAnimatedBackground(
  mimeType: string | undefined,
  diagnostics: Diagnostic[],
  sourcePath: string,
  slideId: string,
): boolean {
  if (mimeType !== "image/gif") {
    return false;
  }
  addIssues(diagnostics, sourcePath, slideId, [
    {
      code: "BACKGROUND_ANIMATED_IMAGE_UNSUPPORTED",
      message:
        "GIF backgrounds are not deterministic for print; use PNG, JPEG, WebP or SVG",
    },
  ]);
  return true;
}

export async function compileImageBackground(options: {
  input: BackgroundInput;
  sourcePath: string;
  deckDirectory: string;
  slideId: string;
  diagnostics: Diagnostic[];
  embeddedAssets?: ReadonlyMap<string, EmbeddedAsset>;
}): Promise<ImageBackgroundIR | undefined> {
  const { input, sourcePath, deckDirectory, slideId, diagnostics } = options;
  if (input.src.startsWith("asset:")) {
    const assetId = input.src.slice("asset:".length);
    const embedded = options.embeddedAssets?.get(assetId);
    if (!embedded) {
      addIssues(diagnostics, sourcePath, slideId, [
        {
          code: "BACKGROUND_ASSET_NOT_FOUND",
          message: `embedded asset "${assetId}" is not declared`,
        },
      ]);
      return undefined;
    }
    const issues = validateEmbeddedAsset(embedded.data, embedded.mimeType);
    if (issues.length > 0) {
      addIssues(diagnostics, sourcePath, slideId, issues);
      return undefined;
    }
    if (rejectAnimatedBackground(embedded.mimeType, diagnostics, sourcePath, slideId)) {
      return undefined;
    }
    return {
      type: "image",
      src: embedded.dataUri,
      contentHash: embedded.contentHash,
      mimeType: embedded.mimeType,
      fit: input.fit,
      ...(input.focalPosition ? { focalPosition: input.focalPosition } : {}),
    };
  }

  try {
    const asset = await readSecureDeckFile({
      deckDirectory,
      sourcePath,
      reference: input.src,
      allowedExtensions: IMAGE_FILE_POLICIES,
      defaultMaxBytes: MAX_IMAGE_ASSET_BYTES,
    });
    if (rejectAnimatedBackground(asset.mimeType, diagnostics, sourcePath, slideId)) {
      return undefined;
    }
    return {
      type: "image",
      src: asset.path,
      contentHash: asset.contentHash,
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      fit: input.fit,
      ...(input.focalPosition ? { focalPosition: input.focalPosition } : {}),
    };
  } catch (error) {
    if (error instanceof SecurityValidationError) {
      addIssues(diagnostics, sourcePath, slideId, error.issues);
    } else {
      addIssues(diagnostics, sourcePath, slideId, [
        { code: "BACKGROUND_READ_FAILED", message: String(error) },
      ]);
    }
    return undefined;
  }
}
