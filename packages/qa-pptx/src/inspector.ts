import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { PptxInspectionError } from "./error.js";
import type {
  InspectedObject,
  InspectedSlide,
  InspectedTextRun,
  InspectionIssue,
  InspectPptxOptions,
  LogicalFrame,
  NativeObjectKind,
  PptxDeckInput,
  PptxInput,
  PptxInspectionReport,
} from "./types.js";

const EMU_PER_INCH = 914400;
const DEFAULT_WIDTH_INCH = 13.333333;
const DEFAULT_HEIGHT_INCH = 7.5;
const REQUIRED_PACKAGE_FILES = [
  "[Content_Types].xml",
  "_rels/.rels",
  "ppt/presentation.xml",
  "ppt/_rels/presentation.xml.rels",
];
const TABLE_RELATIONSHIP_URI = "http://schemas.openxmlformats.org/drawingml/2006/table";
const CHART_RELATIONSHIP_URI = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const TRACK_RELATIONSHIP_URI =
  "http://schemas.microsoft.com/office/2017/04/relationships/track";

type UnknownRecord = Record<string, unknown>;

interface CanvasMetrics {
  width: number;
  height: number;
  widthInch: number;
  heightInch: number;
}

interface ExpectedElement {
  id: string;
  name: string;
  type: string;
  frame: LogicalFrame;
  rotation: number;
  editable: boolean;
  role?: string;
  text?: string;
  textRuns: ExpectedTextRun[];
  mimeType?: string;
  byteLength?: number;
  contentHash?: string;
  captionSrc?: string;
  captionContentHash?: string;
  captionLanguage?: string;
  captionLabel?: string;
}

interface ExpectedTextRun {
  text: string;
  fontFace?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

interface PackageContentTypes {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
}

interface InspectedObjectInternal extends InspectedObject {
  source: UnknownRecord;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
});

export async function inspectPptx(
  input: PptxInput,
  deck?: PptxDeckInput,
  options: InspectPptxOptions = {},
): Promise<PptxInspectionReport> {
  const issues: InspectionIssue[] = [];
  const data = await loadInput(input);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (error) {
    return failureReport(
      "package.invalid-zip",
      `The input is not a valid PPTX ZIP package: ${errorMessage(error)}`,
    );
  }

  for (const requiredPath of REQUIRED_PACKAGE_FILES) {
    if (!zip.file(requiredPath)) {
      issues.push({
        severity: "error",
        code: "package.missing-part",
        message: `Required OOXML package part is missing: ${requiredPath}`,
        actual: requiredPath,
      });
    }
  }
  const contentTypes = await readPackageContentTypes(zip, issues);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(numericPartSort);
  const notesFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
    .sort(numericPartSort);
  if (deck && slideFiles.length !== deck.slides.length) {
    issues.push({
      severity: "error",
      code: "deck.slide-count",
      message: `PPTX has ${slideFiles.length} slide(s); DeckIR expects ${deck.slides.length}.`,
      expected: deck.slides.length,
      actual: slideFiles.length,
    });
  }

  const canvas = getCanvas(deck);
  const inspectedSlides: InspectedSlide[] = [];
  let expectedEditableObjects = 0;
  let verifiedNativeObjects = 0;

  for (const [index, fileName] of slideFiles.entries()) {
    const file = zip.file(fileName);
    if (!file) {
      continue;
    }
    const xml = await file.async("string");
    let document: UnknownRecord;
    try {
      document = asRecord(parser.parse(xml));
    } catch (error) {
      issues.push({
        severity: "error",
        code: "slide.invalid-xml",
        message: `Unable to parse ${fileName}: ${errorMessage(error)}`,
        slideNumber: index + 1,
      });
      continue;
    }

    const relationships = await readRelationships(
      zip,
      relationshipPath(fileName),
      issues,
      index + 1,
    );
    const actualObjects = inspectSlideObjects(document, canvas, relationships);
    await inspectMediaRelationships(
      zip,
      fileName,
      actualObjects,
      relationships,
      contentTypes,
      issues,
      deck?.slides[index]?.id,
      index + 1,
    );
    const notesRelationship = relationships.find((relationship) =>
      relationship.type.endsWith("/notesSlide"),
    );
    const notesFile = notesRelationship
      ? resolveRelationshipTarget(fileName, notesRelationship.target)
      : undefined;
    const notesText = notesFile
      ? await readNotesText(zip, notesFile, issues, index + 1)
      : undefined;
    const expectedSlide = deck?.slides[index];

    verifyDuplicateNames(actualObjects, issues, expectedSlide?.id, index + 1);
    verifyChartRelationships(
      zip,
      fileName,
      actualObjects,
      relationships,
      issues,
      expectedSlide?.id,
      index + 1,
    );

    if (expectedSlide) {
      const defaultFont = readDefaultBodyFont(deck?.theme);
      const expectedElements = flattenExpectedElements(
        expectedSlide.id,
        expectedSlide.elements,
        defaultFont,
        canvas,
      );
      expectedEditableObjects += expectedElements.length;
      verifiedNativeObjects += verifyExpectedObjects(
        expectedElements,
        actualObjects,
        options,
        issues,
        expectedSlide.id,
        index + 1,
      );
      verifyNotes(
        expectedSlide.notes,
        notesFile,
        notesText,
        issues,
        expectedSlide.id,
        index + 1,
      );
    }

    verifyFullSlideImages(
      actualObjects,
      expectedSlide
        ? flattenExpectedElements(
            expectedSlide.id,
            expectedSlide.elements,
            undefined,
            canvas,
          )
        : [],
      canvas,
      options,
      issues,
      expectedSlide?.id,
      index + 1,
    );

    inspectedSlides.push({
      slideNumber: index + 1,
      slideId: expectedSlide?.id,
      fileName,
      objects: actualObjects.map(({ source: _source, ...object }) => object),
      notesFile,
      notesText,
    });
  }

  if (options.strictEditable && deck) {
    for (const slide of deck.slides) {
      walkElements(slide.elements, (candidate) => {
        const element = asRecord(candidate);
        const id = stringValue(element.id);
        if (element.editable === false || stringValue(element.fallbackReason)) {
          issues.push({
            severity: "error",
            code: "strict.non-editable-element",
            message: `DeckIR element ${id || "(missing ID)"} is not editable.`,
            slideId: slide.id,
            elementId: id || undefined,
          });
        }
      });
    }
  }

  const semanticHash = createSemanticHash(inspectedSlides);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  return {
    valid: errorCount === 0,
    slideCount: slideFiles.length,
    notesSlideCount: notesFiles.length,
    expectedEditableObjects,
    verifiedNativeObjects,
    nativeEditabilityRate:
      expectedEditableObjects === 0
        ? 1
        : verifiedNativeObjects / expectedEditableObjects,
    semanticHash,
    issues,
    slides: inspectedSlides,
  };
}

