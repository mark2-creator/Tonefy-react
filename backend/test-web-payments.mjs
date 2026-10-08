// Web payments test (Oct 8 2026): live checks that the routes are OFF without keys, then the
// grant logic against real Firestore with a FAKE Flutterwave (pending, underpaid, wrong currency,
// other account, page+webhook race, replay, mid-pass block, webhook hash, expiry). Makes and
// deletes a disposable account. Run from this folder:
//   SA_PATH=./serviceAccountKey.json WEB_API_KEY=<website firebase apiKey> node test-web-payments.mjs
// Once real TEST keys are in .env the first two live checks will (correctly) fail.
import 'dotenv/config';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createWebPayments, currencyFor } from './webPayments.js';
import { tierConfig, isAdminUid } from './tiers.js';

const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

// ---- live HTTP checks while switched off
const uid = 'webpaytest-' + Date.now();
await getAuth().createUser({ uid, email: `${uid}@example.com`, emailVerified: true });
const custom = await getAuth().createCustomToken(uid);
const KEY = process.env.WEB_API_KEY;
const sr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) }).then(r => r.json());
const H = { Authorization: `Bearer ${sr.idToken}`, 'content-type': 'application/json' };
const API = 'https://api.fitlifesolutions.site';
let r = await fetch(`${API}/api/web-pay/config`, { headers: H }); let j = await r.json();
assert(r.status === 200 && j.enabled === false && j.passes.pro.amount === 30000 && j.plan === 'free', `live config off: ${JSON.stringify(j)}`);
r = await fetch(`${API}/api/web-pay/start`, { method: 'POST', headers: H, body: '{"plan":"pro"}' }); j = await r.json();
assert(r.status === 503, `live start refused while off: ${r.status} ${j.error}`);

// ---- logic with a fake Flutterwave
process.env.FLW_SECRET_KEY = 'FLWSECK_TEST-fake';
process.env.FLW_WEBHOOK_HASH = 'hash123';
let fakeTx = null; let lastStartBody = '{}'; const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.flutterwave.com')) return realFetch(url, init);
  calls.push(String(url));
  if (String(url).endsWith('/payments')) lastStartBody = init.body;
  if (String(url).endsWith('/payments')) {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify({ status: 'success', data: { link: 'https://checkout.flutterwave.com/x/' + b.tx_ref } }));
  }
  return new Response(JSON.stringify({ status: 'success', data: fakeTx }));
};
const wp = createWebPayments({ adminDb: db, getAuth, isAdminUid, tierConfig });

// test key + not on FLW_TEST_UIDS: refused before Flutterwave is called
delete process.env.FLW_TEST_UIDS;
let s = await wp.start(uid, 'pro');
assert(s.status === 503 && (await wp.config(uid)).enabled === false, `test mode refuses unlisted accounts: ${s.status}`);
process.env.FLW_TEST_UIDS = `someone-else, ${uid}`;
assert((await wp.config(uid)).enabled === true, 'test mode allows a listed tester');

// currency: shillings + mobile money for Uganda only, dollars by card for everyone else
assert(currencyFor({ country: 'Uganda' }, '') === 'UGX' && currencyFor({}, 'UG') === 'UGX'
  && currencyFor({ country: 'Brazil' }, 'GB') === 'USD' && currencyFor({}, '') === 'USD', 'currency rule');
assert((await wp.config(uid, 'GB')).currency === 'USD' && (await wp.config(uid, 'UG')).currency === 'UGX', 'config currency follows location');
s = await wp.start(uid, 'pro', 'US');
let usd = (await db.collection('webPayments').doc(s.txRef).get()).data();
const usdBody = JSON.parse(lastStartBody);
assert(usd.currency === 'USD' && usd.amount === 8.25 && usdBody.currency === 'USD' && usdBody.payment_options === 'card', `non-Ugandan: USD 8.25 card only (${usd.currency} ${usd.amount} ${usdBody.payment_options})`);
fakeTx = { id: 554, tx_ref: s.txRef, status: 'successful', currency: 'UGX', amount: 30000 };
let cu = await wp.confirm({ transactionId: 554, txRef: s.txRef, uid });
assert(cu.status === 400, 'a USD checkout paid in UGX is refused');
await db.collection('webPayments').doc(s.txRef).delete();

