import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type Hit = { id: number; title: string; author: string; downloads?: number };

/** Gutendex is the good path. It is also a single free service that goes down. */
async function viaGutendex(q: string): Promise<Hit[]> {
  const r = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(q)}&languages=en`, {
    headers: { "User-Agent": "Foglight/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`gutendex ${r.status}`);
  const d = (await r.json()) as {
    results: { id: number; title: string; authors: { name: string }[]; download_count: number }[];
  };
  return d.results.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.authors.map((a) => a.name).join(", ") || "Unknown",
    downloads: b.download_count,
  }));
}

/** Fallback: read Gutenberg's own search page. Slower, but it is the source of truth. */
async function viaGutenbergHtml(q: string): Promise<Hit[]> {
  const r = await fetch(`https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "Foglight/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`gutenberg ${r.status}`);
  const html = await r.text();
  const re =
    /<li class="booklink">[\s\S]*?href="\/ebooks\/(\d+)"[\s\S]*?<span class="title">([\s\S]*?)<\/span>[\s\S]*?<span class="subtitle">([\s\S]*?)<\/span>/g;
  const out: Hit[] = [];
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  for (const m of html.matchAll(re)) {
    out.push({ id: Number(m[1]), title: strip(m[2]), author: strip(m[3]) });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json({ results: [] });

  for (const attempt of [viaGutendex, viaGutenbergHtml]) {
    try {
      const results = await attempt(q);
      if (results.length) {
        return Response.json(
          { results: results.slice(0, 30) },
          { headers: { "Cache-Control": "public, s-maxage=3600" } }
        );
      }
    } catch {
      /* try the next one */
    }
  }
  return Response.json({ results: [] });
}
