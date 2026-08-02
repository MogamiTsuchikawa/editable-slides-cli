import type { DeckIR, ElementIR, SlideIR } from "@livetoon/slide-deck-ir";
import { ResponsiveSlide } from "@livetoon/slide-renderer-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import Moveable from "react-moveable";
import Selecto from "react-selecto";
import { type DeckSourceState, saveOverrides } from "./api.js";
import { createEditHistory, historyReducer } from "./history.js";
import { MetadataPanel } from "./metadata-panel.js";
import {
  type FrameOverride,
  findOrphanOverrides,
  flattenElements,
  frameForElement,
  type OverrideDocument,
  setFrameOverride,
  setFrameOverrides,
} from "./overrides.js";
import { StructuredDataPanel } from "./structured-data-panel.js";
import { isTextEditorTarget, selectedTextElement } from "./text-edit.js";
import { TextEditPanel } from "./text-edit-panel.js";

type SaveStatus = "saved" | "dirty" | "saving" | "error";

function isEditable(element: ElementIR): boolean {
  return !element.locked && element.editable !== false;
}

function changedFrame(
  base: FrameOverride,
  values: Partial<FrameOverride>,
): FrameOverride {
  return {
    x: values.x ?? base.x,
    y: values.y ?? base.y,
    w: Math.max(1, values.w ?? base.w),
    h: Math.max(1, values.h ?? base.h),
    rotation: values.rotation ?? base.rotation,
    zIndex: values.zIndex ?? base.zIndex,
  };
}

function elementIdFromTarget(target: HTMLElement | SVGElement): string | undefined {
  return target instanceof HTMLElement ? target.dataset.slideElementId : undefined;
}

