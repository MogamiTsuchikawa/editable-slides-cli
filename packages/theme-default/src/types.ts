import type {
  ChartStyleIR,
  FillIR,
  FrameIR,
  ResolvedThemeIR,
  StrokeIR,
  TableStyleIR,
  TextAlignIR,
  TextStyleIR,
} from "@livetoon/slide-deck-ir";

export type TypographyRole = keyof ResolvedThemeIR["typography"];

export interface LayoutSlotDefinition {
  frame: FrameIR;
  typography: TypographyRole;
  textAlign?: TextAlignIR;
  textStyle?: Partial<TextStyleIR>;
  zIndex: number;
}

export interface LayoutDefinition {
  id: string;
  label: string;
  masterId: string;
  background?: FillIR;
  slots: Record<string, LayoutSlotDefinition>;
}

export interface ThemeDefaults {
  shape: {
    fill: FillIR;
    stroke: StrokeIR;
  };
  table: TableStyleIR;
  chart: ChartStyleIR;
}

export interface ThemeTokenGuidance {
  purpose: string;
  useFor: string[];
  avoidFor?: string[];
}

export interface ThemeAuthoringGuidance {
  schemaVersion: 1;
  intent: string;
  colors: {
    strategy: string;
    roles: Record<string, ThemeTokenGuidance>;
  };
  typography: {
    strategy: string;
    languageFonts: Record<string, string>;
    roles: Record<TypographyRole, string>;
  };
  layouts: Record<string, string>;
  rules: {
    prefer: string[];
    avoid: string[];
  };
}

export interface ThemeDefinition {
  ir: ResolvedThemeIR;
  layouts: Record<string, LayoutDefinition>;
  defaults: ThemeDefaults;
  /**
   * Machine-readable instructions for Codex, Claude Code, and other authoring
   * agents. Renderers intentionally ignore this field.
   */
  authoring?: ThemeAuthoringGuidance;
}
