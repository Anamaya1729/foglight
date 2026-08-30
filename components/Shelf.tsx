"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SHELVES, type ShelfBook } from "@/lib/catalog";
import { loadProgress, type Place } from "@/lib/store";

function Difficulty({ level }: { level: number }) {
  return (
    <span className="pips" title={`Difficulty ${level} of 5`} aria-label={`Difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= level ? "pip on" : "pip"} />
      ))}
    </span>
  );
}

function BookCard({ b }: { b: ShelfBook }) {
  return (
    <Link href={`/read/${b.id}`} className="card">
      <h3>{b.title}</h3>
      <div className="meta">
        {b.year && <span>{b.year}</span>}
        <Difficulty level={b.difficulty} />
      </div>
      {b.note && <p className="note">{b.note}</p>}
    </Link>
  );
}

type Hit = { id: number; title: string; author: string };

export default function Shelf() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPlaces(Object.values(loadProgress()).sort((a, b) => b.at - a.at));
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const d = (await r.json()) as { results: Hit[] };
        setHits(d.results ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 420);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const shelfCount = useMemo(() => SHELVES.reduce((n, s) => n + s.books.length, 0), []);

  return (
    <>
      <div className="topbar">
        <div className="wrap" style={{ display: "flex", alignItems: "center", width: "100%", padding: 0 }}>
          <span className="brand">
            <span className="mark" />
            Foglight
          </span>
          <span className="spacer" />
          <a className="btn ghost sm" href="#how">
            How it works
          </a>
        </div>
      </div>

      <div className="wrap">
        <div className="hero">
          <h1>You are not a bad reader. The sentences are just very long.</h1>
          <p className="lede">
            Dickens wrote for people who read aloud, in instalments, with time. Nietzsche wrote in
            fragments that assume the argument he made two books ago. Tolstoy gives everyone four
            names. Reading the same paragraph five times is the normal result.
          </p>
          <p>
            So: read the real text, unaltered. When a paragraph slides off, tap it and get the same
            paragraph in today&rsquo;s English, right underneath. Ask who someone is and get an answer
            drawn only from the pages you have actually turned. {shelfCount} books, free and complete,
            straight from Project Gutenberg.
          </p>
        </div>

        {places.length > 0 && (
          <div className="section">
            <div className="section-head">
              <h2>Where you left off</h2>
            </div>
            <div className="resume-strip">
              {places.map((p) => (
                <Link key={p.bookId} href={`/read/${p.bookId}?ch=${p.ch}&p=${p.para}`} className="resume">
                  <div className="body">
                    <h4>{p.title}</h4>
                    <div className="where">{p.chapterTitle}</div>
                    <div className="bar">
                      <i style={{ width: `${Math.round(((p.ch + 1) / Math.max(1, p.chapterCount)) * 100)}%` }} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="section" style={{ marginTop: 0 }}>
          <div className="searchbar">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search all of Project Gutenberg…"
              aria-label="Search Project Gutenberg"
            />
          </div>
          {searching && <div className="empty">Searching…</div>}
          {hits && !searching && (
            <div style={{ marginTop: 16 }}>
              {hits.length === 0 ? (
                <div className="empty">Nothing found for &ldquo;{q}&rdquo;.</div>
              ) : (
                <div className="grid">
                  {hits.map((h) => (
                    <Link key={h.id} href={`/read/${h.id}`} className="card">
                      <h3>{h.title}</h3>
                      <div className="meta">{h.author}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {!hits &&
          SHELVES.map((s) => (
            <div className="section" key={s.author}>
              <div className="section-head">
                <h2>{s.author}</h2>
                <p>{s.blurb}</p>
              </div>
              <div className="grid">
                {s.books.map((b) => (
                  <BookCard key={b.id} b={b} />
                ))}
              </div>
            </div>
          ))}

        <div className="section" id="how">
          <div className="section-head">
            <h2>How it works</h2>
            <p>
              Every tool is a switch. Turn them all off and you have a clean, well-set e-reader; turn
              them on one at a time and find the level of help you actually want. Nothing here rewrites
              the book you are reading — the original text is always what is on the page.
            </p>
          </div>
          <div className="grid">
            <div className="card">
              <h3>Focus mode</h3>
              <p className="note">
                One paragraph lit, the rest faded. Your eye cannot slide back up the page, which is
                what causes the re-reading in the first place.
              </p>
            </div>
            <div className="card">
              <h3>Plain English</h3>
              <p className="note">
                The same paragraph in current words, same length, same events, same irony. A crutch to
                lean on for one paragraph, not a replacement to read instead.
              </p>
            </div>
            <div className="card">
              <h3>Who is this again?</h3>
              <p className="note">
                Select a name, get an answer built only from the text behind your bookmark. It cannot
                spoil you because it has not read ahead either.
              </p>
            </div>
            <div className="card">
              <h3>Tap a word</h3>
              <p className="note">
                Tap any word in the paragraph you are on — or click it on a laptop — for how it
                sounds, what the dictionary says including the senses that died out, and what it
                means right here.
              </p>
            </div>
            <div className="card">
              <h3>Untangle</h3>
              <p className="note">
                For the ninety-word sentence with six subordinate clauses: the main clause, then
                everything hanging off it, labelled.
              </p>
            </div>
          </div>
        </div>

        <footer className="foot">
          Texts from <a href="https://www.gutenberg.org">Project Gutenberg</a>, public domain and
          complete. Your place in each book, your settings and every explanation you have asked for
          live in this browser and nowhere else.
          <div className="made">
            <span className="dot" />
            made by anamaya
          </div>
        </footer>
      </div>
    </>
  );
}
