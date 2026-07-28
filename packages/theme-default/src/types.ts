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

export interface ThemeDefinition {
  ir: ResolvedThemeIR;
  layouts: Record<string, LayoutDefinition>;
  defaults: ThemeDefaults;
}
