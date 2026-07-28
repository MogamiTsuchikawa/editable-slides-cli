import type { DeckIR } from "@livetoon/slide-deck-ir";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDeck, fetchOverrides } from "./api.js";
import { emptyOverrides, type OverrideDocument } from "./overrides.js";

interface DeckData {
  deck?: DeckIR;
  overrides: OverrideDocument;
  loading: boolean;
  error?: string;
  reloadDeck: () => Promise<void>;
  reloadOverrides: () => Promise<void>;
  setOverrides: (document: OverrideDocument) => void;
}

export function useDeckData(deckId: string): DeckData {
  const [deck, setDeck] = useState<DeckIR>();
  const [overrides, setOverrides] = useState(emptyOverrides);
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

  useEffect(() => {
    setLoading(true);
    setDeck(undefined);
    setOverrides(emptyOverrides());
    void Promise.all([reloadDeck(), reloadOverrides()]);
  }, [reloadDeck, reloadOverrides]);

  useEffect(() => {
    if (!import.meta.hot) return;
    const onChange = (event: { kind?: string }) => {
      if (event.kind === "overrides") {
        void reloadOverrides();
      } else {
        void reloadDeck();
      }
    };
    import.meta.hot.on("studio:deck-changed", onChange);
    return () => import.meta.hot?.off("studio:deck-changed", onChange);
  }, [reloadDeck, reloadOverrides]);

  return {
    ...(deck ? { deck } : {}),
    overrides,
    loading,
    ...(error ? { error } : {}),
    reloadDeck,
    reloadOverrides,
    setOverrides,
  };
}
