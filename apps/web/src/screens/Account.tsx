import { useEffect, useState } from 'react';
import type { Screen } from '../App';
import { accessToken, deleteAccount, sessionRejected, signOut, type Session } from '../lib/auth';

const base = (import.meta.env.VITE_API_URL as string | undefined) || '';

/** Who's signed in, credits, sign out, delete account. */
export function Account({ go, session }: { go: (s: Screen) => void; session: Session }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const token = await accessToken();
      if (!token) return;
      const res = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      if (res?.status === 401) return sessionRejected();
      if (res?.ok) setCredits((await res.json()).credits);
    })();
  }, []);

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await deleteAccount();
      go({ name: 'home' });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Your account</h1>
      <div className="card stack-sm">
        <div>
          <span className="label">Signed in as</span>
          <p>{session.email || 'Your account'}</p>
        </div>
        <div>
          <span className="label">Credits</span>
          <p>{credits == null ? '—' : credits}</p>
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              await signOut();
              go({ name: 'home' });
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="card stack-sm">
        <h2 className="section-title">Delete your account</h2>
        <p className="small muted">This deletes your sign-in and any credits left, and can’t be undone. Your past sessions stay in this browser until you delete them.</p>
        {error && <p className="note warn" role="alert">{error}</p>}
        {confirming ? (
          <div className="row wrap">
            <button className="btn danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Yes, delete my account'}</button>
            <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        ) : (
          <div className="row">
            <button className="btn danger" onClick={() => setConfirming(true)}>Delete my account</button>
          </div>
        )}
      </div>
    </div>
  );
}
