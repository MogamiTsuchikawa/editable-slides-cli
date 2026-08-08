import type { SlideIR } from "@editable-slides/slide-deck-ir";
import { useEffect, useState } from "react";

import { type DeckSourceState, type EditableSource, saveSlideMetadata } from "./api.js";

interface SourceDraft extends EditableSource {
  draftId: string;
}

function sourceDrafts(slide: SlideIR): SourceDraft[] {
  return slide.notes.sources.map((source) => ({
    ...source,
    draftId: crypto.randomUUID(),
  }));
}

export function MetadataPanel({
  deckId,
  onSaved,
  slide,
  sourceState,
}: {
  deckId: string;
  onSaved: (state: DeckSourceState) => void;
  slide: SlideIR;
  sourceState?: DeckSourceState;
}) {
  const [notes, setNotes] = useState(slide.notes.markdown);
  const [sources, setSources] = useState<SourceDraft[]>(() => sourceDrafts(slide));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    setNotes(slide.notes.markdown);
    setSources(sourceDrafts(slide));
    setMessage(undefined);
  }, [slide]);

  const save = async () => {
    if (!sourceState?.editable) return;
    setSaving(true);
    setMessage(undefined);
    try {
      onSaved(
        await saveSlideMetadata(
          deckId,
          slide.id,
          sourceState.sourceHash,
          notes,
          sources.map(({ draftId: _draftId, ...source }) => source),
        ),
      );
      setMessage("保存しました。資料へ反映しています。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="studio-source-editor" open>
      <summary>発表者原稿・出典</summary>
      <label className="studio-field">
        <span>発表者原稿</span>
        <textarea
          disabled={!sourceState?.editable || saving}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="このページで話す内容を入力"
          value={notes}
        />
      </label>
      <div className="studio-sources-head">
        <span>出典</span>
        <button
          disabled={!sourceState?.editable || saving}
          onClick={() =>
            setSources((value) => [
              ...value,
              { draftId: crypto.randomUUID(), label: "" },
            ])
          }
          type="button"
        >
          出典を追加
        </button>
      </div>
      <div className="studio-sources-list">
        {sources.length === 0 ? <small>出典はまだありません。</small> : null}
        {sources.map((source, index) => (
          <div className="studio-source-row" key={source.draftId}>
            <input
              aria-label={`出典${index + 1}の名前`}
              disabled={!sourceState?.editable || saving}
              onChange={(event) =>
                setSources((value) =>
                  value.map((entry, entryIndex) =>
                    entryIndex === index
                      ? { ...entry, label: event.target.value }
                      : entry,
                  ),
                )
              }
              placeholder="資料名"
              value={source.label}
            />
            <input
              aria-label={`出典${index + 1}のURL`}
              disabled={!sourceState?.editable || saving}
              onChange={(event) =>
                setSources((value) =>
                  value.map((entry, entryIndex) =>
                    entryIndex === index
                      ? { ...entry, url: event.target.value }
                      : entry,
                  ),
                )
              }
              placeholder="https://…（任意）"
              type="url"
              value={source.url ?? ""}
            />
            <button
              aria-label={`出典${index + 1}を削除`}
              disabled={!sourceState?.editable || saving}
              onClick={() =>
                setSources((value) => value.filter((_, item) => item !== index))
              }
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!sourceState?.editable ? (
        <p className="studio-source-message">
          {sourceState?.reason ?? "編集準備中です。"}
        </p>
      ) : null}
      {message ? (
        <p className="studio-source-message" role="status">
          {message}
        </p>
      ) : null}
      <button
        className="studio-source-save"
        disabled={!sourceState?.editable || saving}
        onClick={() => void save()}
        type="button"
      >
        {saving ? "保存中…" : "原稿と出典を保存"}
      </button>
    </details>
  );
}
