import { NextRequest } from "next/server";
import { getBook } from "@/lib/gutenberg";
import { aiConfigured, buildMessages, streamChat, type Mode } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How much already-read text the spoiler-safe tools get. Ollama bills on input size,
 * so this is a real cost lever, not just a context-window question.
 */
const SEEN_BUDGET = 36000;

type Body = {
  mode: Mode;
  bookId: number;
  ch: number;
  para?: number;
  query?: string;
};

const MODES: Mode[] = ["explain", "untangle", "who", "recap", "gloss"];

export async function POST(req: NextRequest) {
  if (!aiConfigured()) {
    return Response.json(
      { error: "This deployment has no OLLAMA_API_KEY set, so the reading tools are switched off." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Bad request body" }, { status: 400 });
  }

  const { mode, bookId, ch, para, query } = body;
  if (!MODES.includes(mode)) return Response.json({ error: "Unknown mode" }, { status: 400 });
  if (!Number.isInteger(bookId) || !Number.isInteger(ch)) {
    return Response.json({ error: "Bad book or chapter" }, { status: 400 });
  }
  if ((mode === "who" || mode === "gloss") && !query?.trim()) {
    return Response.json({ error: "Nothing to look up" }, { status: 400 });
  }

  try {
    const book = await getBook(bookId);
    const chapter = book.chapters[ch];
    if (!chapter) return Response.json({ error: "No such chapter" }, { status: 404 });

    const pi = Number.isInteger(para) ? (para as number) : 0;
    const target = chapter.paras[pi]?.text ?? chapter.paras[0]?.text ?? "";

    // Everything before the reader's finger, newest first, trimmed to budget. This is
    // what makes the tracker and the recap spoiler-safe: later text is never in scope.
    let seen: string | undefined;
    if (mode === "who" || mode === "recap") {
      const parts: string[] = [];
      let used = 0;
      outer: for (let c = ch; c >= 0; c--) {
        const chap = book.chapters[c];
        const upto = c === ch ? pi : chap.paras.length - 1;
        for (let p = upto; p >= 0; p--) {
          const t = chap.paras[p].text;
          if (used + t.length > SEEN_BUDGET) break outer;
          parts.push(t);
          used += t.length;
        }
        parts.push(`— ${chap.title} —`);
      }
      seen = parts.reverse().join("\n\n");
    }

    const messages = buildMessages({
      mode,
      book: book.title,
      author: book.author,
      chapter: chapter.title,
      target,
      before: chapter.paras[pi - 1]?.text,
      after: chapter.paras[pi + 1]?.text,
      query,
      seen,
      resumeInto: chapter.title,
    });

    const stream = await streamChat(messages, req.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    // The model is on a shared endpoint whose queue times swing wildly. When it never
    // answers, say so in words the reader can act on rather than leaking the raw error.
    const timedOut =
      e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || /abort|timeout/i.test(e.message));
    if (timedOut) {
      return Response.json(
        { error: "The model did not answer in time. It is usually quicker on a second try." },
        { status: 504 }
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong" }, { status: 502 });
  }
}
