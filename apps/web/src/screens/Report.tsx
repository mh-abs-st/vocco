import { useEffect, useMemo, useRef, useState } from 'react';
import { fillerIndexes } from '@vocco/shared/words';
import { CUES } from '@vocco/shared/cues';
import type { Screen } from '../App';
import type { Report, SessionResult } from '../lib/types';
import { requestReport } from '../lib/api';
import { loadHistory, loadPrefs, saveSession } from '../lib/history';
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
  // Same topic and settings again, straight into the session (the mic-check numbers may be newer).
  const again = () => go({ name: 'session', setup: { ...result.setup, baseline: loadPrefs().baseline ?? result.setup.baseline } });
  const changeSettings = () => go({ name: 'setup', topic: result.setup.topic });

  // The last session on the same topic before this one, to compare numbers.
  const prev = useMemo(
    () => loadHistory().find((h) => h.id !== result.id && h.at < result.at && h.setup.topic.prompt === result.setup.topic.prompt && h.summary.spoke)?.summary,
    [result],
  );

  // Moments: cues and hesitations, each pointing at a word in the transcript.
  const moments = s.timeline.filter((f) => f.kind in CUES || f.kind === 'hesitation');
  const hesitationAt = useMemo(() => new Map(s.timeline.filter((f) => f.kind === 'hesitation' && f.i != null).map((f) => [f.i as number, f.detail || ''])), [s.timeline]);
  const [active, setActive] = useState<number | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const show = (i: number) => {
    setActive(i);
    void wordRefs.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

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
          <button className="btn" onClick={changeSettings}>Change settings</button>
          <button className="btn" onClick={() => go({ name: 'topics' })}>New topic</button>
        </div>
      </div>
      {prev && <p className="small muted">“Last time” is your previous session on this topic.</p>}

      <section className="grid stats">
        <Stat label="Pace" value={`${s.wpm ?? 0}`} unit="words/min" hint={(s.wpm ?? 0) > 170 ? 'A bit fast' : (s.wpm ?? 0) < 110 ? 'A bit slow' : 'Comfortable'} prev={prev && `${prev.wpm ?? 0}`} />
        <Stat label="Fillers" value={`${s.fillers?.count ?? 0}`} unit={`${s.fillers?.perMinute ?? 0} a minute`} hint={s.fillers?.words?.length ? s.fillers.words.map((w) => `“${w}”`).join(', ') : 'None'} prev={prev && `${prev.fillers?.count ?? 0}`} />
        <Stat label="Pauses" value={`${s.pauses?.good ?? 0}`} unit="well placed" hint={`${s.pauses?.hesitations ?? 0} hesitations`} prev={prev && `${prev.pauses?.good ?? 0}`} />
        <Stat label="Voice range" value={s.voice ? `${s.voice.rangeSemitones}` : '—'} unit="semitones" hint={s.voice ? (s.voice.rangeSemitones < 3 ? 'Quite flat' : 'Lively') : 'Not enough voice heard'} prev={prev && (prev.voice ? `${prev.voice.rangeSemitones}` : '—')} />
        <Stat label="Talked" value={clock(s.durationSec ?? 0)} unit={`${s.words} words`} hint={s.connectionLostSec ? `Connection lost for ${Math.round(s.connectionLostSec)} s (not counted)` : `Started after ${s.startDelaySec ?? 0} s`} />
        <Stat label="Sentences" value={`${s.sentences?.avgWords ?? 0}`} unit="words on average" hint={s.sentences?.runOns ? `${s.sentences.runOns} very long` : 'Easy to follow'} prev={prev && `${prev.sentences?.avgWords ?? 0}`} />
      </section>

      {s.paceSeries && s.paceSeries.length > 1 && (
        <section className="card">
          <h2 className="section-title">Pace over time</h2>
          <PaceChart series={s.paceSeries} target={s.targetWpm ?? [130, 160]} bucket={s.paceBucketSec ?? 10} />
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
            <span key={i}>
              {hesitationAt.has(i) && <span className="hes" title={`Hesitation: ${hesitationAt.get(i)}`}>{hesitationAt.get(i)}</span>}
              <span
                ref={(el) => {
                  wordRefs.current[i] = el;
                }}
                className={`${fillers.has(i) ? 'w filler' : w.confidence < 0.55 ? 'w unclear' : 'w'}${active === i ? ' active' : ''}`}
              >
                {w.text}
              </span>{' '}
            </span>
          ))}
        </p>
        <p className="small muted">
          <span className="w filler">Filler</span> · <span className="w unclear">Not clear</span> · <span className="hes">0.8 s</span> Hesitation (a long stop mid-sentence)
        </p>
      </section>

      {moments.length > 0 && (
        <section className="card">
          <h2 className="section-title">Moments</h2>
          <p className="small muted">Tap one to see it in what you said.</p>
          <ul className="timeline">
            {moments.map((f, i) => (
              <li key={i}>
                <button className="moment" disabled={f.i == null} onClick={() => f.i != null && show(f.i)} aria-pressed={active === f.i}>
                  <span className="muted">{clock(f.t - (s.startAt ?? 0))}</span>{' '}
                  {f.kind === 'hesitation' ? `Hesitation (${f.detail}) before “${f.word}”` : CUES[f.kind as keyof typeof CUES].text}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, unit, hint, prev }: { label: string; value: string; unit: string; hint: string; prev?: string }) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className="big-number">{value}</span>
      <span className="small">{unit}</span>
      <span className="small muted">{hint}</span>
      {prev != null && <span className="small prev">Last time: {prev}</span>}
    </div>
  );
}

/** "Here's the point / *Sleep* matters" → pause marks and stressed words. */
function renderMarks(text: string) {
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') ? <strong key={i}>{part.slice(1, -1)}</strong> : <span key={i}>{part.split(' / ').join('  /  ')}</span>,
  );
}
