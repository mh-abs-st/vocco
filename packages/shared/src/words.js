// Small helpers about words as Deepgram sends them: { word, punctuated_word, start, end, confidence }.

/** @typedef {{ word: string, text: string, start: number, end: number, confidence: number }} Word */

const SINGLE_FILLERS = new Set(['um', 'uh', 'erm', 'er', 'uhm', 'umm', 'hmm', 'mm', 'ah']);
const PAIR_FILLERS = new Set(['you know', 'i mean', 'sort of', 'kind of']);
const SOLO_FILLERS = new Set(['basically', 'literally']);

/** Lowercase letters only ("Um," → "um"). */
export const bare = (w = '') => String(w).toLowerCase().replace(/[^a-z']/g, '');

/** Deepgram word → our Word. */
export function fromDeepgram(w) {
  return {
    word: bare(w.word),
    text: String(w.punctuated_word || w.word || ''),
    start: Number(w.start) || 0,
    end: Number(w.end) || Number(w.start) || 0,
    confidence: typeof w.confidence === 'number' ? w.confidence : 1,
  };
}

/** Does this word end a sentence ("today." / "right?")? */
export const endsSentence = (w) => /[.!?]["')\]]?$/.test(w.text);
/** Does this word end a clause or sentence (where a pause belongs)? */
export const endsClause = (w) => /[.!?,;:—–-]["')\]]?$/.test(w.text);

/**
 * Indexes of words that are fillers. A two-word filler marks both words.
 * @param {Word[]} words
 */
export function fillerIndexes(words) {
  const out = new Set();
  for (let i = 0; i < words.length; i++) {
    const a = words[i].word;
    if (SINGLE_FILLERS.has(a) || SOLO_FILLERS.has(a)) out.add(i);
    if (i + 1 < words.length && PAIR_FILLERS.has(`${a} ${words[i + 1].word}`)) {
      out.add(i);
      out.add(i + 1);
    }
  }
  return out;
}

/** How many filler phrases (a two-word filler counts once). */
export function countFillers(words) {
  const idx = fillerIndexes(words);
  let n = 0;
  for (let i = 0; i < words.length; i++) if (idx.has(i) && !(idx.has(i - 1) && PAIR_FILLERS.has(`${words[i - 1].word} ${words[i].word}`))) n++;
  return n;
}

/** Split words into sentences by their punctuation. */
export function sentences(words) {
  const out = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (endsSentence(w)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
