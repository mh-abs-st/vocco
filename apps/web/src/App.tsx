import { useEffect, useState } from 'react';
import type { SessionResult, SessionSetup, Topic } from './lib/types';
import { Home } from './screens/Home';
import { TopicPicker } from './screens/TopicPicker';
import { Setup } from './screens/Setup';
import { Session } from './screens/Session';
import { ReportScreen } from './screens/Report';

export type Screen =
  | { name: 'home' }
  | { name: 'topics' }
  | { name: 'setup'; topic: Topic }
  | { name: 'session'; setup: SessionSetup }
  | { name: 'report'; result: SessionResult };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  // Browser Back goes to the previous screen (except out of a live session, which has its own End).
  useEffect(() => {
    const onPop = () => setScreen((s) => (s.name === 'session' ? s : { name: 'home' }));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const go = (s: Screen) => {
    if (s.name !== 'home') history.pushState(null, '');
    setScreen(s);
    scrollTo(0, 0);
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => screen.name !== 'session' && go({ name: 'home' })} aria-label="Vocco home">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Vocco</span>
        </button>
      </header>
      <main>
        {screen.name === 'home' && <Home go={go} />}
        {screen.name === 'topics' && <TopicPicker go={go} />}
        {screen.name === 'setup' && <Setup topic={screen.topic} go={go} />}
        {screen.name === 'session' && <Session setup={screen.setup} go={go} />}
        {screen.name === 'report' && <ReportScreen result={screen.result} go={go} />}
      </main>
    </div>
  );
}
