import { useMemo, useState } from 'react';
import { CATEGORIES, TOPICS, randomTopic } from '@vocco/shared/topics';
import type { Screen } from '../App';
import type { Topic } from '../lib/types';

const LEVEL = ['', 'Easy', 'Medium', 'Hard'];

export function TopicPicker({ go }: { go: (s: Screen) => void }) {
  const [cat, setCat] = useState<string>('');
  const [custom, setCustom] = useState('');
  const list = useMemo(() => (cat ? TOPICS.filter((t) => t.category === cat) : TOPICS), [cat]);
  const pick = (topic: Topic) => go({ name: 'setup', topic });

  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>Pick a topic</h1>
        <button className="btn" onClick={() => pick(randomTopic(cat || undefined))}>Surprise me</button>
      </div>

      <form
        className="card custom"
        onSubmit={(e) => {
          e.preventDefault();
          const text = custom.trim();
          if (text) pick({ id: `custom-${Date.now()}`, category: 'custom', title: text.length > 60 ? `${text.slice(0, 57)}…` : text, prompt: text, level: 2 });
        }}
      >
        <label htmlFor="custom">Your own topic or question</label>
        <div className="row">
          <input id="custom" value={custom} maxLength={300} placeholder="e.g. Present my team’s Q3 results" onChange={(e) => setCustom(e.target.value)} />
          <button className="btn primary" disabled={!custom.trim()}>Use it</button>
        </div>
      </form>

      <div className="chips" role="group" aria-label="Categories">
        <button aria-pressed={!cat} className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} aria-pressed={cat === c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid topics">
        {list.map((t) => (
          <button key={t.id} className="card topic" onClick={() => pick(t)}>
            <span className="topic-title">{t.title}</span>
            <span className="muted">{t.prompt}</span>
            <span className="small muted">{CATEGORIES.find((c) => c.id === t.category)?.label} · {LEVEL[t.level]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
