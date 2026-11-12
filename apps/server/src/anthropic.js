// Calls to Claude over plain fetch (no SDK), so tests can fake `fetch` like Offro's do.

export const API_URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

// Claude Sonnet 5.5 thinks before answering unless told not to; a report doesn't need it and it costs output
// tokens (same default as Offro: "between_tools" is its lowest setting). Haiku 5.5 always thinks: keep it low.
const NO_THINKING = { 'claude-sonnet-5-5': { type: 'between_tools' } };
const LOW_EFFORT = new Set(['claude-haiku-5-5']);
export function withDefaults(body) {
  let b = body;
  if (!b.thinking && NO_THINKING[b.model]) b = { ...b, thinking: NO_THINKING[b.model] };
  if (LOW_EFFORT.has(b.model) && !b.output_config?.effort) b = { ...b, output_config: { ...(b.output_config || {}), effort: 'low' } };
  return b;
}

export class ClaudeError extends Error {
  constructor(message, { status = 0, raw = '' } = {}) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

/** POST /v1/messages and return the parsed response. */
export async function createMessage(body, { key, fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  if (!key) throw new ClaudeError('No ANTHROPIC_API_KEY set.', { status: 0 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': VERSION },
      body: JSON.stringify(withDefaults(body)),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ClaudeError(`Claude API ${res.status}`, { status: res.status, raw: text.slice(0, 500) });
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Strict tool schemas need additionalProperties: false on every object and no number/length limits. */
const DROP = new Set(['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);
export function strictSchema(s) {
  if (Array.isArray(s)) return s.map(strictSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (DROP.has(k)) continue;
    out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, sub]) => [p, strictSchema(sub)])) : strictSchema(v);
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

/**
 * Ask for exactly one call of `tool` and return its input. Forced and strict first; if the API refuses either
 * (400 naming it), retry without it.
 */
export async function callTool({ model, system, content, tool, maxTokens = 3000 }, opts) {
  const attempts = [
    { tools: [{ ...tool, strict: true, input_schema: strictSchema(tool.input_schema) }], tool_choice: { type: 'tool', name: tool.name } },
    { tools: [tool], tool_choice: { type: 'tool', name: tool.name } },
    { tools: [tool], tool_choice: { type: 'auto' }, remind: true },
  ];
  let lastErr;
  for (const a of attempts) {
    const sys = a.remind ? `${system}\n\nAlways respond by calling the ${tool.name} tool exactly once.` : system;
    try {
      const msg = await createMessage({ model, max_tokens: maxTokens, system: sys, tools: a.tools, tool_choice: a.tool_choice, messages: [{ role: 'user', content }] }, opts);
      if (opts?.onUsage) opts.onUsage(msg.usage || {});
      const block = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
      if (block && msg.stop_reason !== 'max_tokens') return block.input;
      lastErr = new ClaudeError(`No ${tool.name} result (stop: ${msg.stop_reason}).`, { status: 200 });
      if (msg.stop_reason === 'refusal') throw lastErr;
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof ClaudeError && err.status === 400 && /strict|schema|tool_choice/i.test(err.raw);
      if (!retryable) throw err;
    }
  }
  throw lastErr;
}
