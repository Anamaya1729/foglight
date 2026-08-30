export type Mode = "explain" | "untangle" | "who" | "recap" | "gloss";

/**
 * Any OpenAI-compatible endpoint. Swapping provider is three environment variables and
 * a redeploy — no code change — because the one thing measurably true of these hosts is
 * that whichever is fast today may not be next week.
 */
const BASE = process.env.FOGLIGHT_BASE_URL || process.env.OLLAMA_BASE_URL || "https://opencode.ai/zen/go/v1";
const MODEL = process.env.FOGLIGHT_MODEL || "mimo-v2.5";
const API_KEY = process.env.FOGLIGHT_API_KEY || process.env.OLLAMA_API_KEY || "";

/** opencode sits behind Cloudflare, which 403s a request with no real User-Agent. */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Msg = { role: "system" | "user"; content: string };

/**
 * The model reasons before it answers and that reasoning is billed against max_tokens.
 * Starve it and you get a 200 with an empty content string, which looks like a bug and
 * isn't one — so the budget here is deliberately generous.
 */
const MAX_TOKENS = 2000;

/**
 * Ollama Cloud sometimes streams a complete answer and then simply never sends its
 * [DONE] frame, holding the socket open indefinitely. An idle-based watchdog is the
 * only thing that catches that: once the tokens stop arriving, the answer is finished.
 */
const IDLE_MS = 18000;
/**
 * Vercel's Hobby plan kills a function at 60s. Give up at 52 so the reader gets a real
 * sentence explaining what happened instead of a dead connection.
 */
const TOTAL_MS = 52000;

export function aiConfigured(): boolean {
  return Boolean(API_KEY);
}

export async function streamChat(messages: Msg[], signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  if (!API_KEY) throw new Error("No model API key is configured");

  const upstream = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      reasoning_effort: "low",
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TOTAL_MS)]) : AbortSignal.timeout(TOTAL_MS),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    throw new Error(`Model call failed (${upstream.status}). ${detail.slice(0, 300)}`);
  }

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawContent = false;
      // Some models emit their scratchpad as a <think> block inside `content` instead of
      // the separate reasoning field. Hold it back rather than showing it to the reader.
      let thinking = false;
      let pending = "";

      const emit = (chunk: string) => {
        pending += chunk;
        for (;;) {
          if (thinking) {
            const end = pending.indexOf("</think>");
            if (end === -1) {
              // keep only enough to recognise a split closing tag
              if (pending.length > 16) pending = pending.slice(-16);
              return;
            }
            pending = pending.slice(end + 8);
            thinking = false;
            continue;
          }
          const start = pending.indexOf("<think>");
          if (start === -1) {
            // a partial "<think" at the tail might still complete on the next chunk
            const keep = Math.max(0, pending.length - 7);
            const safe = pending.slice(0, keep);
            if (safe) {
              sawContent = true;
              controller.enqueue(encoder.encode(safe));
            }
            pending = pending.slice(keep);
            return;
          }
          const before = pending.slice(0, start);
          if (before) {
            sawContent = true;
            controller.enqueue(encoder.encode(before));
          }
          pending = pending.slice(start + 7);
          thinking = true;
        }
      };

      const flush = () => {
        if (!thinking && pending) {
          sawContent = true;
          controller.enqueue(encoder.encode(pending));
        }
        pending = "";
      };

      const drain = (line: string) => {
        const t = line.trim();
        if (!t.startsWith("data:")) return false;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") return true;
        try {
          // `reasoning` is the model thinking out loud. The reader never sees it.
          const chunk: string | undefined = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (chunk) emit(chunk);
        } catch {
          /* a partial SSE frame; the next read completes it */
        }
        return false;
      };

      /** Resolves as "idle" rather than hanging when the upstream goes quiet. */
      const readOrIdle = async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const idle = new Promise<"idle">((resolve) => {
          timer = setTimeout(() => resolve("idle"), IDLE_MS);
        });
        try {
          return await Promise.race([reader.read(), idle]);
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        reading: for (;;) {
          const step = await readOrIdle();
          if (step === "idle") break;
          const { done, value } = step;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            // Ollama can hold the socket open well past [DONE]; that terminator is
            // the only reliable signal that the answer is finished.
            if (drain(line)) break reading;
          }
        }
        if (buffer.trim()) drain(buffer);
        flush();
        if (!sawContent) {
          controller.enqueue(
            encoder.encode("The model returned nothing. Try again \u2014 this usually clears on a retry.")
          );
        }
      } catch (e) {
        if (!sawContent) {
          const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
          controller.enqueue(
            encoder.encode(
              timedOut
                ? "The model took longer than a minute, which is where this host cuts a request off. It is usually quicker on a second try."
                : `The answer was cut off: ${e instanceof Error ? e.message : e}`
            )
          );
        }
      } finally {
        reader.cancel().catch(() => {});
        controller.close();
      }
    },
  });
}

/* ------------------------------------------------------------------ prompts */

const VOICE = `You help one person get through a difficult classic novel. They are intelligent
and they are not a student — never condescend, never praise them, never add encouragement.
Answer and stop. No preamble, no "Sure", no restating the question, no markdown headers.`;

const FIDELITY = `Never invent content. If the passage is genuinely ambiguous, say which readings
are open rather than picking one and asserting it.`;

