import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrial, normalizeEmail, networkOf, cleanBrowserId, trialMessage, trialSecret, PER_NETWORK } from '../src/trial.js';

/** An in-memory stand-in for the parts of supabase.js the trial uses. */
function fakeDb() {
  const claims = []; // { kind, key_hash, user_id, at }
  const ledger = new Map();
  const accounts = new Map();
  let t = Date.parse('2026-11-13T12:00:00Z');
  return {
    claims, ledger, accounts,
    advance: (days) => (t += days * 864e5),
    now: () => t,
    countTrialClaims: async (kind, hash, sinceIso) => claims.filter((c) => c.kind === kind && c.key_hash === hash && c.at >= Date.parse(sinceIso)).length,
    addTrialClaims: async (rows) => rows.forEach((r) => claims.push({ ...r, at: t })),
    hasLedgerRef: async (ref) => ledger.has(ref),
    grantCredits: async (userId, amount, _reason, ref) => {
      if (!ledger.has(ref)) {
        ledger.set(ref, amount);
        accounts.set(userId, (accounts.get(userId) || 0) + amount);
      }
      return accounts.get(userId);
    },
    updateAccount: async (userId, fields) => accounts.set(`${userId}:status`, fields.trial_status),
  };
}
const setup = () => {
  const db = fakeDb();
  const trial = createTrial({ db, secret: 'test-secret', freeCredits: 10, now: db.now, log: () => {}, blockedDomains: ['spam.example'] });
  let n = 0;
  const signUp = (email, browserId, ip) => {
    const user = { id: `u${++n}`, email };
    return trial.claim({ user, account: { user_id: user.id, credits: 0 }, browserId, ip }).then((r) => ({ ...r, user }));
  };
  return { db, trial, signUp };
};
const B = (n) => `browser-${String(n).padStart(12, '0')}`;

test('emails: Gmail dots and +tags are the same inbox', () => {
  assert.equal(normalizeEmail('Jane.Doe+vocco@GoogleMail.com'), 'janedoe@gmail.com');
  assert.equal(normalizeEmail('jane.doe+x@work.com'), 'jane.doe@work.com');
  assert.equal(normalizeEmail('nope'), '');
});

test('networks: IPv4 as is, IPv6 by its /64', () => {
  assert.equal(networkOf('::ffff:81.2.3.4'), '81.2.3.4');
  assert.equal(networkOf('2001:db8:0:12::1'), '2001:db8:0:12::/64');
  assert.equal(networkOf('2001:0db8:0000:0012:abcd:1:2:3'), '2001:db8:0:12::/64');
  assert.equal(networkOf(''), '');
});

test('browser ids: only plain tokens', () => {
  assert.equal(cleanBrowserId('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  assert.equal(cleanBrowserId('short'), '');
  assert.equal(cleanBrowserId('<script>alert(1)</script>xxxxxx'), '');
});

test('a new person gets the free credits once', async () => {
  const { db, signUp, trial } = setup();
  const r = await signUp('jane@example.com', B(1), '81.2.3.4');
  assert.deepEqual([r.status, r.justGranted, r.balance], ['granted', true, 10]);
  assert.equal(db.claims.length, 3); // email, browser, network
  assert.ok(db.claims.every((c) => /^[0-9a-f]{40}$/.test(c.key_hash))); // hashes, never raw values
  assert.ok(!JSON.stringify(db.claims).includes('jane'));
  // The same account asking again: the stored status answers, no second grant.
  const again = await trial.claim({ user: r.user, account: { user_id: r.user.id, trial_status: 'granted' }, browserId: B(1), ip: '81.2.3.4' });
  assert.deepEqual(again, { status: 'granted' });
  assert.equal(db.ledger.size, 1);
});

test('the same inbox, browser or a busy network gets none the second time', async () => {
  const { signUp } = setup();
  await signUp('jane.doe@gmail.com', B(1), '81.2.3.4');
  const sameInbox = await signUp('janedoe+2@gmail.com', B(2), '9.9.9.9');
  assert.deepEqual([sameInbox.status, sameInbox.reason], ['denied', 'email']);
  const sameBrowser = await signUp('other@example.com', B(1), '9.9.9.8');
  assert.equal(sameBrowser.reason, 'browser');
  assert.match(trialMessage(sameBrowser.reason), /this browser/);
});

test('a shared network allows a few, then waits 30 days', async () => {
  const { db, signUp } = setup();
  for (let i = 0; i < PER_NETWORK; i++) assert.equal((await signUp(`p${i}@uni.example`, B(10 + i), '2001:db8:0:12::5')).status, 'granted');
  const fourth = await signUp('p9@uni.example', B(20), '2001:db8:0:12::abcd'); // same /64
  assert.equal(fourth.reason, 'network');
  db.advance(31);
  assert.equal((await signUp('p10@uni.example', B(21), '2001:db8:0:12::abcd')).status, 'granted');
});

test('throwaway inboxes get none (built-in and extra domains)', async () => {
  const { signUp, db } = setup();
  assert.equal((await signUp('x@mailinator.com', B(1), '1.1.1.1')).reason, 'disposable');
  assert.equal((await signUp('x@mail.spam.example', B(2), '1.1.1.2')).reason, 'disposable');
  assert.equal(db.ledger.size, 0);
  assert.match(trialMessage('disposable'), /usual email/);
});

test('a refusal is remembered on the account', async () => {
  const { signUp, db } = setup();
  await signUp('jane@example.com', B(1), '1.1.1.1');
  const r = await signUp('jane@example.com', B(2), '1.1.1.2');
  assert.equal(db.accounts.get(`${r.user.id}:status`), 'denied:email');
});

test('the hash secret: TRIAL_SECRET, or derived from the Supabase key', () => {
  assert.equal(trialSecret({ trialSecret: 'abc' }), 'abc');
  assert.equal(trialSecret({ supabaseKey: 'k1' }), trialSecret({ supabaseKey: 'k1' }));
  assert.notEqual(trialSecret({ supabaseKey: 'k1' }), trialSecret({ supabaseKey: 'k2' }));
  assert.throws(() => createTrial({ db: {}, secret: '' }));
});