s = await wp.start(uid, 'pro', 'UG');
assert(JSON.parse(lastStartBody).payment_options === 'mobilemoneyuganda,card', 'Ugandan checkout offers mobile money');
assert(s.status === 200 && s.link.includes(s.txRef), 'start gives a checkout link');
const ref = s.txRef;
const pay = (await db.collection('webPayments').doc(ref).get()).data();
assert(pay.status === 'pending' && pay.amount === 30000 && pay.uid === uid, 'pending record written');

fakeTx = { id: 555, tx_ref: ref, status: 'pending', currency: 'UGX', amount: 30000 };
let c = await wp.confirm({ transactionId: 555, txRef: ref, uid });
assert(c.granted === false && c.state === 'pending', 'pending payment grants nothing');

fakeTx = { id: 555, tx_ref: ref, status: 'successful', currency: 'UGX', amount: 29000 };
c = await wp.confirm({ transactionId: 555, txRef: ref, uid });
assert(c.status === 400 && !c.granted, 'underpaid amount refused');
let u = (await db.collection('users').doc(uid).get()).data() || {};
assert(u.plan !== 'pro', 'underpaid did not change the plan');

// fresh checkout for the success path
await db.collection('webPayments').doc(ref).set({ status: 'pending' }, { merge: true });
fakeTx = { id: 556, tx_ref: ref, status: 'successful', currency: 'USD', amount: 30000 };
c = await wp.confirm({ transactionId: 556, txRef: ref, uid });
assert(c.status === 400, 'wrong currency refused');
await db.collection('webPayments').doc(ref).set({ status: 'pending' }, { merge: true });

fakeTx = { id: 557, tx_ref: ref, status: 'successful', currency: 'UGX', amount: 30000, payment_type: 'mobilemoneyug' };
c = await wp.confirm({ transactionId: 557, txRef: ref, uid: 'someone-else' });
assert(c.status === 403, 'another account cannot confirm it');
const both = await Promise.all([wp.confirm({ transactionId: 557, txRef: ref, uid }), wp.confirm({ transactionId: 557, txRef: ref })]);
assert(both.every(x => x.granted), 'page + webhook together both report granted');
u = (await db.collection('users').doc(uid).get()).data();
assert(u.plan === 'pro' && u.creditsRemaining === 60 && u.webPassStatus === 'active', `granted once: plan ${u.plan}, credits ${u.creditsRemaining}`);
c = await wp.confirm({ transactionId: 557, txRef: ref, uid });
assert(c.granted && (await db.collection('users').doc(uid).get()).data().creditsRemaining === 60, 'replay does not add credits');

s = await wp.start(uid, 'creator');
assert(s.status === 409, `second purchase blocked mid-pass: ${s.error}`);

// webhook auth
const mkRes = () => { const o = { code: 0, status(c) { o.code = c; return o; }, end() { return o; } }; return o; };
let res = mkRes(); await wp.webhook({ get: () => 'wrong', body: {} }, res); assert(res.code === 401, 'webhook with wrong hash refused');
res = mkRes(); await wp.webhook({ get: () => 'hash123', body: { data: { id: 557, tx_ref: ref } } }, res); assert(res.code === 200, 'webhook with right hash accepted');

// expiry
await db.collection('users').doc(uid).set({ webPassUntil: new Date(Date.now() - 1000).toISOString(), creditsRemaining: 42 }, { merge: true });
await wp.expireSweep();
u = (await db.collection('users').doc(uid).get()).data();
assert(u.plan === 'free' && u.webPassStatus === 'ended' && u.creditsRemaining === 10, `expired -> free with ${u.creditsRemaining} credits`);

// cleanup
await db.collection('webPayments').doc(ref).delete();
const more = await db.collection('webPayments').where('uid', '==', uid).get(); for (const d of more.docs) await d.ref.delete();
await db.collection('users').doc(uid).delete();
await getAuth().deleteUser(uid);
console.log('cleaned up; flutterwave calls:', calls.length);
