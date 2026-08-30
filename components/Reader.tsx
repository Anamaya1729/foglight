"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import WordCard, { type WordQuery } from "@/components/WordCard";
import {
  DEFAULTS,
  FEATURE_META,
  cacheGet,
  cacheKey,
  cacheSet,
  loadSettings,
  saveSettings,
  savePlace,
  getPlace,
  type Features,
  type Prefs,
  type Settings,
} from "@/lib/store";

type Para = { i: number; text: string; kind: "text" | "heading" | "verse" };
type ChapterMeta = { i: number; title: string; paras: number; chars: number };
type Meta = { id: number; title: string; author: string; totalChars: number; chapters: ChapterMeta[] };
type ChapterData = { i: number; title: string; paras: Para[]; chars: number };

type Mode = "explain" | "untangle" | "who" | "gloss" | "recap";

type Panel = {
  key: string;
  para: number;
  mode: Mode;
  query?: string;
  text: string;
  loading: boolean;
  error?: string;
};

const LABEL: Record<Mode, string> = {
  explain: "In plain English",
  untangle: "Untangled",
  who: "Who / what this is",
  gloss: "Meaning here",
  recap: "Where you were",
};

/**
 * Project Gutenberg marks italics with _underscores_. Left raw they read as typos, so
 * they become real emphasis here.
 */
function Rich({ text }: { text: string }) {
  const parts = text.split(/_([^_\n]+)_/g);
  return (
    <>
      {parts.map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part))}
    </>
  );
}

/**
 * Streamed model output arrives as loose lines. A leading GIST: line is the one-sentence
 * point of the passage and is set apart, because on a paragraph whose difficulty is its
 * shape rather than its words it is the only part the reader could not already see.
 */
/** The model still opens with "The paragraph shows..." now and then; drop the preamble. */
function tighten(gist: string): string {
  const cut = gist.replace(/^(?:the|this)\s+(?:paragraph|passage|text|sentence|line)\s+\S+?s\s+/i, "");
  return cut === gist ? gist : cut.charAt(0).toUpperCase() + cut.slice(1);
}

function Body({ text }: { text: string }) {
  const lines = text
    .replace(/<blank line>/gi, "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <>
      {lines.map((l, i) => {
        const gist = l.match(/^GIST:\s*(.+)$/i);
        return gist ? (
          <p key={i} className="gist">
            {tighten(gist[1])}
          </p>
        ) : (
          <p key={i}>{l}</p>
        );
      })}
    </>
  );
}

