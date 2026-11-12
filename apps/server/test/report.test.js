import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport, reportContent, checkReportBody, writeReport } from '../src/report.js';
import { strictSchema, withDefaults } from '../src/anthropic.js';
import { loadConfig } from '../src/config.js';

const good = {
  headline: 'Clear and confident.',
  scores: { content: 4, structure: 3, pace: 9, pauses: 0, fillers: 2.6, voice: 'x' },
  strengths: ['Strong opening', '', 'Good example', 'extra', 'more'],
  fixes: [{ skill: 'pace', what: 'Slow down in the middle.', why: '185 wpm at 0:40.' }, { skill: 'x', what: '' }],
  stronger: { original: 'So um basically…', better: 'Here’s the point. / *Sleep* is a skill.' },
  drills: ['Read a paragraph at 140 wpm.'],
};

test('report output is clamped and cleaned', () => {
  const r = cleanReport(good);
  assert.deepEqual(r.scores, { content: 4, structure: 3, pace: 5, pauses: 1, fillers: 3, voice: 3 });
  assert.deepEqual(r.strengths, ['Strong opening', 'Good example', 'extra']);
  assert.equal(r.fixes.length, 1);
  assert.equal(r.stronger.better, 'Here’s the point. / *Sleep* is a skill.');
  assert.equal(cleanReport({}).stronger, null);
});

test('the prompt carries topic, goals, transcript and numbers, not the timeline', () => {
  const c = reportContent({ topic: { title: 'Sleep', prompt: 'Why sleep matters' }, goals: ['pace'], transcript: 'Sleep matters.', summary: { wpm: 150, timeline: [{ t: 1 }], paceSeries: [1] } });
  assert.match(c, /Topic: Sleep/);
  assert.match(c, /focus goals: pace/);
  assert.match(c, /"wpm":150/);
  assert.doesNotMatch(c, /timeline|paceSeries/);
});

test('request body checks', () => {
  assert.equal(checkReportBody(null), 'Missing session data.');
  assert.equal(checkReportBody({ transcript: 'x' }), 'Missing session numbers.');
  assert.equal(checkReportBody({ transcript: 'x', summary: {} }), null);
});

test('strict schemas: no limits, closed objects', () => {
  const s = strictSchema({ type: 'object', properties: { a: { type: 'integer', minimum: 1 }, b: { type: 'object', properties: {} } } });
  assert.deepEqual(s, { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'object', properties: {}, additionalProperties: false } }, additionalProperties: false });
});

test('Sonnet 5.5 runs without thinking, Haiku 5.5 at low effort', () => {
  assert.deepEqual(withDefaults({ model: 'claude-sonnet-5-5' }).thinking, { type: 'between_tools' });
  assert.equal(withDefaults({ model: 'claude-haiku-5-5' }).output_config.effort, 'low');
});

test('writing a report: forced strict tool first, falls back when strict is refused', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    assert.equal(init.headers['x-api-key'], 'k');
    if (calls.length === 1) return new Response(JSON.stringify({ error: { message: 'strict mode not supported for this schema' } }), { status: 400 });
    return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'speech_report', input: good }], usage: {} }), { status: 200 });
  };
  const config = loadConfig({ ANTHROPIC_API_KEY: 'k' });
  const r = await writeReport({ transcript: 'Hello.', summary: { wpm: 140 } }, { config, fetchImpl, log: () => {} });
  assert.equal(r.headline, 'Clear and confident.');
  assert.equal(calls[0].tools[0].strict, true);
  assert.equal(calls[0].tool_choice.name, 'speech_report');
  assert.equal(calls[1].tools[0].strict, undefined);
  assert.equal(calls[0].model, 'claude-sonnet-5-5');
});

test('an API error that isn’t about the schema is not retried', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return new Response('{"error":{"message":"overloaded"}}', { status: 529 }); };
  const config = loadConfig({ ANTHROPIC_API_KEY: 'k' });
  await assert.rejects(writeReport({ transcript: 'x', summary: {} }, { config, fetchImpl }), (e) => e.status === 529);
  assert.equal(n, 1);
});
