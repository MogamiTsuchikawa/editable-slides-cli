import { companyTheme } from "@livetoon/slide-theme-company";
import { defaultTheme, type ThemeDefinition } from "@livetoon/slide-theme-default";
import { tsuchikawaShuronTheme } from "@livetoon/slide-theme-tsuchikawa-shuron";

const themes = {
  company: companyTheme,
  default: defaultTheme,
  "tsuchikawa-shuron": tsuchikawaShuronTheme,
} as const satisfies Record<string, ThemeDefinition>;

export type BuiltInThemeId = keyof typeof themes;

export const BUILT_IN_THEME_IDS = Object.freeze(
  Object.keys(themes) as BuiltInThemeId[],
);

export function isBuiltInThemeId(value: string): value is BuiltInThemeId {
  return Object.hasOwn(themes, value);
}

export function resolveBuiltInTheme(reference: string): ThemeDefinition | undefined {
  if (!isBuiltInThemeId(reference)) return undefined;
  return structuredClone(themes[reference]);
}
