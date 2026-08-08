import { readFile } from "node:fs/promises";

import {
  BackgroundIRSchema,
  FillIRSchema,
  ResolvedThemeIRSchema,
  StrokeIRSchema,
  TextStyleIRSchema,
} from "@editable-slides/slide-deck-ir";
import type {
  LayoutDefinition,
  LayoutSlotDefinition,
  ThemeDefinition,
} from "@editable-slides/slide-theme-default";

const MAX_DECLARATIVE_THEME_BYTES = 5 * 1024 * 1024;
const TYPOGRAPHY_ROLES = new Set(["title", "heading", "body", "caption", "code"]);
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const PartialTextStyleIRSchema = TextStyleIRSchema.partial();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasUnsafeObjectKey(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > 100_000) return true;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) return true;
      pending.push(child);
    }
  }
  return false;
}

function isFrame(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    finiteNumber(value.x) &&
    finiteNumber(value.y) &&
    finiteNumber(value.w) &&
    value.w > 0 &&
    finiteNumber(value.h) &&
    value.h > 0
  );
}

function isLayoutSlot(value: unknown): value is LayoutSlotDefinition {
  if (!isRecord(value)) return false;
  const allowed = new Set(["frame", "textAlign", "textStyle", "typography", "zIndex"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return (
    isFrame(value.frame) &&
    typeof value.typography === "string" &&
    TYPOGRAPHY_ROLES.has(value.typography) &&
    finiteNumber(value.zIndex) &&
    (value.textAlign === undefined ||
      ["left", "center", "right", "justify"].includes(String(value.textAlign))) &&
    (value.textStyle === undefined ||
      PartialTextStyleIRSchema.safeParse(value.textStyle).success)
  );
}

function isLayout(value: unknown): value is LayoutDefinition {
  if (!isRecord(value) || !isRecord(value.slots)) return false;
  const allowed = new Set(["background", "id", "label", "masterId", "slots"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    typeof value.masterId === "string" &&
    value.masterId.length > 0 &&
    (value.background === undefined ||
      BackgroundIRSchema.safeParse(value.background).success) &&
    Object.values(value.slots).every(isLayoutSlot)
  );
}

function isDefaults(value: unknown): value is ThemeDefinition["defaults"] {
  if (!isRecord(value) || !isRecord(value.shape)) return false;
  if (!isRecord(value.table) || !isRecord(value.chart)) return false;
  if (
    Object.keys(value).some((key) => !["chart", "shape", "table"].includes(key)) ||
    Object.keys(value.shape).some((key) => !["fill", "stroke"].includes(key)) ||
    Object.keys(value.table).some(
      (key) => !["bodyFill", "border", "headerFill", "text"].includes(key),
    ) ||
    Object.keys(value.chart).some(
      (key) =>
        ![
          "colors",
          "showCategoryName",
          "showLegend",
          "showTitle",
          "showValue",
        ].includes(key),
    )
  ) {
    return false;
  }
  return (
    FillIRSchema.safeParse(value.shape.fill).success &&
    StrokeIRSchema.safeParse(value.shape.stroke).success &&
    FillIRSchema.safeParse(value.table.headerFill).success &&
    FillIRSchema.safeParse(value.table.bodyFill).success &&
    StrokeIRSchema.safeParse(value.table.border).success &&
    TextStyleIRSchema.safeParse(value.table.text).success &&
    Array.isArray(value.chart.colors) &&
    value.chart.colors.every(
      (color) => typeof color === "string" && COLOR_PATTERN.test(color),
    ) &&
    typeof value.chart.showLegend === "boolean" &&
    typeof value.chart.showTitle === "boolean" &&
    typeof value.chart.showValue === "boolean" &&
    typeof value.chart.showCategoryName === "boolean"
  );
}

export function parseDeclarativeTheme(contents: string): ThemeDefinition {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw new Error("theme.jsonをJSONとして読み取れません。");
  }
  if (!isRecord(value) || hasUnsafeObjectKey(value)) {
    throw new Error("theme.jsonの内容が不正です。");
  }
  const allowed = new Set(["authoring", "defaults", "ir", "layouts"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("theme.jsonに未対応の項目があります。");
  }
  const ir = ResolvedThemeIRSchema.safeParse(value.ir);
  if (!ir.success || !isRecord(value.layouts) || !isDefaults(value.defaults)) {
    throw new Error("theme.jsonのテーマ定義が不正です。");
  }
  const layouts = Object.fromEntries(
    Object.entries(value.layouts).map(([id, layout]) => {
      if (!isLayout(layout) || layout.id !== id) {
        throw new Error(`theme.jsonのlayout ${id} が不正です。`);
      }
      return [id, layout];
    }),
  );
  if (Object.keys(layouts).length === 0) {
    throw new Error("theme.jsonには1件以上のlayoutが必要です。");
  }
  const layoutIds = Object.keys(layouts).sort();
  const declaredLayoutIds = [...ir.data.layoutIds].sort();
  const masterIds = new Set(ir.data.masters.map((master) => master.id));
  if (
    layoutIds.length !== declaredLayoutIds.length ||
    layoutIds.some((id, index) => id !== declaredLayoutIds[index]) ||
    Object.values(layouts).some((layout) => !masterIds.has(layout.masterId))
  ) {
    throw new Error("theme.jsonのlayout一覧がテーマ本体と一致しません。");
  }
  if (value.authoring !== undefined && !isRecord(value.authoring)) {
    throw new Error("theme.jsonのauthoringが不正です。");
  }
  return {
    ir: ir.data,
    layouts,
    defaults: value.defaults,
    ...(value.authoring === undefined
      ? {}
      : {
          authoring: value.authoring as unknown as ThemeDefinition["authoring"],
        }),
  };
}

export async function loadDeclarativeTheme(filePath: string): Promise<ThemeDefinition> {
  const data = await readFile(filePath);
  if (data.byteLength > MAX_DECLARATIVE_THEME_BYTES) {
    throw new Error("theme.jsonが大きすぎます。上限は5MiBです。");
  }
  let contents: string;
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new Error("theme.jsonをUTF-8として読み取れません。");
  }
  return parseDeclarativeTheme(contents);
}
