import { TextDecoder } from "node:util";

import type { SecureDeckFile, SecurityIssue } from "./security.js";
import { readSecureDeckFile, SecurityValidationError } from "./security.js";

export const MEDIA_SIZE_WARNING_BYTES = 50 * 1024 * 1024;
export const MAX_MEDIA_ASSET_BYTES = 100 * 1024 * 1024;
export const MAX_CAPTION_ASSET_BYTES = 1024 * 1024;

const VIDEO_FILE_POLICIES = {
  ".mp4": { mimeType: "video/mp4", maxBytes: MAX_MEDIA_ASSET_BYTES },
} as const;

const AUDIO_FILE_POLICIES = {
  ".m4a": { mimeType: "audio/mp4", maxBytes: MAX_MEDIA_ASSET_BYTES },
  ".mp3": { mimeType: "audio/mpeg", maxBytes: MAX_MEDIA_ASSET_BYTES },
} as const;

const CAPTION_FILE_POLICIES = {
  ".vtt": { mimeType: "text/vtt", maxBytes: MAX_CAPTION_ASSET_BYTES },
} as const;

export interface MediaInspectionIssue extends SecurityIssue {
  severity: "error" | "warning";
}

export interface ResolvedMediaFile extends SecureDeckFile {
  issues: MediaInspectionIssue[];
}

export interface ResolvedCaptionFile extends SecureDeckFile {
  mimeType: "text/vtt";
  text: string;
}

interface IsoBox {
  type: string;
  payloadStart: number;
  end: number;
}

function mediaIssue(
  severity: MediaInspectionIssue["severity"],
  code: string,
  message: string,
): MediaInspectionIssue {
  return { severity, code, message };
}

export function mediaSizeIssues(byteLength: number): MediaInspectionIssue[] {
  if (byteLength > MAX_MEDIA_ASSET_BYTES) {
    return [
      mediaIssue(
        "error",
        "ASSET_SIZE_LIMIT_EXCEEDED",
        `Media asset is ${byteLength} bytes; the limit is ${MAX_MEDIA_ASSET_BYTES} bytes`,
      ),
    ];
  }
  if (byteLength > MEDIA_SIZE_WARNING_BYTES) {
    return [
      mediaIssue(
        "warning",
        "MEDIA_FILE_LARGE",
        `Media asset is ${byteLength} bytes; files over ${MEDIA_SIZE_WARNING_BYTES} bytes can make decks slow to open and share`,
      ),
    ];
  }
  return [];
}

