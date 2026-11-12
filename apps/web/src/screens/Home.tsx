import { useEffect, useState } from 'react';
import type { Screen } from '../App';
import { deleteSession, loadHistory } from '../lib/history';
import { fetchHealth } from '../lib/api';
import { when } from '../lib/format';

const MODES = [
  { id: 'coach', title: 'Talk on a topic', text: 'Speak for 1–5 minutes. Your coach cues you live, then gives you a report.', ready: true },
  { id: 'debate', title: 'Debate an opponent', text: 'Argue a motion against a sparring partner who pushes back.', ready: false },
  { id: 'qa', title: 'Face tough questions', text: 'Give a talk, then handle follow-ups from a demanding audience.', ready: false },
  { id: 'drills', title: 'Drills', text: 'Short exercises for pace, pauses, tone and clear words.', ready: false },
];

export function Home({ go }: { go: (s: Screen) => void }) {
  const [history, setHistory] = useState(loadHistory);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchHealth>> | undefined>(undefined);

  useEffect(() => {
    fetchHealth().then(setHealth);
  }, []);

  return (
    <div className="stack-lg">
      <section className="hero">
        <h1>Practice out loud. Get coached while you speak.</h1>
        <p className="lead">Pick a topic and talk. Vocco listens and tells you when to start, pause, slow down, lift your voice and say it clearly. Then you get a report with what to fix.</p>
        <button className="btn primary big" onClick={() => go({ name: 'topics' })}>Pick a topic</button>
        {health === null && <p className="note warn">Can’t reach the Vocco server. Start it with <code>npm run dev</code>, then reload.</p>}
        {health && !health.listening && <p className="note warn">Listening isn’t set up on this server yet: add a speech-to-text key to the server’s .env.</p>}
      </section>

      <section>
        <h2 className="section-title">Ways to practise</h2>
        <div className="grid modes">
          {MODES.map((m) => (
            <button key={m.id} className={`card mode ${m.ready ? '' : 'soon'}`} disabled={!m.ready} onClick={() => go({ name: 'topics' })}>
              <span className="mode-title">{m.title}</span>
              <span className="muted">{m.text}</span>
              {!m.ready && <span className="pill">Soon</span>}
            </button>
          ))}
        </div>
      </section>

      {history.length > 0 && (
        <section>
          <h2 className="section-title">Your sessions</h2>
          <ul className="history">
            {history.map((s) => (
              <li key={s.id} className="card row">
                <button className="history-main" onClick={() => go({ name: 'report', result: s })}>
                  <span className="history-title">{s.setup.topic.title}</span>
                  <span className="muted small">
                    {when(s.at)} · {s.summary.spoke ? `${Math.round(s.summary.durationSec ?? 0)} s · ${s.summary.wpm} words/min · ${s.summary.fillers?.count ?? 0} fillers` : 'Nothing heard'}
                  </span>
                </button>
                <button
                  className="btn ghost small"
                  aria-label={`Delete ${s.setup.topic.title}`}
                  onClick={() => {
                    deleteSession(s.id);
                    setHistory(loadHistory());
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Sessions are kept only in this browser.</p>
        </section>
      )}
    </div>
  );
}
