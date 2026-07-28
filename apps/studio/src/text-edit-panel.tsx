import type { TextElementIR } from "@livetoon/slide-deck-ir";
import { useCallback, useEffect, useMemo, useState } from "react";
import { saveElementText } from "./api.js";
import { isTextSaveShortcut, textElementToEditableMarkdown } from "./text-edit.js";

type TextSaveStatus = "idle" | "saving" | "saved" | "error";

export function TextEditPanel({
  deckId,
  slideId,
  element,
  onTextSaved,
}: {
  deckId: string;
  slideId: string;
  element: TextElementIR;
  onTextSaved?: () => void;
}) {
  const sourceText = useMemo(() => textElementToEditableMarkdown(element), [element]);
  const [savedText, setSavedText] = useState(sourceText);
  const [draft, setDraft] = useState(sourceText);
  const [status, setStatus] = useState<TextSaveStatus>("idle");
  const [error, setError] = useState<string>();
  const dirty = draft !== savedText;

  useEffect(() => {
    setSavedText(sourceText);
    setDraft(sourceText);
    setStatus("idle");
    setError(undefined);
  }, [sourceText]);

  const save = useCallback(async () => {
    if (!dirty || status === "saving") return;
    setStatus("saving");
    setError(undefined);
    try {
      await saveElementText(deckId, slideId, element.id, draft);
      setSavedText(draft);
      setStatus("saved");
      onTextSaved?.();
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [deckId, dirty, draft, element.id, onTextSaved, slideId, status]);

  return (
    <section
      className="studio-text-editor"
      data-studio-text-editor
      data-testid="text-element-editor"
    >
      <div className="studio-text-editor-header">
        <div>
          <p className="studio-eyebrow">TEXT CONTENT</p>
          <strong className="studio-text-editor-meta">{element.id}</strong>
        </div>
        <span
          aria-live="polite"
          className="studio-text-editor-status"
          data-state={status}
        >
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved"}
          {status === "error" && "Save failed"}
          {status === "idle" && (dirty ? "Unsaved" : "No changes")}
        </span>
      </div>
      <textarea
        aria-label={`テキスト内容: ${element.id}`}
        className="studio-text-editor-textarea"
        data-testid="text-editor-input"
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setStatus("idle");
          setError(undefined);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (isTextSaveShortcut(event)) {
            event.preventDefault();
            void save();
          }
        }}
        rows={9}
        spellCheck
        value={draft}
      />
      <div className="studio-text-editor-actions">
        <small>Markdown · ⌘/Ctrl + Enterで保存</small>
        <button
          aria-label="選択したテキストを保存"
          data-testid="text-editor-save"
          disabled={!dirty || status === "saving"}
          onClick={() => void save()}
          type="button"
        >
          Save text
        </button>
      </div>
      {error ? (
        <p className="studio-text-editor-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
