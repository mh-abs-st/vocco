import type { Report, SessionResult } from './types';

const base = (import.meta.env.VITE_API_URL as string | undefined) || '';

export async function fetchHealth(): Promise<{ ok: boolean; listening: boolean; reports: boolean } | null> {
  try {
    const r = await fetch(`${base}/health`);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

/** Ask for the coach's report on a finished session. Throws an Error with a message to show. */
export async function requestReport(s: SessionResult): Promise<Report> {
  const transcript = s.words.map((w) => w.text).join(' ');
  let res: Response;
  try {
    res = await fetch(`${base}/api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'coach',
        topic: { title: s.setup.topic.title, prompt: s.setup.topic.prompt, side: s.setup.side },
        goals: s.setup.goals,
        transcript,
        summary: s.summary,
      }),
    });
  } catch {
    throw new Error('Couldn’t reach Vocco. Check your connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'The report couldn’t be written. Try again.');
  return body.report;
}