export type PromptInput = {
  mode: Mode;
  book: string;
  author: string;
  chapter: string;
  /** the paragraph the reader is stuck on */
  target: string;
  /** paragraphs immediately before/after, for pronoun and reference resolution */
  before?: string;
  after?: string;
  /** for `who` and `gloss`: the thing they tapped */
  query?: string;
  /** for `who` and `recap`: only text the reader has already passed */
  seen?: string;
  /** for `recap`: the chapter they are returning to */
  resumeInto?: string;
};

/** Gutenberg's _underscore italics_ are markup, not the author's punctuation. */
const clean = (t?: string) => t?.replace(/_([^_\n]+)_/g, "$1");

export function buildMessages(input: PromptInput): Msg[] {
  const p: PromptInput = {
    ...input,
    target: clean(input.target) ?? "",
    before: clean(input.before),
    after: clean(input.after),
    seen: clean(input.seen),
  };
  const where = `Book: ${p.book} by ${p.author}. Currently in: ${p.chapter}.`;

  switch (p.mode) {
    case "explain":
      return [
        {
          role: "system",
          content: `${VOICE} ${FIDELITY}

Rewrite the paragraph in plain modern English.

Rules:
- Same meaning, same events, same order. You are clarifying, not summarising and not interpreting.
- Keep every proper noun exactly as written.
- Break long sentences into short ones. Replace archaic or obsolete words with current ones.
- Keep the narrator's stance: if the original is sarcastic or ironic, the rewrite must be too,
  and if the irony would otherwise be lost, make it explicit.
- Aim for a similar length. Do not add detail that is not there.

Answer in exactly this shape and nothing else.

The first line begins with GIST: and is one sentence of at most 25 words saying what the
paragraph is actually doing or claiming — the point underneath the wording.

State the thing itself, never a report about the text:
  bad   GIST: The paragraph describes fog covering every part of London.
  good  GIST: Fog has swallowed the whole city, the comfortable and the wretched alike.
  bad   GIST: The paragraph notes the rulers of England and France were alike.
  good  GIST: England and France had interchangeable rulers, and their elites assumed it would last forever.

Then one empty line. Then the rewritten paragraph.

The GIST line is never optional and never just a repeat of the opening sentence. Some
paragraphs are hard because of their words and some because of their shape; where the words
are already plain the rewrite will land close to the original, and the GIST is then the only
thing standing between the reader and a paragraph they have already failed to get once.
- Output the rewritten paragraph only.`,
        },
        {
          role: "user",
          content: `${where}

${p.before ? `[the paragraph before, for context only — do not rewrite it]\n${p.before}\n\n` : ""}[rewrite this paragraph]
${p.target}${p.after ? `\n\n[the paragraph after, for context only — do not rewrite it]\n${p.after}` : ""}`,
        },
      ];

    case "untangle":
      return [
        {
          role: "system",
          content: `${VOICE} ${FIDELITY}

The reader has hit a sentence whose grammar is fighting them. Take it apart.

For each sentence in the passage that is genuinely long or convoluted, output:
- a line "MAIN: <the core subject-verb-object, in the author's own words where possible>"
- then numbered lines, one per subordinate clause or interruption, each labelled with what it does
  in plain words: who it describes, when it happened, why, what it contrasts with.

Skip short sentences entirely — say nothing about them.
Use the author's own wording wherever you can. No markdown, no bold, no headers.`,
        },
        { role: "user", content: `${where}\n\n${p.target}` },
      ];

    case "who":
      return [
        {
          role: "system",
          content: `${VOICE} ${FIDELITY}

The reader tapped a name or term and wants to know who or what it is.

THE ONE ABSOLUTE RULE: you are given only the text they have already read. Use nothing else.
No knowledge of how the book ends, no knowledge of this book at all beyond the excerpt supplied.
If the answer is not in the supplied text, say exactly what is and is not established so far,
and stop. Never fill a gap with what you happen to know about the novel. A spoiler is a failure.

Answer in at most four short sentences:
- who or what they are, and their relation to the people currently on the page
- any other names, nicknames, patronymics or titles the same person goes by
- where the reader last saw them, if the supplied text shows it`,
        },
        {
          role: "user",
          content: `${where}

Reader asked about: "${p.query}"

[everything the reader has read so far — your only source]
${p.seen ?? p.target}

[the paragraph they are on now]
${p.target}`,
        },
      ];

    case "gloss":
      return [
        {
          role: "system",
          content: `${VOICE} ${FIDELITY}

Define the word or phrase as it is used in this sentence — not its most common modern sense.

Two short parts, no labels, no markdown:
- the meaning here, in one sentence
- if the word has drifted, died, or is a foreign phrase, one more sentence on what it meant then.
Nothing else.`,
        },
        { role: "user", content: `${where}\n\nWord or phrase: "${p.query}"\n\nSentence:\n${p.target}` },
      ];

    case "recap":
      return [
        {
          role: "system",
          content: `${VOICE} ${FIDELITY}

The reader is coming back after a gap and needs to pick up the thread. From the text supplied —
and only that text — write a recap of at most 140 words.

Lead with the thread they are mid-way through, not with the earliest events. Name the people who
are about to matter and say who they are to each other. Say where everyone physically is.
End with the question the story has just left hanging.

Never mention anything that happens after the supplied text. Plain prose, no bullets, no headers.`,
        },
        {
          role: "user",
          content: `${where}

[what the reader has read — your only source]
${p.seen ?? p.target}

They are about to open: ${p.resumeInto ?? p.chapter}`,
        },
      ];
  }
}
