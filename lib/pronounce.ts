/**
 * Datamuse returns pronunciations in ARPABET ("P R AH0 D IH1 JH AH0 S"). Readers want
 * to see IPA, so translate it, including stress marks placed at syllable onsets.
 */
const PHONE: Record<string, string> = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ",
  B: "b", CH: "tʃ", D: "d", DH: "ð",
  EH: "ɛ", ER: "ɝ", EY: "eɪ",
  F: "f", G: "ɡ", HH: "h",
  IH: "ɪ", IY: "i", JH: "dʒ",
  K: "k", L: "l", M: "m", N: "n", NG: "ŋ",
  OW: "oʊ", OY: "ɔɪ",
  P: "p", R: "ɹ", S: "s", SH: "ʃ",
  T: "t", TH: "θ",
  UH: "ʊ", UW: "u", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};

const VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW",
]);

export function arpabetToIpa(arpabet: string): string {
  const raw = arpabet.trim().split(/\s+/).filter(Boolean);
  if (!raw.length) return "";

  const tokens = raw.map((t) => {
    const m = t.match(/^([A-Z]+)([0-2])?$/);
    return { base: m?.[1] ?? t, stress: m?.[2] ? Number(m[2]) : null };
  });

  // Group into syllables: every vowel takes the consonants since the last vowel as its onset.
  type Syl = { onset: string[]; stress: number };
  const syls: Syl[] = [];
  let pending: string[] = [];
  let coda: string[] = [];

  for (const t of tokens) {
    const ipa = PHONE[t.base];
    if (!ipa) continue;
    if (VOWELS.has(t.base)) {
      // Unstressed AH and ER are schwas, which is what English actually sounds like.
      const vowel = t.stress === 0 ? (t.base === "AH" ? "ə" : t.base === "ER" ? "ɚ" : ipa) : ipa;
      syls.push({ onset: [...pending, vowel], stress: t.stress ?? 0 });
      pending = [];
    } else if (syls.length === 0) {
      pending.push(ipa);
    } else {
      pending.push(ipa);
    }
  }
  coda = pending;

  if (!syls.length) return tokens.map((t) => PHONE[t.base] ?? "").join("");

  const multi = syls.length > 1;
  const out = syls
    .map((s) => (multi && s.stress === 1 ? "ˈ" : multi && s.stress === 2 ? "ˌ" : "") + s.onset.join(""))
    .join("");

  return `/${out}${coda.join("")}/`;
}
