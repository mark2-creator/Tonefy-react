// Web payments test (Pesapal adapter, Oct 24 2026; Flutterwave version Oct 8): live checks that
// the routes are OFF without keys, then the grant logic against real Firestore with a FAKE
// Pesapal (unpaid/INVALID, failed, underpaid, wrong currency, other account, page+IPN race,
// replay, mid-pass block, IPN shape, reversal, expiry), then ONE real sandbox order with
// Pesapal's public demo keys. Makes and deletes a disposable account. Run from this folder:
//   SA_PATH=./serviceAccountKey.json WEB_API_KEY=<website firebase apiKey> node test-web-payments.mjs
// Once real keys are in .env the first two live checks will (correctly) fail.
import 'dotenv/config';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createWebPayments, regionFor, offerFor } from './webPayments.js';
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
assert(r.status === 200 && j.enabled === false && j.passes.pro.display === '$8.25' && j.plan === 'free', `live config off: ${JSON.stringify(j)}`);
r = await fetch(`${API}/api/web-pay/start`, { method: 'POST', headers: H, body: '{"plan":"pro"}' }); j = await r.json();
assert(r.status === 503, `live start refused while off: ${r.status} ${j.error}`);

// ---- logic with a fake Pesapal
process.env.PESAPAL_CONSUMER_KEY = 'fake-key';
process.env.PESAPAL_CONSUMER_SECRET = 'fake-secret';
delete process.env.PESAPAL_ENV; // sandbox
process.env.PESAPAL_IPN_ID = '11111111-2222-3333-4444-555555555555';
let fakeTx = null; let lastOrder = {}; const calls = []; let orderN = 0;
const realFetch = globalThis.fetch;
const reply = (o) => new Response(JSON.stringify(o));
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://cybqa.pesapal.com')) return realFetch(url, init);
  calls.push(String(url).replace(/^https:\/\/[^/]+\/pesapalv3\/api/, ''));
  if (String(url).endsWith('/Auth/RequestToken')) return reply({ token: 'tok', expiryDate: new Date(Date.now() + 300000).toISOString(), status: '200' });
  if (String(url).endsWith('/SubmitOrderRequest')) {
    lastOrder = JSON.parse(init.body);
    const id = `aaaaaaaa-bbbb-cccc-dddd-${String(++orderN).padStart(12, '0')}`;
    return reply({ order_tracking_id: id, merchant_reference: lastOrder.id, redirect_url: 'https://cybqa.pesapal.com/pay/' + id, error: null, status: '200' });
  }
  if (String(url).includes('/GetTransactionStatus')) return reply(fakeTx);
  return reply({ error: { code: 'x', message: 'unexpected ' + url } });
};
const wp = createWebPayments({ adminDb: db, getAuth, isAdminUid, tierConfig });
const txFor = (rec, code, extra = {}) => ({ status_code: code, payment_status_description: ['INVALID', 'COMPLETED', 'FAILED', 'REVERSED'][code],
  merchant_reference: rec.ref, order_tracking_id: rec.tracking, currency: rec.currency, amount: rec.amount, payment_method: 'MTN', status: '200', ...extra });

// sandbox + not on PESAPAL_TEST_UIDS: refused before Pesapal is called
delete process.env.PESAPAL_TEST_UIDS;
let s = await wp.start(uid, 'pro');
assert(s.status === 503 && (await wp.config(uid)).enabled === false && calls.length === 0, `sandbox refuses unlisted accounts: ${s.status}`);
assert((await wp.config(null)).enabled === false, 'signed-out visitors never see Pay in sandbox');
process.env.PESAPAL_TEST_UIDS = `someone-else, ${uid}`;
assert((await wp.config(uid)).enabled === true, 'sandbox allows a listed tester');

// prices: shillings for Uganda, dollars by card for everyone else
assert(regionFor({ country: 'Uganda' }, '') === 'UG' && regionFor({ country: 'Uganda' }, 'GH') === 'GH'
  && regionFor({ country: 'United Kingdom' }, '') === 'GB' && regionFor({}, '') === '', 'region: location first, then profile');
