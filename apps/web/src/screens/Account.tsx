import { useEffect, useState } from 'react';
import type { Screen } from '../App';
import { deleteAccount, refreshCredits, signOut, type Session } from '../lib/auth';

/** Who's signed in, credits, sign out, delete account. */
export function Account({ go, session, credits, trialNote }: { go: (s: Screen) => void; session: Session; credits: number | null; trialNote?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void refreshCredits();
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
          <p className="small muted">1 credit = 1 minute of speaking. The coach’s notes after a session are 2 credits.</p>
          {trialNote && <p className="small muted">{trialNote}</p>}
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
