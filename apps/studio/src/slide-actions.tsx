import type { SlideIR } from "@livetoon/slide-deck-ir";
import { useEffect, useRef, useState } from "react";

import {
  type DeckSourceState,
  mutateSlide,
  type SlideMutationResult,
  type SlideSourceOperation,
} from "./api.js";

type PendingAction =
  | { type: "add"; title: string }
  | { type: "duplicate" }
  | { type: "delete" }
  | { type: "move"; toIndex: number };

function actionLabel(action: PendingAction): string {
  switch (action.type) {
    case "add":
      return "ページを追加";
    case "duplicate":
      return "このページを複製";
    case "delete":
      return "このページを削除";
    case "move":
      return action.toIndex < 0 ? "ページを移動" : "ページの順番を変更";
  }
}

export function SlideActions({
  deckId,
  index,
  onMutated,
  slide,
  slideCount,
  sourceState,
}: {
  deckId: string;
  index: number;
  onMutated: (result: SlideMutationResult) => void;
  slide: SlideIR;
  slideCount: number;
  sourceState?: DeckSourceState;
}) {
  const [pending, setPending] = useState<PendingAction>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const enabled = Boolean(sourceState?.editable) && !busy;

  useEffect(() => {
    if (!pending) return;
    dialogRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setPending(undefined);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, pending]);

  const run = async () => {
    if (!pending || !sourceState?.editable) return;
    let operation: SlideSourceOperation;
    if (pending.type === "add") {
      operation = {
        type: "add",
        title: pending.title.trim() || "新しいスライド",
        afterSlideId: slide.id,
      };
    } else if (pending.type === "move") {
      operation = { type: "move", slideId: slide.id, toIndex: pending.toIndex };
    } else {
      operation = { type: pending.type, slideId: slide.id };
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await mutateSlide(deckId, sourceState.sourceHash, operation);
      setPending(undefined);
      onMutated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="studio-slide-actions" title={sourceState?.reason}>
        <button
          disabled={!enabled}
          onClick={() => setPending({ type: "add", title: "" })}
          type="button"
        >
          追加
        </button>
        <button
          disabled={!enabled}
          onClick={() => setPending({ type: "duplicate" })}
          type="button"
        >
          複製
        </button>
        <button
          disabled={!enabled || index === 0}
          onClick={() => setPending({ type: "move", toIndex: index - 1 })}
          type="button"
          aria-label="前へ移動"
        >
          ↑
        </button>
        <button
          disabled={!enabled || index === slideCount - 1}
          onClick={() => setPending({ type: "move", toIndex: index + 1 })}
          type="button"
          aria-label="後ろへ移動"
        >
          ↓
        </button>
        <button
          className="studio-slide-delete"
          disabled={!enabled || slideCount === 1}
          onClick={() => setPending({ type: "delete" })}
          type="button"
        >
          削除
        </button>
      </div>
      {pending ? (
        <div className="studio-confirm-overlay">
          <button
            aria-label="確認を閉じる"
            className="studio-confirm-backdrop"
            disabled={busy}
            onClick={() => setPending(undefined)}
            type="button"
          />
          <div
            aria-modal="true"
            className="studio-confirm-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <p className="studio-eyebrow">確認</p>
            <h2>{actionLabel(pending)}</h2>
            {pending.type === "add" ? (
              <label>
                ページの見出し
                <input
                  onChange={(event) =>
                    setPending({ ...pending, title: event.target.value })
                  }
                  placeholder="新しいスライド"
                  value={pending.title}
                />
              </label>
            ) : (
              <p>
                「{slide.id}
                」にこの操作を行います。元に戻す機能はないため、内容を確認してください。
              </p>
            )}
            {error ? (
              <p className="studio-editor-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="studio-confirm-actions">
              <button
                disabled={busy}
                onClick={() => setPending(undefined)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className={pending.type === "delete" ? "danger" : "primary"}
                disabled={busy}
                onClick={() => void run()}
                type="button"
              >
                {busy ? "反映中…" : "実行する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
