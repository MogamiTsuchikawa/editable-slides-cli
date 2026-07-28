import { readFileSync } from "node:fs";

function assetDataUri(fileName: string, mimeType: string): string {
  const contents = readFileSync(new URL(`../assets/${fileName}`, import.meta.url));
  return `data:${mimeType};base64,${contents.toString("base64")}`;
}

export const companyAssets = {
  logoBlack: assetDataUri("livetoon-logo-black.svg", "image/svg+xml"),
  logoWhite: assetDataUri("livetoon-logo-white.png", "image/png"),
  mark: assetDataUri("livetoon-mark.png", "image/png"),
  gradient: assetDataUri("livetoon-gradient.png", "image/png"),
  coverRibbon: assetDataUri("livetoon-cover-ribbon.png", "image/png"),
} as const;