export async function assertPptx(
  input: PptxInput,
  deck?: PptxDeckInput,
  options: InspectPptxOptions = {},
): Promise<PptxInspectionReport> {
  const report = await inspectPptx(input, deck, options);
  if (!report.valid) {
    throw new PptxInspectionError(report);
  }
  return report;
}

function inspectSlideObjects(
  document: UnknownRecord,
  canvas: CanvasMetrics,
  relationships: Relationship[],
): InspectedObjectInternal[] {
  const slide = asRecord(document["p:sld"]);
  const commonSlideData = asRecord(slide["p:cSld"]);
  const shapeTree = asRecord(commonSlideData["p:spTree"]);
  const result: InspectedObjectInternal[] = [];

  for (const shape of asArray(shapeTree["p:sp"])) {
    const source = asRecord(shape);
    const nonVisual = asRecord(source["p:nvSpPr"]);
    const nonVisualProperties = asRecord(nonVisual["p:cNvPr"]);
    const nonVisualShapeProperties = asRecord(nonVisual["p:cNvSpPr"]);
    const shapeProperties = asRecord(source["p:spPr"]);
    const geometry = asRecord(shapeProperties["a:prstGeom"]);
    const isLine = stringValue(geometry["@_prst"]) === "line";
    const isTextBox = booleanAttribute(nonVisualShapeProperties["@_txBox"]);
    result.push(
      createInspectedObject({
        name: stringValue(nonVisualProperties["@_name"]),
        nativeKind: isLine ? "line" : isTextBox ? "text" : "shape",
        ooxmlElement: "p:sp",
        xfrm: asRecord(shapeProperties["a:xfrm"]),
        textContainer: source["p:txBody"],
        source,
        canvas,
      }),
    );
  }

  for (const connector of asArray(shapeTree["p:cxnSp"])) {
    const source = asRecord(connector);
    const nonVisual = asRecord(source["p:nvCxnSpPr"]);
    const nonVisualProperties = asRecord(nonVisual["p:cNvPr"]);
    const shapeProperties = asRecord(source["p:spPr"]);
    result.push(
      createInspectedObject({
        name: stringValue(nonVisualProperties["@_name"]),
        nativeKind: "connector",
        ooxmlElement: "p:cxnSp",
        xfrm: asRecord(shapeProperties["a:xfrm"]),
        source,
        canvas,
      }),
    );
  }

  for (const picture of asArray(shapeTree["p:pic"])) {
    const source = asRecord(picture);
    const nonVisual = asRecord(source["p:nvPicPr"]);
    const nonVisualProperties = asRecord(nonVisual["p:cNvPr"]);
    const applicationNonVisualProperties = asRecord(nonVisual["p:nvPr"]);
    const mediaFile = asRecord(
      applicationNonVisualProperties["a:audioFile"] ??
        applicationNonVisualProperties["a:videoFile"],
    );
    const mediaRelationshipId = stringValue(mediaFile["@_r:link"]);
    const mediaRelationship = relationships.find(
      (relationship) => relationship.id === mediaRelationshipId,
    );
    const captionTracks = collectValuesForKey(source, "p173:track");
    const captionTrack = asRecord(captionTracks[0]);
    const mediaKind: NativeObjectKind = mediaRelationship?.type.endsWith("/audio")
      ? "audio"
      : mediaRelationship?.type.endsWith("/video")
        ? "video"
        : "image";
    const shapeProperties = asRecord(source["p:spPr"]);
    result.push(
      createInspectedObject({
        name: stringValue(nonVisualProperties["@_name"]),
        nativeKind: mediaKind,
        ooxmlElement: "p:pic",
        xfrm: asRecord(shapeProperties["a:xfrm"]),
        relationshipId: mediaRelationshipId,
        captionTrackPresent: captionTracks.length > 0,
        captionRelationshipId: stringValue(captionTrack["@_r:embed"]),
        captionLanguage: stringValue(captionTrack["@_lang"]),
        captionLabel: stringValue(captionTrack["@_label"]),
        source,
        canvas,
      }),
    );
  }

  for (const graphicFrame of asArray(shapeTree["p:graphicFrame"])) {
    const source = asRecord(graphicFrame);
    const nonVisual = asRecord(source["p:nvGraphicFramePr"]);
    const nonVisualProperties = asRecord(nonVisual["p:cNvPr"]);
    const graphic = asRecord(source["a:graphic"]);
    const graphicData = asRecord(graphic["a:graphicData"]);
    const uri = stringValue(graphicData["@_uri"]);
    const kind: NativeObjectKind =
      uri === TABLE_RELATIONSHIP_URI || graphicData["a:tbl"]
        ? "table"
        : uri === CHART_RELATIONSHIP_URI || graphicData["c:chart"]
          ? "chart"
          : "unknown";
    const chart = asRecord(graphicData["c:chart"]);
    result.push(
      createInspectedObject({
        name: stringValue(nonVisualProperties["@_name"]),
        nativeKind: kind,
        ooxmlElement: "p:graphicFrame",
        xfrm: asRecord(source["p:xfrm"]),
        textContainer: kind === "table" ? graphicData["a:tbl"] : undefined,
        relationshipId: stringValue(chart["@_r:id"]),
        source,
        canvas,
      }),
    );
  }
  return result;
}