function readIsoBoxes(data: Buffer, start: number, end: number): IsoBox[] {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      const extendedSize = data.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, payloadStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function childBoxes(data: Buffer, parent: IsoBox): IsoBox[] {
  return readIsoBoxes(data, parent.payloadStart, parent.end);
}

function handlerType(data: Buffer, handler: IsoBox): string | undefined {
  const offset = handler.payloadStart + 8;
  return offset + 4 <= handler.end
    ? data.subarray(offset, offset + 4).toString("ascii")
    : undefined;
}

function containsFourCc(data: Buffer, values: ReadonlyArray<string>): boolean {
  return values.some((value) => data.includes(Buffer.from(value, "ascii")));
}

export function inspectIsoMedia(
  data: Buffer,
  expectedTrack: "video" | "audio",
): MediaInspectionIssue[] {
  const issues: MediaInspectionIssue[] = [];
  const moov = readIsoBoxes(data, 0, data.byteLength).find(
    (candidate) => candidate.type === "moov",
  );
  if (!moov) {
    return [
      mediaIssue(
        "error",
        "MEDIA_MOOV_BOX_MISSING",
        "MP4/M4A container must include a readable moov box",
      ),
    ];
  }
  const tracks = childBoxes(data, moov).filter(
    (candidate) => candidate.type === "trak",
  );
  if (tracks.length === 0) {
    return [
      mediaIssue(
        "error",
        "MEDIA_TRACK_BOX_MISSING",
        "MP4/M4A container must include at least one trak box",
      ),
    ];
  }
  const handlers = tracks.flatMap((track) => {
    const media = childBoxes(data, track).find(
      (candidate) => candidate.type === "mdia",
    );
    if (!media) return [];
    const handler = childBoxes(data, media).find(
      (candidate) => candidate.type === "hdlr",
    );
    const type = handler ? handlerType(data, handler) : undefined;
    return type ? [type] : [];
  });
  if (handlers.length === 0) {
    return [
      mediaIssue(
        "error",
        "MEDIA_HANDLER_BOX_MISSING",
        "MP4/M4A tracks must include a readable hdlr box",
      ),
    ];
  }
  const requiredHandler = expectedTrack === "video" ? "vide" : "soun";
  if (!handlers.includes(requiredHandler)) {
    return [
      mediaIssue(
        "error",
        "MEDIA_REQUIRED_TRACK_MISSING",
        `${expectedTrack === "video" ? "MP4 video" : "M4A audio"} must include a ${requiredHandler} track`,
      ),
    ];
  }
  if (handlers.includes("vide") && !containsFourCc(data, ["avc1", "avc3"])) {
    issues.push(
      mediaIssue(
        "warning",
        "MEDIA_VIDEO_CODEC_RECOMMENDED",
        "H.264 video (avc1/avc3) is recommended for reliable browser and PowerPoint playback",
      ),
    );
  }
  if (handlers.includes("soun") && !containsFourCc(data, ["mp4a"])) {
    issues.push(
      mediaIssue(
        "warning",
        "MEDIA_AUDIO_CODEC_RECOMMENDED",
        "AAC audio (mp4a) is recommended for reliable browser and PowerPoint playback",
      ),
    );
  }
  return issues;
}

export async function readMediaFile(options: {
  component: "Video" | "Audio";
  deckDirectory: string;
  sourcePath: string;
  reference: string;
}): Promise<ResolvedMediaFile> {
  const isVideo = options.component === "Video";
  const file = await readSecureDeckFile({
    deckDirectory: options.deckDirectory,
    sourcePath: options.sourcePath,
    reference: options.reference,
    allowedExtensions: isVideo ? VIDEO_FILE_POLICIES : AUDIO_FILE_POLICIES,
    defaultMaxBytes: MAX_MEDIA_ASSET_BYTES,
  });
  const issues = mediaSizeIssues(file.data.byteLength);
  if (file.extension === ".mp4" || file.extension === ".m4a") {
    issues.push(...inspectIsoMedia(file.data, isVideo ? "video" : "audio"));
  }
  const errors = issues.filter((candidate) => candidate.severity === "error");
  if (errors.length > 0) {
    throw new SecurityValidationError(
      errors.map(({ code, message }) => ({ code, message })),
    );
  }
  return { ...file, issues };
}

function parseWebVttTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

function hasValidWebVttCueTiming(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const timing = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?\s*$/.exec(line);
    if (!timing) return false;
    const startValue = timing[1];
    const endValue = timing[2];
    if (!startValue || !endValue) return false;
    const start = parseWebVttTimestamp(startValue);
    const end = parseWebVttTimestamp(endValue);
    return start !== undefined && end !== undefined && end > start;
  });
}

export async function readCaptionFile(options: {
  deckDirectory: string;
  sourcePath: string;
  reference: string;
}): Promise<ResolvedCaptionFile> {
  const file = await readSecureDeckFile({
    deckDirectory: options.deckDirectory,
    sourcePath: options.sourcePath,
    reference: options.reference,
    allowedExtensions: CAPTION_FILE_POLICIES,
    defaultMaxBytes: MAX_CAPTION_ASSET_BYTES,
  });

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.data);
  } catch {
    throw new SecurityValidationError([
      {
        code: "CAPTION_UTF8_INVALID",
        message: "WebVTT captions must contain valid UTF-8 text",
      },
    ]);
  }

  const normalizedText = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (!/^WEBVTT(?:[ \t].*)?(?:\r?\n)/.test(normalizedText)) {
    throw new SecurityValidationError([
      {
        code: "CAPTION_WEBVTT_HEADER_INVALID",
        message: 'WebVTT captions must begin with a "WEBVTT" header',
      },
    ]);
  }
  if (!hasValidWebVttCueTiming(normalizedText)) {
    throw new SecurityValidationError([
      {
        code: "CAPTION_TIMING_INVALID",
        message:
          "WebVTT captions must include at least one cue whose end time is after its start time",
      },
    ]);
  }

  return {
    ...file,
    mimeType: "text/vtt",
    text: normalizedText,
  };
}
