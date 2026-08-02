import type { DeckIR } from "@livetoon/slide-deck-ir";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DeckSourceState,
  fetchDeck,
  fetchDeckSourceState,
  fetchOverrides,
} from "./api.js";
import { emptyOverrides, type OverrideDocument } from "./overrides.js";

interface DeckData {
  deck?: DeckIR;
  sourceState?: DeckSourceState;
  overrides: OverrideDocument;
  loading: boolean;
  error?: string;
  reloadDeck: () => Promise<void>;
  reloadOverrides: () => Promise<void>;
  reloadSourceState: () => Promise<void>;
  setOverrides: (document: OverrideDocument) => void;
  setSourceState: (state: DeckSourceState) => void;
}

export function useDeckData(deckId: string): DeckData {
  const [deck, setDeck] = useState<DeckIR>();
  const [overrides, setOverrides] = useState(emptyOverrides);
  const [sourceState, setSourceState] = useState<DeckSourceState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const requestVersion = useRef(0);

  const reloadDeck = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const next = await fetchDeck(deckId);
      if (requestVersion.current !== version) return;
      setDeck(next);
      setError(undefined);
    } catch (cause) {
      if (requestVersion.current !== version) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [deckId]);

  const reloadOverrides = useCallback(async () => {
    try {
      setOverrides(await fetchOverrides(deckId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [deckId]);

  const reloadSourceState = useCallback(async () => {
    try {
      setSourceState(await fetchDeckSourceState(deckId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [deckId]);

  useEffect(() => {
    setLoading(true);
    setDeck(undefined);
    setOverrides(emptyOverrides());
    setSourceState(undefined);
    void Promise.all([reloadDeck(), reloadOverrides(), reloadSourceState()]);
  }, [reloadDeck, reloadOverrides, reloadSourceState]);

  useEffect(() => {
    const onChange = (event: { kind?: string }) => {
      if (event.kind === "overrides") {
        void reloadOverrides();
      } else {
        void Promise.all([reloadDeck(), reloadSourceState()]);
      }
    };
    if (import.meta.hot) {
      import.meta.hot.on("studio:deck-changed", onChange);
      return () => import.meta.hot?.off("studio:deck-changed", onChange);
    }
    if (!("EventSource" in window)) return;
    const events = new EventSource(`/api/events?deck=${encodeURIComponent(deckId)}`);
    const receive = (event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as { kind?: string };
        onChange(value);
      } catch {
        onChange({ kind: "deck" });
      }
    };
    events.onmessage = receive;
    events.addEventListener("deck", () => onChange({ kind: "deck" }));
    events.addEventListener("overrides", () => onChange({ kind: "overrides" }));
    return () => events.close();
  }, [deckId, reloadDeck, reloadOverrides, reloadSourceState]);

  return {
    ...(deck ? { deck } : {}),
    ...(sourceState ? { sourceState } : {}),
    overrides,
    loading,
    ...(error ? { error } : {}),
    reloadDeck,
    reloadOverrides,
    reloadSourceState,
    setOverrides,
    setSourceState,
  };
}
