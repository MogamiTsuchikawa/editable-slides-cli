import { type DeckIR, parseDeckIR } from "@livetoon/slide-deck-ir";
import { type OverrideDocument, parseOverrideDocument } from "./overrides.js";

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store" });
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      value && typeof value === "object" && "error" in value
        ? String((value as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return value;
}

export async function fetchDeck(deckId: string): Promise<DeckIR> {
  return parseDeckIR(
    await getJson(`/api/decks/${encodeURIComponent(deckId)}?t=${Date.now()}`),
  );
}

export async function fetchOverrides(deckId: string): Promise<OverrideDocument> {
  return parseOverrideDocument(
    await getJson(`/api/layout-overrides/${encodeURIComponent(deckId)}`),
  );
}

export async function saveOverrides(
  deckId: string,
  document: OverrideDocument,
  signal?: AbortSignal,
  keepalive = false,
): Promise<OverrideDocument> {
  const response = await fetch(`/api/layout-overrides/${encodeURIComponent(deckId)}`, {
    method: "PUT",
    body: JSON.stringify(document),
    headers: { "content-type": "application/json" },
    keepalive,
    ...(signal ? { signal } : {}),
  });
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      value && typeof value === "object" && "error" in value
        ? String((value as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return parseOverrideDocument(value);
}

export async function saveElementText(
  deckId: string,
  slideId: string,
  elementId: string,
  text: string,
): Promise<void> {
  const response = await fetch(
    `/api/text-elements/${encodeURIComponent(deckId)}/${encodeURIComponent(
      slideId,
    )}/${encodeURIComponent(elementId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ text }),
      headers: { "content-type": "application/json" },
    },
  );
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      value && typeof value === "object" && "error" in value
        ? String((value as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
}