function createInspectedObject(input: {
  name: string;
  nativeKind: NativeObjectKind;
  ooxmlElement: InspectedObject["ooxmlElement"];
  xfrm: UnknownRecord;
  textContainer?: unknown;
  relationshipId?: string;
  captionTrackPresent?: boolean;
  captionRelationshipId?: string;
  captionLanguage?: string;
  captionLabel?: string;
  source: UnknownRecord;
  canvas: CanvasMetrics;
}): InspectedObjectInternal {
  const textRuns = input.textContainer ? collectTextRuns(input.textContainer) : [];
  const text = input.textContainer
    ? extractParagraphText(input.textContainer)
    : undefined;
  return {
    name: input.name,
    nativeKind: input.nativeKind,
    ooxmlElement: input.ooxmlElement,
    logicalFrame: readLogicalFrame(input.xfrm, input.canvas),
    rotation: readRotation(input.xfrm),
    text,
    textRuns,
    relationshipId: input.relationshipId || undefined,
    captionTrackPresent: input.captionTrackPresent || undefined,
    captionRelationshipId: input.captionRelationshipId || undefined,
    captionLanguage: input.captionLanguage || undefined,
    captionLabel: input.captionLabel || undefined,
    source: input.source,
  };
}

function verifyExpectedObjects(
  expectedElements: ExpectedElement[],
  actualObjects: InspectedObjectInternal[],
  options: InspectPptxOptions,
  issues: InspectionIssue[],
  slideId: string,
  slideNumber: number,
): number {
  const actualByName = new Map(actualObjects.map((object) => [object.name, object]));
  let verified = 0;
  for (const expected of expectedElements) {
    const actual = actualByName.get(expected.name);
    if (!actual) {
      issues.push({
        severity: "error",
        code: "element.missing-object",
        message: `No PowerPoint object is named ${expected.name}.`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
      });
      continue;
    }
    const expectedKind = expectedNativeKind(expected.type);
    if (actual.nativeKind !== expectedKind) {
      issues.push({
        severity: "error",
        code: "element.wrong-native-kind",
        message: `${expected.name} is ${actual.nativeKind}; expected native ${expectedKind}.`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
        expected: expectedKind,
        actual: actual.nativeKind,
      });
      continue;
    }

    let elementValid = true;
    const frameTolerance = options.frameTolerance ?? 1;
    if (
      !actual.logicalFrame ||
      !framesEqual(expected.frame, actual.logicalFrame, frameTolerance)
    ) {
      issues.push({
        severity: "error",
        code: "element.frame-mismatch",
        message: `${expected.name} does not match its DeckIR frame within ${frameTolerance} logical unit(s).`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
        expected: expected.frame,
        actual: actual.logicalFrame,
      });
      elementValid = false;
    }
    if (
      Math.abs(
        normalizeRotation(expected.rotation) - normalizeRotation(actual.rotation ?? 0),
      ) > 0.001
    ) {
      issues.push({
        severity: "error",
        code: "element.rotation-mismatch",
        message: `${expected.name} rotation differs from DeckIR.`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
        expected: expected.rotation,
        actual: actual.rotation,
      });
      elementValid = false;
    }
    if (
      (options.compareText ?? true) &&
      expected.text !== undefined &&
      normalizeText(expected.text) !== normalizeText(actual.text ?? "")
    ) {
      issues.push({
        severity: "error",
        code: "text.content-mismatch",
        message: `${expected.name} text differs from DeckIR.`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
        expected: expected.text,
        actual: actual.text,
      });
      elementValid = false;
    }
    if ((options.compareTextStyles ?? true) && expected.textRuns.length > 0) {
      elementValid =
        verifyTextRuns(expected, actual, issues, slideId, slideNumber) && elementValid;
    }
    if (expected.type === "video" || expected.type === "audio") {
      elementValid =
        verifyExpectedMedia(expected, actual, issues, slideId, slideNumber) &&
        elementValid;
    }
    if (elementValid) {
      verified += 1;
    }
  }

  if (options.strictEditable) {
    const expectedNames = new Set(expectedElements.map((element) => element.name));
    for (const object of actualObjects) {
      if (object.name.startsWith("lt:") && !expectedNames.has(object.name)) {
        issues.push({
          severity: "error",
          code: "strict.unexpected-object",
          message: `Unexpected generated object ${object.name}.`,
          slideId,
          slideNumber,
          objectName: object.name,
        });
      }
    }
  }
  return verified;
}

function verifyExpectedMedia(
  expected: ExpectedElement,
  actual: InspectedObjectInternal,
  issues: InspectionIssue[],
  slideId: string,
  slideNumber: number,
): boolean {
  let valid = true;
  const comparisons = [
    {
      property: "mimeType",
      expected: expected.mimeType,
      actual: actual.mediaMimeType,
    },
    {
      property: "byteLength",
      expected: expected.byteLength,
      actual: actual.mediaByteLength,
    },
    {
      property: "contentHash",
      expected: expected.contentHash,
      actual: actual.mediaContentHash,
    },
  ] as const;
  for (const comparison of comparisons) {
    if (
      comparison.expected !== undefined &&
      comparison.expected !== comparison.actual
    ) {
      issues.push({
        severity: "error",
        code: `media.${comparison.property}-mismatch`,
        message: `${expected.name} embedded media ${comparison.property} differs from DeckIR.`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
        expected: comparison.expected,
        actual: comparison.actual,
      });
      valid = false;
    }
  }
  if (expected.captionSrc) {
    valid =
      verifyExpectedCaption(expected, actual, issues, slideId, slideNumber) && valid;
  }
  return valid;
}

