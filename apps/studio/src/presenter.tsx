import type { DeckIR, SlideIR } from "@editable-slides/slide-deck-ir";
import { ResponsiveSlide } from "@editable-slides/slide-renderer-react";
import { useEffect, useMemo, useState } from "react";

import type { OverrideDocument } from "./overrides.js";

function displayTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function PresenterView({
  deck,
  index,
  next,
  openEditor,
  overrides,
  previous,
}: {
  deck: DeckIR;
  index: number;
  next: () => void;
  openEditor: () => void;
  overrides: OverrideDocument;
  previous: () => void;
}) {
  const slide = deck.slides[index] as SlideIR;
  const nextSlide = deck.slides[index + 1];
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const interactive =
        target instanceof HTMLButtonElement ||
        target instanceof HTMLAnchorElement ||
        target instanceof HTMLInputElement;
      if (interactive && event.key === " ") return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        next();
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        previous();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, previous]);

  const sources = useMemo(() => slide.notes.sources, [slide]);

  return (
    <main className="studio-presenter" aria-label="発表者画面">
      <header className="studio-presenter-toolbar">
        <div>
          <strong>{deck.metadata.title}</strong>
          <span>
            {index + 1} / {deck.slides.length}
          </span>
        </div>
        <div
          className="studio-presenter-clock"
          aria-label={`経過時間 ${displayTime(seconds)}`}
          role="timer"
        >
          <strong>{displayTime(seconds)}</strong>
          <button onClick={() => setRunning((value) => !value)} type="button">
            {running ? "一時停止" : "再開"}
          </button>
          <button onClick={() => setSeconds(0)} type="button">
            リセット
          </button>
          <button onClick={openEditor} type="button">
            編集画面
          </button>
        </div>
      </header>
      <section className="studio-presenter-current" aria-label="現在のスライド">
        <ResponsiveSlide
          deck={deck}
          frameOverrides={overrides.slides[slide.id]}
          safeArea={deck.theme.safeArea}
          slide={slide}
        />
      </section>
      <aside className="studio-presenter-notes">
        <p className="studio-eyebrow">発表者原稿</p>
        <div className="studio-presenter-note-copy">
          {slide.notes.markdown || "このページには発表者原稿がありません。"}
        </div>
        {sources.length > 0 ? (
          <section>
            <p className="studio-eyebrow">出典</p>
            <ul>
              {sources.map((source) => (
                <li key={`${source.label}:${source.url ?? ""}`}>
                  {source.url ? (
                    <a href={source.url} rel="noreferrer" target="_blank">
                      {source.label}
                    </a>
                  ) : (
                    source.label
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
      <aside className="studio-presenter-next" aria-label="次のスライド">
        <p className="studio-eyebrow">次のページ</p>
        {nextSlide ? (
          <div className="studio-presenter-next-canvas">
            <ResponsiveSlide
              deck={deck}
              frameOverrides={overrides.slides[nextSlide.id]}
              mode="overview"
              safeArea={deck.theme.safeArea}
              slide={nextSlide}
            />
          </div>
        ) : (
          <p>最後のページです。</p>
        )}
        <div className="studio-presenter-nav">
          <button disabled={index === 0} onClick={previous} type="button">
            前へ
          </button>
          <button disabled={!nextSlide} onClick={next} type="button">
            次へ
          </button>
        </div>
      </aside>
    </main>
  );
}
