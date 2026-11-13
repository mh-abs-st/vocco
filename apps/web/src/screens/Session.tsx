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

type Phase = 'connecting' | 'prep' | 'live' | 'lost' | 'reconnecting' | 'ending' | 'error';
type Cue = { kind: string; text: string; detail: string } | null;

export function Session({ setup, go }: { setup: SessionSetup; go: (s: Screen) => void }) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lostMessage, setLostMessage] = useState('');
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
  const reconnectRef = useRef<() => void>(() => {});
  const tapRef = useRef<() => void>(() => {});
  // Safari can keep audio paused until a tap. Shown over whatever the session is doing; nothing moves meanwhile.
  const [needsTap, setNeedsTap] = useState(false);
  const needsTapRef = useRef(false);
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
    // Word times from the server count from the first audio chunk of *that* connection; `offset` is the mic time
    // of that chunk, so words stay on the mic's clock across reconnects.
    let offset = 0;
    let lostAt = 0; // mic time when the connection dropped
    let lostTotal = 0; // seconds lost to outages (not counted against the session length)
    let sock: SessionSocket | null = null;
    let sockClosed: Promise<void> = Promise.resolve();

    const coach = createCoach({ goals: setup.goals, baseline: setup.baseline });

    const afterReady = () => {
      if (setup.prepSeconds > 0) {
        prepStart = Date.now();
        setP('prep');
      } else goLive();
    };

    const goLive = () => {
      goAt = mic.time;
      coach.promptEnded(goAt);
      setP('live');
    };

    function lose(message: string) {
      if (ended) return;
      if (phaseRef.current === 'live') lostAt = mic.time;
      sock?.close();
      setCue(null);
      setInterim('');
      setLostMessage(message);
      setP('lost');
    }

    function connect() {
      let resolveClosed: () => void = () => {};
      sockClosed = new Promise<void>((r) => (resolveClosed = r));
      const s: SessionSocket = new SessionSocket((m) => {
        if (m.type === 'closed') resolveClosed();
        if (cancelled || s !== sock) return; // an old connection
        onMessage(m);
      }, { language: setup.language });
      sock = s;
    }

    function onMessage(m: ServerMessage) {
      const phase = phaseRef.current;
      if (m.type === 'ready') {
        if (phase === 'connecting') afterReady();
        else if (phase === 'reconnecting') {
          const now = mic.time;
          coach.addBreak(lostAt, now);
          lostTotal += now - lostAt;
          setLostMessage('');
          setP('live');
        }
      } else if (m.type === 'words') {
        const words = m.words.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
        if (m.final) {
          coach.addWords(words);
          setFinals([...coach.words()]);
          setInterim('');
        } else setInterim(m.text);
      } else if (m.type === 'limit') {
        setNotice(m.message);
        void finish();
      } else if (m.type === 'error') {
        if (phase === 'live') lose(m.message || 'Lost the connection. What you said so far is safe.');
        else if (phase === 'reconnecting') lose('Couldn’t reconnect. Check your connection, then try again.');
        else if (phase !== 'ending' && phase !== 'lost') {
          setError(m.message);
          setP('error');
          void mic.stop();
        }
      } else if (m.type === 'closed') {
        if (phase === 'live') lose('Lost the connection. What you said so far is safe.');
        else if (phase === 'reconnecting') lose('Couldn’t reconnect. Check your connection, then try again.');
      }
    }

    const mic = new Mic({
      deviceId: setup.deviceId,
      onFrame: (f) => {
        coach.addFrame(f);
        frames.current.push(f);
        if (frames.current.length > 1500) frames.current.splice(0, 500);
        audioTime.current = f.t;
      },
      onPcm: (pcm) => {
        // Before 'ready' (and while disconnected) audio isn't sent: nobody is listening.
        sock?.sendAudio(pcm, () => {
          offset = mic.time - pcm.length / 16000; // the start of this chunk
        });
      },
    });

    connect();
    mic
      .start()
      .then(() => {
        // Safari may keep audio paused because the session didn't start from a tap: ask for one.
        if (!cancelled && !mic.running) {
          needsTapRef.current = true;
          setNeedsTap(true);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(micError(e));
        setP('error');
        sock?.close();
      });
    tapRef.current = async () => {
      if (!(await mic.resume()) || cancelled) return;
      needsTapRef.current = false;
      setNeedsTap(false);
    };

    async function finish() {
      if (ended) return;
      ended = true;
      const wasConnected = sock?.live;
      setP('ending');
      setCue(null);
      await mic.stop();
      if (wasConnected && sock) {
        sock.stop();
        // The last words arrive just after stopping: wait for the server to close, at most 4 s.
        await Promise.race([sockClosed, new Promise((r) => setTimeout(r, 4000))]);
      }
      sock?.close();
      if (cancelled) return;
      const result: SessionResult = { id: newId(), at: Date.now(), setup, words: coach.words(), summary: coach.summary() };
      saveSession(result);
      go({ name: 'report', result });
    }
    finishRef.current = () => void finish();
    reconnectRef.current = () => {
      if (ended || phaseRef.current !== 'lost') return;
      setP('reconnecting');
      connect();
    };

    const timer = setInterval(() => {
      if (cancelled) return;
      if (phaseRef.current === 'prep') {
        if (needsTapRef.current) {
          prepStart += 250; // the thinking time waits for the tap
          return;
        }
        const left = setup.prepSeconds - (Date.now() - prepStart) / 1000;
        setPrepLeft(Math.max(0, Math.ceil(left)));
        if (left <= 0) goLive();
      } else if (phaseRef.current === 'live') {
        const t = mic.time;
        setCue(coach.tick(t));
        setPace(coach.pace(t));
        const e = t - goAt - lostTotal;
        setElapsed(e);
        if (e >= total) void finish();
      }
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(timer);
      void mic.stop();
      sock?.close();
    };
    // One session per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Screen readers hear a cue once when it appears, and state changes (lost, reconnecting, ending) — not every redraw.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (needsTap) setAnnounce('Tap Start listening to begin.');
    else if (phase === 'prep') setAnnounce(`Think about your opening line. You start in ${setup.prepSeconds} seconds.`);
    else if (phase === 'live' && cue) setAnnounce(`${cue.text}. ${cue.detail}`);
    else if (phase === 'live' && !finals.length) setAnnounce('You’re on. Start speaking.');
    else if (phase === 'lost') setAnnounce(`Connection lost. ${lostMessage}`);
    else if (phase === 'reconnecting') setAnnounce('Reconnecting.');
    else if (phase === 'ending') setAnnounce('Writing your report.');
    // Only when the cue kind or phase changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue?.kind, phase, needsTap]);

  const fillers = useMemo(() => fillerIndexes(finals), [finals]);
  const transcriptBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the transcript box (scrollIntoView would also scroll the page and push the cue away on phones).
    const el = transcriptBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [finals, interim]);

  if (phase === 'error') {
    return (
      <div className="stack">
        <div className="card">
          <h1>Couldn’t start</h1>
          <p className="note warn" role="alert">{error}</p>
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
      <h1 className="sr-only">Live session</h1>
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      <div className="row between wrap">
        <div>
          <span className="small muted">{setup.side ? `Arguing ${setup.side === 'for' ? 'for' : 'against'}` : 'Your topic'}</span>
          <h2 className="session-topic">{setup.topic.prompt}</h2>
        </div>
        <div className="row">
          <span className="timer" aria-label="Time left">{phase === 'connecting' || phase === 'prep' ? clock(total) : clock(total - elapsed)}</span>
          <button
            className="btn danger"
            disabled={phase === 'ending'}
            onClick={() => (phase === 'live' || phase === 'lost' || phase === 'reconnecting' ? finishRef.current() : go({ name: 'setup', topic: setup.topic }))}
          >
            {phase === 'ending' ? 'Ending…' : phase === 'connecting' || phase === 'prep' ? 'Cancel' : 'End'}
          </button>
        </div>
      </div>

      <div className={`cue ${cue && !needsTap ? 'on' : ''} ${phase === 'lost' ? 'lost' : ''}`}>
        {needsTap && phase !== 'lost' && phase !== 'ending' ? (
          <>
            <span className="cue-text">Tap to start listening</span>
            <span className="cue-detail">Your browser waits for a tap before it uses the microphone.</span>
            <span className="row wrap cue-actions">
              <button className="btn primary" onClick={() => tapRef.current()}>Start listening</button>
            </span>
          </>
        ) : (
          <>
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
        {phase === 'lost' && (
          <>
            <span className="cue-text">Connection lost</span>
            <span className="cue-detail">{lostMessage} Keep going when you’re back online, or get your report now.</span>
            <span className="row wrap cue-actions">
              <button className="btn primary" onClick={() => reconnectRef.current()}>Keep going</button>
              <button className="btn" onClick={() => finishRef.current()}>Get my report</button>
            </span>
          </>
        )}
        {phase === 'reconnecting' && <span className="cue-text quiet">Reconnecting…</span>}
        {phase === 'ending' && <span className="cue-text quiet">Writing your report…</span>}
          </>
        )}
      </div>
      {notice && <p className="note">{notice}</p>}

      <div className="grid session-grid">
        <div className="card transcript" aria-label="What you said" ref={transcriptBox}>
          {finals.length === 0 && !interim && <p className="muted">Your words appear here as you speak.</p>}
          <p>
            {finals.map((w, i) => (
              <span key={i} className={fillers.has(i) ? 'w filler' : w.confidence < 0.55 ? 'w unclear' : 'w'}>{w.text} </span>
            ))}
            {interim && <span className="interim">{interim}</span>}
          </p>
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
            <span className="small muted voice-hint">Line: your pitch going up and down. Bar: loudness.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