function verifyExpectedCaption(
  expected: ExpectedElement,
  actual: InspectedObjectInternal,
  issues: InspectionIssue[],
  slideId: string,
  slideNumber: number,
): boolean {
  if (!actual.captionTrackPresent) {
    issues.push({
      severity: "error",
      code: "caption.missing-track",
      message: `${expected.name} has captions in DeckIR but no p173:track in its PowerPoint picture.`,
      slideId,
      slideNumber,
      elementId: expected.id,
      objectName: expected.name,
    });
    return false;
  }

  let valid = true;
  const comparisons = [
    {
      property: "contentHash",
      expected: expected.captionContentHash,
      actual: actual.captionContentHash,
    },
    {
      property: "language",
      expected: expected.captionLanguage,
      actual: actual.captionLanguage,
    },
    {
      property: "label",
      expected: expected.captionLabel,
      actual: actual.captionLabel,
    },
  ] as const;
  for (const comparison of comparisons) {
    if (
      comparison.expected !== undefined &&
      comparison.expected !== comparison.actual
    ) {
      issues.push({
        severity: "error",
        code: `caption.${comparison.property}-mismatch`,
        message: `${expected.name} embedded caption ${comparison.property} differs from DeckIR.`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
        expected: comparison.expected,
        actual: comparison.actual,
      });
      valid = false;
    }
  }
  return valid;
}

function verifyTextRuns(
  expected: ExpectedElement,
  actual: InspectedObjectInternal,
  issues: InspectionIssue[],
  slideId: string,
  slideNumber: number,
): boolean {
  const actualRuns = actual.textRuns ?? [];
  let valid = true;
  for (const [index, expectedRun] of expected.textRuns.entries()) {
    const actualRun = actualRuns[index];
    if (!actualRun) {
      issues.push({
        severity: "error",
        code: "text.missing-run",
        message: `${expected.name} is missing text run ${index + 1}.`,
        slideId,
        slideNumber,
        elementId: expected.id,
        objectName: expected.name,
      });
      valid = false;
      continue;
    }
    const comparisons: Array<[keyof ExpectedTextRun, unknown, unknown]> = [
      ["fontFace", expectedRun.fontFace, actualRun.fontFace],
      ["fontSize", expectedRun.fontSize, actualRun.fontSize],
      [
        "color",
        normalizeOptionalColor(expectedRun.color),
        normalizeOptionalColor(actualRun.color),
      ],
      ["bold", expectedRun.bold, actualRun.bold],
      ["italic", expectedRun.italic, actualRun.italic],
    ];
    for (const [property, expectedValue, actualValue] of comparisons) {
      if (expectedValue !== undefined && expectedValue !== actualValue) {
        issues.push({
          severity: "error",
          code: `text.${property}-mismatch`,
          message: `${expected.name} run ${index + 1} ${property} differs from DeckIR.`,
          slideId,
          slideNumber,
          elementId: expected.id,
          objectName: expected.name,
          expected: expectedValue,
          actual: actualValue,
        });
        valid = false;
      }
    }
  }
  return valid;
}

function verifyChartRelationships(
  zip: JSZip,
  slideFile: string,
  objects: InspectedObjectInternal[],
  relationships: Relationship[],
  issues: InspectionIssue[],
  slideId: string | undefined,
  slideNumber: number,
): void {
  for (const object of objects) {
    if (object.nativeKind !== "chart") {
      continue;
    }
    const relationship = relationships.find(
      (item) => item.id === object.relationshipId,
    );
    if (!relationship?.type.endsWith("/chart")) {
      issues.push({
        severity: "error",
        code: "chart.missing-relationship",
        message: `Chart ${object.name} has no chart relationship.`,
        slideId,
        slideNumber,
        objectName: object.name,
        actual: object.relationshipId,
      });
      continue;
    }
    const target = resolveRelationshipTarget(slideFile, relationship.target);
    if (!zip.file(target)) {
      issues.push({
        severity: "error",
        code: "chart.missing-part",
        message: `Chart ${object.name} relationship target is missing: ${target}`,
        slideId,
        slideNumber,
        objectName: object.name,
        actual: target,
      });
    }
  }
}

async function inspectMediaRelationships(
  zip: JSZip,
  slideFile: string,
  objects: InspectedObjectInternal[],
  relationships: Relationship[],
  contentTypes: PackageContentTypes,
  issues: InspectionIssue[],
  slideId: string | undefined,
  slideNumber: number,
): Promise<void> {
  for (const object of objects) {
    if (object.nativeKind !== "video" && object.nativeKind !== "audio") {
      continue;
    }
    await inspectCaptionRelationship(
      zip,
      slideFile,
      object,
      relationships,
      contentTypes,
      issues,
      slideId,
      slideNumber,
    );
    const relationship = relationships.find(
      (candidate) => candidate.id === object.relationshipId,
    );
    const expectedRelationshipSuffix = `/${object.nativeKind}`;
    if (!relationship?.type.endsWith(expectedRelationshipSuffix)) {
      issues.push({
        severity: "error",
        code: "media.missing-relationship",
        message: `${object.nativeKind} ${object.name} has no ${object.nativeKind} relationship.`,
        slideId,
        slideNumber,
        objectName: object.name,
        actual: object.relationshipId,
      });
      continue;
    }

    const target = resolveRelationshipTarget(slideFile, relationship.target);
    object.mediaTarget = target;
    object.mediaMimeType = mediaMimeType(target, object.nativeKind);
    if (!object.mediaMimeType) {
      issues.push({
        severity: "error",
        code: "media.unsupported-format",
        message: `${object.nativeKind} ${object.name} uses an unsupported media format: ${target}`,
        slideId,
        slideNumber,
        objectName: object.name,
        actual: target,
      });
    }

    const mediaPart = zip.file(target);
    if (!mediaPart) {
      issues.push({
        severity: "error",
        code: "media.missing-part",
        message: `${object.nativeKind} ${object.name} relationship target is missing: ${target}`,
        slideId,
        slideNumber,
        objectName: object.name,
        actual: target,
      });
      continue;
    }

    const secondaryRelationship = relationships.find(
      (candidate) =>
        candidate.type ===
          "http://schemas.microsoft.com/office/2007/relationships/media" &&
        resolveRelationshipTarget(slideFile, candidate.target) === target,
    );
    if (!secondaryRelationship) {
      issues.push({
        severity: "error",
        code: "media.missing-office-relationship",
        message: `${object.nativeKind} ${object.name} has no Office media relationship.`,
        slideId,
        slideNumber,
        objectName: object.name,
        actual: target,
      });
    }

    const bytes = await mediaPart.async("uint8array");
    object.mediaByteLength = bytes.byteLength;
    object.mediaContentHash = createHash("sha256").update(bytes).digest("hex");
  }
}

