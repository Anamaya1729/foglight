import { NextRequest } from "next/server";
import { getBook } from "@/lib/gutenberg";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return Response.json({ error: "Bad book id" }, { status: 400 });
  }

  const ch = req.nextUrl.searchParams.get("ch");

  try {
    const book = await getBook(id);

    // No chapter asked for: the table of contents, which is all the shelf needs.
    if (ch === null) {
      return Response.json(
        {
          id: book.id,
          title: book.title,
          author: book.author,
          totalChars: book.totalChars,
          chapters: book.chapters.map((c) => ({
            i: c.i,
            title: c.title,
            paras: c.paras.length,
            chars: c.chars,
          })),
        },
        { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
      );
    }

    const n = Number(ch);
    const chapter = book.chapters[n];
    if (!chapter) return Response.json({ error: "No such chapter" }, { status: 404 });

    return Response.json(
      {
        id: book.id,
        title: book.title,
        author: book.author,
        chapterCount: book.chapters.length,
        chapter: { i: chapter.i, title: chapter.title, paras: chapter.paras, chars: chapter.chars },
      },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Fetch failed" }, { status: 502 });
  }
}
