import { type DeckIR, parseDeckIR } from "@livetoon/slide-deck-ir";
import { type OverrideDocument, parseOverrideDocument } from "./overrides.js";

export interface DeckSourceState {
  editable: boolean;
  sourceHash: string;
  sourceFile: string;
  slideIds: string[];
  reason?: string;
}

export interface SlideMutationResult extends DeckSourceState {
  operation: "add" | "duplicate" | "delete" | "move";
  slideId: string;
  selectedSlideId: string;
}

export type SlideSourceOperation =
  | { type: "add"; title: string; layout?: string; afterSlideId?: string }
  | { type: "duplicate"; slideId: string }
  | { type: "delete"; slideId: string }
  | { type: "move"; slideId: string; toIndex: number };

export interface EditableSource {
  label: string;
  url?: string;
}

async function responseJson(response: Response): Promise<unknown> {
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

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store" });
  return responseJson(response);
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

export async function fetchDeckSourceState(deckId: string): Promise<DeckSourceState> {
  return (await getJson(
    `/api/deck-source/${encodeURIComponent(deckId)}?t=${Date.now()}`,
  )) as DeckSourceState;
}

async function sendJson(path: string, method: "POST" | "PUT", body: unknown) {
  return responseJson(
    await fetch(path, {
      method,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

export async function mutateSlide(
  deckId: string,
  expectedHash: string,
  operation: SlideSourceOperation,
): Promise<SlideMutationResult> {
  return (await sendJson(
    `/api/slide-operations/${encodeURIComponent(deckId)}`,
    "POST",
    { expectedHash, operation },
  )) as SlideMutationResult;
}

export async function saveSlideMetadata(
  deckId: string,
  slideId: string,
  expectedHash: string,
  notes: string,
  sources: EditableSource[],
): Promise<DeckSourceState> {
  return (await sendJson(
    `/api/slide-metadata/${encodeURIComponent(deckId)}/${encodeURIComponent(slideId)}`,
    "PUT",
    { expectedHash, notes, sources },
  )) as DeckSourceState;
}

export async function saveStructuredData(
  deckId: string,
  slideId: string,
  elementId: string,
  expectedHash: string,
  data: unknown,
): Promise<DeckSourceState> {
  return (await sendJson(
    `/api/structured-data/${encodeURIComponent(deckId)}/${encodeURIComponent(
      slideId,
    )}/${encodeURIComponent(elementId)}`,
    "PUT",
    { expectedHash, data },
  )) as DeckSourceState;
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
  const value = await responseJson(response);
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
  await responseJson(response);
}