async function inspectCaptionRelationship(
  zip: JSZip,
  slideFile: string,
  object: InspectedObjectInternal,
  relationships: Relationship[],
  contentTypes: PackageContentTypes,
  issues: InspectionIssue[],
  slideId: string | undefined,
  slideNumber: number,
): Promise<void> {
  if (!object.captionTrackPresent) {
    return;
  }
  const elementId = elementIdFromObjectName(object.name, slideId);
  if (!object.captionRelationshipId) {
    issues.push({
      severity: "error",
      code: "caption.missing-embed",
      message: `${object.nativeKind} ${object.name} has a p173:track without r:embed.`,
      slideId,
      slideNumber,
      elementId,
      objectName: object.name,
    });
    return;
  }

  const relationship = relationships.find(
    (candidate) => candidate.id === object.captionRelationshipId,
  );
  object.captionRelationshipType = relationship?.type;
  if (!relationship) {
    issues.push({
      severity: "error",
      code: "caption.missing-relationship",
      message: `${object.nativeKind} ${object.name} caption r:embed has no slide relationship.`,
      slideId,
      slideNumber,
      elementId,
      objectName: object.name,
      actual: object.captionRelationshipId,
    });
    return;
  }
  if (relationship.type !== TRACK_RELATIONSHIP_URI) {
    issues.push({
      severity: "error",
      code: "caption.relationship-type-mismatch",
      message: `${object.nativeKind} ${object.name} caption relationship does not use the PowerPoint track relationship type.`,
      slideId,
      slideNumber,
      elementId,
      objectName: object.name,
      expected: TRACK_RELATIONSHIP_URI,
      actual: relationship.type,
    });
  }

  const target = resolveRelationshipTarget(slideFile, relationship.target);
  object.captionTarget = target;
  object.captionMimeType = contentTypeForPart(contentTypes, target);
  if (object.captionMimeType !== "text/vtt") {
    issues.push({
      severity: "error",
      code: "caption.content-type-mismatch",
      message: `${object.nativeKind} ${object.name} caption part does not use text/vtt.`,
      slideId,
      slideNumber,
      elementId,
      objectName: object.name,
      expected: "text/vtt",
      actual: object.captionMimeType,
    });
  }

  const captionPart = zip.file(target);
  if (!captionPart) {
    issues.push({
      severity: "error",
      code: "caption.missing-part",
      message: `${object.nativeKind} ${object.name} caption relationship target is missing: ${target}`,
      slideId,
      slideNumber,
      elementId,
      objectName: object.name,
      actual: target,
    });
    return;
  }
  const bytes = await captionPart.async("uint8array");
  object.captionContentHash = createHash("sha256").update(bytes).digest("hex");
}

function elementIdFromObjectName(
  objectName: string,
  slideId: string | undefined,
): string | undefined {
  if (!slideId) return undefined;
  const prefix = `lt:${slideId}:`;
  return objectName.startsWith(prefix) ? objectName.slice(prefix.length) : undefined;
}

function mediaMimeType(
  target: string,
  kind: "video" | "audio",
): InspectedObject["mediaMimeType"] {
  const extension = path.extname(target).toLowerCase();
  if (kind === "video" && extension === ".mp4") {
    return "video/mp4";
  }
  if (kind === "audio" && extension === ".m4a") {
    return "audio/mp4";
  }
  if (kind === "audio" && extension === ".mp3") {
    return "audio/mpeg";
  }
  return undefined;
}

function verifyDuplicateNames(
  objects: InspectedObjectInternal[],
  issues: InspectionIssue[],
  slideId: string | undefined,
  slideNumber: number,
): void {
  const names = new Set<string>();
  for (const object of objects) {
    if (!object.name) {
      issues.push({
        severity: "error",
        code: "object.missing-name",
        message: "A slide object has no selection-pane name.",
        slideId,
        slideNumber,
        actual: object.ooxmlElement,
      });
      continue;
    }
    if (names.has(object.name)) {
      issues.push({
        severity: "error",
        code: "object.duplicate-name",
        message: `Duplicate PowerPoint object name: ${object.name}`,
        slideId,
        slideNumber,
        objectName: object.name,
      });
    }
    names.add(object.name);
  }
}

function verifyNotes(
  notes: PptxDeckInput["slides"][number]["notes"],
  notesFile: string | undefined,
  actualText: string | undefined,
  issues: InspectionIssue[],
  slideId: string,
  slideNumber: number,
): void {
  const expectedText = formatExpectedNotes(notes);
  if (!expectedText) {
    return;
  }
  if (!notesFile) {
    issues.push({
      severity: "error",
      code: "notes.missing-relationship",
      message: "DeckIR contains speaker notes but the slide has no notes relationship.",
      slideId,
      slideNumber,
      expected: expectedText,
    });
    return;
  }
  if (normalizeText(expectedText) !== normalizeText(actualText ?? "")) {
    issues.push({
      severity: "error",
      code: "notes.content-mismatch",
      message: "PowerPoint speaker notes differ from DeckIR notes.",
      slideId,
      slideNumber,
      expected: expectedText,
      actual: actualText,
    });
  }
}

function verifyFullSlideImages(
  objects: InspectedObjectInternal[],
  expected: ExpectedElement[],
  canvas: CanvasMetrics,
  options: InspectPptxOptions,
  issues: InspectionIssue[],
  slideId: string | undefined,
  slideNumber: number,
): void {
  const threshold = options.fullSlideImageThreshold ?? 0.95;
  const expectedByName = new Map(expected.map((element) => [element.name, element]));
  for (const object of objects) {
    if (
      object.nativeKind !== "image" ||
      !object.logicalFrame ||
      object.name.startsWith("background:")
    ) {
      continue;
    }
    const frame = object.logicalFrame;
    const intersectionWidth = Math.max(
      0,
      Math.min(canvas.width, frame.x + frame.w) - Math.max(0, frame.x),
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(canvas.height, frame.y + frame.h) - Math.max(0, frame.y),
    );
    const coverage =
      (intersectionWidth * intersectionHeight) / (canvas.width * canvas.height);
    const expectedImage = expectedByName.get(object.name);
    if (coverage >= threshold && expectedImage?.role !== "background") {
      issues.push({
        severity: "error",
        code: "image.implicit-full-slide-raster",
        message: `Image ${object.name} covers ${(coverage * 100).toFixed(1)}% of the slide without role: background.`,
        slideId,
        slideNumber,
        elementId: expectedImage?.id,
        objectName: object.name,
        actual: coverage,
      });
    }
  }
}