assert(offerFor('UG', 'pro').amount === 30000 && offerFor('GH', 'creator').display === '$17.69'
  && offerFor('US', 'pro').amount === 13.99 && offerFor('KE', 'pro').display === '$8.25', 'offers follow Play prices');
assert((await wp.config(uid, 'GB')).passes.pro.display === '$13.99' && (await wp.config(uid, 'UG')).passes.pro.currency === 'UGX', 'config price follows location');

s = await wp.start(uid, 'pro', 'US');
let rec = (await db.collection('webPayments').doc(s.txRef).get()).data();
assert(rec.currency === 'USD' && rec.amount === 13.99 && lastOrder.currency === 'USD' && lastOrder.amount === 13.99
  && lastOrder.notification_id === process.env.PESAPAL_IPN_ID && lastOrder.id === s.txRef && lastOrder.id.length <= 50
  && lastOrder.description.length <= 100 && lastOrder.billing_address.email_address === `${uid}@example.com`
  && lastOrder.callback_url.endsWith('/payment-done.html') && /status=cancelled/.test(lastOrder.cancellation_url),
  `US order: USD 13.99, our ref, IPN id, email, callback (${JSON.stringify(lastOrder).slice(0, 160)})`);
assert(rec.orderTrackingId && s.link.startsWith('https://cybqa.pesapal.com/'), 'tracking id stored, link is Pesapal');
fakeTx = txFor({ ref: s.txRef, tracking: rec.orderTrackingId, currency: 'UGX', amount: 30000 }, 1);
let cu = await wp.confirm({ orderTrackingId: rec.orderTrackingId, txRef: s.txRef, uid });
assert(cu.status === 400, 'a USD checkout paid in UGX is refused');
await db.collection('webPayments').doc(s.txRef).delete();

s = await wp.start(uid, 'pro', 'UG');
assert(s.status === 200 && lastOrder.currency === 'UGX' && lastOrder.amount === 30000 && lastOrder.billing_address.country_code === 'UG', 'Ugandan order in shillings');
const ref = s.txRef;
rec = (await db.collection('webPayments').doc(ref).get()).data();
const tracking = rec.orderTrackingId;
assert(rec.status === 'pending' && rec.amount === 30000 && rec.uid === uid && rec.provider === 'pesapal' && rec.env === 'sandbox', 'pending record written');
const T = (code, extra) => txFor({ ref, tracking, currency: 'UGX', amount: 30000 }, code, extra);

fakeTx = T(0);
let c = await wp.confirm({ orderTrackingId: tracking, txRef: ref, uid });
assert(c.granted === false && c.state === 'pending', 'unpaid (INVALID) is pending, not failed');
c = await wp.confirm({ txRef: ref, uid });
assert(c.state === 'pending', 'the reference alone is enough (tracking id read from our record)');

fakeTx = T(2);
c = await wp.confirm({ orderTrackingId: tracking, txRef: ref, uid });
assert(c.granted === false && c.state === 'failed', 'FAILED is failed');
await db.collection('webPayments').doc(ref).set({ status: 'pending' }, { merge: true });

fakeTx = T(1, { amount: 29000 });
c = await wp.confirm({ orderTrackingId: tracking, txRef: ref, uid });
assert(c.status === 400 && !c.granted, 'underpaid amount refused');
let u = (await db.collection('users').doc(uid).get()).data() || {};
assert(u.plan !== 'pro', 'underpaid did not change the plan');
await db.collection('webPayments').doc(ref).set({ status: 'pending' }, { merge: true });

fakeTx = T(1, { currency: 'USD' });
c = await wp.confirm({ orderTrackingId: tracking, txRef: ref, uid });
assert(c.status === 400, 'wrong currency refused');
await db.collection('webPayments').doc(ref).set({ status: 'pending' }, { merge: true });

fakeTx = T(1, { merchant_reference: 'tfy-somebody-else-00000000' });
c = await wp.confirm({ orderTrackingId: tracking, txRef: ref, uid });
assert(c.status === 400, "another order's tracking id cannot confirm this checkout");

