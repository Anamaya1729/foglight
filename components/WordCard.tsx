"use client";

import { useEffect, useRef, useState } from "react";

export type Sense = { pos: string; text: string; archaic: boolean };
export type WordInfo = { word: string; ipa: string | null; senses: Sense[] };

export type WordQuery = {
  word: string;
  para: number;
  x: number;
  y: number;
  /** where the phrase sits in the paragraph text, so it can be widened by tapping */
  start?: number;
  end?: number;
};

/**
 * Below this, the card is a bottom sheet rather than a popover hung off the word:
 * a phone has nowhere to hang a 360px card, and `hover: none` catches the tablets
 * that are wide enough but still read with a thumb.
 */
const SHEET = "(max-width: 700px), (hover: none)";

const POS_SHORT: Record<string, string> = {
  n: "n.", v: "v.", adj: "adj.", adv: "adv.", u: "", prep: "prep.", pron: "pron.", conj: "conj.",
};

/**
 * Pronunciation comes from the browser's own speech synthesis rather than an audio
 * file, so it works for every word — including the proper nouns no dictionary carries.
 */
function speak(word: string, onEnd: () => void) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return onEnd();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.rate = 0.82;
    u.lang = "en-GB";
    const voice = synth.getVoices().find((v) => /en-GB|en_GB/.test(v.lang)) ?? undefined;
    if (voice) u.voice = voice;
    u.onend = onEnd;
    u.onerror = onEnd;
    synth.speak(u);
  } catch {
    onEnd();
  }
}

export default function WordCard({
  query,
  contextual,
  contextLoading,
  onClose,
  onPickPhrase,
}: {
  query: WordQuery;
  /** the AI's reading of the word in this exact sentence */
  contextual: string;
  contextLoading: boolean;
  onClose: () => void;
  /**
   * Leave the card and go pick a longer phrase by tapping its two ends. Separate from
   * looking anything up: widening used to re-ask the model on every press, which made
   * the card flicker through half-finished phrases nobody asked about.
   */
  onPickPhrase?: () => void;
}) {
  const [info, setInfo] = useState<WordInfo | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [sheet, setSheet] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(SHEET).matches
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(SHEET);
    const on = () => setSheet(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const phrase = /\s/.test(query.word.trim());

  useEffect(() => {
    // A dictionary has entries for words, not for the phrases a reader picks out of a
    // sentence, so a selection of several words gets the contextual reading alone.
    if (phrase) {
      setInfo({ word: query.word, ipa: null, senses: [] });
      return;
    }
    let live = true;
    setInfo(null);
    fetch(`/api/word?w=${encodeURIComponent(query.word)}`)
      .then((r) => r.json())
      .then((d: WordInfo) => live && setInfo(d))
      .catch(() => live && setInfo({ word: query.word, ipa: null, senses: [] }));
    return () => {
      live = false;
    };
  }, [query.word, phrase]);

  useEffect(() => {
    const away = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // A tick's delay, or the click that opened the card closes it again.
    const t = setTimeout(() => document.addEventListener("pointerdown", away), 60);
    document.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* not available */
      }
    };
  }, [onClose]);

  const say = () => {
    setSpeaking(true);
    speak(query.word, () => setSpeaking(false));
  };

  return (
    <>
      {sheet && <div className="wc-scrim" onClick={onClose} aria-hidden="true" />}
      <div
        ref={ref}
        className={`wordcard${sheet ? " sheet" : ""}${phrase ? " phrase" : ""}`}
        style={sheet ? undefined : { left: query.x, top: query.y }}
        role="dialog"
        aria-modal={sheet || undefined}
        aria-label={`Meaning of ${query.word}`}
      >
        <div className="wc-head">
          <span className="wc-word">{query.word}</span>
          {info?.ipa && <span className="wc-ipa">{info.ipa}</span>}
          <button className={`wc-say ${speaking ? "speaking" : ""}`} onClick={say} aria-label={`Read ${query.word} aloud`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9 9 0 0 1 0 13" />
            </svg>
          </button>
          <button className="wc-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {onPickPhrase && (
          <div className="wc-grow">
            <button onClick={onPickPhrase}>Look up a longer phrase…</button>
          </div>
        )}

        <div className="wc-body">
          <p className="wc-sec">{phrase ? "This phrase, here" : "In this sentence"}</p>
          {contextual ? (
            <p className="wc-here">{contextual}</p>
          ) : contextLoading ? (
            <p className="wc-here thinking">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              Reading it in context…
            </p>
          ) : (
            <p className="wc-here" style={{ color: "var(--ink-3)" }}>
              No contextual reading available.
            </p>
          )}

          {info === null ? (
            <>
              <div className="wc-divider" />
              <p style={{ color: "var(--ink-3)", fontSize: 12.5, margin: 0 }}>Looking it up…</p>
            </>
          ) : info.senses.length > 0 ? (
            <>
              <div className="wc-divider" />
              <p className="wc-sec">Dictionary</p>
              {info.senses.map((s, i) => (
                <div className="wc-sense" key={i}>
                  <span className="wc-pos">{POS_SHORT[s.pos] ?? s.pos}</span>
                  <span>
                    {s.archaic && <span className="wc-tag">old use</span>}
                    {s.text}
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
