// The end-of-session report: Claude reads the transcript and the measured numbers (never the audio) and writes
// scores, what worked, what to fix, a stronger version of the weakest part, and drills.

import { callTool } from './anthropic.js';
import { claudeCost } from './costs.js';

const S = { type: 'integer', minimum: 1, maximum: 5 };
export const REPORT_TOOL = {
  name: 'speech_report',
  description: 'Coaching report for one spoken practice session.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One encouraging, specific sentence to the speaker ("you").' },
      scores: {
        type: 'object',
        description: '1 = needs a lot of work, 3 = solid, 5 = excellent. Base delivery scores on the measured numbers.',
        properties: { content: S, structure: S, pace: S, pauses: S, fillers: S, voice: S },
        required: ['content', 'structure', 'pace', 'pauses', 'fillers', 'voice'],
      },
      strengths: { type: 'array', items: { type: 'string' }, description: '2–3 specific things that worked, quoting their words where it helps.' },
      fixes: {
        type: 'array',
        description: '2–4 most useful changes, most important first.',
        items: {
          type: 'object',
          properties: {
            skill: { type: 'string', enum: ['content', 'structure', 'pace', 'pauses', 'fillers', 'voice', 'clarity', 'start'] },
            what: { type: 'string', description: 'What to change, in one short sentence.' },
            why: { type: 'string', description: 'Why, pointing at the moment or number.' },
          },
          required: ['skill', 'what', 'why'],
        },
      },
      stronger: {
        type: 'object',
        description: 'Their weakest passage, rewritten to be said out loud.',
        properties: {
          original: { type: 'string', description: 'Their words (shortened with … if long).' },
          better: { type: 'string', description: 'A stronger spoken version, 2–4 sentences, using only their facts. Mark a pause with " / " and a word to stress in *asterisks*.' },
        },
        required: ['original', 'better'],
      },
      drills: { type: 'array', items: { type: 'string' }, description: '2–3 short drills (one line each) for the next session.' },
    },
    required: ['headline', 'scores', 'strengths', 'fixes', 'stronger', 'drills'],
  },
};

const SYSTEM = `You are a warm, direct speaking coach. You get the transcript of someone practising out loud, and numbers measured from their audio. Write a short, specific report.
Rules:
- Talk to the speaker as "you". Plain words, no jargon, no fluff.
- Ground every point in their words or a measured number. Never invent facts about them.
- Delivery (pace, pauses, fillers, voice) comes from the numbers: a comfortable pace is about 130–160 words per minute; fillers above about 3 per minute are noticeable; a voice range under about 3 semitones sounds flat; "hesitations" are long mid-sentence gaps.
- If voice numbers are missing, score voice 3 and don't comment on it.
- If they barely spoke, say so kindly and keep the report short.
- Write in the language of the transcript.`;

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

/** The user message for the report: topic, goals, transcript and numbers. Exported for tests. */
export function reportContent({ topic, mode = 'coach', goals = [], transcript, summary }) {
  const numbers = { ...summary };
  delete numbers.timeline; // the transcript and counts carry what matters; keep the prompt small
  delete numbers.paceSeries;
  return [
    `Mode: ${mode}`,
    `Topic: ${clip(topic?.title || 'Free talk', 200)}`,
    topic?.prompt ? `Prompt they answered: ${clip(topic.prompt, 500)}` : '',
    topic?.side ? `Side they argued: ${topic.side}` : '',
    goals.length ? `Their focus goals: ${goals.join(', ')}` : '',
    '',
    'Transcript:',
    clip(transcript, 12000) || '(nothing was said)',
    '',
    `Measured numbers: ${JSON.stringify(numbers)}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

const clamp = (n) => (Number.isFinite(Number(n)) && n !== null && n !== '' ? Math.min(5, Math.max(1, Math.round(Number(n)))) : 3);
const strs = (a, n) => (Array.isArray(a) ? a.map((x) => String(x || '').trim()).filter(Boolean).slice(0, n) : []);

/** Make whatever came back safe to show. Exported for tests. */
export function cleanReport(r = {}) {
  const sc = r.scores || {};
  return {
    headline: String(r.headline || '').trim(),
    scores: Object.fromEntries(['content', 'structure', 'pace', 'pauses', 'fillers', 'voice'].map((k) => [k, clamp(sc[k])])),
    strengths: strs(r.strengths, 3),
    fixes: (Array.isArray(r.fixes) ? r.fixes : []).slice(0, 4).map((f) => ({ skill: String(f?.skill || ''), what: String(f?.what || ''), why: String(f?.why || '') })).filter((f) => f.what),
    stronger: r.stronger?.better ? { original: String(r.stronger.original || ''), better: String(r.stronger.better) } : null,
    drills: strs(r.drills, 3),
  };
}

/** Validate the request body; returns an error message or null. */
export function checkReportBody(b) {
  if (!b || typeof b !== 'object') return 'Missing session data.';
  if (typeof b.transcript !== 'string') return 'Missing transcript.';
  if (!b.summary || typeof b.summary !== 'object') return 'Missing session numbers.';
  if (b.transcript.length > 60000) return 'This session is too long for a report.';
  return null;
}

export async function writeReport(body, { config, fetchImpl, costs, userId = null }) {
  const input = await callTool(
    { model: config.reportModel, system: SYSTEM, content: reportContent(body), tool: REPORT_TOOL, maxTokens: 3000 },
    {
      key: config.anthropicKey,
      fetchImpl,
      // Every attempt costs, also ones that are retried: record each.
      onUsage: (u) => {
        const c = claudeCost(config.reportModel, u);
        costs?.record({ user_id: userId, activity: 'report', provider: 'anthropic', model: config.reportModel, input_tokens: c.input, output_tokens: c.output, cost_usd: c.usd });
      },
    },
  );
  return cleanReport(input);
}
