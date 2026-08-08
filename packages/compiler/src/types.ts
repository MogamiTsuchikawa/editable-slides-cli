import type {
  DeckIR,
  Diagnostic,
  ElementIR,
  SlideIR,
} from "@editable-slides/slide-deck-ir";
import type { ThemeDefinition } from "@editable-slides/slide-theme-default";

export interface DeckConfig {
  schemaVersion: 1;
  id: string;
  title: string;
  author?: string;
  company?: string;
  theme: string;
  canvas: "wide";
  language: string;
  strictEditable: boolean;
  slides: string[];
}

export interface SlideFrontmatter {
  id: string;
  layout: string;
  notes: string;
  sources: Array<{ label: string; url?: string }>;
  masterId?: string;
  background?: {
    src: string;
    fit: "stretch" | "contain" | "cover";
    focalPosition?: { x: number; y: number };
  };
}

export interface DeckMdxConfig extends Omit<DeckConfig, "slides"> {
  slides: SlideFrontmatter[];
}

export interface EmbeddedAsset {
  id: string;
  mimeType: string;
  encoding: "base64";
  data: Buffer;
  dataUri: string;
  contentHash: string;
}

export interface ElementLayoutOverride {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  zIndex?: number;
}

export interface LayoutOverrides {
  schemaVersion: 1;
  slides: Record<string, Record<string, ElementLayoutOverride>>;
}

export interface CompileDeckOptions {
  theme?: ThemeDefinition;
  failOnWarnings?: boolean;
}

export interface CompileDeckResult {
  deck: DeckIR;
  diagnostics: Diagnostic[];
}

export interface ParsedSlide {
  slide: SlideIR;
  diagnostics: Diagnostic[];
}

export interface MutableSlideCompilation {
  slideId: string;
  sourcePath: string;
  elements: ElementIR[];
  diagnostics: Diagnostic[];
}