fakeTx = T(1, { confirmation_code: 'MTN123' });
c = await wp.confirm({ orderTrackingId: tracking, txRef: ref, uid: 'someone-else' });
assert(c.status === 403, 'another account cannot confirm it');
const mkRes = () => { const o = { body: null, json(b) { o.body = b; return o; } }; return o; };
const ipnRes = mkRes();
const both = await Promise.all([wp.confirm({ orderTrackingId: tracking, txRef: ref, uid }),
  wp.ipn({ query: { OrderTrackingId: tracking, OrderMerchantReference: ref, OrderNotificationType: 'IPNCHANGE' } }, ipnRes)]);
assert(both[0].granted && ipnRes.body?.status === 200 && ipnRes.body.orderTrackingId === tracking
  && ipnRes.body.orderMerchantReference === ref && ipnRes.body.orderNotificationType === 'IPNCHANGE', `page + IPN together: granted, IPN answered ${JSON.stringify(ipnRes.body)}`);
u = (await db.collection('users').doc(uid).get()).data();
assert(u.plan === 'pro' && u.creditsRemaining === 60 && u.webPassStatus === 'active', `granted once: plan ${u.plan}, credits ${u.creditsRemaining}`);
c = await wp.confirm({ orderTrackingId: tracking, txRef: ref, uid });
assert(c.granted && (await db.collection('users').doc(uid).get()).data().creditsRemaining === 60, 'replay does not add credits');
rec = (await db.collection('webPayments').doc(ref).get()).data();
assert(rec.status === 'granted' && rec.confirmationCode === 'MTN123', 'record granted with the provider confirmation code');

s = await wp.start(uid, 'creator');
assert(s.status === 409, `second purchase blocked mid-pass: ${s.error}`);

// IPN with junk is answered 500 without calling Pesapal
const before = calls.length; const junk = mkRes();
await wp.ipn({ query: { OrderTrackingId: 'nope', OrderMerchantReference: '../x' } }, junk);
assert(junk.body.status === 500 && calls.length === before, 'junk IPN refused without a Pesapal call');

// reversal after the grant is recorded, not silently undone
fakeTx = T(3);
c = await wp.confirm({ orderTrackingId: tracking, txRef: ref });
rec = (await db.collection('webPayments').doc(ref).get()).data();
assert(c.state === 'reversed' && rec.status === 'reversed-after-grant' && (await db.collection('users').doc(uid).get()).data().plan === 'pro', 'reversal recorded for the owner');

// expiry
await db.collection('users').doc(uid).set({ webPassUntil: new Date(Date.now() - 1000).toISOString(), creditsRemaining: 42 }, { merge: true });
await wp.expireSweep();
u = (await db.collection('users').doc(uid).get()).data();
assert(u.plan === 'free' && u.webPassStatus === 'ended' && u.creditsRemaining === 10, `expired -> free with ${u.creditsRemaining} credits`);

// ---- one REAL sandbox order with Pesapal's public demo keys (Ugandan merchant)
globalThis.fetch = realFetch;
process.env.PESAPAL_CONSUMER_KEY = 'TDpigBOOhs+zAl8cwH2Fl82jJGyD8xev';
process.env.PESAPAL_CONSUMER_SECRET = '1KpqkfsMaihIcOlhnBo/gBZ5smw=';
delete process.env.PESAPAL_IPN_ID; // let it register one
const wp2 = createWebPayments({ adminDb: db, getAuth, isAdminUid, tierConfig });
s = await wp2.start(uid, 'pro', 'UG');
assert(s.status === 200 && /^https:\/\/cybqa\.pesapal\.com\//.test(s.link), `real sandbox checkout page: ${s.link}`);
c = await wp2.confirm({ txRef: s.txRef, uid });
assert(c.status === 200 && c.state === 'pending', `real sandbox unpaid order reads pending: ${JSON.stringify(c)}`);

// cleanup
const more = await db.collection('webPayments').where('uid', '==', uid).get(); for (const d of more.docs) await d.ref.delete();
await db.collection('users').doc(uid).delete();
await getAuth().deleteUser(uid);
console.log('cleaned up; fake pesapal calls:', calls.length);
