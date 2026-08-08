import type { DeckIR, SlideIR } from "@editable-slides/slide-deck-ir";
import {
  DeckReadiness,
  PrintDeck,
  ResponsiveSlide,
} from "@editable-slides/slide-renderer-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "./editor.js";
import type { OverrideDocument } from "./overrides.js";
import { PresenterView } from "./presenter.js";
import { parseStudioRoute, routePath, type StudioRoute } from "./routes.js";
import { SlideActions } from "./slide-actions.js";
import { useDeckData } from "./use-deck-data.js";

interface SyncMessage {
  type: "navigate";
  sender: string;
  deckId: string;
  slideId: string;
}

function clampSlide(index: number, deck: DeckIR): number {
  return Math.max(0, Math.min(deck.slides.length - 1, index));
}

function slideRoute(
  kind: "edit" | "presenter",
  deckId: string,
  slide: SlideIR,
): StudioRoute {
  return { kind, deckId, slideId: slide.id };
}

function ViewportSlide({
  deck,
  slide,
  overrides,
  mode = "normal",
}: {
  deck: DeckIR;
  slide: SlideIR;
  overrides: OverrideDocument;
  mode?: "normal" | "overview" | "debug";
}) {
  return (
    <ResponsiveSlide
      deck={deck}
      frameOverrides={overrides.slides[slide.id]}
      mode={mode}
      safeArea={deck.theme.safeArea}
      slide={slide}
    />
  );
}

function DebugIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M9 5.5 7.5 3.8M15 5.5l1.5-1.7M6 9H3.8M20.2 9H18M6 14H3.8m16.4 0H18M8 19.5h8M7 10a5 5 0 0 1 10 0v4a5 5 0 0 1-10 0v-4Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="M12 8v10" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function Toolbar({
  deck,
  debugOpen,
  index,
  next,
  previous,
  openPresenter,
  toggleDebug,
}: {
  deck: DeckIR;
  debugOpen: boolean;
  index: number;
  next: () => void;
  previous: () => void;
  openPresenter: () => void;
  toggleDebug: () => void;
}) {
  return (
    <header className="studio-toolbar">
      <div className="studio-brand">
        <span className="studio-mark" aria-hidden="true">
          L
        </span>
        <span className="studio-brand-copy">
          <strong>{deck.metadata.title}</strong>
          <small>{deck.metadata.id}</small>
        </span>
      </div>
      <span className="studio-toolbar-mode">Edit</span>
      <div className="studio-pager">
        <button
          aria-label="前のスライド"
          disabled={index === 0}
          onClick={previous}
          type="button"
        >
          ←
        </button>
        <span>
          {index + 1} / {deck.slides.length}
        </span>
        <button
          aria-label="次のスライド"
          disabled={index === deck.slides.length - 1}
          onClick={next}
          type="button"
        >
          →
        </button>
        <DeckReadiness deck={deck}>
          {(ready) => (
            <span
              className="studio-ready"
              data-ready={ready}
              title={ready ? "描画準備完了" : "フォント・画像を読み込み中"}
            />
          )}
        </DeckReadiness>
        <span className="studio-toolbar-divider" aria-hidden="true" />
        <button
          aria-label="発表者画面を開く"
          className="studio-presenter-button"
          onClick={openPresenter}
          title="発表者画面を別ウィンドウで開く"
          type="button"
        >
          ▶
        </button>
        <button
          aria-controls="studio-debug-drawer"
          aria-expanded={debugOpen}
          aria-label={debugOpen ? "デバッグを閉じる" : "デバッグを表示"}
          className="studio-debug-button"
          onClick={toggleDebug}
          title={debugOpen ? "デバッグを閉じる" : "デバッグを表示"}
          type="button"
        >
          <DebugIcon />
        </button>
      </div>
    </header>
  );
}