async function readRelationships(
  zip: JSZip,
  fileName: string,
  issues: InspectionIssue[],
  slideNumber: number,
): Promise<Relationship[]> {
  const file = zip.file(fileName);
  if (!file) {
    issues.push({
      severity: "error",
      code: "slide.missing-relationships",
      message: `Slide relationships part is missing: ${fileName}`,
      slideNumber,
    });
    return [];
  }
  try {
    const document = asRecord(parser.parse(await file.async("string")));
    const root = asRecord(document.Relationships);
    return asArray(root.Relationship).map((candidate) => {
      const relationship = asRecord(candidate);
      return {
        id: stringValue(relationship["@_Id"]),
        type: stringValue(relationship["@_Type"]),
        target: stringValue(relationship["@_Target"]),
      };
    });
  } catch (error) {
    issues.push({
      severity: "error",
      code: "slide.invalid-relationships",
      message: `Unable to parse ${fileName}: ${errorMessage(error)}`,
      slideNumber,
    });
    return [];
  }
}

async function readPackageContentTypes(
  zip: JSZip,
  issues: InspectionIssue[],
): Promise<PackageContentTypes> {
  const contentTypes: PackageContentTypes = {
    defaults: new Map(),
    overrides: new Map(),
  };
  const file = zip.file("[Content_Types].xml");
  if (!file) {
    return contentTypes;
  }
  try {
    const document = asRecord(parser.parse(await file.async("string")));
    const root = asRecord(document.Types);
    for (const candidate of asArray(root.Default)) {
      const entry = asRecord(candidate);
      const extension = stringValue(entry["@_Extension"]).toLowerCase();
      const contentType = stringValue(entry["@_ContentType"]);
      if (extension && contentType) {
        contentTypes.defaults.set(extension, contentType);
      }
    }
    for (const candidate of asArray(root.Override)) {
      const entry = asRecord(candidate);
      const partName = stringValue(entry["@_PartName"]);
      const contentType = stringValue(entry["@_ContentType"]);
      if (partName && contentType) {
        contentTypes.overrides.set(
          partName.startsWith("/") ? partName : `/${partName}`,
          contentType,
        );
      }
    }
  } catch (error) {
    issues.push({
      severity: "error",
      code: "package.invalid-content-types",
      message: `Unable to parse [Content_Types].xml: ${errorMessage(error)}`,
    });
  }
  return contentTypes;
}

function contentTypeForPart(
  contentTypes: PackageContentTypes,
  target: string,
): string | undefined {
  const normalizedTarget = target.startsWith("/") ? target : `/${target}`;
  const override = contentTypes.overrides.get(normalizedTarget);
  if (override) return override;
  const extension = path.posix.extname(target).slice(1).toLowerCase();
  return extension ? contentTypes.defaults.get(extension) : undefined;
}

async function readNotesText(
  zip: JSZip,
  fileName: string,
  issues: InspectionIssue[],
  slideNumber: number,
): Promise<string | undefined> {
  const file = zip.file(fileName);
  if (!file) {
    issues.push({
      severity: "error",
      code: "notes.missing-part",
      message: `Notes relationship target is missing: ${fileName}`,
      slideNumber,
    });
    return undefined;
  }
  try {
    const document = asRecord(parser.parse(await file.async("string")));
    const notes = asRecord(document["p:notes"]);
    const commonSlideData = asRecord(notes["p:cSld"]);
    const shapeTree = asRecord(commonSlideData["p:spTree"]);
    for (const candidate of asArray(shapeTree["p:sp"])) {
      const shape = asRecord(candidate);
      const nonVisual = asRecord(shape["p:nvSpPr"]);
      const nonVisualProperties = asRecord(nonVisual["p:nvPr"]);
      const placeholder = asRecord(nonVisualProperties["p:ph"]);
      if (stringValue(placeholder["@_type"]) === "body") {
        return extractParagraphText(shape["p:txBody"]);
      }
    }
    return "";
  } catch (error) {
    issues.push({
      severity: "error",
      code: "notes.invalid-xml",
      message: `Unable to parse ${fileName}: ${errorMessage(error)}`,
      slideNumber,
    });
    return undefined;
  }
}

function flattenExpectedElements(
  slideId: string,
  elements: ReadonlyArray<unknown>,
  defaultFont: string | undefined,
  canvas: CanvasMetrics,
  parent?: {
    frame: LogicalFrame;
    coordinateSpace: "absolute" | "relative";
    rotation: number;
  },
): ExpectedElement[] {
  const result: ExpectedElement[] = [];
  for (const candidate of elements) {
    const element = asRecord(candidate);
    const id = stringValue(element.id);
    const type = stringValue(element.type ?? element.kind);
    let frame = readExpectedFrame(element.frame);
    let rotation = numberValue(element.rotation) ?? 0;
    if (parent) {
      rotation += parent.rotation;
      if (parent.coordinateSpace === "relative") {
        frame = {
          x: parent.frame.x + frame.x,
          y: parent.frame.y + frame.y,
          w: frame.w,
          h: frame.h,
        };
      }
    }
    if (type === "group") {
      result.push(
        ...flattenExpectedElements(
          slideId,
          asArray(element.elements ?? element.children),
          defaultFont,
          canvas,
          {
            frame,
            coordinateSpace:
              stringValue(element.coordinateSpace) === "relative"
                ? "relative"
                : "absolute",
            rotation,
          },
        ),
      );
      continue;
    }
    const text = expectedElementText(element, type);
    result.push({
      id,
      name: `lt:${slideId}:${id}`,
      type,
      frame,
      rotation,
      editable: element.editable !== false,
      role: stringValue(element.role) || undefined,
      text,
      textRuns: expectedTextRuns(element, type, defaultFont, canvas),
      mimeType: stringValue(element.mimeType) || undefined,
      byteLength: numberValue(element.byteLength),
      contentHash: stringValue(element.contentHash) || undefined,
      captionSrc: stringValue(element.captionSrc) || undefined,
      captionContentHash: stringValue(element.captionContentHash) || undefined,
      captionLanguage: stringValue(element.captionLanguage) || undefined,
      captionLabel: stringValue(element.captionLabel) || undefined,
    });
  }
  return result;
}

