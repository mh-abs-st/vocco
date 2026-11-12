import type { Goal } from '@vocco/shared/cues';
import type { Summary } from '@vocco/shared/engine';

export type { Summary };

export type Word = { word: string; text: string; start: number; end: number; confidence: number };

export type Topic = { id: string; category: string; title: string; prompt: string; level: number; motion?: boolean };

export type SessionSetup = {
  topic: Topic;
  side?: 'for' | 'against';
  minutes: number;
  prepSeconds: number;
  goals: Goal[];
  language: string;
  deviceId?: string;
  baseline?: { speechDb?: number; pitchHz?: number };
};

export type Scores = { content: number; structure: number; pace: number; pauses: number; fillers: number; voice: number };

export type Report = {
  headline: string;
  scores: Scores;
  strengths: string[];
  fixes: { skill: string; what: string; why: string }[];
  stronger: { original: string; better: string } | null;
  drills: string[];
};



export type SessionResult = {
  id: string;
  at: number;
  setup: SessionSetup;
  words: Word[];
  summary: Summary;
  report?: Report | null;
};
