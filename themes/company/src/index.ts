import { defaultTheme, type ThemeDefinition } from "@livetoon/slide-theme-default";

/**
 * Company-wide defaults live here. Keep deck-specific exceptions in MDX and
 * geometry-only adjustments in layout.overrides.json.
 */
export const companyTheme: ThemeDefinition = structuredClone(defaultTheme);

companyTheme.ir.id = "company";
companyTheme.ir.name = "Livetoon Company";

export default companyTheme;