function expectedElementText(element: UnknownRecord, type: string): string | undefined {
  if (type === "text" || type === "shape") {
    const paragraphs = asArray(element.paragraphs);
    if (paragraphs.length > 0) {
      return paragraphs
        .map((candidate) => {
          const paragraph = asRecord(candidate);
          const runs = asArray(paragraph.runs);
          if (runs.length > 0) {
            return runs.map((run) => stringValue(asRecord(run).text)).join("");
          }
          return stringValue(paragraph.text);
        })
        .join("\n");
    }
    return typeof element.text === "string" ? element.text : undefined;
  }
  if (type === "table") {
    return asArray(element.rows)
      .flatMap((rowCandidate) => {
        const row = Array.isArray(rowCandidate)
          ? rowCandidate
          : asArray(asRecord(rowCandidate).cells);
        return row.map((cell) => {
          if (typeof cell === "string") {
            return cell;
          }
          const cellRecord = asRecord(cell);
          if (typeof cellRecord.text === "string") {
            return cellRecord.text;
          }
          return asArray(cellRecord.paragraphs)
            .map((paragraphCandidate) => {
              const paragraph = asRecord(paragraphCandidate);
              return asArray(paragraph.runs)
                .map((run) => stringValue(asRecord(run).text))
                .join("");
            })
            .join("\n");
        });
      })
      .join("\n");
  }
  return undefined;
}

function expectedTextRuns(
  element: UnknownRecord,
  type: string,
  defaultFont: string | undefined,
  canvas: CanvasMetrics,
): ExpectedTextRun[] {
  if (type !== "text" && type !== "shape") {
    return [];
  }
  const baseStyle = asRecord(type === "shape" ? element.textStyle : element.style);
  const paragraphs = asArray(element.paragraphs);
  if (paragraphs.length === 0) {
    const text = stringValue(element.text);
    return text ? [expectedRun(text, baseStyle, defaultFont, canvas)] : [];
  }
  const result: ExpectedTextRun[] = [];
  for (const paragraphCandidate of paragraphs) {
    const paragraph = asRecord(paragraphCandidate);
    const paragraphStyle = { ...baseStyle, ...paragraph };
    const runs = asArray(paragraph.runs);
    if (runs.length === 0) {
      result.push(
        expectedRun(stringValue(paragraph.text), paragraphStyle, defaultFont, canvas),
      );
      continue;
    }
    for (const runCandidate of runs) {
      const run = asRecord(runCandidate);
      result.push(
        expectedRun(
          stringValue(run.text),
          { ...paragraphStyle, ...run },
          defaultFont,
          canvas,
        ),
      );
    }
  }
  return result;
}

function expectedRun(
  text: string,
  style: UnknownRecord,
  defaultFont: string | undefined,
  canvas: CanvasMetrics,
): ExpectedTextRun {
  return {
    text,
    fontFace: stringValue(style.fontFace) || defaultFont,
    fontSize: logicalFontSizeToPoints(numberValue(style.fontSize) ?? 18, canvas),
    color: normalizeOptionalColor(stringValue(style.color) || "000000"),
    bold: booleanValue(style.bold) ?? (numberValue(style.fontWeight) ?? 400) >= 600,
    italic: booleanValue(style.italic) ?? false,
  };
}

function collectTextRuns(candidate: unknown): InspectedTextRun[] {
  const result: InspectedTextRun[] = [];
  visitKey(candidate, "a:r", (runCandidate) => {
    const run = asRecord(runCandidate);
    const runProperties = asRecord(run["a:rPr"]);
    const latin = asRecord(runProperties["a:latin"]);
    const eastAsian = asRecord(runProperties["a:ea"]);
    const solidFill = asRecord(runProperties["a:solidFill"]);
    const color = asRecord(solidFill["a:srgbClr"]);
    result.push({
      text: textValue(run["a:t"]),
      fontFace:
        stringValue(latin["@_typeface"] ?? eastAsian["@_typeface"]) || undefined,
      fontSize: parseFontSize(runProperties["@_sz"]),
      color: stringValue(color["@_val"]) || undefined,
      bold: booleanAttribute(runProperties["@_b"]),
      italic: booleanAttribute(runProperties["@_i"]),
    });
  });
  return result;
}

function extractParagraphText(candidate: unknown): string {
  const container = asRecord(candidate);
  const paragraphs = collectValuesForKey(container, "a:p");
  if (paragraphs.length === 0) {
    return collectValuesForKey(container, "a:t").map(textValue).join("");
  }
  return paragraphs
    .map((paragraphCandidate) => {
      const texts = collectValuesForKey(paragraphCandidate, "a:t");
      return texts.map(textValue).join("");
    })
    .join("\n");
}

function readLogicalFrame(
  transform: UnknownRecord,
  canvas: CanvasMetrics,
): LogicalFrame | undefined {
  const offset = asRecord(transform["a:off"]);
  const extent = asRecord(transform["a:ext"]);
  const x = numericAttribute(offset["@_x"]);
  const y = numericAttribute(offset["@_y"]);
  const w = numericAttribute(extent["@_cx"]);
  const h = numericAttribute(extent["@_cy"]);
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    return undefined;
  }
  return {
    x: ((x / EMU_PER_INCH) * canvas.width) / canvas.widthInch,
    y: ((y / EMU_PER_INCH) * canvas.height) / canvas.heightInch,
    w: ((w / EMU_PER_INCH) * canvas.width) / canvas.widthInch,
    h: ((h / EMU_PER_INCH) * canvas.height) / canvas.heightInch,
  };
}

