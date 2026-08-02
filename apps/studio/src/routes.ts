export type StudioRoute =
  | { kind: "edit"; deckId: string; slideId?: string }
  | { kind: "presenter"; deckId: string; slideId?: string }
  | { kind: "print"; deckId: string };

function decode(segment: string | undefined): string | undefined {
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseStudioRoute(pathname: string, search = ""): StudioRoute {
  const segments = pathname.split("/").filter(Boolean);
  const kind = segments[0];
  const deckId =
    decode(segments[1]) ?? new URLSearchParams(search).get("deck") ?? "example";
  const slideId = decode(segments[2]);

  switch (kind) {
    case "print":
      return { kind, deckId };
    case "edit":
    case "deck":
    case "debug":
      return slideId ? { kind: "edit", deckId, slideId } : { kind: "edit", deckId };
    case "presenter":
      return slideId ? { kind, deckId, slideId } : { kind, deckId };
    case "overview":
      return { kind: "edit", deckId };
    default:
      return slideId ? { kind: "edit", deckId, slideId } : { kind: "edit", deckId };
  }
}

export function routePath(route: StudioRoute): string {
  const deckId = encodeURIComponent(route.deckId);
  switch (route.kind) {
    case "print":
      return `/${route.kind}/${deckId}`;
    case "edit":
    case "presenter":
      return `/${route.kind}/${deckId}${
        route.slideId ? `/${encodeURIComponent(route.slideId)}` : ""
      }`;
  }
}