function ThumbnailRail({
  deck,
  activeIndex,
  openSlide,
  overrides,
  actions,
}: {
  deck: DeckIR;
  activeIndex: number;
  openSlide: (index: number) => void;
  overrides: OverrideDocument;
  actions?: React.ReactNode;
}) {
  return (
    <aside className="studio-thumbnail-rail">
      <div className="studio-thumbnail-head">
        <div>
          <strong>ページ</strong>
          <span>{deck.slides.length}</span>
        </div>
        {actions}
      </div>
      <nav aria-label="スライド一覧" className="studio-thumbnail-list">
        {deck.slides.map((slide, index) => (
          <button
            aria-current={index === activeIndex ? "page" : undefined}
            aria-label={`${index + 1}枚目: ${slide.id}`}
            className="studio-thumbnail"
            key={slide.id}
            onClick={() => openSlide(index)}
            type="button"
          >
            <span className="studio-thumbnail-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="studio-thumbnail-canvas" aria-hidden="true">
              <ViewportSlide
                deck={deck}
                mode="overview"
                overrides={overrides}
                slide={slide}
              />
            </span>
            <span className="studio-thumbnail-id">{slide.id}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function DebugDrawer({
  close,
  deck,
  overrides,
  slide,
}: {
  close: () => void;
  deck: DeckIR;
  overrides: OverrideDocument;
  slide: SlideIR;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const diagnostics = deck.diagnostics.filter(
    (diagnostic) => !diagnostic.slideId || diagnostic.slideId === slide.id,
  );

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <div className="studio-debug-overlay">
      <button
        aria-label="デバッグを閉じる"
        className="studio-debug-backdrop"
        onClick={close}
        type="button"
      />
      <aside
        aria-label="スライドのデバッグ情報"
        aria-modal="true"
        className="studio-debug-drawer"
        id="studio-debug-drawer"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="studio-debug-head">
          <div>
            <p className="studio-eyebrow">DEBUG</p>
            <h2>{slide.id}</h2>
          </div>
          <button aria-label="デバッグを閉じる" onClick={close} type="button">
            ×
          </button>
        </div>
        <dl>
          <div>
            <dt>Layout</dt>
            <dd>{slide.layoutId}</dd>
          </div>
          <div>
            <dt>Elements</dt>
            <dd>{slide.elements.length}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{slide.sourcePath}</dd>
          </div>
          <div>
            <dt>Diagnostics</dt>
            <dd>{diagnostics.length}</dd>
          </div>
        </dl>
        {diagnostics.length > 0 ? (
          <ul className="studio-diagnostic-list">
            {diagnostics.map((diagnostic) => (
              <li
                data-severity={diagnostic.severity}
                key={[
                  diagnostic.code,
                  diagnostic.slideId,
                  diagnostic.elementId,
                  diagnostic.message,
                ].join(":")}
              >
                <strong>{diagnostic.code}</strong>
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="studio-muted">このスライドに診断はありません。</p>
        )}
        <details className="studio-debug-ir">
          <summary>Slide IR</summary>
          <pre>
            {JSON.stringify(
              {
                slide,
                frameOverrides: overrides.slides[slide.id] ?? {},
              },
              null,
              2,
            )}
          </pre>
        </details>
      </aside>
    </div>
  );
}

function ErrorView({
  deckId,
  error,
  retry,
}: {
  deckId: string;
  error: string;
  retry: () => void;
}) {
  return (
    <main className="studio-state">
      <div className="studio-state-card">
        <span className="studio-state-code">DECK NOT READY</span>
        <h1>{deckId}</h1>
        <p>{error}</p>
        <code>
          EDITABLE_SLIDES_DECK_DIR=/path/to/deck
          EDITABLE_SLIDES_DECK_IR=/path/to/deck.ir.json npm run dev
          --workspace=@editable-slides/slide-studio
        </code>
        <button onClick={retry} type="button">
          Retry
        </button>
      </div>
    </main>
  );
}

export function App() {
  const [route, setRoute] = useState(() =>
    parseStudioRoute(window.location.pathname, window.location.search),
  );
  const routeRef = useRef(route);
  const [activeIndex, setActiveIndex] = useState(0);
  const [debugOpen, setDebugOpen] = useState(false);
  const pendingSlideId = useRef<string | undefined>(undefined);
  const sender = useRef(crypto.randomUUID());
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const data = useDeckData(route.deckId);

  const visit = useCallback((nextRoute: StudioRoute, replace = false) => {
    routeRef.current = nextRoute;
    setRoute(nextRoute);
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      routePath(nextRoute),
    );
  }, []);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    const canonicalPath = routePath(route);
    if (window.location.pathname !== canonicalPath || window.location.search) {
      window.history.replaceState({}, "", canonicalPath);
    }
  }, [route]);

  useEffect(() => {
    const onPopState = () => {
      setDebugOpen(false);
      setRoute(parseStudioRoute(window.location.pathname, window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!data.deck || route.kind === "print" || !route.slideId) return;
    const index = data.deck.slides.findIndex((slide) => slide.id === route.slideId);
    if (index >= 0) setActiveIndex(index);
  }, [data.deck, route]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const syncChannel = new BroadcastChannel(`editable-slides-cli:${route.deckId}`);
    channel.current = syncChannel;
    syncChannel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const message = event.data;
      const currentDeck = data.deck;
      if (
        message.type !== "navigate" ||
        message.sender === sender.current ||
        message.deckId !== route.deckId ||
        !currentDeck
      ) {
        return;
      }
      const index = currentDeck.slides.findIndex(
        (slide) => slide.id === message.slideId,
      );
      if (index < 0) return;
      setActiveIndex(index);
      const currentRoute = routeRef.current;
      if (currentRoute.kind === "edit" || currentRoute.kind === "presenter") {
        visit(
          slideRoute(
            currentRoute.kind,
            currentRoute.deckId,
            currentDeck.slides[index] as SlideIR,
          ),
          true,
        );
      }
    };
    return () => {
      syncChannel.close();
      if (channel.current === syncChannel) channel.current = undefined;
    };
  }, [data.deck, route.deckId, visit]);

  const goToSlide = useCallback(
    (requestedIndex: number, publish = true) => {
      const deck = data.deck;
      if (!deck || deck.slides.length === 0) return;
      const index = clampSlide(requestedIndex, deck);
      const slide = deck.slides[index];
      if (!slide) return;
      setActiveIndex(index);
      const currentRoute = routeRef.current;
      if (currentRoute.kind === "edit" || currentRoute.kind === "presenter") {
        visit(slideRoute(currentRoute.kind, currentRoute.deckId, slide), true);
      }
      if (publish) {
        channel.current?.postMessage({
          type: "navigate",
          sender: sender.current,
          deckId: deck.metadata.id,
          slideId: slide.id,
        } satisfies SyncMessage);
      }
    },
    [data.deck, visit],
  );

  useEffect(() => {
    const selectedSlideId = pendingSlideId.current;
    if (!selectedSlideId || !data.deck) return;
    const index = data.deck.slides.findIndex(
      (candidate) => candidate.id === selectedSlideId,
    );
    if (index < 0) return;
    pendingSlideId.current = undefined;
    goToSlide(index);
  }, [data.deck, goToSlide]);

  if (data.loading && !data.deck) {
    return (
      <main className="studio-state">
        <div
          className="studio-loader"
          aria-label="スライドを読み込み中"
          role="status"
        />
      </main>
    );
  }
  if (!data.deck) {
    return (
      <ErrorView
        deckId={route.deckId}
        error={data.error ?? "Deck could not be loaded."}
        retry={() => void data.reloadDeck()}
      />
    );
  }
  if (data.deck.slides.length === 0) {
    return (
      <ErrorView
        deckId={route.deckId}
        error="Deck has no slides."
        retry={() => void data.reloadDeck()}
      />
    );
  }

  const deck = data.deck;
  const safeIndex = clampSlide(activeIndex, deck);
  const slide = deck.slides[safeIndex] as SlideIR;
  const previous = () => goToSlide(safeIndex - 1);
  const next = () => goToSlide(safeIndex + 1);

  if (route.kind === "print") {
    return (
      <DeckReadiness deck={deck}>
        {() => <PrintDeck deck={deck} frameOverridesBySlide={data.overrides.slides} />}
      </DeckReadiness>
    );
  }

  if (route.kind === "presenter") {
    return (
      <PresenterView
        deck={deck}
        index={safeIndex}
        next={next}
        openEditor={() => visit(slideRoute("edit", deck.metadata.id, slide))}
        overrides={data.overrides}
        previous={previous}
      />
    );
  }

  return (
    <div className="studio-app" data-route="edit">
      <Toolbar
        debugOpen={debugOpen}
        deck={deck}
        index={safeIndex}
        next={next}
        openPresenter={() =>
          window.open(
            routePath(slideRoute("presenter", deck.metadata.id, slide)),
            "_blank",
            "noopener,noreferrer",
          )
        }
        previous={previous}
        toggleDebug={() => setDebugOpen((open) => !open)}
      />
      {data.error ? (
        <div className="studio-toast" role="status">
          {data.error}
        </div>
      ) : null}
      <div className="studio-workbench">
        <ThumbnailRail
          activeIndex={safeIndex}
          deck={deck}
          openSlide={goToSlide}
          overrides={data.overrides}
          actions={
            <SlideActions
              deckId={deck.metadata.id}
              index={safeIndex}
              onMutated={(result) => {
                pendingSlideId.current = result.selectedSlideId;
                data.setSourceState(result);
                window.setTimeout(() => {
                  void Promise.all([data.reloadDeck(), data.reloadSourceState()]);
                }, 250);
              }}
              slide={slide}
              slideCount={deck.slides.length}
              sourceState={data.sourceState}
            />
          }
        />
        <div className="studio-workbench-main">
          <EditorView
            deck={deck}
            initialDocument={data.overrides}
            onDocumentSaved={data.setOverrides}
            onSourceChanged={(state) => {
              data.setSourceState(state);
              window.setTimeout(() => {
                void Promise.all([data.reloadDeck(), data.reloadSourceState()]);
              }, 250);
            }}
            onTextSaved={() =>
              void Promise.all([data.reloadDeck(), data.reloadSourceState()])
            }
            slide={slide}
            sourceState={data.sourceState}
          />
        </div>
      </div>
      {debugOpen ? (
        <DebugDrawer
          close={() => setDebugOpen(false)}
          deck={deck}
          overrides={data.overrides}
          slide={slide}
        />
      ) : null}
    </div>
  );
}
