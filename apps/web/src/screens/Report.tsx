import { useEffect, useMemo, useState } from 'react';
import { fillerIndexes } from '@vocco/shared/words';
import { CUES } from '@vocco/shared/cues';
import type { Screen } from '../App';
import type { Report, SessionResult } from '../lib/types';
import { requestReport } from '../lib/api';
import { saveSession } from '../lib/history';
import { clock } from '../lib/format';
import { PaceChart } from '../components/PaceChart';

const SCORE_LABELS: Record<string, string> = { content: 'Content', structure: 'Structure', pace: 'Pace', pauses: 'Pauses', fillers: 'Fillers', voice: 'Voice' };

export function ReportScreen({ result, go }: { result: SessionResult; go: (s: Screen) => void }) {
  const [report, setReport] = useState<Report | null | undefined>(result.report);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const s = result.summary;

  async function load() {
    setError('');
    setLoading(true);
    try {
      const r = await requestReport(result);
      setReport(r);
      saveSession({ ...result, report: r });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!result.report && s.spoke) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fillers = useMemo(() => fillerIndexes(result.words), [result.words]);
  const again = () => go({ name: 'setup', topic: result.setup.topic });

  if (!s.spoke) {
    return (
      <div className="stack">
        <div className="card">
          <h1>We didn’t hear anything</h1>
          <p className="lead">Check that the right microphone is picked and not muted, then try again.</p>
          <div className="row">
            <button className="btn primary" onClick={again}>Try again</button>
            <button className="btn" onClick={() => go({ name: 'topics' })}>Pick another topic</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg report">
      <div className="row between wrap">
        <div>
          <span className="small muted">Report · {result.setup.topic.title}</span>
          <h1>{report?.headline || 'Your session'}</h1>
        </div>
        <div className="row">
          <button className="btn primary" onClick={again}>Try again</button>
          <button className="btn" onClick={() => go({ name: 'topics' })}>New topic</button>
        </div>
      </div>

      <section className="grid stats">
        <Stat label="Pace" value={`${s.wpm ?? 0}`} unit="words/min" hint={(s.wpm ?? 0) > 170 ? 'A bit fast' : (s.wpm ?? 0) < 110 ? 'A bit slow' : 'Comfortable'} />
        <Stat label="Fillers" value={`${s.fillers?.count ?? 0}`} unit={`${s.fillers?.perMinute ?? 0} a minute`} hint={s.fillers?.words?.length ? s.fillers.words.map((w) => `“${w}”`).join(', ') : 'None'} />
        <Stat label="Pauses" value={`${s.pauses?.good ?? 0}`} unit="well placed" hint={`${s.pauses?.hesitations ?? 0} hesitations`} />
        <Stat label="Voice range" value={s.voice ? `${s.voice.rangeSemitones}` : '—'} unit="semitones" hint={s.voice ? (s.voice.rangeSemitones < 3 ? 'Quite flat' : 'Lively') : 'Not enough voice heard'} />
        <Stat label="Talked" value={clock(s.durationSec ?? 0)} unit={`${s.words} words`} hint={`Started after ${s.startDelaySec ?? 0} s`} />
        <Stat label="Sentences" value={`${s.sentences?.avgWords ?? 0}`} unit="words on average" hint={s.sentences?.runOns ? `${s.sentences.runOns} very long` : 'Easy to follow'} />
      </section>

      {s.paceSeries && s.paceSeries.length > 1 && (
        <section className="card">
          <h2 className="section-title">Pace over time</h2>
          <PaceChart series={s.paceSeries} target={s.targetWpm ?? [130, 160]} />
        </section>
      )}

      <section className="card">
        <h2 className="section-title">Coach’s notes</h2>
        {loading && <p className="muted">Your coach is reading your session…</p>}
        {error && (
          <div className="row wrap">
            <p className="note warn">{error}</p>
            <button className="btn" onClick={load}>Try again</button>
          </div>
        )}
        {report && (
          <div className="stack">
            <div className="scores">
              {Object.entries(report.scores).map(([k, v]) => (
                <div key={k} className="score">
                  <span className="small">{SCORE_LABELS[k] || k}</span>
                  <div className="score-bar" aria-label={`${SCORE_LABELS[k]} ${v} of 5`}><div style={{ width: `${(v / 5) * 100}%` }} /></div>
                  <span className="small muted">{v}/5</span>
                </div>
              ))}
            </div>
            {report.strengths.length > 0 && (
              <div>
                <h3>What worked</h3>
                <ul>{report.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
            {report.fixes.length > 0 && (
              <div>
                <h3>What to fix next</h3>
                <ol className="fixes">
                  {report.fixes.map((f, i) => (
                    <li key={i}>
                      <strong>{f.what}</strong> <span className="muted">{f.why}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {report.stronger && (
              <div className="stronger">
                <h3>Say it stronger</h3>
                <p className="muted small">You said: “{report.stronger.original}”</p>
                <p className="better">{renderMarks(report.stronger.better)}</p>
                <p className="small muted">“/” = pause · <em>bold</em> = stress that word</p>
              </div>
            )}
            {report.drills.length > 0 && (
              <div>
                <h3>Drills for next time</h3>
                <ul>{report.drills.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">What you said</h2>
        <p className="transcript-final">
          {result.words.map((w, i) => (
            <span key={i} className={fillers.has(i) ? 'w filler' : w.confidence < 0.55 ? 'w unclear' : 'w'}>{w.text} </span>
          ))}
        </p>
        <p className="small muted"><span className="w filler">Filler</span> · <span className="w unclear">Not clear</span></p>
      </section>

      {s.timeline.some((f) => f.kind in CUES) && (
        <section className="card">
          <h2 className="section-title">Cues you got</h2>
          <ul className="timeline">
            {s.timeline.filter((f) => f.kind in CUES).map((f, i) => (
              <li key={i}><span className="muted">{clock(f.t - (s.startAt ?? 0))}</span> {CUES[f.kind as keyof typeof CUES].text}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, unit, hint }: { label: string; value: string; unit: string; hint: string }) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className="big-number">{value}</span>
      <span className="small">{unit}</span>
      <span className="small muted">{hint}</span>
    </div>
  );
}

/** "Here's the point / *Sleep* matters" → pause marks and stressed words. */
function renderMarks(text: string) {
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') ? <strong key={i}>{part.slice(1, -1)}</strong> : <span key={i}>{part.split(' / ').join('  /  ')}</span>,
  );
}
