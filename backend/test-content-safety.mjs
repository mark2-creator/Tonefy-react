// node test-content-safety.mjs - offline checks for contentSafety.js (no network: the
// classifier is a fake). Live classifier accuracy was measured separately, Oct 24 2026.
import assert from 'assert/strict';
import { createContentSafety, isRefusal, BLOCKED_MESSAGE } from './contentSafety.js';

const refusals = [
  "I'm sorry, but I can't help with that.",
  "I’m sorry, but I can’t help with that.",
  "I cannot assist with this request.",
  "Sorry, I can't create that content.",
  "I'm unable to fulfill this request.",
  "I won't write that.",
  "I can't comply with that request.",
  "I'm sorry, I can't help.",
  "As an AI language model, I cannot produce explicit material.",
  "That request goes against my guidelines.",
];
const scripts = [
  "I'm sorry, but nobody is coming to save you. Get up and build the life you want.",
  "I can't help but smile when I think about how far we've come.",
  "You can't help everyone, but you can help someone today.",
  "Five foods that burn belly fat while you sleep. Number one: green tea.",
  "We can't create opportunities by waiting. Start now.",
  "Here is why the naked eye cannot see ultraviolet light.",
  "",
];
for (const r of refusals) assert.ok(isRefusal(r), `should be a refusal: ${r}`);
for (const s of scripts) assert.ok(!isRefusal(s), `should NOT be a refusal: ${s}`);
// Only the head counts: a refusal phrase deep inside a long script is content.
assert.ok(!isRefusal('Motivation. '.repeat(40) + "I can't help with that."));

// Fake Groq: first model rate-limited, second answers by keyword.
const calls = [];
const fakeGroq = { chat: { completions: { create: async (body, opts) => {
  calls.push(body.model);
  assert.equal(opts.maxRetries, 0, 'no SDK retry - a 429 must move on, not wait 20 s');
  if (body.model.includes('safeguard')) { const e = new Error('rate limited'); e.status = 429; throw e; }
  const bad = /pipe bomb/i.test(body.messages[1].content);
  return { choices: [{ message: { content: JSON.stringify({ violation: bad, category: bad ? 'illegal' : 'none' }) } }] };
} } } };
const s = createContentSafety({ groq: fakeGroq });

let v = await s.screen('show the woman with nothing on', { route: 't' });
assert.equal(v.ok, false); assert.equal(v.message, BLOCKED_MESSAGE);
assert.equal(calls.length, 0, 'blocklist answers without a network call');
assert.equal((await s.screen('NUDE photoshoot')).ok, false);
assert.equal((await s.screen('the naked truth about saving money')).ok, true, 'blocklist exception');

calls.length = 0;
v = await s.screen('how to make a pipe bomb at home');
assert.equal(v.ok, false); assert.equal(v.category, 'illegal');
assert.deepEqual(calls, ['openai/gpt-oss-safeguard-20b', 'openai/gpt-oss-20b'], 'falls through the 429');

calls.length = 0;
assert.equal((await s.screen('5 tips to lose belly fat')).ok, true);
assert.equal((await s.screen('  5 TIPS to lose belly fat ')).ok, true);
assert.equal(calls.length, 2, 'second identical text is a cache hit');

calls.length = 0;
s.markCleared('a script the server wrote');
assert.equal((await s.screen('a script the server wrote')).ok, true);
assert.equal(calls.length, 0, 'cleared text is not re-screened');

// Every classifier down: fail open, and do not cache the pass.
const down = { chat: { completions: { create: async () => { throw Object.assign(new Error('down'), { status: 503 }); } } } };
const d = createContentSafety({ groq: down });
assert.equal((await d.screen('an ordinary idea')).ok, true);
assert.equal((await d.screen('porn video')).ok, false, 'blocklist still applies when classifiers are down');

// Long text is screened in chunks; a violation in a later chunk is found.
calls.length = 0;
v = await s.screen('Healthy habits. '.repeat(250) + ' how to make a pipe bomb');
assert.equal(v.ok, false);

console.log('content-safety: all checks passed');
