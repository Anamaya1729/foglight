export type Paragraph = { i: number; text: string; kind: "text" | "heading" | "verse" };
export type Chapter = { i: number; title: string; paras: Paragraph[]; chars: number };
export type ParsedBook = {
  id: number;
  title: string;
  author: string;
  chapters: Chapter[];
  totalChars: number;
};

const START_RE = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
const END_RE = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;

/** A "strong" heading is unambiguous: CHAPTER IV, STAVE II, XVII., 42. */
const STRONG_RE = new RegExp(
  "^(?:" +
    "(?:CHAPTER|Chapter|CHAP|Chap|STAVE|Stave|BOOK|Book|PART|Part|VOLUME|Volume|VOL|LETTER|Letter|ACT|Act|SCENE|Scene|CANTO|Canto|SECTION|Section|EPILOGUE|Epilogue|PROLOGUE|Prologue|PREFACE|Preface|INTRODUCTION|Introduction|APPENDIX|Appendix|CONCLUSION|Conclusion)\\b[^\\n]{0,80}" +
    "|[IVXLCDM]{1,7}\\.?" +
    "|\\d{1,3}\\.?" +
  ")$"
);

/** A "weak" heading is an all-caps line. Only trusted when the book has no strong ones. */
const WEAK_RE = /^[A-Z0-9][A-Z0-9 '\u2019\-.,;:!?()&]{2,70}$/;

const TOC_HINT_RE =
  /(chapter|book|part|canto|stave)\s+(\d+|[ivxlcdm]+\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/gi;
const CONTENTS_RE = /^(contents|table of contents|index)\b/i;

const STRUCTURAL_RE = /^(?:book|part|volume|vol\.)\b/i;

function stripBoilerplate(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n");
  const s = t.match(START_RE);
  if (s && s.index !== undefined) t = t.slice(s.index + s[0].length);
  const e = t.match(END_RE);
  if (e && e.index !== undefined) t = t.slice(0, e.index);
  // Gutenberg often repeats title/author/"Produced by" after the start marker.
  t = t.replace(/^[\s\S]{0,3000}?\n\s*(?:Produced by|Transcribed from|E-text prepared by)[^\n]*\n/i, "\n");
  return t.trim();
}

function readMeta(raw: string): { title: string; author: string } {
  const head = raw.slice(0, 4000).replace(/\r/g, "");
  const title = head.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const author = head.match(/^Author:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { title, author };
}

/** Join hard-wrapped lines into real paragraphs, preserving verse line breaks. */
function toBlocks(body: string): { text: string; verse: boolean }[] {
  const chunks = body.split(/\n[ \t]*\n+/);
  const out: { text: string; verse: boolean }[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.replace(/\s+$/, ""));
    const meaningful = lines.filter((l) => l.trim());
    if (!meaningful.length) continue;
    // Verse: most lines short AND consistently indented. Keep their line breaks.
    const short = meaningful.filter((l) => l.trim().length < 60).length;
    const indented = meaningful.filter((l) => /^\s{2,}/.test(l)).length;
    const verse =
      meaningful.length > 1 &&
      short / meaningful.length > 0.7 &&
      indented / meaningful.length > 0.6;
    if (verse) {
      out.push({ text: meaningful.map((l) => l.trim()).join("\n"), verse: true });
    } else {
      const text = meaningful.map((l) => l.trim()).join(" ").replace(/\s{2,}/g, " ").trim();
      if (text) out.push({ text, verse: false });
    }
  }
  return out;
}

type HeadKind = "strong" | "weak" | null;

function headingKind(text: string, verse: boolean): HeadKind {
  if (verse) return null;
  const t = text.trim();
  if (t.length > 90 || t.length < 1) return null;
  if (STRONG_RE.test(t)) return "strong";
  // A line ending in sentence punctuation is prose, not a title.
  if (/[.!?]["\u2019\u201d']?$/.test(t)) return null;
  if (WEAK_RE.test(t)) return "weak";
  return null;
}

/** A run of >=4 headings with no prose between them is a table of contents. */
function dropTocRuns<T extends { title: string; head: HeadKind; blocks: unknown[] }>(drafts: T[]): T[] {
  const keep = drafts.map(() => true);
  let runStart = -1;
  for (let i = 0; i <= drafts.length; i++) {
    const isStub = i < drafts.length && drafts[i].head !== null && drafts[i].blocks.length === 0;
    if (isStub) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0 && i - runStart >= 4) {
        for (let j = runStart; j < i; j++) keep[j] = false;
        // The last entry of a contents list often absorbs a scrap of the page that
        // followed it. If that draft is tiny, it belongs to the list, not the book.
        const tail = drafts[i] as unknown as { blocks: { text: string }[] } | undefined;
        if (tail && tail.blocks.reduce((n, b) => n + b.text.length, 0) < 500) keep[i] = false;
      }
      runStart = -1;
    }
  }
  // Also drop an explicit "CONTENTS" heading and any list-shaped block under it.
  for (let i = 0; i < drafts.length; i++) {
    if (CONTENTS_RE.test(drafts[i].title.trim())) {
      const body = (drafts[i].blocks as { text: string }[]).map((b) => b.text).join(" ");
      if ((body.match(TOC_HINT_RE) || []).length >= 4 || body.length < 2000) keep[i] = false;
    }
  }
  return drafts.filter((_, i) => keep[i]);
}

export function parseGutenberg(raw: string, id: number): ParsedBook {
  const meta = readMeta(raw);
  const body = stripBoilerplate(raw);
  const blocks = toBlocks(body);

  type Draft = { title: string; head: HeadKind; blocks: { text: string; verse: boolean }[] };

  // Pass 1: how the book signposts itself. If it has real CHAPTER markers we trust
  // only those; an all-caps line mid-prose is then just emphasis, not a new chapter.
  const kinds = blocks.map((b) => headingKind(b.text, b.verse));
  const strongCount = kinds.filter((k) => k === "strong").length;
  const strongMode = strongCount >= 3;

  // Pass 2: cut into drafts.
  const drafts: Draft[] = [];
  let cur: Draft = { title: "", head: null, blocks: [] };
  blocks.forEach((b, i) => {
    const k = kinds[i];
    const isBoundary = k === "strong" || (k === "weak" && !strongMode);
    if (isBoundary) {
      if (cur.title || cur.blocks.length) drafts.push(cur);
      cur = { title: b.text.trim(), head: k, blocks: [] };
    } else {
      cur.blocks.push(b);
    }
  });
  if (cur.title || cur.blocks.length) drafts.push(cur);

  // Pass 3: throw away tables of contents.
  const cleaned = dropTocRuns(drafts);

  // Pass 4: a lone "BOOK ONE: 1805" above "CHAPTER I" is a label for it, not a chapter.
  // Carry at most two such labels so a stray run can never build a monster title.
  const merged: Draft[] = [];
  let carried: string[] = [];
  for (const d of cleaned) {
    if (d.head && d.blocks.length === 0) {
      const listy = (d.title.match(TOC_HINT_RE) || []).length >= 3;
      if (listy) carried = [];
      else if (STRUCTURAL_RE.test(d.title)) carried = [...carried, d.title].slice(-2);
      else carried = [d.title];
      continue;
    }
    const title = [...carried, d.title].filter(Boolean).join(" \u00b7 ");
    merged.push({ ...d, title });
    carried = [];
  }

  // Pass 5: in strong mode, anything before the first CHAPTER is a title page. Drop it
  // unless it is long enough to be real prose the reader would miss.
  let start = 0;
  if (strongMode) {
    while (start < merged.length && merged[start].head !== "strong") {
      const size = merged[start].blocks.reduce((n, b) => n + b.text.length, 0);
      if (size > 2000) break;
      start++;
    }
    if (start >= merged.length) start = 0;
  }

  let chapters: Chapter[] = merged
    .slice(start)
    .filter((d) => d.blocks.length > 0)
    .map((d, i) => {
      const paras: Paragraph[] = d.blocks.map((b, j) => ({
        i: j,
        text: b.text,
        kind: b.verse ? "verse" : "text",
      }));
      return {
        i,
        title: d.title || `Section ${i + 1}`,
        paras,
        chars: paras.reduce((n, p) => n + p.text.length, 0),
      };
    });

  // Pass 5b: a short opening chapter in a signposted book is a title-page scrap, not
  // writing. Keep it only if it announces itself as something the reader wants.
  const KEEPS_LEAD = /^(preface|introduction|prologue|dedication|foreword|author|translator)/i;
  const JUNK_LEAD =
    /^(volume|vol\.|edited|translated|printed|published|copyright|all rights|london|edinburgh|new york|first published|complete works)\b/i;
  let dropped = 0;
  while (strongMode && chapters.length > 1 && dropped < 5) {
    const head = chapters[0];
    const junk = JUNK_LEAD.test(head.title) || (head.chars < 800 && !KEEPS_LEAD.test(head.title));
    if (!junk) break;
    chapters.shift();
    dropped++;
  }

  // Pass 6: fold scraps into their neighbour so the chapter list has no dead entries.
  // The floor is low on purpose: a single Nietzsche aphorism is a legitimate chapter.
  const MIN = 300;
  const folded: Chapter[] = [];
  for (const c of chapters) {
    const prev = folded[folded.length - 1];
    if (c.chars < MIN && prev) {
      prev.paras.push(...c.paras.map((p, j) => ({ ...p, i: prev.paras.length + j })));
      prev.chars += c.chars;
    } else {
      folded.push(c);
    }
  }
  chapters = folded;

  // Pass 7: an unsignposted appendix can run to six figures of characters. Break it up
  // so a chapter is always something a person could finish in a sitting.
  const MAX = 40000;
  const split: Chapter[] = [];
  for (const c of chapters) {
    if (c.chars <= MAX) {
      split.push(c);
      continue;
    }
    const parts = Math.ceil(c.chars / MAX);
    const per = Math.ceil(c.paras.length / parts);
    for (let k = 0; k < parts; k++) {
      const paras = c.paras.slice(k * per, (k + 1) * per).map((p, j) => ({ ...p, i: j }));
      if (!paras.length) continue;
      split.push({
        i: split.length,
        title: `${c.title} (${k + 1}/${parts})`,
        paras,
        chars: paras.reduce((n, p) => n + p.text.length, 0),
      });
    }
  }
  chapters = split;

  // Nothing usable came out: fall back to fixed-size sections so the book still reads.
  if (chapters.length < 2) {
    const flat = blocks.map((b, j) => ({
      i: j,
      text: b.text,
      kind: b.verse ? ("verse" as const) : ("text" as const),
    }));
    chapters = [];
    const SIZE = 45;
    for (let s = 0; s < flat.length; s += SIZE) {
      const paras = flat.slice(s, s + SIZE).map((p, j) => ({ ...p, i: j }));
      chapters.push({
        i: chapters.length,
        title: `Section ${chapters.length + 1}`,
        paras,
        chars: paras.reduce((n, p) => n + p.text.length, 0),
      });
    }
  }

  chapters.forEach((c, i) => {
    c.i = i;
    c.paras.forEach((p, j) => (p.i = j));
  });

  return {
    id,
    title: meta.title || `Project Gutenberg #${id}`,
    author: meta.author || "Unknown",
    chapters,
    totalChars: chapters.reduce((n, c) => n + c.chars, 0),
  };
}

const TXT_URLS = (id: number) => [
  `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
  `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
  `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`,
];

export async function fetchRawBook(id: number): Promise<string> {
  let lastErr = "";
  for (const url of TXT_URLS(id)) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Foglight/1.0 (reading assistant)" },
        next: { revalidate: 60 * 60 * 24 * 30 },
      } as RequestInit & { next?: { revalidate: number } });
      if (r.ok) {
        const t = await r.text();
        if (t.length > 5000) return t;
        lastErr = `short body from ${url}`;
      } else {
        lastErr = `${r.status} from ${url}`;
      }
    } catch (e) {
      lastErr = String(e);
    }
  }
  throw new Error(`Could not fetch book ${id}: ${lastErr}`);
}

/** Warm-lambda memo so a chapter flip doesn't re-download War and Peace. */
const memo = new Map<number, ParsedBook>();
const MEMO_MAX = 4;

export async function getBook(id: number): Promise<ParsedBook> {
  const hit = memo.get(id);
  if (hit) return hit;
  const parsed = parseGutenberg(await fetchRawBook(id), id);
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as number);
  memo.set(id, parsed);
  return parsed;
}
