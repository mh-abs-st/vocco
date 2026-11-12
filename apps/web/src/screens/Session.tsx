import { useEffect, useMemo, useRef, useState } from 'react';
import { createCoach } from '@vocco/shared/engine';
import { fillerIndexes } from '@vocco/shared/words';
import type { Screen } from '../App';
import type { SessionResult, SessionSetup, Word } from '../lib/types';
import { Mic, micError, type VoiceFrame } from '../audio/mic';
import { SessionSocket, type ServerMessage } from '../lib/session-socket';
import { saveSession } from '../lib/history';
import { clock, newId } from '../lib/format';
import { VoiceTrace } from '../components/VoiceTrace';

type Phase = 'connecting' | 'prep' | 'live' | 'ending' | 'error';
type Cue = { kind: string; text: string; detail: string } | null;

export function Session({ setup, go }: { setup: SessionSetup; go: (s: Screen) => void }) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [finals, setFinals] = useState<Word[]>([]);
  const [interim, setInterim] = useState('');
  const [cue, setCue] = useState<Cue>(null);
  const [pace, setPace] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [prepLeft, setPrepLeft] = useState(setup.prepSeconds);

  const frames = useRef<VoiceFrame[]>([]);
  const audioTime = useRef(0);
  const phaseRef = useRef<Phase>('connecting');
  const finishRef = useRef<() => void>(() => {});
  const setP = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const total = setup.minutes * 60;

  useEffect(() => {
    let cancelled = false;
    let ended = false;
    let goAt = 0;
    let prepStart = 0;
    let closedResolve: () => void = () => {};
    const closed = new Promise<void>((r) => (closedResolve = r));

    const coach = createCoach({ goals: setup.goals, baseline: setup.baseline });

    const goLive = () => {
      goAt = mic.time;
      coach.promptEnded(goAt);
      setP('live');
    };

    const onMessage = (m: ServerMessage) => {
      if (cancelled) return;
      if (m.type === 'ready') {
        if (phaseRef.current !== 'connecting') return;
        if (setup.prepSeconds > 0) {
          prepStart = Date.now();
          setP('prep');
        } else goLive();
      } else if (m.type === 'words') {
        if (m.final) {
          coach.addWords(m.words);
          setFinals([...coach.words()]);
          setInterim('');
        } else setInterim(m.text);
      } else if (m.type === 'limit') {
        setNotice(m.message);
        finish();
      } else if (m.type === 'error') {
        if (phaseRef.current === 'live') {
          setNotice(m.message);
          finish();
        } else {
          setError(m.message);
          setP('error');
          void mic.stop();
        }
      } else if (m.type === 'closed') {
        closedResolve();
        if (phaseRef.current === 'live') finish(); // the server ended it
      }
    };

    const sock = new SessionSocket(onMessage, { language: setup.language });
    const mic = new Mic({
      deviceId: setup.deviceId,
      onFrame: (f) => {
        coach.addFrame(f);
        frames.current.push(f);
        if (frames.current.length > 1500) frames.current.splice(0, 500);
        audioTime.current = f.t;
      },
      onPcm: (pcm) => sock.sendAudio(pcm),
    });
    mic.start().catch((e) => {
      if (cancelled) return;
      setError(micError(e));
      setP('error');
      sock.close();
    });

    async function finish() {
      if (ended) return;
      ended = true;
      setP('ending');
      setCue(null);
      await mic.stop();
      sock.stop();
      // The last words arrive just after stopping: wait for the server to close, at most 4 s.
      await Promise.race([closed, new Promise((r) => setTimeout(r, 4000))]);
      sock.close();
      if (cancelled) return;
      const result: SessionResult = { id: newId(), at: Date.now(), setup, words: coach.words(), summary: coach.summary() };
      saveSession(result);
      go({ name: 'report', result });
    }
    finishRef.current = finish;

    const timer = setInterval(() => {
      if (cancelled) return;
      if (phaseRef.current === 'prep') {
        const left = setup.prepSeconds - (Date.now() - prepStart) / 1000;
        setPrepLeft(Math.max(0, Math.ceil(left)));
        if (left <= 0) goLive();
      } else if (phaseRef.current === 'live') {
        const t = mic.time;
        setCue(coach.tick(t));
        setPace(coach.pace(t));
        const e = t - goAt;
        setElapsed(e);
        if (e >= total) finish();
      }
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(timer);
      void mic.stop();
      sock.close();
    };
    // One session per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fillers = useMemo(() => fillerIndexes(finals), [finals]);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Newer browsers return a Promise from scrollIntoView: don't hand it back to React as a cleanup.
    void transcriptEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [finals, interim]);

  if (phase === 'error') {
    return (
      <div className="stack">
        <div className="card">
          <h1>Couldn’t start</h1>
          <p className="note warn">{error}</p>
          <div className="row">
            <button className="btn primary" onClick={() => go({ name: 'setup', topic: setup.topic })}>Back to setup</button>
            <button className="btn" onClick={() => go({ name: 'home' })}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  const paceBand = pace == null ? '' : pace > 175 ? 'fast' : pace < 105 ? 'slow' : 'good';

  return (
    <div className="session stack">
      <div className="row between wrap">
        <div>
          <span className="small muted">{setup.side ? `Arguing ${setup.side === 'for' ? 'for' : 'against'}` : 'Your topic'}</span>
          <h2 className="session-topic">{setup.topic.prompt}</h2>
        </div>
        <div className="row">
          <span className="timer" aria-label="Time left">{phase === 'live' ? clock(total - elapsed) : clock(total)}</span>
          <button className="btn danger" disabled={phase === 'ending'} onClick={() => (phase === 'live' ? finishRef.current() : go({ name: 'setup', topic: setup.topic }))}>
            {phase === 'live' ? 'End' : phase === 'ending' ? 'Ending…' : 'Cancel'}
          </button>
        </div>
      </div>

      <div className={`cue ${cue ? 'on' : ''} ${phase}`} role="status" aria-live="polite">
        {phase === 'connecting' && <span className="cue-text">Getting ready…</span>}
        {phase === 'prep' && (
          <>
            <span className="cue-text">Think about your opening line</span>
            <span className="cue-detail">You start in {prepLeft} s</span>
          </>
        )}
        {phase === 'live' && cue && (
          <>
            <span className="cue-text">{cue.text}</span>
            <span className="cue-detail">{cue.detail}</span>
          </>
        )}
        {phase === 'live' && !cue && <span className="cue-text quiet">{finals.length ? 'Keep going' : 'Go ahead, you’re on'}</span>}
        {phase === 'ending' && <span className="cue-text quiet">Writing your report…</span>}
      </div>
      {notice && <p className="note">{notice}</p>}

      <div className="grid session-grid">
        <div className="card transcript" aria-label="What you said">
          {finals.length === 0 && !interim && <p className="muted">Your words appear here as you speak.</p>}
          <p>
            {finals.map((w, i) => (
              <span key={i} className={fillers.has(i) ? 'w filler' : w.confidence < 0.55 ? 'w unclear' : 'w'}>{w.text} </span>
            ))}
            {interim && <span className="interim">{interim}</span>}
          </p>
          <div ref={transcriptEnd} />
        </div>
        <div className="stack-sm">
          <div className="card meter-card">
            <span className="label">Pace</span>
            <span className={`big-number ${paceBand}`}>{pace == null ? '—' : Math.round(pace)}</span>
            <span className="small muted">words/min · aim for 130–160</span>
          </div>
          <div className="card meter-card">
            <span className="label">Voice</span>
            <VoiceTrace frames={frames} now={audioTime} baselineHz={setup.baseline?.pitchHz} />
            <span className="small muted">Line: your pitch going up and down. Bar: loudness.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
