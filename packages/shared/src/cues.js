// Every live cue the coach can show: what it says, which goal it belongs to, and how important it is.
// Lower `priority` wins when two cues are due at the same moment. Copy is short and says what to do.

/** @typedef {'start'|'warmup'|'resume'|'slower'|'faster'|'breathe'|'hold'|'fillers'|'monotone'|'louder'|'trail'|'uptalk'} CueKind */
/** @typedef {'start'|'pace'|'pauses'|'fillers'|'voice'} Goal */

/** @type {Record<CueKind, { text: string, detail: string, goal: Goal, priority: number }>} */
export const CUES = {
  start: { text: 'Start now', detail: 'Say your first line. You can shape it as you go.', goal: 'start', priority: 0 },
  warmup: { text: 'Skip the warm-up', detail: 'Open with your point, not “um, so…”.', goal: 'start', priority: 1 },
  resume: { text: 'Pick it back up', detail: 'Say your next point. A short pause is fine, a long one loses people.', goal: 'start', priority: 2 },
  slower: { text: 'Slow down', detail: 'Give each sentence room to land.', goal: 'pace', priority: 3 },
  faster: { text: 'A bit faster', detail: 'Keep the energy up.', goal: 'pace', priority: 4 },
  breathe: { text: 'Pause', detail: 'Take a breath. Pauses make you sound sure.', goal: 'pauses', priority: 5 },
  hold: { text: 'Hold the pause', detail: 'Stop for a beat at the end of each sentence.', goal: 'pauses', priority: 6 },
  fillers: { text: 'Fewer fillers', detail: 'Pause silently instead of “um” or “uh”.', goal: 'fillers', priority: 7 },
  monotone: { text: 'Lift your voice', detail: 'Vary your tone: go up for questions and key words.', goal: 'voice', priority: 8 },
  louder: { text: 'Louder', detail: 'Speak to the back of the room.', goal: 'voice', priority: 9 },
  trail: { text: 'Don’t trail off', detail: 'Keep your volume to the last word.', goal: 'voice', priority: 10 },
  uptalk: { text: 'Land it down', detail: 'End statements on a falling tone, not a question.', goal: 'voice', priority: 11 },
};

/** @type {{ id: Goal, label: string, hint: string }[]} */
export const GOALS = [
  { id: 'pace', label: 'Pace', hint: 'Not too fast, not too slow' },
  { id: 'pauses', label: 'Pauses', hint: 'Breathe and stop at sentence ends' },
  { id: 'fillers', label: 'Fillers', hint: 'Fewer “um”, “uh”, “you know”' },
  { id: 'voice', label: 'Voice up & down', hint: 'Tone, volume, ending sentences well' },
];

/** @type {Goal[]} */
export const DEFAULT_GOALS = ['pace', 'pauses'];