export function EditorView({
  deck,
  slide,
  initialDocument,
  onDocumentSaved,
  onTextSaved,
  onSourceChanged,
  sourceState,
}: {
  deck: DeckIR;
  slide: SlideIR;
  initialDocument: OverrideDocument;
  onDocumentSaved: (document: OverrideDocument) => void;
  onTextSaved?: () => void;
  onSourceChanged: (state: DeckSourceState) => void;
  sourceState?: DeckSourceState;
}) {
  const [history, dispatch] = useReducer(
    historyReducer,
    initialDocument,
    createEditHistory,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string>();
  const canvasShellRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef(history.present);
  const pendingSaveRef = useRef(history.present);
  const lastSavedRef = useRef(JSON.stringify(initialDocument));
  const saveTimerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef<Promise<void> | undefined>(undefined);
  const gestureBaseRef = useRef<Record<string, FrameOverride>>({});

  const elements = useMemo(() => flattenElements(slide.elements), [slide]);
  const elementById = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  );
  const orphans = useMemo(
    () => findOrphanOverrides(history.present, deck.slides),
    [deck.slides, history.present],
  );
  const editableTextElement = useMemo(
    () => selectedTextElement(elements, selectedIds),
    [elements, selectedIds],
  );
  const structuredElement = useMemo(() => {
    if (selectedIds.size !== 1) return undefined;
    const element = elementById.get([...selectedIds][0] ?? "");
    return element?.type === "table" || element?.type === "chart" ? element : undefined;
  }, [elementById, selectedIds]);

  useEffect(() => {
    documentRef.current = history.present;
    pendingSaveRef.current = history.present;
  }, [history.present]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((elementId) => elementById.has(elementId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [elementById]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rendered element nodes change after layout edits and slide navigation.
  useLayoutEffect(() => {
    const canvas = canvasShellRef.current;
    if (!canvas) return;
    const nextTargets = [
      ...canvas.querySelectorAll<HTMLElement>("[data-slide-element-id]"),
    ].filter(
      (target) =>
        Boolean(target.dataset.slideElementId) &&
        selectedIds.has(target.dataset.slideElementId as string) &&
        target.dataset.locked !== "true",
    );
    setTargets(nextTargets);
  }, [history.present, selectedIds, slide.id]);

  const persist = useCallback(
    async (document: OverrideDocument, keepalive = false) => {
      const serialized = JSON.stringify(document);
      if (serialized === lastSavedRef.current) {
        setSaveStatus("saved");
        return;
      }
      setSaveStatus("saving");
      setSaveError(undefined);
      try {
        const saved = await saveOverrides(
          deck.metadata.id,
          document,
          undefined,
          keepalive,
        );
        lastSavedRef.current = JSON.stringify(saved);
        onDocumentSaved(saved);
        setSaveStatus(
          JSON.stringify(pendingSaveRef.current) === lastSavedRef.current
            ? "saved"
            : "dirty",
        );
      } catch (cause) {
        setSaveStatus("error");
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [deck.metadata.id, onDocumentSaved],
  );

  const flush = useCallback(
    (keepalive = false): Promise<void> => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      const run = (savingRef.current ?? Promise.resolve()).then(() =>
        persist(pendingSaveRef.current, keepalive),
      );
      const settled = run.finally(() => {
        if (savingRef.current === settled) savingRef.current = undefined;
      });
      savingRef.current = settled;
      return settled;
    },
    [persist],
  );

  useEffect(() => {
    if (JSON.stringify(history.present) === lastSavedRef.current) return;
    setSaveStatus("dirty");
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      void flush();
    }, 300);
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
    };
  }, [flush, history.present]);

  useEffect(() => {
    const saveOnExit = () => {
      if (JSON.stringify(pendingSaveRef.current) !== lastSavedRef.current) {
        void persist(pendingSaveRef.current, true);
      }
    };
    window.addEventListener("beforeunload", saveOnExit);
    window.addEventListener("pagehide", saveOnExit);
    return () => {
      window.removeEventListener("beforeunload", saveOnExit);
      window.removeEventListener("pagehide", saveOnExit);
      saveOnExit();
    };
  }, [persist]);

  const frameForId = useCallback(
    (elementId: string): FrameOverride | undefined => {
      const element = elementById.get(elementId);
      if (!element) return undefined;
      return frameForElement(
        element,
        documentRef.current.slides[slide.id]?.[elementId],
      );
    },
    [elementById, slide.id],
  );

  const beginGesture = useCallback(() => {
    const base: Record<string, FrameOverride> = {};
    for (const elementId of selectedIds) {
      const frame = frameForId(elementId);
      if (frame) base[elementId] = frame;
    }
    gestureBaseRef.current = base;
    dispatch({ type: "begin" });
  }, [frameForId, selectedIds]);

  const previewFrame = useCallback(
    (elementId: string, frame: FrameOverride) => {
      const next = setFrameOverride(documentRef.current, slide.id, elementId, frame);
      documentRef.current = next;
      pendingSaveRef.current = next;
      dispatch({ type: "preview", document: next });
    },
    [slide.id],
  );

  const endGesture = useCallback(() => {
    dispatch({ type: "commit" });
    gestureBaseRef.current = {};
  }, []);

  const selectElement = useCallback(
    (element: ElementIR, event: ReactPointerEvent<HTMLElement>) => {
      if (!isEditable(element)) return;
      event.stopPropagation();
      setSelectedIds((current) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          const next = new Set(current);
          if (next.has(element.id)) next.delete(element.id);
          else next.add(element.id);
          return next;
        }
        return new Set([element.id]);
      });
    },
    [],
  );

  const applyFrames = useCallback(
    (frames: Record<string, FrameOverride>) => {
      const next = setFrameOverrides(documentRef.current, slide.id, frames);
      documentRef.current = next;
      pendingSaveRef.current = next;
      dispatch({ type: "apply", document: next });
    },
    [slide.id],
  );

  const nudge = useCallback(
    (x: number, y: number) => {
      const frames: Record<string, FrameOverride> = {};
      for (const elementId of selectedIds) {
        const frame = frameForId(elementId);
        if (frame) frames[elementId] = { ...frame, x: frame.x + x, y: frame.y + y };
      }
      if (Object.keys(frames).length > 0) applyFrames(frames);
    },
    [applyFrames, frameForId, selectedIds],
  );

  const shiftZIndex = useCallback(
    (delta: number) => {
      const frames: Record<string, FrameOverride> = {};
      for (const elementId of selectedIds) {
        const frame = frameForId(elementId);
        if (frame) frames[elementId] = { ...frame, zIndex: frame.zIndex + delta };
      }
      if (Object.keys(frames).length > 0) applyFrames(frames);
    },
    [applyFrames, frameForId, selectedIds],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEditorTarget(event.target)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (modifier && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(
          new Set(elements.filter(isEditable).map((element) => element.id)),
        );
        return;
      }
      if (event.key === "Escape") {
        setSelectedIds(new Set());
        return;
      }
      if (!event.key.startsWith("Arrow") || selectedIds.size === 0) return;
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") nudge(-distance, 0);
      if (event.key === "ArrowRight") nudge(distance, 0);
      if (event.key === "ArrowUp") nudge(0, -distance);
      if (event.key === "ArrowDown") nudge(0, distance);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [elements, nudge, selectedIds.size]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: guideline nodes must refresh after an override changes element geometry.
  const elementGuidelines = useMemo(
    () =>
      [
        ...(canvasShellRef.current?.querySelectorAll<HTMLElement>(
          "[data-slide-element-id]",
        ) ?? []),
      ].filter((element) => !selectedIds.has(element.dataset.slideElementId ?? "")),
    [history.present, selectedIds],
  );
  const safeArea = deck.theme.safeArea;
  const currentOverrides = history.present.slides[slide.id];

  return (
    <main className="studio-editor">
      <section className="studio-editor-workspace">
        <div className="studio-editor-ruler studio-editor-ruler-x" />
        <div className="studio-editor-ruler studio-editor-ruler-y" />
        <div
          className="studio-canvas-shell"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setSelectedIds(new Set());
          }}
          ref={canvasShellRef}
        >
          <ResponsiveSlide
            deck={deck}
            frameOverrides={currentOverrides}
            mode="edit"
            onElementPointerDown={selectElement}
            safeArea={safeArea}
            selectedIds={selectedIds}
            slide={slide}
          />
          <Selecto
            continueSelect={false}
            dragContainer=".studio-canvas-shell"
            hitRate={10}
            onSelect={(event) => {
              setSelectedIds(
                new Set(
                  event.selected.flatMap((target) =>
                    target instanceof HTMLElement && target.dataset.slideElementId
                      ? [target.dataset.slideElementId]
                      : [],
                  ),
                ),
              );
            }}
            selectByClick
            selectableTargets={[
              ".studio-canvas-shell [data-slide-element-id]:not([data-locked='true'])",
            ]}
            selectFromInside={false}
            toggleContinueSelect={["shift"]}
          />
          <Moveable
            bounds={{ left: 0, top: 0, right: 1920, bottom: 1080 }}
            draggable
            elementGuidelines={elementGuidelines}
            horizontalGuidelines={[safeArea.y, safeArea.y + safeArea.h, 540]}
            keepRatio={false}
            onDrag={({ target, beforeTranslate }) => {
              const elementId = elementIdFromTarget(target);
              const base = elementId ? gestureBaseRef.current[elementId] : undefined;
              if (!elementId || !base) return;
              previewFrame(
                elementId,
                changedFrame(base, {
                  x: base.x + (beforeTranslate[0] ?? 0),
                  y: base.y + (beforeTranslate[1] ?? 0),
                }),
              );
            }}
            onDragEnd={endGesture}
            onDragGroup={({ events }) => {
              for (const event of events) {
                const elementId = elementIdFromTarget(event.target);
                const base = elementId ? gestureBaseRef.current[elementId] : undefined;
                if (!elementId || !base) continue;
                previewFrame(
                  elementId,
                  changedFrame(base, {
                    x: base.x + (event.beforeTranslate[0] ?? 0),
                    y: base.y + (event.beforeTranslate[1] ?? 0),
                  }),
                );
              }
            }}
            onDragGroupEnd={endGesture}
            onDragGroupStart={beginGesture}
            onDragStart={beginGesture}
            onResize={({ target, width, height, drag }) => {
              const elementId = elementIdFromTarget(target);
              const base = elementId ? gestureBaseRef.current[elementId] : undefined;
              if (!elementId || !base) return;
              previewFrame(
                elementId,
                changedFrame(base, {
                  x: base.x + (drag.beforeTranslate[0] ?? 0),
                  y: base.y + (drag.beforeTranslate[1] ?? 0),
                  w: width,
                  h: height,
                }),
              );
            }}
            onResizeEnd={endGesture}
            onResizeGroup={({ events }) => {
              for (const event of events) {
                const elementId = elementIdFromTarget(event.target);
                const base = elementId ? gestureBaseRef.current[elementId] : undefined;
                if (!elementId || !base) continue;
                previewFrame(
                  elementId,
                  changedFrame(base, {
                    x: base.x + (event.drag.beforeTranslate[0] ?? 0),
                    y: base.y + (event.drag.beforeTranslate[1] ?? 0),
                    w: event.width,
                    h: event.height,
                  }),
                );
              }
            }}
            onResizeGroupEnd={endGesture}
            onResizeGroupStart={beginGesture}
            onResizeStart={beginGesture}
            onRotate={({ target, beforeRotate }) => {
              const elementId = elementIdFromTarget(target);
              const base = elementId ? gestureBaseRef.current[elementId] : undefined;
              if (!elementId || !base) return;
              previewFrame(elementId, changedFrame(base, { rotation: beforeRotate }));
            }}
            onRotateEnd={endGesture}
            onRotateGroup={({ events }) => {
              for (const event of events) {
                const elementId = elementIdFromTarget(event.target);
                const base = elementId ? gestureBaseRef.current[elementId] : undefined;
                if (!elementId || !base) continue;
                previewFrame(
                  elementId,
                  changedFrame(base, {
                    x: base.x + (event.drag.beforeTranslate[0] ?? 0),
                    y: base.y + (event.drag.beforeTranslate[1] ?? 0),
                    rotation: event.beforeRotate,
                  }),
                );
              }
            }}
            onRotateGroupEnd={endGesture}
            onRotateGroupStart={beginGesture}
            onRotateStart={beginGesture}
            origin={false}
            resizable
            rotatable
            snapDirections={{
              top: true,
              right: true,
              bottom: true,
              left: true,
              center: true,
              middle: true,
            }}
            snapGap
            snapGridHeight={8}
            snapGridWidth={8}
            snappable
            target={targets.length === 1 ? (targets[0] ?? null) : targets}
            throttleDrag={1}
            throttleResize={1}
            throttleRotate={1}
            verticalGuidelines={[safeArea.x, safeArea.x + safeArea.w, 960]}
          />
        </div>
      </section>
      <aside className="studio-editor-panel">
        <div className="studio-editor-panel-head">
          <div>
            <p className="studio-eyebrow">LAYOUT EDITOR</p>
            <h2>{slide.id}</h2>
          </div>
          <span className="studio-save-state" data-state={saveStatus}>
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "dirty" && "Unsaved"}
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "error" && "Save failed"}
          </span>
        </div>
        <div className="studio-editor-actions">
          <button
            disabled={history.past.length === 0}
            onClick={() => dispatch({ type: "undo" })}
            type="button"
          >
            Undo
          </button>
          <button
            disabled={history.future.length === 0}
            onClick={() => dispatch({ type: "redo" })}
            type="button"
          >
            Redo
          </button>
          <button
            disabled={saveStatus === "saved" || saveStatus === "saving"}
            onClick={() => void flush()}
            type="button"
          >
            Save now
          </button>
        </div>
        <div className="studio-editor-actions">
          <button
            disabled={selectedIds.size === 0}
            onClick={() => shiftZIndex(-1)}
            type="button"
          >
            Send backward
          </button>
          <button
            disabled={selectedIds.size === 0}
            onClick={() => shiftZIndex(1)}
            type="button"
          >
            Bring forward
          </button>
        </div>
        <MetadataPanel
          deckId={deck.metadata.id}
          onSaved={onSourceChanged}
          slide={slide}
          sourceState={sourceState}
        />
        {editableTextElement ? (
          <TextEditPanel
            deckId={deck.metadata.id}
            element={editableTextElement}
            {...(onTextSaved ? { onTextSaved } : {})}
            key={editableTextElement.id}
            slideId={slide.id}
          />
        ) : null}
        {structuredElement ? (
          <StructuredDataPanel
            deckId={deck.metadata.id}
            element={structuredElement}
            onSaved={onSourceChanged}
            slideId={slide.id}
            sourceState={sourceState}
          />
        ) : null}
        <section className="studio-selection-list">
          <p className="studio-eyebrow">ELEMENTS · {selectedIds.size} SELECTED</p>
          <ul>
            {elements.map((element) => {
              const selected = selectedIds.has(element.id);
              const editable = isEditable(element);
              return (
                <li key={element.id}>
                  <button
                    aria-pressed={selected}
                    disabled={!editable}
                    onClick={() =>
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(element.id)) next.delete(element.id);
                        else next.add(element.id);
                        return next;
                      })
                    }
                    type="button"
                  >
                    <span>{element.type}</span>
                    <strong>{element.id}</strong>
                    {!editable ? <small>locked</small> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="studio-shortcuts">
          <p className="studio-eyebrow">SHORTCUTS</p>
          <dl>
            <div>
              <dt>Move</dt>
              <dd>Arrow / Shift + Arrow</dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>⌘ Z / ⌘ ⇧ Z</dd>
            </div>
            <div>
              <dt>Multi-select</dt>
              <dd>Shift + click / drag</dd>
            </div>
          </dl>
        </section>
        {orphans.length > 0 ? (
          <section className="studio-orphans" role="status">
            <p className="studio-eyebrow">ORPHAN OVERRIDES</p>
            <p>MDXに存在しない要素へのoverrideがあります。</p>
            <ul>
              {orphans.map((orphan) => (
                <li key={orphan}>{orphan}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {saveError ? (
          <p className="studio-editor-error" role="alert">
            {saveError}
          </p>
        ) : null}
      </aside>
    </main>
  );
}
