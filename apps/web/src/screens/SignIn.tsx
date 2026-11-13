import { useState, type FormEvent } from 'react';
import type { Screen } from '../App';
import { clearAuthError, googleSignInUrl, sendSignInLink } from '../lib/auth';
import { rememberNext } from '../lib/next';

/** Sign in with an emailed link or with Google. Both come back to Vocco already signed in. */
export function SignIn({ go, next, error }: { go: (s: Screen) => void; next?: Screen; error: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setProblem('');
    clearAuthError();
    setBusy(true);
    try {
      rememberNext(next);
      await sendSignInLink(email);
      setSent(email.trim());
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack signin">
      <h1>Sign in to practise</h1>
      <p className="lead">Your account keeps your credits. Sessions and reports stay in this browser.</p>
      {(error || problem) && <p className="note warn" role="alert">{problem || error}</p>}

      {sent ? (
        <div className="card stack-sm" role="status">
          <h2 className="section-title">Check your email</h2>
          <p>
            We sent a sign-in link to <strong>{sent}</strong>. Open it on this device and you’ll come back here, signed in.
          </p>
          <p className="small muted">No email after a minute? Check spam, or send it again.</p>
          <div className="row wrap">
            <button className="btn" onClick={() => setSent('')}>Use another email</button>
          </div>
        </div>
      ) : (
        <div className="card stack-sm">
          <a
            className="btn primary big google"
            href={googleSignInUrl()}
            onClick={() => {
              clearAuthError();
              rememberNext(next);
            }}
          >
            Continue with Google
          </a>
          <div className="or" aria-hidden="true">or</div>
          <form className="field" onSubmit={sendLink}>
            <label className="label" htmlFor="email">Email me a sign-in link</label>
            <div className="row">
              <input id="email" type="email" autoComplete="email" required value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
              <button className="btn" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send link'}</button>
            </div>
          </form>
          <p className="small muted">No password. New here? The same link creates your account.</p>
        </div>
      )}
      <button className="link" onClick={() => go({ name: 'home' })}>← Home</button>
    </div>
  );
}
