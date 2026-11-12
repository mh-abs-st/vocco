import { useEffect, useRef, useState } from 'react';
import { GOALS } from '@vocco/shared/cues';
import { LANGUAGES } from '@vocco/shared/protocol';
import { median } from '@vocco/shared/pitch';
import type { Goal } from '@vocco/shared/cues';
import type { Screen } from '../App';
import type { SessionSetup, Topic } from '../lib/types';
import { loadPrefs, savePrefs } from '../lib/history';
import { Mic, listMics, micError, type VoiceFrame } from '../audio/mic';

const LENGTHS = [1, 2, 3, 5];
const PREP = [0, 15, 30];
const CHECK_LINE = 'The best talks start with a clear point, take a breath, and end on a strong last word.';

export function Setup({ topic, go }: { topic: Topic; go: (s: Screen) => void }) {
  const prefs = loadPrefs();
  const [minutes, setMinutes] = useState(prefs.minutes ?? 2);
  const [prepSeconds, setPrep] = useState(prefs.prepSeconds ?? 15);
  const [goals, setGoals] = useState<Goal[]>((prefs.goals as Goal[]) ?? ['pace', 'pauses']);
  const [language, setLanguage] = useState(prefs.language ?? 'en');
  const [side, setSide] = useState<'for' | 'against'>('for');
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(prefs.deviceId ?? '');
  const [baseline, setBaseline] = useState(prefs.baseline);

  useEffect(() => {
    listMics().then(setMics).catch(() => {});
  }, []);

  const toggleGoal = (g: Goal) => setGoals((gs) => (gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]));

  const start = () => {
    savePrefs({ minutes, prepSeconds, goals, language, deviceId });
    const setup: SessionSetup = { topic, side: topic.motion ? side : undefined, minutes, prepSeconds, goals, language, deviceId: deviceId || undefined, baseline };
    go({ name: 'session', setup });
  };

  return (
    <div className="stack">
      <button className="link" onClick={() => go({ name: 'topics' })}>← Topics</button>
      <div className="card prompt-card">
        <span className="small muted">Your topic</span>
        <h1>{topic.title}</h1>
        <p className="lead">{topic.prompt}</p>
        {topic.motion && (
          <div className="field">
            <span className="label">Your side</span>
            <div className="chips">
              {(['for', 'against'] as const).map((s) => (
                <button key={s} className={`chip ${side === s ? 'on' : ''}`} onClick={() => setSide(s)}>{s === 'for' ? 'For the motion' : 'Against'}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid two">
        <div className="card stack-sm">
          <div className="field">
            <span className="label">How long</span>
            <div className="chips">
              {LENGTHS.map((m) => (
                <button key={m} className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{m} min</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Time to think first</span>
            <div className="chips">
              {PREP.map((p) => (
                <button key={p} className={`chip ${prepSeconds === p ? 'on' : ''}`} onClick={() => setPrep(p)}>{p ? `${p} s` : 'None'}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Coach me live on</span>
            <div className="chips">
              {GOALS.map((g) => (
                <button key={g.id} className={`chip ${goals.includes(g.id) ? 'on' : ''}`} title={g.hint} onClick={() => toggleGoal(g.id)}>{g.label}</button>
              ))}
            </div>
            <span className="small muted">Everything is in the report either way. Fewer live cues are easier to follow.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="lang">Language</label>
            <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </div>
        </div>

        <div className="card stack-sm">
          <div className="field">
            <label className="label" htmlFor="mic">Microphone</label>
            <select id="mic" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Default microphone</option>
              {mics.filter((m) => m.deviceId && m.deviceId !== 'default').map((m, i) => (
                <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>
              ))}
            </select>
          </div>
          <MicCheck
            deviceId={deviceId}
            done={Boolean(baseline)}
            onDone={(b) => {
              setBaseline(b);
              savePrefs({ baseline: b });
              listMics().then(setMics).catch(() => {}); // labels appear once the mic is allowed
            }}
          />
        </div>
      </div>

      <div className="row end">
        <button className="btn primary big" onClick={start}>Start speaking</button>
      </div>
    </div>
  );
}

/** Read one line out loud: checks the mic works and learns your normal loudness and pitch. */
function MicCheck({ deviceId, done, onDone }: { deviceId: string; done: boolean; onDone: (b: { speechDb: number; pitchHz: number }) => void }) {
  const [state, setState] = useState<'idle' | 'listening' | 'ok' | 'error'>(done ? 'ok' : 'idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const mic = useRef<Mic | null>(null);

  useEffect(() => () => {
    void mic.current?.stop();
  }, []);

  async function run() {
    setError('');
    const frames: VoiceFrame[] = [];
    const m = new Mic({ deviceId: deviceId || undefined, onFrame: (f) => { frames.push(f); setLevel(Math.max(0, Math.min(1, (f.db + 60) / 50))); } });
    mic.current = m;
    try {
      await m.start();
    } catch (e) {
      setState('error');
      setError(micError(e));
      return;
    }
    setState('listening');
    await new Promise((r) => setTimeout(r, 6000));
    await m.stop();
    setLevel(0);
    const voiced = frames.filter((f) => f.hz);
    if (voiced.length < 60) {
      setState('error');
      setError('We didn’t hear much. Move closer to the mic or speak up, then try again.');
      return;
    }
    onDone({ speechDb: median(voiced.map((f) => f.db)), pitchHz: median(voiced.map((f) => f.hz as number)) });
    setState('ok');
  }

  return (
    <div className="field">
      <span className="label">Mic check</span>
      {state === 'listening' ? (
        <>
          <p className="read-line">“{CHECK_LINE}”</p>
          <div className="meter" aria-label="Mic level"><div style={{ width: `${level * 100}%` }} /></div>
        </>
      ) : (
        <p className="small muted">
          {state === 'ok' ? 'Done: Vocco knows your normal volume and voice.' : 'Read one line out loud (6 seconds) so the coach knows your normal volume and voice.'}
        </p>
      )}
      {error && <p className="note warn">{error}</p>}
      {state !== 'listening' && <button className="btn" onClick={run}>{state === 'ok' ? 'Check again' : 'Check my mic'}</button>}
    </div>
  );
}
