import { useEffect, useRef, useState } from 'react';
import type { SessionResult, SessionSetup, Topic } from './lib/types';
import { Home } from './screens/Home';
import { TopicPicker } from './screens/TopicPicker';
import { Setup } from './screens/Setup';
import { Session } from './screens/Session';
import { ReportScreen } from './screens/Report';
import { SignIn } from './screens/SignIn';
import { Account } from './screens/Account';
import { dismissWelcome, getAuth, init as initAuth, onAuth, type AuthState } from './lib/auth';
import { takeNext } from './lib/next';

export type Screen =
  | { name: 'home' }
  | { name: 'topics' }
  | { name: 'setup'; topic: Topic }
  | { name: 'session'; setup: SessionSetup }
  | { name: 'report'; result: SessionResult }
  | { name: 'signin'; next?: Screen }
  | { name: 'account' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [auth, setAuth] = useState<AuthState>(getAuth);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Sign-in state: config from the server, a session from the URL after signing in, or a saved one.
  useEffect(() => {
    const off = onAuth(setAuth);
    void initAuth().then(() => {
      const a = getAuth();
      // Back from an email link or Google: carry on where they were heading.
      if (a.session) {
        const next = takeNext();
        if (next) go(next);
      } else if (a.error) go({ name: 'signin' });
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new screen: move keyboard and screen-reader focus to its heading (or the main area), like a page load.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h = main.current?.querySelector<HTMLElement>('h1');
    if (h) {
      h.tabIndex = -1;
      h.focus();
    } else main.current?.focus();
  }, [screen]);

  // Browser Back goes to the previous screen (except out of a live session, which has its own End).
  useEffect(() => {
    const onPop = () => setScreen((s) => (s.name === 'session' ? s : { name: 'home' }));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  function go(target: Screen) {
    const a = getAuth();
    let s = target;
    // With accounts on, a session needs sign-in; so does the account page.
    if (a.accounts && !a.session && (s.name === 'session' || s.name === 'account')) s = { name: 'signin', next: s.name === 'session' ? s : undefined };
    if (s.name !== 'home') history.pushState(null, '');
    setScreen(s);
    scrollTo(0, 0);
  }

  // Signed out while on the account page (sign out, delete, or the server rejected the session).
  useEffect(() => {
    if (auth.ready && !auth.session && screen.name === 'account') setScreen({ name: 'home' });
  }, [auth, screen.name]);

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <button className="brand" onClick={() => screen.name !== 'session' && go({ name: 'home' })} aria-label="Vocco home">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Vocco</span>
        </button>
        {auth.accounts && screen.name !== 'session' && (
          <nav className="account-nav" aria-label="Account">
            {auth.session ? (
              <button className="btn ghost small" onClick={() => go({ name: 'account' })} title={auth.session.email}>
                Account{auth.credits != null && ' '}{auth.credits != null && <span className="credits-pill">{auth.credits} {auth.credits === 1 ? 'credit' : 'credits'}</span>}
              </button>
            ) : (
              screen.name !== 'signin' && (
                <button className="btn small" onClick={() => go({ name: 'signin' })}>
                  Sign in
                </button>
              )
            )}
          </nav>
        )}
      </header>
      {auth.welcome && screen.name !== 'session' && (
        <div className="welcome row between" role="status">
          <span>{auth.welcome}</span>
          <button className="btn ghost small" onClick={dismissWelcome}>OK</button>
        </div>
      )}
      <main id="main" ref={main} tabIndex={-1}>
        {screen.name === 'home' && <Home go={go} />}
        {screen.name === 'topics' && <TopicPicker go={go} />}
        {screen.name === 'setup' && <Setup topic={screen.topic} go={go} auth={auth} />}
        {screen.name === 'session' && <Session setup={screen.setup} go={go} />}
        {screen.name === 'report' && <ReportScreen result={screen.result} go={go} />}
        {screen.name === 'signin' && <SignIn go={go} next={screen.next} error={auth.error} />}
        {screen.name === 'account' && auth.session && <Account go={go} session={auth.session} credits={auth.credits} trialNote={auth.trialNote} />}
      </main>
    </div>
  );
}