export default function Reader({ bookId, initialCh, initialPara }: { bookId: number; initialCh: number; initialPara: number }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [ch, setCh] = useState(initialCh);
  const [cur, setCur] = useState(initialPara);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [recap, setRecap] = useState<Panel | null>(null);
  const [drawer, setDrawer] = useState<"none" | "settings" | "toc">("none");
  const [sel, setSel] = useState<{ x: number; y: number; text: string; para: number; below: boolean } | null>(null);
  const [word, setWord] = useState<WordQuery | null>(null);
  const [wordGloss, setWordGloss] = useState<{ text: string; loading: boolean }>({ text: "", loading: false });
  const tapStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const [scrolled, setScrolled] = useState(0);

  const pageRef = useRef<HTMLDivElement>(null);
  const paraRefs = useRef<Record<number, HTMLParagraphElement | null>>({});
  const { features, prefs } = settings;

  /* ------------------------------------------------------------- settings */

  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
  }, []);

  const update = useCallback((patch: { features?: Partial<Features>; prefs?: Partial<Prefs> }) => {
    setSettings((s) => {
      const next: Settings = {
        features: { ...s.features, ...patch.features },
        prefs: { ...s.prefs, ...patch.prefs },
      };
      saveSettings(next);
      const el = document.documentElement;
      if (next.prefs.theme === "system") el.removeAttribute("data-theme");
      else el.setAttribute("data-theme", next.prefs.theme);
      return next;
    });
  }, []);

  /* ----------------------------------------------------------------- data */

  useEffect(() => {
    let live = true;
    setLoadErr(null);
    fetch(`/api/book/${bookId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not open this book");
        return d as Meta;
      })
      .then((d) => live && setMeta(d))
      .catch((e) => live && setLoadErr(String(e.message || e)));
    return () => {
      live = false;
    };
  }, [bookId]);

  useEffect(() => {
    if (!meta) return;
    let live = true;
    setChapter(null);
    setPanels([]);
    fetch(`/api/book/${bookId}?ch=${ch}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load this chapter");
        return d as { chapter: ChapterData };
      })
      .then((d) => {
        if (!live) return;
        setChapter(d.chapter);
        setCur((c) => Math.min(c, d.chapter.paras.length - 1));
      })
      .catch((e) => live && setLoadErr(String(e.message || e)));
    return () => {
      live = false;
    };
  }, [bookId, ch, meta]);

  /* Remember the place, but not on every keystroke of scrolling. */
  useEffect(() => {
    if (!meta || !chapter) return;
    const t = setTimeout(() => {
      savePlace({
        bookId,
        title: meta.title,
        author: meta.author,
        ch,
        para: cur,
        chapterTitle: chapter.title,
        chapterCount: meta.chapters.length,
        at: Date.now(),
        read: ch,
      });
    }, 700);
    return () => clearTimeout(t);
  }, [bookId, meta, chapter, ch, cur]);

  /* ------------------------------------------------------------ ai calls */

  const ask = useCallback(
    async (mode: Mode, para: number, query?: string) => {
      const key = cacheKey(mode, bookId, ch, para, query);
      const panel: Panel = { key, para, mode, query, text: "", loading: true };

      const hit = cacheGet(key);
      if (hit) {
        const done = { ...panel, text: hit, loading: false };
        if (mode === "recap") setRecap(done);
        else setPanels((p) => [...p.filter((x) => x.key !== key), done]);
        return;
      }

      if (mode === "recap") setRecap(panel);
      else setPanels((p) => [...p.filter((x) => x.key !== key), panel]);

      const put = (fn: (p: Panel) => Panel) => {
        if (mode === "recap") setRecap((r) => (r && r.key === key ? fn(r) : r));
        else setPanels((ps) => ps.map((x) => (x.key === key ? fn(x) : x)));
      };

      try {
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, bookId, ch, para, query }),
        });

        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({ error: "The model could not be reached." }));
          put((p) => ({ ...p, loading: false, error: d.error }));
          return;
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          put((p) => ({ ...p, text: acc }));
        }
        put((p) => ({ ...p, loading: false }));
        if (acc.trim()) cacheSet(key, acc);
      } catch {
        put((p) => ({ ...p, loading: false, error: "The connection dropped before the answer arrived." }));
      }
    },
    [bookId, ch]
  );

  const close = (key: string) => setPanels((p) => p.filter((x) => x.key !== key));

  /** Acting on a selection dismisses it — and with it the system's own selection bar. */
  const dropSelection = () => {
    setSel(null);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* nothing selected */
    }
  };

  /**
   * Tap a word (or click one on a desktop) and it is looked up three ways at once:
   * dictionary senses, pronunciation, and what it means in this particular sentence.
   * Select several words and the same card explains the phrase.
   */
  const lookUpWord = useCallback(
    async (raw: string, para: number, x: number, y: number, span?: { start: number; end: number }) => {
      // Trim the punctuation off both ends but keep the inside intact: a selection of
      // several words ("a countenance of some pretension") is looked up the same way a
      // single one is, since a phrase is exactly where the meaning tends to hide.
      const clean = raw.replace(/\s+/g, " ").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").slice(0, 140);
      if (!clean) return;
      setWord({ word: clean, para, x, y, start: span?.start, end: span?.end });

      const key = cacheKey("gloss", bookId, ch, para, clean);
      const hit = cacheGet(key);
      if (hit) {
        setWordGloss({ text: hit, loading: false });
        return;
      }

      setWordGloss({ text: "", loading: true });
      try {
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "gloss", bookId, ch, para, query: clean }),
        });
        if (!res.ok || !res.body) {
          setWordGloss({ text: "", loading: false });
          return;
        }
        const rd = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setWordGloss({ text: acc, loading: true });
        }
        setWordGloss({ text: acc, loading: false });
        if (acc.trim()) cacheSet(key, acc);
      } catch {
        setWordGloss({ text: "", loading: false });
      }
    },
    [bookId, ch]
  );

  /** Which word is under this point, and where to hang the card. */
  const wordAtPoint = useCallback((clientX: number, clientY: number) => {
    const host = pageRef.current;
    if (!host) return null;
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    let node: Node | null = null;
    let offset = 0;
    const pos = doc.caretPositionFromPoint?.(clientX, clientY);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    } else {
      const r = doc.caretRangeFromPoint?.(clientX, clientY);
      if (r) {
        node = r.startContainer;
        offset = r.startOffset;
      }
    }
    if (!node || node.nodeType !== 3) return null;

    const el = node.parentElement?.closest("[data-para]") as HTMLElement | null;
    if (!el || !host.contains(el)) return null;

    const text = node.textContent ?? "";
    const isWord = (c: string) => /[\p{L}\p{M}'\u2019-]/u.test(c);
    let a = offset;
    let b = offset;
    while (a > 0 && isWord(text[a - 1])) a--;
    while (b < text.length && isWord(text[b])) b++;
    const picked = text.slice(a, b);
    if (!picked || picked.length > 40) return null;

    const range = document.createRange();
    range.setStart(node, a);
    range.setEnd(node, b);
    const rect = range.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    // Where this word sits in the paragraph's own text. Measured with a range rather
    // than string search because the same word usually appears more than once, and
    // markup inside the paragraph means the text is spread over several nodes.
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(node, a);
    const start = pre.toString().length;
    return {
      word: picked,
      para: Number(el.dataset.para),
      x: rect.left + rect.width / 2 - hostRect.left,
      y: rect.bottom - hostRect.top + 10,
      start,
      end: start + picked.length,
    };
  }, []);

  /* ------------------------------------------------------------ pick mode */

  /**
   * WHY THIS EXISTS: the first cut at phrases put "＋ word" buttons on the card and
   * looked the phrase up again on every press. His words: "every word I clicked + it
   * refreshed." Widening a phrase is not a question; it only becomes one when he has
   * finished choosing. So picking and asking are now separate: enter the mode, tap the
   * two ends of what you want, ask once, leave.
   *
   * Still entirely tap-driven. Android hands a long-press-and-drag to its own selection
   * bar before the page sees it, so a real text selection is not available to us on the
   * device this is for.
   */
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<{ para: number; start: number; end: number } | null>(null);

  /** Map character offsets in a paragraph's text back onto a DOM range. */
  const rangeFromOffsets = useCallback((el: HTMLElement, from: number, to: number) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    let seen = 0;
    let started = false;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const len = (n.textContent ?? "").length;
      if (!started && seen + len >= from) {
        r.setStart(n, from - seen);
        started = true;
      }
      if (started && seen + len >= to) {
        r.setEnd(n, to - seen);
        return r;
      }
      seen += len;
    }
    return started ? r : null;
  }, []);

  /**
   * Paint the chosen span with the CSS Custom Highlight API rather than a real DOM
   * Selection — a Selection is precisely what summons the OS menu we are avoiding — and
   * without wrapping anything in a <mark>, which would fight `Rich`'s own <em> spans.
   */
  useEffect(() => {
    // Next 16's CSS parser rejects `::highlight()` as an unknown pseudo-element and
    // fails the build, so the rule is injected here instead of living in globals.css.
    if (!document.getElementById("fg-pick-style")) {
      const tag = document.createElement("style");
      tag.id = "fg-pick-style";
      tag.textContent =
        "::highlight(fg-pick){background:var(--glow);color:var(--ink);" +
        "text-decoration:underline;text-decoration-color:var(--ink-3);text-underline-offset:3px}";
      document.head.appendChild(tag);
    }
    const H = (window as unknown as { Highlight?: typeof Range }).Highlight;
    const store = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (!store || !H) return;
    if (!pick) {
      store.delete("fg-pick");
      return;
    }
    const el = paraRefs.current[pick.para];
    if (!el) return;
    const r = rangeFromOffsets(el, pick.start, pick.end);
    if (!r) return;
    try {
      store.set("fg-pick", new (H as unknown as new (...a: Range[]) => unknown)(r));
    } catch {
      /* older browser: the bar still shows the text, it just is not painted */
    }
    return () => {
      store.delete("fg-pick");
    };
  }, [pick, rangeFromOffsets]);

  const pickText = useMemo(() => {
    if (!pick) return "";
    const el = paraRefs.current[pick.para];
    return (el?.textContent ?? "").slice(pick.start, pick.end).trim();
  }, [pick]);

  /** A tap while picking sets one end of the span; the second tap sets the other. */
  const takePick = useCallback(
    (at: { para: number; start: number; end: number }) => {
      setPick((cur) => {
        if (!cur || cur.para !== at.para) return { para: at.para, start: at.start, end: at.end };
        return {
          para: at.para,
          start: Math.min(cur.start, at.start),
          end: Math.max(cur.end, at.end),
        };
      });
      navigator.vibrate?.(6);
    },
    []
  );

  const askPick = useCallback(() => {
    if (!pick || !pickText) return;
    const el = paraRefs.current[pick.para];
    const host = pageRef.current;
    let x = 0;
    let y = 0;
    if (el && host) {
      const r = rangeFromOffsets(el, pick.start, pick.end);
      const rect = (r ?? el).getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      x = rect.left + rect.width / 2 - hostRect.left;
      y = rect.bottom - hostRect.top + 10;
    }
    lookUpWord(pickText, pick.para, x, y);
    setPicking(false);
    setPick(null);
  }, [pick, pickText, lookUpWord, rangeFromOffsets]);

  /**
   * The model can take half a minute to answer. Fetching the next paragraph's plain
   * English while the reader is still on this one hides almost all of that.
   */
  useEffect(() => {
    if (!ready || !prefs.prefetch || !features.plain || !chapter) return;
    const next = cur + 1;
    if (next >= chapter.paras.length) return;
    const key = cacheKey("explain", bookId, ch, next);
    if (cacheGet(key)) return;

    const t = setTimeout(() => {
      fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "explain", bookId, ch, para: next }),
      })
        .then((r) => (r.ok ? r.text() : null))
        .then((txt) => txt && txt.trim() && cacheSet(key, txt))
        .catch(() => {});
    }, 1800);
    return () => clearTimeout(t);
  }, [ready, prefs.prefetch, features.plain, chapter, cur, bookId, ch]);

  /* ------------------------------------------------------------ movement */

  const goPara = useCallback(
    (n: number) => {
      if (!chapter) return;
      const clamped = Math.max(0, Math.min(n, chapter.paras.length - 1));
      setCur(clamped);
      paraRefs.current[clamped]?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [chapter]
  );

  const goChapter = useCallback(
    (n: number) => {
      if (!meta) return;
      const clamped = Math.max(0, Math.min(n, meta.chapters.length - 1));
      setCh(clamped);
      setCur(0);
      setRecap(null);
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [meta]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (drawer !== "none" && e.key !== "Escape") return;

      switch (e.key) {
        case "Escape":
          setDrawer("none");
          setSel(null);
          setWord(null);
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          goPara(cur + 1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          goPara(cur - 1);
          break;
        case "[":
          goChapter(ch - 1);
          break;
        case "]":
          goChapter(ch + 1);
          break;
        case "e":
          if (features.plain) ask("explain", cur);
          break;
        case "u":
          if (features.untangle) ask("untangle", cur);
          break;
        case "f":
          update({ features: { focus: !features.focus } });
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, ch, drawer, features, goPara, goChapter, ask, update]);

  /* ------------------------------------------------------------ selection */

  useEffect(() => {
    // The popover below renders on `features.words || tracker || untangle`, but this
    // effect used to bail unless tracker or untangle were on — so with only word
    // lookup enabled, `sel` was never set and selecting several words did nothing at
    // all. The two gates have to agree or the feature silently does not exist.
    if (!features.words && !features.tracker && !features.untangle) return;
    const onUp = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      if (!s || !text || text.length > 400) {
        setSel(null);
        return;
      }
      const node = s.anchorNode;
      const el = (node?.nodeType === 3 ? node.parentElement : (node as HTMLElement))?.closest?.("[data-para]");
      if (!el || !pageRef.current?.contains(el)) {
        setSel(null);
        return;
      }
      const rect = s.getRangeAt(0).getBoundingClientRect();
      const host = pageRef.current.getBoundingClientRect();
      // A phone puts its own copy/search bar above the selection, so sit underneath it
      // there. On a mouse, above the selection is where a popover belongs.
      const below = window.matchMedia("(hover: none)").matches;
      setSel({
        x: rect.left + rect.width / 2 - host.left,
        y: below ? rect.bottom - host.top + 10 : rect.top - host.top - 8,
        text,
        para: Number((el as HTMLElement).dataset.para),
        below,
      });
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    // Android finalises a selection AFTER touchend when the drag handles are used,
    // so touchend alone misses every adjustment made with the handles.
    document.addEventListener("selectionchange", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("selectionchange", onUp);
    };
  }, [features.words, features.tracker, features.untangle]);

  /* --------------------------------------------------------------- recap */

  useEffect(() => {
    if (!ready || !features.recaps || !meta || !chapter || ch === 0) return;
    const place = getPlace(bookId);
    const gap = place ? Date.now() - place.at : 0;
    if (place && gap > 6 * 3600 * 1000 && !recap) ask("recap", cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, features.recaps, meta, chapter]);

  /* -------------------------------------------------------------- scroll */

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(h > 0 ? Math.min(1, window.scrollY / h) : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* --------------------------------------------------------------- views */

  const chapterMeta = meta?.chapters[ch];
  const panelsFor = useMemo(() => {
    const by: Record<number, Panel[]> = {};
    for (const p of panels) (by[p.para] ||= []).push(p);
    return by;
  }, [panels]);

  if (loadErr) {
    return (
      <div className="center-note">
        <h2>That book would not open</h2>
        <p style={{ maxWidth: 420, margin: "0 auto 20px" }}>{loadErr}</p>
        <Link className="btn" href="/">
          Back to the shelf
        </Link>
      </div>
    );
  }

  if (!meta || !chapter) {
    return (
      <div className="center-note">
        <div className="thinking">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          Fetching the text from Project Gutenberg…
        </div>
      </div>
    );
  }

  return (
    <div className="reader-shell">
      <div className="hairline" style={{ width: `${scrolled * 100}%` }} />

      <div className="reader-bar">
        <Link className="btn ghost sm" href="/" aria-label="Back to the shelf">
          ←
        </Link>
        <div className="where">
          <div className="bk">{meta.title}</div>
          <div className="ch">{chapterMeta?.title}</div>
        </div>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => setDrawer("toc")}>
          {ch + 1} / {meta.chapters.length}
        </button>
        <button className="btn ghost sm" onClick={() => setDrawer("settings")} aria-label="Reading settings">
          Tools
        </button>
      </div>

      <div
        ref={pageRef}
        className={`page ${prefs.serif ? "serif" : "sans"} ${features.focus ? "focusing" : ""}`}
        style={
          {
            "--measure": prefs.measure,
            "--fsize": `${prefs.fontSize}px`,
            "--dim": prefs.dim,
            position: "relative",
          } as React.CSSProperties
        }
      >
        <h1 className="chapter-title">{chapter.title}</h1>

        {recap && (
          <div className="recap">
            <div className="label">
              {LABEL.recap}
              <button className="x" onClick={() => setRecap(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
            {recap.error ? (
              <p className="err">{recap.error}</p>
            ) : recap.text ? (
              <Body text={recap.text} />
            ) : (
              <p className="thinking">
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
                Reading back over where you got to…
              </p>
            )}
          </div>
        )}

        {features.recaps && !recap && ch > 0 && (
          <button className="tool" style={{ marginBottom: 28 }} onClick={() => ask("recap", cur)}>
            Catch me up on the story so far
          </button>
        )}

        {chapter.paras.map((p) => {
          const isCur = p.i === cur;
          const near = Math.abs(p.i - cur) === 1;
          return (
            <div className="para-wrap" key={p.i}>
              <p
                ref={(el) => {
                  paraRefs.current[p.i] = el;
                }}
                data-para={p.i}
                className={`para ${p.kind === "verse" ? "verse" : ""} ${isCur ? "current" : ""} ${near ? "near" : ""}`}
                onClick={(e) => {
                  if (picking) {
                    const at = wordAtPoint(e.clientX, e.clientY);
                    if (at) takePick({ para: at.para, start: at.start, end: at.end });
                    return;
                  }
                  setCur(p.i);
                  // On a mouse, a plain click on a word is the quickest way in. A drag
                  // is a selection, so leave that to the selection popover. Touch comes
                  // through touchend instead, so ignore the synthetic click behind it.
                  if (!features.words || window.matchMedia("(hover: none)").matches) return;
                  if ((window.getSelection()?.toString() ?? "").trim()) return;
                  const at = wordAtPoint(e.clientX, e.clientY);
                  if (at) lookUpWord(at.word, at.para, at.x, at.y, { start: at.start, end: at.end });
                }}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  tapStart.current = { x: t.clientX, y: t.clientY, at: Date.now() };
                }}
                onTouchEnd={(e) => {
                  const s0 = tapStart.current;
                  tapStart.current = null;
                  const t = e.changedTouches[0];
                  if (!features.words || !s0 || !t) return;
                  // While picking, a tap marks an end of the span and nothing else: it must
                  // not move the reading focus or open a card, or choosing the second word
                  // would scroll the first one out from under him.
                  if (picking) {
                    if (Math.hypot(t.clientX - s0.x, t.clientY - s0.y) > 10) return;
                    const at = wordAtPoint(t.clientX, t.clientY);
                    if (at) {
                      e.preventDefault();
                      takePick({ para: at.para, start: at.start, end: at.end });
                    }
                    return;
                  }
                  // A finger that travelled was scrolling; one that lingered was reaching
                  // for the system's own selection menu. Neither is a tap.
                  if (Math.hypot(t.clientX - s0.x, t.clientY - s0.y) > 10) return;
                  if (Date.now() - s0.at > 500) return;
                  if ((window.getSelection()?.toString() ?? "").trim()) return;
                  // The first tap moves the reading focus to a paragraph; a tap inside the
                  // paragraph you are already on is the one that looks a word up. Without
                  // that, every tap taken to move down the page would throw a card in the way.
                  if (p.i !== cur) return;
                  const at = wordAtPoint(t.clientX, t.clientY);
                  if (at) {
                    // A touch is followed by synthetic mouse events at the same point.
                    // Left alone they reach the card's own click-away and shut it in the
                    // same gesture that opened it.
                    e.preventDefault();
                    navigator.vibrate?.(8);
                    lookUpWord(at.word, at.para, at.x, at.y, { start: at.start, end: at.end });
                  }
                }}
              >
                <Rich text={p.text} />
              </p>

              {isCur && (features.plain || features.untangle) && p.text.length > 80 && (
                <div className="tools">
                  {features.plain && (
                    <button className="tool" onClick={() => ask("explain", p.i)}>
                      Say this plainly
                    </button>
                  )}
                  {features.untangle && p.text.length > 220 && (
                    <button className="tool" onClick={() => ask("untangle", p.i)}>
                      Untangle the sentence
                    </button>
                  )}
                </div>
              )}

              {(panelsFor[p.i] ?? []).map((panel) => (
                <div className="panel" key={panel.key}>
                  <div className="label">
                    {LABEL[panel.mode]}
                    {panel.query && <span style={{ color: "var(--ink-3)" }}>· {panel.query}</span>}
                    <button className="x" onClick={() => close(panel.key)} aria-label="Close">
                      ×
                    </button>
                  </div>
                  {panel.error ? (
                    <>
                      <p className="err">{panel.error}</p>
                      <button
                        className="tool"
                        onClick={() => ask(panel.mode, panel.para, panel.query)}
                      >
                        Try again
                      </button>
                    </>
                  ) : panel.text ? (
                    <div className={panel.loading ? "cursor" : ""}>
                      <Body text={panel.text} />
                    </div>
                  ) : (
                    <p className="thinking">
                      <span className="dots">
                        <i />
                        <i />
                        <i />
                      </span>
                      Working through it…
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        {picking && (
          <div className="pickbar" role="dialog" aria-label="Choose a phrase to look up">
            <div className="pickbar-text">
              {pickText ? (
                <>
                  <span className="pickbar-quote">{pickText}</span>
                </>
              ) : (
                <span className="pickbar-hint">Tap a word. Tap another to reach across to it.</span>
              )}
            </div>
            <div className="pickbar-acts">
              <button
                className="pickbar-go"
                disabled={!pickText}
                onClick={askPick}
              >
                What does this mean?
              </button>
              <button
                className="pickbar-x"
                onClick={() => {
                  setPicking(false);
                  setPick(null);
                }}
                aria-label="Leave phrase picking"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {word && features.words && (
          <WordCard
            query={word}
            contextual={wordGloss.text}
            contextLoading={wordGloss.loading}
            onPickPhrase={
              word.start != null
                ? () => {
                    setPick({ para: word.para, start: word.start!, end: word.end! });
                    setPicking(true);
                    setWord(null);
                    setWordGloss({ text: "", loading: false });
                  }
                : undefined
            }
            onClose={() => {
              setWord(null);
              setWordGloss({ text: "", loading: false });
            }}
          />
        )}

        {sel && (features.words || features.tracker || features.untangle) && (
          <div className={`selpop ${sel.below ? "below" : ""}`} style={{ left: sel.x, top: sel.y }}>
            {features.words && (
              <button
                onClick={() => {
                  lookUpWord(sel.text, sel.para, sel.x, sel.y + 26);
                  dropSelection();
                }}
              >
                {/\s/.test(sel.text.trim()) ? "What does this mean?" : "Define"}
              </button>
            )}
            {features.tracker && (
              <button
                onClick={() => {
                  ask("who", sel.para, sel.text);
                  dropSelection();
                }}
              >
                Who is this?
              </button>
            )}
            {features.untangle && (
              <button
                onClick={() => {
                  ask("untangle", sel.para);
                  dropSelection();
                }}
              >
                Untangle
              </button>
            )}
          </div>
        )}

        <div className="chapnav">
          <button className="btn" onClick={() => goChapter(ch - 1)} disabled={ch === 0}>
            ← Previous
          </button>
          <button className="btn ghost sm" onClick={() => setDrawer("toc")}>
            Contents
          </button>
          <button className="btn primary" onClick={() => goChapter(ch + 1)} disabled={ch >= meta.chapters.length - 1}>
            Next chapter →
          </button>
        </div>

        <div className="made" style={{ justifyContent: "center", marginTop: 34, fontSize: 11.5 }}>
          <span className="dot" />
          made by anamaya
        </div>
      </div>

      {drawer !== "none" && <div className="scrim" onClick={() => setDrawer("none")} />}

      {drawer === "toc" && (
        <div className="drawer left">
          <div className="drawer-head">
            <h3>Contents</h3>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => setDrawer("none")}>
              ×
            </button>
          </div>
          <div className="drawer-body" style={{ padding: 8 }}>
            {meta.chapters.map((c) => (
              <button
                key={c.i}
                className={`toc-item ${c.i < ch ? "done" : ""}`}
                aria-current={c.i === ch}
                onClick={() => {
                  goChapter(c.i);
                  setDrawer("none");
                }}
              >
                <span className="n">{c.i + 1}</span>
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {drawer === "settings" && (
        <div className="drawer">
          <div className="drawer-head">
            <h3>Tools & reading</h3>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => setDrawer("none")}>
              ×
            </button>
          </div>
          <div className="drawer-body">
            {FEATURE_META.map((f) => (
              <div className="toggle-row" key={f.key}>
                <div className="txt">
                  <div className="name">
                    {f.name}
                    {f.shortcut && <span className="kbd">{f.shortcut}</span>}
                  </div>
                  <div className="blurb">{f.blurb}</div>
                </div>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={features[f.key]}
                  aria-label={f.name}
                  onClick={() => update({ features: { [f.key]: !features[f.key] } as Partial<Features> })}
                >
                  <i />
                </button>
              </div>
            ))}

            <div className="toggle-row">
              <div className="txt">
                <div className="name">Read ahead</div>
                <div className="blurb">
                  Quietly prepares the next paragraph&rsquo;s plain English while you are still on this
                  one, so it is waiting when you get there.
                </div>
              </div>
              <button
                className="switch"
                role="switch"
                aria-checked={prefs.prefetch}
                aria-label="Read ahead"
                onClick={() => update({ prefs: { prefetch: !prefs.prefetch } })}
              >
                <i />
              </button>
            </div>

            <div style={{ borderTop: "1px solid var(--rule)", margin: "22px 0 4px" }} />

            <div className="field">
              <label htmlFor="th">Theme</label>
              <div className="seg" id="th">
                {(["system", "light", "sepia", "dark"] as const).map((t) => (
                  <button key={t} aria-pressed={prefs.theme === t} onClick={() => update({ prefs: { theme: t } })}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="tf">Typeface</label>
              <div className="seg" id="tf">
                <button aria-pressed={prefs.serif} onClick={() => update({ prefs: { serif: true } })}>
                  Serif
                </button>
                <button aria-pressed={!prefs.serif} onClick={() => update({ prefs: { serif: false } })}>
                  Sans
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="fs">
                Text size <span>{prefs.fontSize}px</span>
              </label>
              <input
                id="fs"
                type="range"
                min={15}
                max={30}
                value={prefs.fontSize}
                onChange={(e) => update({ prefs: { fontSize: Number(e.target.value) } })}
              />
            </div>

            <div className="field">
              <label htmlFor="ms">
                Line width <span>{prefs.measure} characters</span>
              </label>
              <input
                id="ms"
                type="range"
                min={45}
                max={100}
                value={prefs.measure}
                onChange={(e) => update({ prefs: { measure: Number(e.target.value) } })}
              />
            </div>

            <div className="field">
              <label htmlFor="dm">
                How far the rest of the page fades <span>{Math.round(prefs.dim * 100)}%</span>
              </label>
              <input
                id="dm"
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={prefs.dim}
                onChange={(e) => update({ prefs: { dim: Number(e.target.value) } })}
              />
            </div>

            <p className="note-line">
              Keyboard: <span className="kbd">J</span> <span className="kbd">K</span> move a paragraph,{" "}
              <span className="kbd">E</span> explains it, <span className="kbd">U</span> untangles it,{" "}
              <span className="kbd">F</span> toggles focus, <span className="kbd">[</span>{" "}
              <span className="kbd">]</span> change chapter.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