function readRotation(transform: UnknownRecord): number {
  const raw = numericAttribute(transform["@_rot"]);
  return raw === undefined ? 0 : raw / 60000;
}

function readExpectedFrame(candidate: unknown): LogicalFrame {
  const frame = asRecord(candidate);
  return {
    x: numberValue(frame.x) ?? 0,
    y: numberValue(frame.y) ?? 0,
    w: numberValue(frame.w) ?? 0,
    h: numberValue(frame.h) ?? 0,
  };
}

function expectedNativeKind(type: string): NativeObjectKind {
  if (type === "icon") {
    return "image";
  }
  return [
    "text",
    "shape",
    "line",
    "connector",
    "image",
    "video",
    "audio",
    "table",
    "chart",
  ].includes(type)
    ? (type as NativeObjectKind)
    : "unknown";
}

function framesEqual(
  expected: LogicalFrame,
  actual: LogicalFrame,
  tolerance: number,
): boolean {
  return (["x", "y", "w", "h"] as const).every(
    (key) => Math.abs(expected[key] - actual[key]) <= tolerance,
  );
}

function formatExpectedNotes(notes: PptxDeckInput["slides"][number]["notes"]): string {
  if (!notes) {
    return "";
  }
  const plainText = (notes.plainText ?? notes.markdown ?? "").trim();
  const sources = notes.sources ?? [];
  if (sources.length === 0) {
    return plainText;
  }
  return [
    plainText,
    "[Sources]",
    ...sources.map((source) => {
      const location = source.url ? ` — ${source.url}` : "";
      const detail = source.detail ? ` (${source.detail})` : "";
      return `- ${source.label}${location}${detail}`;
    }),
  ]
    .filter(Boolean)
    .join("\n");
}

function getCanvas(deck: PptxDeckInput | undefined): CanvasMetrics {
  return {
    width: deck?.canvas.width ?? 1920,
    height: deck?.canvas.height ?? 1080,
    widthInch: deck?.canvas.pptxWidthInch ?? DEFAULT_WIDTH_INCH,
    heightInch: deck?.canvas.pptxHeightInch ?? DEFAULT_HEIGHT_INCH,
  };
}

function logicalFontSizeToPoints(fontSize: number, canvas: CanvasMetrics): number {
  return Math.round(((fontSize * canvas.heightInch * 72) / canvas.height) * 100) / 100;
}

function readDefaultBodyFont(themeCandidate: unknown): string | undefined {
  const theme = asRecord(themeCandidate);
  const fonts = asRecord(theme.fonts);
  const body = fonts.body;
  if (typeof body === "string") {
    return body;
  }
  const bodyRecord = asRecord(body);
  return stringValue(bodyRecord.family ?? bodyRecord.fontFace) || undefined;
}

async function loadInput(input: PptxInput): Promise<Uint8Array> {
  if (typeof input === "string") {
    return readFile(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  return new Uint8Array(input);
}

function relationshipPath(slideFile: string): string {
  return path.posix.join(
    path.posix.dirname(slideFile),
    "_rels",
    `${path.posix.basename(slideFile)}.rels`,
  );
}

function resolveRelationshipTarget(sourceFile: string, target: string): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), target));
}

function createSemanticHash(slides: InspectedSlide[]): string {
  const normalized = slides.map((slide) => ({
    slideNumber: slide.slideNumber,
    slideId: slide.slideId,
    objects: slide.objects
      .map((object) => ({
        name: object.name,
        nativeKind: object.nativeKind,
        ooxmlElement: object.ooxmlElement,
        logicalFrame: object.logicalFrame ? roundFrame(object.logicalFrame) : undefined,
        rotation: object.rotation,
        text: object.text,
        textRuns: object.textRuns,
        captionRelationshipType: object.captionRelationshipType,
        captionTarget: object.captionTarget,
        captionMimeType: object.captionMimeType,
        captionContentHash: object.captionContentHash,
        captionLanguage: object.captionLanguage,
        captionLabel: object.captionLabel,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    notesText: slide.notesText,
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function roundFrame(frame: LogicalFrame): LogicalFrame {
  return {
    x: round(frame.x),
    y: round(frame.y),
    w: round(frame.w),
    h: round(frame.h),
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeOptionalColor(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  return value.replace(/^#/, "").toUpperCase();
}

function parseFontSize(value: unknown): number | undefined {
  const number = numericAttribute(value);
  return number === undefined ? undefined : number / 100;
}

function numericAttribute(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanAttribute(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function visitKey(
  candidate: unknown,
  key: string,
  visitor: (value: unknown) => void,
): void {
  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      visitKey(item, key, visitor);
    }
    return;
  }
  if (!candidate || typeof candidate !== "object") {
    return;
  }
  for (const [candidateKey, value] of Object.entries(candidate as UnknownRecord)) {
    if (candidateKey === key) {
      for (const item of asArray(value)) {
        visitor(item);
      }
    }
    visitKey(value, key, visitor);
  }
}

function collectValuesForKey(candidate: unknown, key: string): unknown[] {
  const result: unknown[] = [];
  visitKey(candidate, key, (value) => result.push(value));
  return result;
}

function textValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  const record = asRecord(value);
  return stringValue(record["#text"]);
}

function walkElements(
  elements: ReadonlyArray<unknown>,
  visitor: (element: unknown) => void,
): void {
  for (const element of elements) {
    visitor(element);
    const record = asRecord(element);
    if (stringValue(record.type ?? record.kind) === "group") {
      walkElements(asArray(record.elements ?? record.children), visitor);
    }
  }
}

function failureReport(code: string, message: string): PptxInspectionReport {
  return {
    valid: false,
    slideCount: 0,
    notesSlideCount: 0,
    expectedEditableObjects: 0,
    verifiedNativeObjects: 0,
    nativeEditabilityRate: 0,
    semanticHash: "",
    issues: [{ severity: "error", code, message }],
    slides: [],
  };
}

function numericPartSort(left: string, right: string): number {
  return extractNumericPart(left) - extractNumericPart(right);
}

function extractNumericPart(value: string): number {
  const match = /(\d+)\.xml$/.exec(value);
  return match ? Number(match[1]) : 0;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
