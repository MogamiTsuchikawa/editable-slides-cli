import type { FrameIR } from "./types.js";
import { WIDE_CANVAS } from "./types.js";

export interface PptxFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function logicalToPptxX(value: number): number {
  return (value * WIDE_CANVAS.pptxWidthInch) / WIDE_CANVAS.width;
}

export function logicalToPptxY(value: number): number {
  return (value * WIDE_CANVAS.pptxHeightInch) / WIDE_CANVAS.height;
}

export function frameToPptx(frame: FrameIR): PptxFrame {
  return {
    x: logicalToPptxX(frame.x),
    y: logicalToPptxY(frame.y),
    w: logicalToPptxX(frame.w),
    h: logicalToPptxY(frame.h),
  };
}

export function pptxToLogicalX(value: number): number {
  return (value * WIDE_CANVAS.width) / WIDE_CANVAS.pptxWidthInch;
}

export function pptxToLogicalY(value: number): number {
  return (value * WIDE_CANVAS.height) / WIDE_CANVAS.pptxHeightInch;
}
