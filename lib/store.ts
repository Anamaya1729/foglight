"use client";

export type Features = {
  focus: boolean;
  plain: boolean;
  tracker: boolean;
  untangle: boolean;
  words: boolean;
  recaps: boolean;
};

export type Prefs = {
  theme: "system" | "light" | "dark" | "sepia";
  serif: boolean;
  fontSize: number; // px
  measure: number; // characters per line, roughly
  dim: number; // 0–1, how far unfocused paragraphs fade
  prefetch: boolean;
};

export type Settings = { features: Features; prefs: Prefs };

export const DEFAULTS: Settings = {
  features: { focus: true, plain: true, tracker: true, untangle: true, words: true, recaps: true },
  prefs: { theme: "system", serif: true, fontSize: 20, measure: 68, dim: 0.72, prefetch: true },
};

export const FEATURE_META: {
  key: keyof Features;
  name: string;
  blurb: string;
  shortcut?: string;
}[] = [
  {
    key: "focus",
    name: "Focus mode",
    blurb: "Everything but the paragraph you are on fades back. This is the one that stops the re-reading.",
    shortcut: "F",
  },
  {
    key: "plain",
    name: "Plain English",
    blurb: "Tap a paragraph you have lost and get the same paragraph in today's words, beside the original.",
    shortcut: "E",
  },
  {
    key: "tracker",
    name: "Character & term tracker",
    blurb: "Select any name and ask who it is. Answered only from what you have already read — it cannot spoil you.",
    shortcut: "W",
  },
  {
    key: "untangle",
    name: "Sentence untangler",
    blurb: "Splits a runaway sentence into its main clause and everything hanging off it.",
    shortcut: "U",
  },
  {
    key: "words",
    name: "Word lookup",
    blurb:
      "Tap a word on a touchscreen \u2014 once to settle on the paragraph, then on the word itself \u2014 or click one with a mouse, for its pronunciation, its dictionary senses \u2014 old ones included \u2014 and what it means in this particular sentence.",
  },
  {
    key: "recaps",
    name: "Recaps & progress",
    blurb: "A reminder of where you were when you come back, plus your place in every book kept for you.",
  },
];

const SETTINGS_KEY = "foglight:settings:v1";
const PROGRESS_KEY = "foglight:progress:v1";
const CACHE_KEY = "foglight:cache:v1";
const CACHE_MAX = 400;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as object) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, or the quota is full — the app still works, it just forgets */
  }
}

export function loadSettings(): Settings {
  const s = read<Settings>(SETTINGS_KEY, DEFAULTS);
  return {
    features: { ...DEFAULTS.features, ...s.features },
    prefs: { ...DEFAULTS.prefs, ...s.prefs },
  };
}
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

/* ------------------------------------------------------------------ progress */

export type Place = {
  bookId: number;
  title: string;
  author: string;
  ch: number;
  para: number;
  chapterTitle: string;
  chapterCount: number;
  /** epoch ms of the last time this book was open */
  at: number;
  /** total paragraphs finished, for the progress read-out */
  read: number;
};

export type Progress = Record<string, Place>;

export const loadProgress = (): Progress => read<Progress>(PROGRESS_KEY, {});

export function savePlace(place: Place) {
  const all = loadProgress();
  const prev = all[place.bookId];
  all[place.bookId] = { ...place, read: Math.max(prev?.read ?? 0, place.read) };
  write(PROGRESS_KEY, all);
}

export const getPlace = (bookId: number): Place | undefined => loadProgress()[bookId];

export function forgetBook(bookId: number) {
  const all = loadProgress();
  delete all[bookId];
  write(PROGRESS_KEY, all);
}

/* --------------------------------------------------------------------- cache */

/**
 * Model calls against Ollama Cloud can take tens of seconds. Anything the reader has
 * already asked for is kept, so going back over a paragraph is instant and free.
 */
type CacheShape = { order: string[]; items: Record<string, string> };

const emptyCache: CacheShape = { order: [], items: {} };

export const cacheKey = (mode: string, bookId: number, ch: number, para: number, query = "") =>
  `${mode}:${bookId}:${ch}:${para}:${query.slice(0, 60).toLowerCase()}`;

export function cacheGet(key: string): string | undefined {
  return read<CacheShape>(CACHE_KEY, emptyCache).items[key];
}

export function cacheSet(key: string, value: string) {
  const c = read<CacheShape>(CACHE_KEY, emptyCache);
  if (!c.items[key]) c.order.push(key);
  c.items[key] = value;
  while (c.order.length > CACHE_MAX) {
    const oldest = c.order.shift();
    if (oldest) delete c.items[oldest];
  }
  write(CACHE_KEY, c);
}
