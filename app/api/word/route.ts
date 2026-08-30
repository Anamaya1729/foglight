import { NextRequest } from "next/server";
import { arpabetToIpa } from "@/lib/pronounce";

export const runtime = "nodejs";
export const maxDuration = 20;

export type Sense = { pos: string; text: string; archaic: boolean };
export type WordInfo = { word: string; ipa: string | null; senses: Sense[] };

const ARCHAIC = /\b(archaic|obsolete|dated|historical|now rare)\b/i;

/** Strip the punctuation and possessives a reader inevitably catches with the word. */
function normalise(raw: string): string {
  return raw
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .replace(/[’']s$/i, "")
    .toLowerCase();
}

export async function GET(req: NextRequest) {
  const word = normalise(req.nextUrl.searchParams.get("w") || "");
  if (!word || word.length > 40 || /\s/.test(word)) {
    return Response.json({ word, ipa: null, senses: [] } satisfies WordInfo);
  }

  try {
    const r = await fetch(
      `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dpr&max=1`,
      { signal: AbortSignal.timeout(7000), next: { revalidate: 60 * 60 * 24 * 30 } } as RequestInit & {
        next?: { revalidate: number };
      }
    );
    if (!r.ok) throw new Error(String(r.status));

    const rows = (await r.json()) as { word: string; tags?: string[]; defs?: string[] }[];
    const hit = rows[0];
    if (!hit || hit.word.toLowerCase() !== word) {
      return Response.json({ word, ipa: null, senses: [] } satisfies WordInfo, {
        headers: { "Cache-Control": "public, s-maxage=86400" },
      });
    }

    const pron = hit.tags?.find((t) => t.startsWith("pron:"))?.slice(5) ?? "";
    const senses: Sense[] = (hit.defs ?? []).slice(0, 6).map((d) => {
      const [pos, ...rest] = d.split("\t");
      const text = rest.join(" ").trim();
      return { pos: pos.trim(), text, archaic: ARCHAIC.test(text) };
    });

    return Response.json(
      { word, ipa: pron ? arpabetToIpa(pron) : null, senses } satisfies WordInfo,
      { headers: { "Cache-Control": "public, s-maxage=2592000" } }
    );
  } catch {
    return Response.json({ word, ipa: null, senses: [] } satisfies WordInfo);
  }
}
